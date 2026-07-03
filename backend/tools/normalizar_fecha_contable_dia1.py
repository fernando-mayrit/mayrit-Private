"""Normaliza la fecha_contable de los recibos al DÍA 1 de su mes.

La fecha contable representa el MES al que se imputa el recibo, así que siempre debe caer en el
día 1 (p. ej. 30/06/2026 -> 01/06/2026). No cambia el mes de imputación: solo corrige el día.
No toca recibos 'Contabilizado' (bloqueados). DRY-RUN por defecto; escribe solo con --commit.

Uso:
  python -m tools.normalizar_fecha_contable_dia1                       # DRY-RUN (todos)
  python -m tools.normalizar_fecha_contable_dia1 --commit
  python -m tools.normalizar_fecha_contable_dia1 --numero 2026-0109    # solo un recibo
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Recibo

CONTABILIZADO = "Contabilizado"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--numero", help="Limita a un recibo concreto (p. ej. 2026-0109)")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    stmt = select(Recibo).where(Recibo.fecha_contable.isnot(None))
    if args.numero:
        stmt = stmt.where(Recibo.numero == args.numero)
    recs = db.scalars(stmt).all()

    malos = [r for r in recs if r.fecha_contable.day != 1]
    cambios, bloqueados = [], []
    for r in malos:
        if (r.estado or "") == CONTABILIZADO:
            bloqueados.append(r)
        else:
            cambios.append(r)

    print(f"Recibos con fecha_contable: {len(recs)}   con dia != 1: {len(malos)}")
    for r in sorted(malos, key=lambda r: (r.anio or 0, r.numero or "")):
        nueva = r.fecha_contable.replace(day=1)
        blq = "  [BLOQUEADO Contabilizado]" if (r.estado or "") == CONTABILIZADO else ""
        print(f"  {r.numero} periodo={r.periodo}  {r.fecha_contable} -> {nueva}{blq}")

    print(f"\nA cambiar: {len(cambios)}   Bloqueados: {len(bloqueados)}")

    if args.commit and cambios:
        for r in cambios:
            r.fecha_contable = r.fecha_contable.replace(day=1)
        db.commit()
        print("COMMIT OK")
    elif not args.commit:
        print("(DRY-RUN: no se ha escrito nada)")
    db.close()


if __name__ == "__main__":
    main()
