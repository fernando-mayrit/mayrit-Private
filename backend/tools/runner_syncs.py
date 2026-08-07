"""Lanzador de las sincronizaciones automáticas LOCALES (DGSFP + proyección de ingresos).

Pensado para correr en VARIOS PCs de la oficina (tarea programada: al encender + cada X horas). En
cada disparo mira qué job toca (según cuándo salió bien por última vez) y lo ejecuta, con un CANDADO
en la BD para que solo un PC lo haga aunque haya varios encendidos a la vez. Es idempotente: no pasa
nada por llamarlo a menudo.

    ~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs
    ~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --forzar dgsfp   # ignora la cadencia
    ~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --estado         # solo informa, no ejecuta

Requisitos por job (un PC al que le falte uno hace el otro y salta el que no puede):
  · dgsfp      → Playwright en el venv (pip install playwright && playwright install chromium)
  · proyeccion → el Excel del Ppto accesible en la ruta de OneDrive local
"""
import argparse
import datetime as dt
import importlib.util
import os
import socket
import sys
import traceback

from sqlalchemy import text

from app.db import SessionLocal
from app.models.maestras import Parametro, SyncEstado

HOST = socket.gethostname()


def _run_dgsfp() -> None:
    from tools.sync_agencias_dgsfp import main as dgsfp_main   # lazy: requiere Playwright
    dgsfp_main()


def _run_proyeccion() -> None:
    from app.ppto_sync import sincronizar                      # lazy: requiere el Excel
    db = SessionLocal()
    try:
        sincronizar(db)
    finally:
        db.close()


def _puede_dgsfp() -> bool:
    """Este PC puede scrapear la DGSFP solo si tiene Playwright instalado en el venv."""
    return importlib.util.find_spec("playwright") is not None


def _puede_proyeccion() -> bool:
    """Este PC puede leer la proyección solo si tiene accesible el Excel del Ppto (OneDrive local)."""
    from app.ppto_sync import RUTA
    return os.path.exists(RUTA)


# clave interna · parámetro cuyo `actualizado` marca el último OK real · cadencia · caducidad del
# candado (por si un run se cuelga) · función · predicado "este PC puede" · etiqueta.
JOBS = [
    {"clave": "dgsfp", "param": "dgsfp_agencias_sync", "cadencia": dt.timedelta(days=28),
     "lease": dt.timedelta(minutes=40), "fn": _run_dgsfp, "puede": _puede_dgsfp,
     "etiqueta": "Registro DGSFP (agencias)"},
    {"clave": "proyeccion", "param": "proyeccion_ingresos_2026", "cadencia": dt.timedelta(hours=20),
     "lease": dt.timedelta(minutes=10), "fn": _run_proyeccion, "puede": _puede_proyeccion,
     "etiqueta": "Proyección de ingresos (Ppto)"},
]


def _ahora() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _ultimo_ok(db, param_clave: str):
    """Última vez que el dato se escribió bien = `parametros.actualizado` del job."""
    p = db.get(Parametro, param_clave)
    act = p.actualizado if p else None
    if act is not None and act.tzinfo is None:
        act = act.replace(tzinfo=dt.timezone.utc)
    return act


def _due(db, job, forzar: bool) -> bool:
    if forzar:
        return True
    ok = _ultimo_ok(db, job["param"])
    return ok is None or (_ahora() - ok) >= job["cadencia"]


def _acquirir(db, clave: str, lease: dt.timedelta) -> bool:
    """Coge el candado del job de forma ATÓMICA (solo un PC gana). Devuelve True si lo consigue."""
    ahora = _ahora()
    db.execute(text("INSERT INTO sync_estado (clave, en_curso) VALUES (:c, false) "
                    "ON CONFLICT (clave) DO NOTHING"), {"c": clave})
    db.commit()
    res = db.execute(text(
        "UPDATE sync_estado SET en_curso = true, host = :h, ultimo_intento = :now, lease_hasta = :hasta "
        "WHERE clave = :c AND (en_curso = false OR lease_hasta IS NULL OR lease_hasta < :now)"),
        {"h": HOST, "now": ahora, "hasta": ahora + lease, "c": clave})
    db.commit()
    return res.rowcount == 1


def _liberar(db, clave: str, ok: bool, error: str | None = None) -> None:
    if ok:
        db.execute(text("UPDATE sync_estado SET en_curso = false, ultimo_ok = :now, ultimo_error = NULL "
                        "WHERE clave = :c"), {"now": _ahora(), "c": clave})
    else:
        db.execute(text("UPDATE sync_estado SET en_curso = false, ultimo_error = :e WHERE clave = :c"),
                   {"e": (error or "")[:2000], "c": clave})
    db.commit()


def _estado(db) -> None:
    print(f"Host: {HOST}  ·  {dt.datetime.now():%Y-%m-%d %H:%M}")
    for job in JOBS:
        ok = _ultimo_ok(db, job["param"])
        se = db.get(SyncEstado, job["clave"])
        puede = "sí" if job["puede"]() else "NO"
        toca = "SÍ" if _due(db, job, False) else "no"
        cuando = f"{ok:%Y-%m-%d %H:%M}" if ok else "nunca"
        err = ("  ⚠ último error: " + se.ultimo_error.splitlines()[0][:80]) if se and se.ultimo_error else ""
        cand = f"  (candado: {se.host})" if se and se.en_curso else ""
        print(f"  · {job['etiqueta']:32} este PC puede: {puede} · último OK: {cuando} · toca: {toca}{cand}{err}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Lanzador de sincronizaciones automáticas locales")
    ap.add_argument("--forzar", help="clave de job a forzar (dgsfp/proyeccion), ignora la cadencia")
    ap.add_argument("--estado", action="store_true", help="solo informa, no ejecuta")
    args = ap.parse_args(argv)

    db = SessionLocal()
    try:
        if args.estado:
            _estado(db)
            return
        for job in JOBS:
            clave = job["clave"]
            if not job["puede"]():
                print(f"[{clave}] este PC no puede ejecutarlo (falta Playwright o el Excel). Salto.")
                continue
            if not _due(db, job, forzar=(args.forzar == clave)):
                print(f"[{clave}] al día, no toca.")
                continue
            if not _acquirir(db, clave, job["lease"]):
                print(f"[{clave}] toca, pero otro PC lo tiene cogido (candado). Salto.")
                continue
            print(f"[{clave}] ejecutando en {HOST}…")
            try:
                job["fn"]()
                _liberar(db, clave, ok=True)
                print(f"[{clave}] OK.")
            except Exception:
                err = traceback.format_exc()
                _liberar(db, clave, ok=False, error=err)
                print(f"[{clave}] ERROR:\n{err}", file=sys.stderr)
    finally:
        db.close()


if __name__ == "__main__":
    main()
