"""
Migración de recibos SUELTOS desde SharePoint `Mayrit - TRecibos` (lectura en vivo): los que
NO son de tipo Binder y NO tienen nº de póliza (Consultoría, Comisiones, Slip de Reaseguro sin
póliza…). No enlazan a ningún binder ni póliza (binder_id y poliza_id quedan a NULL); ya casarán
cuando existan los módulos de Consultoría / Comisiones.

OJO: solo trae los que no tienen `numero_poliza`. Los de tipo Póliza/Slip CON nº de póliza se
migran por `migrar_recibos_om` (cuando su póliza exista), no aquí.

- Idempotente: casa por `numero` (NumeroRecibo) y por `sp_old_id` (Id de SharePoint).
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_recibos_otros --anios 2021 [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Recibo
from tools.migrar_recibos_excel import MAP_DIRECTO, MAP_PORC, FECHAS, IMPORTES

TITULO_DE: dict[str, str] = {campo: titulo for titulo, campo in MAP_DIRECTO.items()}
TITULO_DE.update({campo: titulo for titulo, campo in MAP_PORC.items()})
PORC_FIELDS = set(MAP_PORC.values())


def _fecha(v):
    if not v:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _dec(v, places="0.01"):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v).replace(",", ".")).quantize(Decimal(places), ROUND_HALF_UP)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--anios", default="2021")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    anios = {a.strip() for a in args.anios.split(",")}

    filas = sharepoint.leer_lista("Mayrit - TRecibos", TITULO_DE, FECHAS)
    db = SessionLocal()
    recibos = db.scalars(select(Recibo)).all()
    por_numero = {r.numero for r in recibos if r.numero}
    por_sp = {r.sp_old_id for r in recibos if r.sp_old_id is not None}

    importables, ya = [], []
    for f in filas:
        numero = str(f.get("numero") or "").strip()
        if not numero or numero[:4] not in anios:
            continue
        tipo = str(f.get("tipo_poliza") or "").strip()
        if tipo == "Binder":
            continue
        # Solo los que NO referencian ninguna póliza (los que sí, van por migrar_recibos_om).
        if str(f.get("numero_poliza") or "").strip():
            continue
        if numero in por_numero or f.get("_sp_id") in por_sp:
            ya.append(numero)
            continue
        importables.append(f)

    print(f"== Recibos SUELTOS {sorted(anios)} (sin binder ni póliza) (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Importables: {len(importables)} · ya en BD/omitidos: {len(ya)}")
    for f in importables:
        print(f"   + {f['numero']} [{f.get('tipo_poliza')}] {f.get('asegurado')}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para migrar.")
        return

    creados = 0
    for f in importables:
        numero = str(f["numero"]).strip()
        fer = _fecha(f.get("fecha_efecto_recibo")) or _fecha(f.get("fecha_contable"))
        periodo = fer.strftime("%Y-%m") if fer else ""
        rec = Recibo(numero=numero, binder_id=None, poliza_id=None, periodo=periodo,
                     anio=int(numero[:4]) if numero[:4].isdigit() else 0,
                     sp_old_id=f.get("_sp_id"), estado="Emitido")
        for campo in TITULO_DE:
            if campo == "numero":
                continue
            v = f.get(campo)
            if campo in FECHAS:
                v = _fecha(v)
            elif campo in PORC_FIELDS:
                d = _dec(v, "0.000001")
                v = (d * 100).quantize(Decimal("0.0001"), ROUND_HALF_UP) if d is not None else None
            elif campo in IMPORTES:
                v = _dec(v)
            elif campo == "impuestos_sobre_recibo":
                v = bool(v)
            elif campo in ("yoa", "recibo_num"):
                v = int(v) if v not in (None, "") else None
            else:
                v = str(v).strip() if v not in (None, "") else None
            if v is not None:
                setattr(rec, campo, v)
        db.add(rec)
        creados += 1
    db.commit()
    print(f"\nAPLICADO: {creados} recibos sueltos creados.")
    db.close()


if __name__ == "__main__":
    main()
