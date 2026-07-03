"""Unifica el 'mercado' de los recibos de un binder al NOMBRE canónico del mercado.

Los recibos de binder deben guardar el nombre del mercado (no su alias): p. ej. 'Axeria' -> 'Axeria
Iard, S.L.'. Este script normaliza recibo.mercado y recibo.nombre_mercado de TODOS los recibos del
binder a su nombre canónico (resuelto por alias o nombre en la maestra Mercados), igual que hace la
emisión de recibos de binder/póliza. DRY-RUN por defecto; escribe solo con --commit.

Uso:
  python -m tools.unificar_mercado_recibos_binder --binder B1634MA0326MYR            # DRY-RUN
  python -m tools.unificar_mercado_recibos_binder --binder B1634MA0326MYR --commit
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Binder, Mercado, Recibo


def mercado_nombre(db, valor):
    """alias/nombre -> nombre canónico (idéntico a recibos._mercado_nombre)."""
    v = (valor or "").strip()
    if not v:
        return valor
    nombre = db.scalar(select(Mercado.nombre).where(Mercado.nombre == v))
    if nombre:
        return nombre
    return db.scalar(select(Mercado.nombre).where(Mercado.alias == v)) or valor


CONTABILIZADO = "Contabilizado"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binder", required=True, help="UMR del binder (p. ej. B1634MA0326MYR)")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    b = db.scalar(select(Binder).where(Binder.umr == args.binder))
    if not b:
        raise SystemExit(f"Binder {args.binder} no encontrado")

    recs = db.scalars(
        select(Recibo).where(Recibo.binder_id == b.id).order_by(Recibo.periodo)
    ).all()
    print(f"{args.binder} (id {b.id}) — {len(recs)} recibos")

    cambios = []
    bloqueados = []
    for r in recs:
        canon_m = mercado_nombre(db, r.mercado)
        canon_n = mercado_nombre(db, r.nombre_mercado)
        cambia = (r.mercado != canon_m) or (r.nombre_mercado != canon_n)
        marca = "  " if not cambia else "->"
        print(f"  {marca} {r.numero} {r.periodo} [{r.estado}]  "
              f"mercado={r.mercado!r} nombre_mercado={r.nombre_mercado!r}"
              + (f"   ==> {canon_m!r}" if cambia else ""))
        if cambia:
            if (r.estado or "") == CONTABILIZADO:
                bloqueados.append(r)
            else:
                cambios.append((r, canon_m, canon_n))

    print(f"\nA cambiar: {len(cambios)}   Bloqueados (Contabilizado, no se tocan): {len(bloqueados)}")
    if bloqueados:
        for r in bloqueados:
            print(f"    BLOQUEADO {r.numero} ({r.periodo}) — reábrelo si también quieres normalizarlo")

    if args.commit and cambios:
        for r, cm, cn in cambios:
            r.mercado = cm
            r.nombre_mercado = cn
        db.commit()
        print("COMMIT OK")
    elif not args.commit:
        print("(DRY-RUN: no se ha escrito nada)")
    db.close()


if __name__ == "__main__":
    main()
