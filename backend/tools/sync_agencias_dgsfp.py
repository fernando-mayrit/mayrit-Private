"""Sincroniza el Registro de la DGSFP (aseguradoras ↔ agencias de suscripción) en la BD de Mayrit.

Raspa rrpp.dgsfp.mineco.es con Playwright (el registro tiene anti-bot y carga por API/JS) y hace
UPSERT en dgsfp_aseguradoras / dgsfp_agencias / dgsfp_vinculos. Los vínculos que ya no aparecen se
marcan activo=False (no se borran: se conserva histórico). Guarda la fecha de sincronización en
parametros['dgsfp_agencias_sync'].

Ejecutar EN LOCAL (producción/Azure no puede scrapear). La tarea programada mensual lo llama; el
backend local escribe en la BD de producción, así que actualiza también el móvil.

    ~/.mayrit/venv/Scripts/python.exe -m tools.sync_agencias_dgsfp
    (opcional) ... -m tools.sync_agencias_dgsfp 200   # limitar nº de entidades (prueba)

Requiere Playwright en el venv local (no en requirements.txt: Azure no scrapea):
    pip install playwright   &&   playwright install chromium
"""
import asyncio
import datetime as dt
import json
import re
import sys

from playwright.async_api import async_playwright

from app.db import SessionLocal
from app.models.maestras import DgsfpAgencia, DgsfpAseguradora, DgsfpVinculo, Parametro

BASE = "https://rrpp.dgsfp.mineco.es"
BUSQUEDA_ACTIVAS = ("OperadorClave=4&Clave=&OperadorCif=4&Cif=&OperadorDescripcion=3&Descripcion="
                    "&Situacion=1&Ambito=&TipoEntidad=&OpcionBusqueda=actividad&TipoActividadSeleccionada=--"
                    "&Ramo=--&Prestacion=&RamosTexto=&PrestacionesTexto=&EEE=true&BusquedaCombinadaRamos=True"
                    "&Gestora=false&Espannola=false&PaisOrigenLPS=false&PaisOrigenDE=false&EEE=false")
# El array de agencias va pegado a loadGridAgencias(data); [^;]* evita cruzar el ';' de otras sentencias.
RE_AGENCIAS = re.compile(r"var\s+data\s*=\s*(\[[^;]*\])\s*;\s*loadGridAgencias\(")
CLAVE_PARAM = "dgsfp_agencias_sync"


def _agencias_de_html(html: str) -> list[dict]:
    m = RE_AGENCIAS.search(html)
    if not m:
        return []
    try:
        arr = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    return [{"clave": (a.get("idAgencia") or "").strip(), "nombre": (a.get("nombreLargo") or "").strip()}
            for a in arr if a.get("idAgencia")]


# Búsqueda con TODAS las situaciones: para saber la situación real (Activa/Cancelada/Liquidación…)
# de cada aseguradora referenciada, y así marcar `licencia_activa`.
BUSQUEDA_TODAS = BUSQUEDA_ACTIVAS.replace("&Situacion=1&", "&Situacion=&")


