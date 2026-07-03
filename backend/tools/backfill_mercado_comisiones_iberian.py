"""Rellena el 'mercado' de los recibos de comisiones de Iberian que están sin mercado.

Los recibos de comisiones de Iberian deben llevar mercado = 'Iberian Insurance Group, S.L.' (la
compañía). Este script lo fija en recibo.mercado y recibo.nombre_mercado para los recibos
tipo_poliza='Comisiones' y corredor='Iberian' que estén vacíos. No toca los de otras fuentes
(Insurart, WiiRe...) ni los 'Contabilizado'. DRY-RUN por defecto; escribe solo con --commit.

Uso:
  python -m tools.backfill_mercado_comisiones_iberian            # DRY-RUN
  python -m tools.backfill_mercado_comisiones_iberian --commit
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Recibo
from app.routers.comisiones import MERCADO_IBERIAN

CONTABILIZADO = "Contabilizado"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    recs = db.scalars(
        select(Recibo)
        .where(Recibo.tipo_poliza == "Comisiones", Recibo.corredor == "Iberian")
        .order_by(Recibo.numero)
    ).all()

    vacios = [r for r in recs if not (r.mercado or "").strip()]
    cambios = [r for r in vacios if (r.estado or "") != CONTABILIZADO]
    bloqueados = [r for r in vacios if (r.estado or "") == CONTABILIZADO]

    print(f"Recibos comisiones Iberian: {len(recs)}   sin mercado: {len(vacios)}")
    for r in cambios:
        print(f"  -> {r.numero} {r.periodo} [{r.estado}]  mercado={r.mercado!r} ==> {MERCADO_IBERIAN!r}")
    for r in bloqueados:
        print(f"  BLOQUEADO {r.numero} ({r.estado}) — reábrelo si quieres normalizarlo")

    print(f"\nA cambiar: {len(cambios)}   Bloqueados: {len(bloqueados)}")

    if args.commit and cambios:
        for r in cambios:
            r.mercado = MERCADO_IBERIAN
            r.nombre_mercado = MERCADO_IBERIAN
        db.commit()
        print("COMMIT OK")
    elif not args.commit:
        print("(DRY-RUN: no se ha escrito nada)")
    db.close()


if __name__ == "__main__":
    main()
