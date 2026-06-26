"""
Rellena net_premium_to_broker ('Prima a Mayrit') en las líneas de caución ya importadas, tomándolo
de `extra['Net Premium to pay to Reinsurance Broker by Reinsured']` (se mapeó tarde).

Uso:
  python -m tools.backfill_prima_mayrit_caucion                 # DRY-RUN
  python -m tools.backfill_prima_mayrit_caucion --commit
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Bdx, BdxLinea, Binder

CLAVE = "Net Premium to pay to Reinsurance Broker by Reinsured"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    for umr in ("B1634SB0125IBE", "B1634SB0226IBE"):
        b = db.scalar(select(Binder).where(Binder.umr == umr))
        lineas = db.scalars(
            select(BdxLinea).join(Bdx, BdxLinea.bdx_id == Bdx.id)
            .where(Bdx.binder_id == b.id, Bdx.tipo == "Risk")
        ).all()
        n = act = sinclave = 0
        for ln in lineas:
            n += 1
            v = (ln.extra or {}).get(CLAVE)
            if v is None:
                sinclave += 1
                continue
            nuevo = Decimal(str(v))
            if ln.net_premium_to_broker != nuevo:
                ln.net_premium_to_broker = nuevo
                act += 1
        print(f"{umr}: {n} lineas | a actualizar={act} | sin clave en extra={sinclave}")
    if args.commit:
        db.commit()
        print("COMMIT OK")
    else:
        print("(DRY-RUN: no se ha escrito nada)")
    db.close()


if __name__ == "__main__":
    main()
