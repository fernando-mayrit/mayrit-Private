"""Analítica de la web pública (www.mayritbroker.com) dentro de Mayrit.

Se mide por DOS vías, y hacen falta las dos:

  1. CLOUDFLARE — el termómetro. Cuenta visitas y da rankings sueltos de país, navegador y sistema.
     Cadena: baliza de Cloudflare (sin cookies) → API GraphQL (`app/cloudflare.py`) → tablas
     `web_visitas_dia` / `web_visitas_detalle`.

  2. LA BALIZA PROPIA — el recorrido. Cadena: `medir.js` en la web → `medir.php` en el alojamiento →
     `datos.php` con clave → `app/baliza.py` → tablas `web_sesiones` / `web_eventos`.

     Existe porque Cloudflare, en esta web, se queda muy corto: las siete páginas (Inicio, Agencias,
     Compañías, Cómo funciona, Diccionario, Nosotros, Contacto) se cambian SIN recargar, escondiendo
     un <div> y enseñando otro. La dirección nunca cambia, así que Cloudflare ve una sola visita a
     una sola página. Qué páginas se leen de verdad, cuántos segundos, cuánto se llega a ver de cada
     una y qué se busca en el diccionario solo se puede saber desde aquí.

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

from .. import baliza, cloudflare
from ..config import settings
from ..db import get_db
from ..models.maestras import (
    SyncEstado, WebBalizaDia, WebEvento, WebSesion, WebVisitaDetalle, WebVisitaDia,
)

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


# ════════════════════════════════════════════════════════════════════════════════════════════════
#  LA BALIZA PROPIA — el recorrido de cada visita
# ════════════════════════════════════════════════════════════════════════════════════════════════
# Todo lo de arriba es Cloudflare: cuántas visitas y de dónde. Todo lo de aquí abajo es la baliza
# nuestra: QUÉ hizo cada visita. Son dos archivos independientes y no se mezclan, porque no cuentan
# lo mismo ni pueden cuadrar entre sí (Cloudflare cuenta también a quien no ejecuta JavaScript, y la
# baliza cuenta paseos completos aunque el visitante nunca recargue). Cuadrarlos a la fuerza sería
# inventar; enseñarlos por separado, con lo que cada uno sabe, es lo honesto.

CLAVE_SYNC_BALIZA = "web_baliza"
FRESCURA_BALIZA_MIN = 15    # minutos: por debajo de esto, abrir la pantalla no vuelve a llamar a la web


def _estado_baliza(db: Session) -> SyncEstado:
    est = db.get(SyncEstado, CLAVE_SYNC_BALIZA)
    if est is None:
        est = SyncEstado(clave=CLAVE_SYNC_BALIZA)
        db.add(est)
        db.commit()
    return est


def _sesion_de(db: Session, envio: dict, momento: dt.datetime) -> WebSesion | None:
    """La visita a la que pertenece este envío; se crea la primera vez que se la ve."""
    clave = str(envio.get("s") or "")[:32]
    if not clave:
        return None
    ses = db.scalar(select(WebSesion).where(WebSesion.sesion == clave))
    if ses is None:
        ses = WebSesion(sesion=clave, dia=momento.date(), inicio=momento)
        db.add(ses)
        db.flush()          # para tener el id con el que colgar los eventos
    # Estos vienen del alojamiento en cada envío, no del navegador: se refrescan siempre.
    ses.visitante = str(envio.get("u") or "")[:32]
    ses.huella = str(envio.get("h") or "")[:16]
    ses.navegador = str(envio.get("nav") or "")[:20]
    ses.so = str(envio.get("so") or "")[:20]
    ses.pais = str(envio.get("pais") or "")[:2]
    if ses.fin is None or momento > ses.fin:
        ses.fin = momento
    return ses


def _texto(v, tope: int) -> str:
    """Todo esto viene de un navegador: se trata como texto de fuera, cortado y sin sorpresas."""
    if v is None or isinstance(v, (dict, list)):
        return ""
    if isinstance(v, bool):
        return "sí" if v else ""
    return str(v)[:tope]


def _entero(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _guarda_envio(db: Session, envio: dict) -> int:
    """Archiva un envío de la baliza. Devuelve cuántos eventos nuevos entraron.

    Es IDEMPOTENTE: volver a recoger un día ya recogido no duplica nada, porque cada evento va con
    su (visita, lote, índice) y la tabla tiene esa clave única. Sin eso, un reintento a mitad de una
    sincronización dejaría el archivo sucio para siempre y no habría forma de saberlo."""
    try:
        momento = dt.datetime.fromisoformat(str(envio.get("ts")))
    except (TypeError, ValueError):
        return 0
    ses = _sesion_de(db, envio, momento)
    if ses is None:
        return 0

    lote = _entero(envio.get("n")) or 0
    metidos = 0

    for i, e in enumerate(envio.get("e") or []):
        if not isinstance(e, dict):
            continue
        tipo = _texto(e.get("t"), 16)
        ms = _entero(e.get("ms")) or 0

        # ── Los dos que NO son eventos: describen la visita entera, así que van a la ficha ──
        if tipo == "visita":
            ses.origen = _texto(e.get("origen"), 120) or "directo"
            ses.origen_ruta = _texto(e.get("origen_ruta"), 200)
            ses.entrada = _texto(e.get("pagina"), 60)
            ses.dispositivo = _texto(e.get("dispositivo"), 20)
            ses.idioma = _texto(e.get("idioma"), 5)
            ses.nuevo = bool(e.get("nuevo"))
            ses.fuente = _texto(e.get("source"), 60)
            ses.medio = _texto(e.get("medium"), 60)
            ses.campana = _texto(e.get("campaign"), 60)
            if not ses.salida:
                ses.salida = ses.entrada
            continue
        if tipo == "fin":
            ses.segundos = _entero(e.get("seg")) or ses.segundos
            ses.paginas = _entero(e.get("paginas")) or ses.paginas
            ses.idioma = _texto(e.get("idioma"), 5) or ses.idioma
            continue

        # ── Los que sí son eventos ──
        filas: list[dict] = []
        if tipo == "pagina":
            filas.append({"tipo": "pagina", "valor": _texto(e.get("v"), 200),
                          "segundos": _entero(e.get("seg")), "pct": _entero(e.get("prof")),
                          "orden": _entero(e.get("orden")), "indice": i})
            ses.salida = _texto(e.get("v"), 60) or ses.salida
        elif tipo == "secciones":
            # Llega una lista; se despliega en una fila por sección, con su índice propio para que
            # la clave única siga valiendo (la lista viene topada a 25 y el lote a 200 eventos).
            for k, s in enumerate((e.get("lista") or [])[:25]):
                if isinstance(s, dict):
                    filas.append({"tipo": "seccion", "valor": _texto(s.get("id"), 200),
                                  "segundos": _entero(s.get("seg")), "indice": i * 100 + k})
        elif tipo == "clic":
            filas.append({"tipo": "clic", "valor": _texto(e.get("v"), 200),
                          "detalle": _texto(e.get("q"), 40), "indice": i})
        elif tipo == "busca":
            filas.append({"tipo": "busca", "valor": _texto(e.get("v"), 200),
                          "detalle": "sin_resultado" if e.get("sin_resultado") else "", "indice": i})
        elif tipo == "idioma":
            filas.append({"tipo": "idioma", "valor": _texto(e.get("v"), 200), "indice": i})
        elif tipo == "envio":
            ses.escribio = True
            filas.append({"tipo": "envio", "valor": "", "indice": i})
        else:
            continue        # un tipo que no conocemos: se ignora, no se inventa

        for f in filas:
            if not f.get("valor") and f["tipo"] not in ("envio",):
                continue
            r = db.execute(
                pg_insert(WebEvento)
                .values(sesion_id=ses.id, dia=ses.dia, lote=lote, indice=f["indice"], ms=ms,
                        tipo=f["tipo"], valor=f.get("valor", ""), detalle=f.get("detalle", ""),
                        segundos=f.get("segundos"), pct=f.get("pct"), orden=f.get("orden"))
                .on_conflict_do_nothing(constraint="uq_web_eventos_lote")
            )
            # OJO con rowcount: en un INSERT ... ON CONFLICT DO NOTHING el driver puede devolver
            # -1 ("no lo sé") en vez de 1/0, y entonces el recuento sale en negativo. Solo es un
            # contador para el resumen, pero un número negativo en pantalla haría dudar del resto.
            metidos += max(0, r.rowcount or 0)

    return metidos


def _archivar_baliza(db: Session) -> dict:
    """Se trae del alojamiento lo que aún no está archivado. Solo pide lo NUEVO de cada día."""
    hoy = dt.date.today()
    resumen = {"dias": 0, "envios": 0, "eventos": 0}

    for f in baliza.dias_disponibles():
        dia = f["dia"]
        est = db.get(WebBalizaDia, dia)
        if est is not None and est.cerrado:
            continue                                    # día pasado y leído hasta el final
        leidas = est.lineas if est else 0
        if f["lineas"] <= leidas and dia >= hoy - dt.timedelta(days=1):
            continue                                    # sin nada nuevo, y aún puede crecer

        envios, ahora = baliza.lineas_de(dia, leidas)
        for envio in envios:
            resumen["eventos"] += _guarda_envio(db, envio)
        resumen["envios"] += len(envios)
        if envios:
            resumen["dias"] += 1

        # Un día se da por CERRADO cuando ya es antiguo y se ha leído entero. Se deja un día de
        # margen a propósito: un envío que salga del navegador justo antes de medianoche puede
        # llegar al alojamiento pasada la medianoche y caer todavía en el fichero de ayer.
        db.execute(
            pg_insert(WebBalizaDia)
            .values(dia=dia, lineas=ahora, cerrado=dia < hoy - dt.timedelta(days=1))
            .on_conflict_do_update(
                index_elements=["dia"],
                set_={"lineas": ahora, "cerrado": dia < hoy - dt.timedelta(days=1),
                      "actualizado": func.now()},
            )
        )
        db.commit()

    return resumen


def _archivar_baliza_si_toca(db: Session, forzar: bool = False) -> str | None:
    """Igual que con Cloudflare: si falla, se enseña lo archivado y se avisa. No revienta nada."""
    if not baliza.configurado():
        return None
    est = _estado_baliza(db)
    ahora = dt.datetime.now(dt.timezone.utc)
    if not forzar and est.ultimo_ok and (ahora - est.ultimo_ok).total_seconds() < FRESCURA_BALIZA_MIN * 60:
        return None

    est.ultimo_intento = ahora
    db.commit()
    try:
        _archivar_baliza(db)
    except Exception as e:
        db.rollback()
        est = _estado_baliza(db)
        est.ultimo_error = str(e)[:500]
        est.ultimo_intento = ahora
        db.commit()
        return str(e)
    est = _estado_baliza(db)
    est.ultimo_ok = ahora
    est.ultimo_error = None
    db.commit()
    return None


# ── Lectura ─────────────────────────────────────────────────────────────────────────────────────
def _cuenta(filas, clave, tope=TOP) -> list[dict]:
    """Un ranking sencillo: cuántas veces sale cada valor, de más a menos."""
    from collections import Counter
    c = Counter(k for k in (clave(f) for f in filas) if k)
    return [{"valor": v, "veces": n} for v, n in c.most_common(tope)]


def _minutos(seg: int) -> str:
    """Segundos en cristiano: '3 min 20 s'. En la pantalla se lee mejor que 200."""
    seg = max(0, int(seg or 0))
    return "%d min %d s" % (seg // 60, seg % 60) if seg >= 60 else "%d s" % seg


@router.get("/recorrido")
def recorrido(dias: int = Query(30, ge=1, le=1830), db: Session = Depends(get_db)):
    """Qué hace la gente dentro de la web: páginas, tiempos, recorridos, búsquedas y clics.

    Esto es lo que Cloudflare no puede contar. Va aparte de /analitica a propósito: son dos
    mediciones distintas, con cifras que no tienen por qué coincidir, y mezclarlas confundiría."""
    error = _archivar_baliza_si_toca(db)

    hasta = dt.date.today()
    desde = hasta - dt.timedelta(days=dias - 1)

    visitas = db.execute(
        select(WebSesion).where(WebSesion.dia >= desde, WebSesion.dia <= hasta)
        .order_by(WebSesion.inicio.desc())
    ).scalars().all()

    eventos = db.execute(
        select(WebEvento).where(WebEvento.dia >= desde, WebEvento.dia <= hasta)
        .order_by(WebEvento.sesion_id, WebEvento.ms, WebEvento.indice)
    ).scalars().all()

    por_visita: dict[int, list[WebEvento]] = {}
    for e in eventos:
        por_visita.setdefault(e.sesion_id, []).append(e)

    # ── Páginas: cuántas veces se ve cada una, cuánto se está y cuánto se llega a ver ──
    paginas: dict[str, dict] = {}
    for e in eventos:
        if e.tipo != "pagina" or not e.valor:
            continue
        p = paginas.setdefault(e.valor, {"valor": e.valor, "veces": 0, "seg": 0, "pct": 0, "con_pct": 0})
        p["veces"] += 1
        p["seg"] += e.segundos or 0
        if e.pct is not None:
            p["pct"] += e.pct
            p["con_pct"] += 1
    lista_paginas = []
    for p in paginas.values():
        lista_paginas.append({
            "valor": p["valor"],
            "veces": p["veces"],
            "segundos_medios": round(p["seg"] / p["veces"]) if p["veces"] else 0,
            "tiempo_medio": _minutos(round(p["seg"] / p["veces"]) if p["veces"] else 0),
            "visto_medio": round(p["pct"] / p["con_pct"]) if p["con_pct"] else None,
        })
    lista_paginas.sort(key=lambda p: p["veces"], reverse=True)

    # ── El recorrido más repetido: la secuencia de páginas de cada visita ──
    from collections import Counter
    caminos: Counter = Counter()
    for sid, evs in por_visita.items():
        ruta = [e.valor for e in sorted((x for x in evs if x.tipo == "pagina"),
                                        key=lambda x: (x.orden or 0, x.ms)) if e.valor]
        if len(ruta) >= 2:
            caminos[" → ".join(ruta[:6])] += 1

    # ── Búsquedas del diccionario: lo más valioso, porque son SUS palabras ──
    busquedas: dict[str, dict] = {}
    for e in eventos:
        if e.tipo != "busca" or not e.valor:
            continue
        b = busquedas.setdefault(e.valor.lower(), {"valor": e.valor, "veces": 0, "sin_resultado": False})
        b["veces"] += 1
        if e.detalle == "sin_resultado":
            b["sin_resultado"] = True

    total = len(visitas)
    con_una = sum(1 for v in visitas if v.paginas <= 1)
    repetidos = sum(1 for v in visitas if not v.nuevo)
    con_tiempo = [v.segundos for v in visitas if v.segundos]
    personas = len({v.visitante for v in visitas if v.visitante})

    return {
        "configurado": baliza.configurado(),
        "dias": dias,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "resumen": {
            "visitas": total,
            "personas": personas,
            "repetidos": repetidos,
            "solo_una_pagina": con_una,
            "paginas_por_visita": round(sum(v.paginas for v in visitas) / total, 1) if total else 0,
            "duracion_media": round(sum(con_tiempo) / len(con_tiempo)) if con_tiempo else 0,
            "duracion_media_texto": _minutos(round(sum(con_tiempo) / len(con_tiempo)) if con_tiempo else 0),
            "escribieron": sum(1 for v in visitas if v.escribio),
        },
        "paginas": lista_paginas,
        "caminos": [{"valor": c, "veces": n} for c, n in caminos.most_common(8)],
        "entradas": _cuenta(visitas, lambda v: v.entrada),
        "salidas": _cuenta(visitas, lambda v: v.salida),
        "origenes": _cuenta(visitas, lambda v: v.origen),
        "campanas": _cuenta(visitas, lambda v: v.fuente),
        "dispositivos": _cuenta(visitas, lambda v: v.dispositivo, 5),
        "idiomas": _cuenta(visitas, lambda v: v.idioma, 6),
        "busquedas": sorted(busquedas.values(), key=lambda b: b["veces"], reverse=True)[:15],
        "clics": _cuenta([e for e in eventos if e.tipo == "clic"], lambda e: "%s · %s" % (e.detalle, e.valor)),
        "secciones": sorted(
            [{"valor": v, "veces": n} for v, n in
             Counter(e.valor for e in eventos if e.tipo == "seccion").items()],
            key=lambda s: s["veces"], reverse=True)[:TOP],
        "visitas": [{
            "sesion": v.sesion,
            "cuando": v.inicio.isoformat(),
            "origen": v.origen or "directo",
            "fuente": v.fuente,
            "dispositivo": v.dispositivo,
            "navegador": v.navegador,
            "pais": v.pais,
            "idioma": v.idioma,
            "nuevo": v.nuevo,
            "escribio": v.escribio,
            "paginas": v.paginas,
            "segundos": v.segundos,
            "duracion": _minutos(v.segundos),
            "camino": [e.valor for e in sorted(
                (x for x in por_visita.get(v.id, []) if x.tipo == "pagina"),
                key=lambda x: (x.orden or 0, x.ms))],
        } for v in visitas[:60]],
        "error_sync": error or _estado_baliza(db).ultimo_error,
        "ultima_sync": (lambda e: e.ultimo_ok.isoformat() if e.ultimo_ok else None)(_estado_baliza(db)),
    }


@router.get("/visita/{sesion}")
def visita(sesion: str, db: Session = Depends(get_db)):
    """Una visita concreta, paso a paso. Se llega pinchándola en la lista."""
    v = db.scalar(select(WebSesion).where(WebSesion.sesion == sesion))
    if v is None:
        raise HTTPException(404, "No hay ninguna visita con ese identificador.")
    evs = db.execute(
        select(WebEvento).where(WebEvento.sesion_id == v.id).order_by(WebEvento.ms, WebEvento.indice)
    ).scalars().all()

    # Otras visitas del MISMO visitante: es lo que da la cookie propia y lo que Cloudflare no puede.
    otras = []
    if v.visitante:
        otras = db.execute(
            select(WebSesion).where(WebSesion.visitante == v.visitante, WebSesion.id != v.id)
            .order_by(WebSesion.inicio.desc()).limit(20)
        ).scalars().all()

    return {
        "sesion": v.sesion,
        "cuando": v.inicio.isoformat(),
        "duracion": _minutos(v.segundos),
        "paginas": v.paginas,
        "origen": v.origen or "directo",
        "origen_ruta": v.origen_ruta,
        "fuente": v.fuente, "medio": v.medio, "campana": v.campana,
        "dispositivo": v.dispositivo, "navegador": v.navegador, "so": v.so,
        "pais": v.pais, "idioma": v.idioma,
        "nuevo": v.nuevo, "escribio": v.escribio,
        "pasos": [{
            "segundo": round(e.ms / 1000),
            "tipo": e.tipo,
            "valor": e.valor,
            "detalle": e.detalle,
            "segundos": e.segundos,
            "pct": e.pct,
        } for e in evs],
        "otras_visitas": [{"sesion": o.sesion, "cuando": o.inicio.isoformat(),
                           "paginas": o.paginas, "duracion": _minutos(o.segundos)} for o in otras],
    }


@router.post("/recorrido/sincronizar")
def sincronizar_recorrido(db: Session = Depends(get_db)):
    """Fuerza la recogida desde el alojamiento (botón «Actualizar» de la pestaña Recorrido)."""
    if not baliza.configurado():
        raise HTTPException(400, "Falta la clave de la baliza (WEB_MEDIR_CLAVE).")
    error = _archivar_baliza_si_toca(db, forzar=True)
    if error:
        raise HTTPException(502, error)
    est = _estado_baliza(db)
    return {"ok": True, "ultima_sync": est.ultimo_ok.isoformat() if est.ultimo_ok else None}
