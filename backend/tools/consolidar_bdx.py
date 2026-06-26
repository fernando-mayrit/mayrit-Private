"""
Consolida en UN solo BDX (por binder y tipo) las líneas que estén repartidas en varias cabeceras Bdx.

La app asume 1 BDX por binder (el mes lo distingue `reporting_period_start` de cada línea). El
importador de caución creó una cabecera por hoja/mes; esto las une en una sola, reasignando las
líneas (UPDATE directo, sin tocar su contenido) y borrando las cabeceras que queden vacías.

Uso:
  python -m tools.consolidar_bdx --binder B1634SB0125IBE --tipo Risk            # DRY-RUN
  python -m tools.consolidar_bdx --binder B1634SB0125IBE --tipo Risk --commit
"""
from __future__ import annotations

import argparse

from sqlalchemy import func, select, text

from app.db import SessionLocal
from app.models.maestras import Bdx, BdxLinea, Binder


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binder", required=True)
    ap.add_argument("--tipo", default="Risk")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    b = db.scalar(select(Binder).where(Binder.umr == args.binder))
    if not b:
        raise SystemExit(f"Binder {args.binder} no encontrado")

    bdxs = db.scalars(
        select(Bdx).where(Bdx.binder_id == b.id, Bdx.tipo == args.tipo).order_by(Bdx.id)
    ).all()
    if len(bdxs) <= 1:
        print(f"{args.binder} {args.tipo}: {len(bdxs)} cabecera(s) — nada que consolidar.")
        return

    keep = bdxs[0]
    extras = bdxs[1:]
    conteo = dict(db.execute(select(BdxLinea.bdx_id, func.count(BdxLinea.id)).group_by(BdxLinea.bdx_id)).all())
    tot = sum(conteo.get(x.id, 0) for x in bdxs)
    print(f"{args.binder} {args.tipo}: {len(bdxs)} cabeceras, {tot} líneas en total.")
    print(f"  Se mantiene Bdx id={keep.id}; se reasignan las líneas de {len(extras)} cabeceras y se borran esas.")

    if not args.commit:
        print("\n(DRY-RUN: no se ha escrito nada. Añade --commit.)")
        return

    ids_extra = [x.id for x in extras]
    # 1) Reasignar líneas a la cabecera que se mantiene (UPDATE directo: no toca su contenido).
    db.execute(
        text("UPDATE bdx_lineas SET bdx_id = :keep WHERE bdx_id = ANY(:extras)"),
        {"keep": keep.id, "extras": ids_extra},
    )
    # 2) Borrar las cabeceras ya vacías (con SQL directo para no disparar cascade ORM sobre líneas).
    db.execute(text("DELETE FROM bdx WHERE id = ANY(:extras)"), {"extras": ids_extra})
    # 3) Recalcular el periodo de la cabecera = min/max de las líneas, estado Abierto.
    rng = db.execute(
        select(func.min(BdxLinea.reporting_period_start), func.max(BdxLinea.reporting_period_end))
        .where(BdxLinea.bdx_id == keep.id)
    ).one()
    keep.reporting_period_start, keep.reporting_period_end = rng
    keep.estado = "Abierto"
    keep.notas = "Importado de Excel caución (consolidado en 1 BDX)"
    db.commit()

    n = db.scalar(select(func.count(BdxLinea.id)).where(BdxLinea.bdx_id == keep.id))
    ncab = db.scalar(select(func.count()).select_from(Bdx).where(Bdx.binder_id == b.id, Bdx.tipo == args.tipo))
    print(f"\nCOMMIT OK: ahora {ncab} cabecera {args.tipo} con {n} lineas "
          f"(periodo {keep.reporting_period_start} .. {keep.reporting_period_end}).")


if __name__ == "__main__":
    main()
