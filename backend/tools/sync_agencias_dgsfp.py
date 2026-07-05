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


async def _scrape(limite: int | None):
    """Devuelve (aseguradoras, agencias, vinculos): dicts por clave + lista de pares."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Abriendo el registro DGSFP (sesión/anti-bot)…")
        await page.goto(f"{BASE}/Aseguradora", wait_until="networkidle", timeout=60000)

        r = await page.request.post(f"{BASE}/Aseguradora/GetAseguradorasBusqueda", data=BUSQUEDA_ACTIVAS,
                                    headers={"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                                             "x-requested-with": "XMLHttpRequest"})
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
        return aseguradoras, agencias, vinculos


def _upsert(aseguradoras: dict, agencias: dict, vinculos: list):
    db = SessionLocal()
    ahora = dt.datetime.now(dt.timezone.utc)
    hoy = ahora.date()
    try:
        # Aseguradoras y agencias (upsert por PK)
        for clave, info in aseguradoras.items():
            o = db.get(DgsfpAseguradora, clave) or DgsfpAseguradora(clave=clave)
            o.nombre, o.nif, o.telefono, o.situacion = info["nombre"], info["nif"], info["telefono"], info["situacion"]
            db.add(o)
        for clave, nombre in agencias.items():
            o = db.get(DgsfpAgencia, clave) or DgsfpAgencia(clave=clave)
            o.nombre = nombre
            db.add(o)
        db.flush()

        # Vínculos: índice de los existentes para upsert; marcar bajas los no vistos
        existentes = {(v.aseguradora_clave, v.agencia_clave): v for v in db.query(DgsfpVinculo).all()}
        vistos = set(vinculos)
        altas = 0
        for par in vistos:
            v = existentes.get(par)
            if v is None:
                v = DgsfpVinculo(aseguradora_clave=par[0], agencia_clave=par[1], primera_sync=ahora)
                db.add(v)
                altas += 1
            v.activo = True
            v.ultima_sync = ahora
            v.fecha_baja = None
        bajas = 0
        for par, v in existentes.items():
            if par not in vistos and v.activo:
                v.activo = False
                v.fecha_baja = hoy
                bajas += 1

        # Sello de sincronización
        pr = db.get(Parametro, CLAVE_PARAM) or Parametro(clave=CLAVE_PARAM)
        pr.valor = len(vistos)
        pr.descripcion = f"Sincronización DGSFP agencias de suscripción ({len(aseguradoras)} compañías, {len(vistos)} vínculos)"
        db.add(pr)
        db.commit()
        print(f"\nHecho: {len(aseguradoras)} compañías, {len(agencias)} agencias, {len(vistos)} vínculos "
              f"(altas nuevas: {altas}, bajas: {bajas}).")
    finally:
        db.close()


def main(limite: int | None = None):
    aseguradoras, agencias, vinculos = asyncio.run(_scrape(limite))
    _upsert(aseguradoras, agencias, vinculos)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
