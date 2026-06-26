"""
Enlaza cada línea de Risk BDX con el recibo de su (binder, mes de reporting_period_start):
pone BdxLinea.recibo_id y BdxLinea.recibo (nº). Donde el mes no tenga recibo, deja la línea sin
enlazar y lo informa.

Uso:
  python -m tools.enlazar_lineas_recibos --binder B1634SB0125IBE              # DRY-RUN
  python -m tools.enlazar_lineas_recibos --binder B1634SB0125IBE --commit
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Bdx, BdxLinea, Binder, Recibo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binder", required=True)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    b = db.scalar(select(Binder).where(Binder.umr == args.binder))
    if not b:
        raise SystemExit(f"Binder {args.binder} no encontrado")

    # recibos del binder por periodo 'YYYY-MM'
    recs = {r.periodo: r for r in db.scalars(select(Recibo).where(Recibo.binder_id == b.id)).all()}

    lineas = db.scalars(
        select(BdxLinea).join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id == b.id, Bdx.tipo == "Risk")
    ).all()

    from collections import defaultdict
    por_mes = defaultdict(lambda: [0, 0, 0])   # mes -> [lineas, enlazables, ya_enlazadas]
    cambios = []
    sin_recibo = defaultdict(int)
    for ln in lineas:
        mes = ln.reporting_period_start.strftime("%Y-%m") if ln.reporting_period_start else "?"
        por_mes[mes][0] += 1
        r = recs.get(mes)
        if not r:
            sin_recibo[mes] += 1
            continue
        por_mes[mes][1] += 1
        if ln.recibo_id == r.id:
            por_mes[mes][2] += 1
        else:
            cambios.append((ln, r))

    print(f"{args.binder} (id {b.id}) — {len(lineas)} lineas Risk")
    print(f"{'mes':<9}{'lineas':>7}{'recibo':>11}{'a_enlazar':>10}{'ya':>5}")
    for mes in sorted(por_mes):
        n, enl, ya = por_mes[mes]
        r = recs.get(mes)
        aenl = sum(1 for ln, rr in cambios if ln.reporting_period_start and ln.reporting_period_start.strftime("%Y-%m") == mes)
        print(f"{mes:<9}{n:>7}{(r.numero if r else '— SIN'):>11}{aenl:>10}{ya:>5}")
    if sin_recibo:
        print("\nMeses con lineas pero SIN recibo (no se enlazan):",
              ", ".join(f"{m}({c})" for m, c in sorted(sin_recibo.items())))
    print(f"\nTotal a enlazar: {len(cambios)}")

    if args.commit:
        for ln, r in cambios:
            ln.recibo_id = r.id
            ln.recibo = r.numero
        db.commit()
        print("COMMIT OK")
    else:
        print("(DRY-RUN: no se ha escrito nada)")
    db.close()


if __name__ == "__main__":
    main()
