"""Analítica de la web pública (www.mayritbroker.com) dentro de Mayrit.

Cadena del dato: baliza de Cloudflare (sin cookies) → API GraphQL de Cloudflare (`app/cloudflare.py`)
→ ARCHIVO en nuestras tablas `web_visitas_dia` / `web_visitas_detalle` → esta API → pantalla.

La pantalla lee SIEMPRE de nuestra BD, nunca de Cloudflare en directo. Cloudflare purga el detalle a
los pocos días; el archivo propio no caduca, así que el histórico crece solo con abrir la pantalla de
vez en cuando (no hace falta instalar ninguna tarea programada en los PCs, a diferencia de los syncs
de DGSFP/proyección). El estado de la última sincronización se guarda en `sync_estado` (clave
``web_analytics``), la misma tabla que usa el runner de syncs.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .. import cloudflare
from ..config import settings
from ..db import get_db
from ..models.maestras import SyncEstado, WebVisitaDetalle, WebVisitaDia

router = APIRouter(prefix="/web", tags=["Analítica web"])

CLAVE_SYNC = "web_analytics"
FRESCURA_MIN = 30       # minutos: por debajo de esto, abrir la pantalla no vuelve a llamar a Cloudflare
DIAS_AL_VUELO = 7       # ventana que se refresca en cada visita (y máximo exacto de Cloudflare)
DIAS_PRIMERA_VEZ = 28   # la primera vez se intenta rescatar todo lo que Cloudflare aún conserve
TOP = 10                # filas por desglose


# ── Archivo (Cloudflare → BD) ───────────────────────────────────────────────────────────────────
def _sincronizar(db: Session, dias: int) -> dict:
    """Baja los últimos `dias` de Cloudflare y los archiva. Devuelve un resumen del resultado.

    Los días que vienen se REESCRIBEN enteros (borrar detalle + insertar): Cloudflare puede afinar
    las cifras de un día durante unas horas, y así nunca se duplica ni se queda un valor viejo."""
    hasta = dt.date.today()
    desde = hasta - dt.timedelta(days=max(1, dias) - 1)
    datos = cloudflare.datos(desde, hasta)

    dias_tocados = sorted({f["dia"] for f in datos["total"]})
    for f in datos["total"]:
        db.execute(
            pg_insert(WebVisitaDia)
            .values(dia=f["dia"], visitas=f["visitas"], paginas_vistas=f["vistas"])
            .on_conflict_do_update(
                index_elements=["dia"],
                set_={"visitas": f["visitas"], "paginas_vistas": f["vistas"], "actualizado": func.now()},
            )
        )

    if dias_tocados:
        db.execute(delete(WebVisitaDetalle).where(WebVisitaDetalle.dia.in_(dias_tocados)))
    filas = 0
    for tipo in cloudflare.DESGLOSES:
        for f in datos[tipo]:
            if f["dia"] not in dias_tocados:
                continue                                   # día sin total: no lo archivamos a medias
            db.add(WebVisitaDetalle(
                dia=f["dia"], tipo=tipo, valor=f["valor"][:300],
                visitas=f["visitas"], paginas_vistas=f["vistas"],
            ))
            filas += 1
    db.commit()
    return {"dias": len(dias_tocados), "filas_detalle": filas,
            "desde": desde.isoformat(), "hasta": hasta.isoformat()}


def _estado(db: Session) -> SyncEstado:
    est = db.get(SyncEstado, CLAVE_SYNC)
    if est is None:
        est = SyncEstado(clave=CLAVE_SYNC)
        db.add(est)
        db.commit()
    return est


def _sincronizar_si_toca(db: Session, forzar: bool = False, dias: int | None = None) -> str | None:
    """Refresca desde Cloudflare si hace falta. Devuelve el error (texto) si lo hubo, o None.

    Un fallo NO rompe la pantalla: se enseña lo archivado y se avisa de que el refresco falló."""
    est = _estado(db)
    ahora = dt.datetime.now(dt.timezone.utc)
    if not forzar:
        if est.ultimo_ok and (ahora - est.ultimo_ok).total_seconds() < FRESCURA_MIN * 60:
            return None
        dias = DIAS_AL_VUELO if est.ultimo_ok else DIAS_PRIMERA_VEZ

    est.ultimo_intento = ahora
    db.commit()
    try:
        _sincronizar(db, dias or DIAS_AL_VUELO)
    except Exception as e:                                  # Cloudflare caído, token caducado…
        db.rollback()
        est = _estado(db)
        est.ultimo_error = str(e)[:500]
        est.ultimo_intento = ahora
        db.commit()
        return str(e)
    est = _estado(db)
    est.ultimo_ok = ahora
    est.ultimo_error = None
    db.commit()
    return None


# ── Ruido de robots ─────────────────────────────────────────────────────────────────────────────
# Rutas que NO existen en la web y que solo piden robots rastreando internet en busca de webs de
# WordPress (o de ficheros de configuración) para colarse por algún fallo conocido. Ninguna es de
# Mayrit: la web es UNA página y su único .php es contacto.php.
#
# POR QUÉ ESTABAN CONTANDO COMO VISITAS: el `.htaccess` servía `/index.html` para cualquier ruta
# inexistente, y el index lleva la baliza de Cloudflare → cada trastazo se archivaba como visita
# real. El 2026-08-20 eso infló un día de 7 visitas a 45 (38 robots desde China).
#
# ARREGLADO EN LA WEB el 2026-08-20: ahora `ErrorDocument 404 /404.html`, una página propia SIN
# baliza. De aquí en adelante el ruido ya no entra. Esta lista sirve para limpiar lo YA ARCHIVADO
# (y por si algún día vuelve a colarse algo).
RUTAS_ROBOT = (
    "/wp-content", "/wp-admin", "/wp-includes", "/wp-json", "/wp-login", "/wordpress",
    "/xmlrpc.php", "/.env", "/.git", "/vendor/", "/phpmyadmin", "/phpunit",
    "/administrator", "/autodiscover", "/cgi-bin", "/.well-known/traffic-advice",
)


def _es_ruido(ruta: str | None) -> bool:
    """¿Esta ruta es de un robot rastreando, y no de una persona mirando la web?"""
    r = (ruta or "").lower()
    return any(r.startswith(p) for p in RUTAS_ROBOT)


def _ruido_por_dia(db: Session, desde: dt.date, hasta: dt.date) -> dict[dt.date, int]:
    """Visitas de robots por día = suma de las peticiones a rutas que no existen.

    Solo se puede descontar del TOTAL y del ranking de páginas. Los demás desgloses (país,
    navegador…) los da Cloudflare como rankings independientes, sin decir qué visita fue a qué
    página, así que ahí el ruido de los días anteriores al arreglo no se puede separar."""
    filas = db.execute(
        select(WebVisitaDetalle.dia, WebVisitaDetalle.valor, WebVisitaDetalle.visitas)
        .where(WebVisitaDetalle.tipo == "pagina",
               WebVisitaDetalle.dia >= desde, WebVisitaDetalle.dia <= hasta)
    ).all()
    out: dict[dt.date, int] = {}
    for dia, valor, visitas in filas:
        if _es_ruido(valor):
            out[dia] = out.get(dia, 0) + int(visitas or 0)
    return out


# ── Lectura (BD → pantalla) ─────────────────────────────────────────────────────────────────────
def _serie(db: Session, desde: dt.date, hasta: dt.date) -> list[dict]:
    """Un punto por día del periodo, con ceros en los días sin visitas. La serie no empieza antes
    del primer día del que hay dato (si no, un periodo largo saldría con meses planos de relleno)."""
    filas = db.execute(
        select(WebVisitaDia).where(WebVisitaDia.dia >= desde, WebVisitaDia.dia <= hasta)
        .order_by(WebVisitaDia.dia)
    ).scalars().all()
    if not filas:
        return []
    por_dia = {f.dia: f for f in filas}
    ruido = _ruido_por_dia(db, desde, hasta)
    ini = max(desde, min(por_dia))
    out, d = [], ini
    while d <= hasta:
        f = por_dia.get(d)
        visitas = f.visitas if f else 0
        r = min(ruido.get(d, 0), visitas)   # nunca más ruido que visitas hubo
        out.append({"dia": d.isoformat(),
                    "visitas": visitas,
                    "paginas_vistas": f.paginas_vistas if f else 0,
                    "ruido": r,
                    "personas": visitas - r})
        d += dt.timedelta(days=1)
    return out


def _totales(db: Session, desde: dt.date, hasta: dt.date) -> tuple[int, int]:
    v, p = db.execute(
        select(func.coalesce(func.sum(WebVisitaDia.visitas), 0),
               func.coalesce(func.sum(WebVisitaDia.paginas_vistas), 0))
        .where(WebVisitaDia.dia >= desde, WebVisitaDia.dia <= hasta)
    ).one()
    return int(v or 0), int(p or 0)


def _tops(db: Session, desde: dt.date, hasta: dt.date) -> dict[str, list[dict]]:
    """Ranking por desglose en el periodo (suma de todos los días)."""
    filas = db.execute(
        select(WebVisitaDetalle.tipo, WebVisitaDetalle.valor,
               func.sum(WebVisitaDetalle.visitas), func.sum(WebVisitaDetalle.paginas_vistas))
        .where(WebVisitaDetalle.dia >= desde, WebVisitaDetalle.dia <= hasta)
        .group_by(WebVisitaDetalle.tipo, WebVisitaDetalle.valor)
        .order_by(WebVisitaDetalle.tipo, func.sum(WebVisitaDetalle.visitas).desc())
    ).all()
    out: dict[str, list[dict]] = {t: [] for t in cloudflare.DESGLOSES}
    for tipo, valor, visitas, vistas in filas:
        # En el ranking del periodo las rutas de robots ESTORBAN: son decenas de rutas distintas
        # con una visita cada una que echarían fuera del top a las páginas de verdad. Aquí se
        # quitan (el total del ruido se da aparte); en el detalle de un día sí salen, marcadas,
        # que es donde interesa ver qué anduvo buscando el robot.
        if tipo == "pagina" and _es_ruido(valor):
            continue
        lista = out.setdefault(tipo, [])
        if len(lista) < TOP:
            lista.append({"valor": valor, "visitas": int(visitas or 0),
                          "paginas_vistas": int(vistas or 0), "ruido": False})
    return out


@router.get("/analitica")
def analitica(dias: int = Query(30, ge=1, le=1830), db: Session = Depends(get_db)):
    """Analítica de la web en los últimos `dias` días, con el periodo anterior para comparar."""
    error_sync = _sincronizar_si_toca(db)

    hasta = dt.date.today()
    desde = hasta - dt.timedelta(days=dias - 1)
    prev_hasta = desde - dt.timedelta(days=1)
    prev_desde = prev_hasta - dt.timedelta(days=dias - 1)

    visitas, vistas = _totales(db, desde, hasta)
    visitas_prev, vistas_prev = _totales(db, prev_desde, prev_hasta)
    serie = _serie(db, desde, hasta)
    # Todo lo que se enseña como "visitas" son PERSONAS: el ruido de robots va aparte y a la vista.
    ruido = sum(p["ruido"] for p in serie)
    ruido_prev = min(sum(_ruido_por_dia(db, prev_desde, prev_hasta).values()), visitas_prev)
    personas = visitas - ruido
    personas_prev = visitas_prev - ruido_prev
    mejor = max(serie, key=lambda p: p["personas"], default=None)

    est = _estado(db)
    primer_dia = db.scalar(select(func.min(WebVisitaDia.dia)))
    return {
        "configurado": cloudflare.configurado(),
        "host": settings.cf_web_host,
        "dias": dias,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "totales": {
            # `visitas` = personas (ya sin robots). El bruto y el ruido van aparte para poder
            # explicar de dónde sale la diferencia sin que nadie tenga que fiarse.
            "visitas": personas,
            "visitas_brutas": visitas,
            "ruido": ruido,
            "paginas_vistas": vistas,
            "visitas_previo": personas_prev,
            "paginas_vistas_previo": vistas_prev,
            "media_diaria": round(personas / len(serie), 1) if serie else 0,
            "mejor_dia": mejor,
        },
        "serie": serie,
        "tops": _tops(db, desde, hasta),
        "historico_desde": primer_dia.isoformat() if primer_dia else None,
        "ultima_sync": est.ultimo_ok.isoformat() if est.ultimo_ok else None,
        "error_sync": error_sync or est.ultimo_error,
    }


@router.get("/dia/{fecha}")
def dia(fecha: dt.date, db: Session = Depends(get_db)):
    """Qué pasó UN día concreto: sus cifras y TODOS sus desgloses (al pinchar en la gráfica).

    No llama a Cloudflare: el archivo propio ya guarda cada día por separado con su país, sus
    páginas, su navegador y de dónde venía. A diferencia del ranking del periodo, aquí las rutas
    de robots SÍ se listan (marcadas), que es justo donde interesa ver qué anduvieron buscando."""
    d = db.get(WebVisitaDia, fecha)
    filas = db.execute(
        select(WebVisitaDetalle.tipo, WebVisitaDetalle.valor,
               WebVisitaDetalle.visitas, WebVisitaDetalle.paginas_vistas)
        .where(WebVisitaDetalle.dia == fecha)
        .order_by(WebVisitaDetalle.tipo, WebVisitaDetalle.visitas.desc())
    ).all()

    desgloses: dict[str, list[dict]] = {t: [] for t in cloudflare.DESGLOSES}
    for tipo, valor, visitas, vistas in filas:
        desgloses.setdefault(tipo, []).append({
            "valor": valor, "visitas": int(visitas or 0), "paginas_vistas": int(vistas or 0),
            "ruido": tipo == "pagina" and _es_ruido(valor),
        })

    visitas = d.visitas if d else 0
    ruido = min(sum(f["visitas"] for f in desgloses.get("pagina", []) if f["ruido"]), visitas)
    return {
        "dia": fecha.isoformat(),
        "hay_dato": d is not None,
        "visitas": visitas - ruido,
        "visitas_brutas": visitas,
        "ruido": ruido,
        "paginas_vistas": d.paginas_vistas if d else 0,
        "desgloses": desgloses,
    }


@router.post("/sincronizar")
def sincronizar(dias: int = Query(DIAS_AL_VUELO, ge=1, le=90), db: Session = Depends(get_db)):
    """Fuerza el refresco desde Cloudflare (botón «Actualizar» de la pantalla)."""
    if not cloudflare.configurado():
        raise HTTPException(400, "Falta configurar el token de Cloudflare (CF_API_TOKEN / CF_ACCOUNT_ID).")
    error = _sincronizar_si_toca(db, forzar=True, dias=dias)
    if error:
        raise HTTPException(502, error)
    est = _estado(db)
    return {"ok": True, "ultima_sync": est.ultimo_ok.isoformat() if est.ultimo_ok else None}