async def _scrape(limite: int | None):
    """Devuelve (aseguradoras, agencias, vinculos, situ_map). situ_map = clave→situación (todas)."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Abriendo el registro DGSFP (sesión/anti-bot)…")
        await page.goto(f"{BASE}/Aseguradora", wait_until="networkidle", timeout=60000)
        hdr = {"content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest"}

        # Situación de TODAS las entidades (para licencia_activa)
        rt = await page.request.post(f"{BASE}/Aseguradora/GetAseguradorasBusqueda", data=BUSQUEDA_TODAS, headers=hdr)
        situ_map = {e["clave"]: e.get("situacion") for e in await rt.json()}

        r = await page.request.post(f"{BASE}/Aseguradora/GetAseguradorasBusqueda", data=BUSQUEDA_ACTIVAS, headers=hdr)
        entidades = await r.json()
        if limite:
            entidades = entidades[:limite]
        total = len(entidades)
        print(f"  {total} entidades activas. Leyendo agencias de suscripción de cada ficha…")

        aseguradoras: dict[str, dict] = {}
        agencias: dict[str, str] = {}
        vinculos: list[tuple[str, str]] = []
        for i, e in enumerate(entidades, 1):
            clave = e["clave"]
            try:
                rr = await page.request.get(
                    f"{BASE}/Aseguradora/GetAseguradora/?culture=es-ES&ui-culture=es-ES&clave={clave}")
                ags = _agencias_de_html(await rr.text())
            except Exception as ex:
                print(f"  ! error en {clave}: {ex}")
                ags = []
            if ags:
                aseguradoras[clave] = {"nombre": e.get("descripcion", ""), "nif": e.get("cif"),
                                       "telefono": e.get("telefono"), "situacion": e.get("situacion")}
                for a in ags:
                    agencias[a["clave"]] = a["nombre"]
                    vinculos.append((clave, a["clave"]))
            if i % 100 == 0 or i == total:
                print(f"  {i}/{total}  (compañías con agencias: {len(aseguradoras)})")
            await page.wait_for_timeout(60)
        await browser.close()
        return aseguradoras, agencias, vinculos, situ_map


def _upsert(aseguradoras: dict, agencias: dict, vinculos: list, situ_map: dict) -> dict:
    """Aplica la sync y devuelve un dict de CAMBIOS respecto al estado anterior (para el informe).
    NO toca el `activo` manual de los vínculos; solo actualiza presencia (en_dgsfp) y la situación/
    licencia de las aseguradoras."""
    db = SessionLocal()
    ahora = dt.datetime.now(dt.timezone.utc)
    hoy = ahora.date()
    C = {"agencias_nuevas": [], "aseguradoras_nuevas": [], "vinculos_nuevos": [],
         "vinculos_desaparecidos": [], "vinculos_reaparecidos": [], "licencia_cambios": []}
    try:
        # Agencias (upsert por PK; solo nombre oficial, no la ficha manual)
        for clave, nombre in agencias.items():
            o = db.get(DgsfpAgencia, clave)
            if o is None:
                o = DgsfpAgencia(clave=clave, nombre=nombre); db.add(o)
                C["agencias_nuevas"].append(f"{clave} {nombre}")
            else:
                o.nombre = nombre or o.nombre

        # Aseguradoras (nombre/nif/tel de las que tienen agencias) + situación/licencia de TODAS las
        # referenciadas (incluidas las que solo salen en vínculos históricos).
        referidas = {ase for ase, _ in vinculos} | {v.aseguradora_clave for v in db.query(DgsfpVinculo).all()}
        for clave in referidas | set(aseguradoras):
            o = db.get(DgsfpAseguradora, clave)
            info = aseguradoras.get(clave)
            if o is None:
                o = DgsfpAseguradora(clave=clave, nombre=(info or {}).get("nombre") or clave)
                db.add(o)
                C["aseguradoras_nuevas"].append(f"{clave} {o.nombre}")
            elif info:
                o.nombre = info["nombre"] or o.nombre; o.nif = info["nif"]; o.telefono = info["telefono"]
            situ = situ_map.get(clave)
            lic = (situ == "Activa")
            if situ and situ != o.situacion:
                C["licencia_cambios"].append(f"{clave} {o.nombre}: {o.situacion or '—'} → {situ}")
            if situ:
                o.situacion = situ
            o.licencia_activa = lic
        db.flush()

        # Vínculos: presencia en el registro. NO se toca `activo` (lo controla el usuario).
        existentes = {(v.aseguradora_clave, v.agencia_clave): v for v in db.query(DgsfpVinculo).all()}
        vistos = set(vinculos)
        nom = lambda c: (db.get(DgsfpAgencia, c) and db.get(DgsfpAgencia, c).nombre) or c
        for par in vistos:
            v = existentes.get(par)
            if v is None:
                v = DgsfpVinculo(aseguradora_clave=par[0], agencia_clave=par[1], primera_sync=ahora,
                                 activo=True, en_dgsfp=True)
                db.add(v)
                C["vinculos_nuevos"].append(f"{par[0]} ↔ {par[1]} {nom(par[1])}")
            else:
                if not v.en_dgsfp:
                    C["vinculos_reaparecidos"].append(f"{par[0]} ↔ {par[1]} {nom(par[1])}")
                v.en_dgsfp = True
            v.dgsfp_visto = hoy
            v.ultima_sync = ahora
        for par, v in existentes.items():
            if par not in vistos and v.en_dgsfp:
                v.en_dgsfp = False
                C["vinculos_desaparecidos"].append(f"{par[0]} ↔ {par[1]} {nom(par[1])}")

        pr = db.get(Parametro, CLAVE_PARAM) or Parametro(clave=CLAVE_PARAM)
        pr.valor = len(vistos)
        pr.descripcion = f"Sync DGSFP: {len(aseguradoras)} compañías, {len(vistos)} vínculos en registro"
        db.add(pr)
        db.commit()
        return C
    finally:
        db.close()


def _informe(cambios: dict) -> str:
    """Informe markdown de los cambios de este mes respecto al anterior."""
    hoy = dt.date.today().isoformat()
    L = [f"# Informe de cambios DGSFP — {hoy}", ""]
    secciones = [
        ("Vínculos NUEVOS en el registro", "vinculos_nuevos"),
        ("Vínculos que YA NO están en el registro", "vinculos_desaparecidos"),
        ("Vínculos que REAPARECEN en el registro", "vinculos_reaparecidos"),
        ("Agencias nuevas", "agencias_nuevas"),
        ("Aseguradoras nuevas", "aseguradoras_nuevas"),
        ("Cambios de licencia/situación de aseguradoras", "licencia_cambios"),
    ]
    total = sum(len(cambios[k]) for _, k in secciones)
    if total == 0:
        L.append("_Sin cambios respecto al mes anterior._")
    for titulo, k in secciones:
        items = cambios[k]
        if items:
            L.append(f"## {titulo} ({len(items)})")
            L += [f"- {x}" for x in sorted(items)]
            L.append("")
    return "\n".join(L)


def main(limite: int | None = None):
    from pathlib import Path
    aseguradoras, agencias, vinculos, situ_map = asyncio.run(_scrape(limite))
    cambios = _upsert(aseguradoras, agencias, vinculos, situ_map)
    n_cambios = sum(len(v) for v in cambios.values())
    print(f"\nHecho: {len(aseguradoras)} compañías, {len(agencias)} agencias, {len(vinculos)} vínculos en el registro. "
          "No se toca el 'activo' manual.")
    # Solo se genera el informe SI hay cambios (su existencia = alerta en el módulo Agencias).
    if n_cambios == 0:
        print("Sin cambios respecto al mes anterior: no se genera informe.")
        return
    carpeta = Path(__file__).parent / "informes_dgsfp"
    carpeta.mkdir(exist_ok=True)
    ruta = carpeta / f"informe_{dt.date.today().isoformat()}.md"
    ruta.write_text(_informe(cambios), encoding="utf-8")
    print(f"Informe de cambios ({n_cambios}): {ruta}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
