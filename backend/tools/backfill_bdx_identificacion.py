"""Backfill DIRIGIDO de las líneas Risk de un binder (origen SharePoint): rellena SOLO los campos
de identificación adicional (coverholder/broker/yoa/umr/invoice) y el cajón `extra`, emparejando
por `_OldID` (sp_old_id). NO toca ningún otro campo (ni cobro, ni liquidación, ni importes).

`extra` = columnas de usuario de la lista SP que no tienen campo propio en el modelo, EXCLUYENDO
las columnas internas de gestión de Mayrit (no son del bordereau).

    python tools/backfill_bdx_identificacion.py --umr B1634MA0326MYR           # dry-run
    python tools/backfill_bdx_identificacion.py --umr B1634MA0326MYR --commit   # escribe
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app import sharepoint
from app.bdx_import import _coerce, _json_safe
from app.db import SessionLocal
from app.models.maestras import Bdx, BdxLinea, Binder

NUEVOS = ["coverholder_name", "broker_name", "broker_id", "yoa", "umr", "invoice_number"]
# Columnas internas de Mayrit (no vienen del bordereau) → nunca van a `extra`.
DENY_EXTRA = {"PendienteCobro", "PendienteTraspaso", "Pendiente Liquidar al UW", "ComisionTotal"}


def _getp(props, intn):
    if not intn:
        return None
    v = props.get(intn)
    if v is None and intn.startswith("_"):
        v = props.get("OData_" + intn)
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--umr", required=True)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    list_title = f"Mayrit - {args.umr}"

    # ── Leer campos de la lista SP (Title ↔ InternalName) ──
    ctx = sharepoint.get_context()
    lst = ctx.web.lists.get_by_title(list_title)
    campos = lst.fields
    ctx.load(campos)
    ctx.execute_query()
    info = [(f.properties.get("Title"), f.properties.get("InternalName"),
             f.properties.get("Hidden"), f.properties.get("FromBaseType")) for f in campos]
    norm_titulos = [(sharepoint._norm(t).lower(), intn) for (t, intn, h, fb) in info if t]

    def resolver(aliases):
        opts = [aliases] if isinstance(aliases, str) else aliases
        normados = [sharepoint._norm(a).lower() for a in opts]
        for a in normados:
            for t, intn in norm_titulos:
                if t == a:
                    return intn
        for a in normados:
            for t, intn in norm_titulos:
                if t.startswith(a):
                    return intn
        return None

    mapped_internals = {resolver(al) for al in sharepoint.MAPEO.values()}
    mapped_internals.discard(None)
    # Columnas de usuario para `extra`: no ocultas, no de sistema, no mapeadas, no internas de Mayrit.
    extra_cols = {title: intn for (title, intn, h, fb) in info
                  if title and not h and not fb and intn not in mapped_internals and title not in DENY_EXTRA}
    # Internals de los 6 campos nuevos + _OldID.
    intn_nuevos = {campo: resolver(sharepoint.MAPEO[campo]) for campo in NUEVOS}
    intn_oldid = resolver(sharepoint.MAPEO["sp_old_id"])

    print(f"Lista: {list_title}")
    print(f"Columnas que irán a `extra` ({len(extra_cols)}): {', '.join(sorted(extra_cols))}")
    print(f"Campos nuevos resueltos: " + ", ".join(f"{k}→{v or '—'}" for k, v in intn_nuevos.items()))

    # ── Líneas del binder en BD (por sp_old_id) ──
    db = SessionLocal()
    binder = db.scalars(select(Binder).where(Binder.umr == args.umr)).first()
    if not binder:
        sys.exit(f"No existe el binder {args.umr}")
    bdx = db.scalars(select(Bdx).where(Bdx.binder_id == binder.id, Bdx.tipo == "Risk")).first()
    if not bdx:
        sys.exit("El binder no tiene BDX Risk.")
    lineas = {l.sp_old_id: l for l in db.scalars(select(BdxLinea).where(BdxLinea.bdx_id == bdx.id)).all()
              if l.sp_old_id is not None}
    print(f"Líneas en BD con sp_old_id: {len(lineas)}")

    cols = {c.name: c.type for c in BdxLinea.__table__.columns}
    items = lst.items.get_all().execute_query()

    tocadas = sin_match = con_extra = 0
    muestra = None
    for it in items:
        p = it.properties
        oldid = _coerce("sp_old_id", _getp(p, intn_oldid), cols["sp_old_id"])
        linea = lineas.get(oldid)
        if linea is None:
            sin_match += 1
            continue
        # 6 campos nuevos (coaccionados)
        for campo in NUEVOS:
            setattr(linea, campo, _coerce(campo, _getp(p, intn_nuevos[campo]), cols[campo]))
        # extra = columnas no mapeadas con valor
        extra = {}
        for title, intn in extra_cols.items():
            v = _getp(p, intn)
            if v not in (None, ""):
                extra[title] = _json_safe(v)
        linea.extra = extra or None
        if extra:
            con_extra += 1
        tocadas += 1
        if muestra is None:
            muestra = (oldid, {c: getattr(linea, c) for c in NUEVOS}, extra)

    print(f"\nLíneas a actualizar: {tocadas} | sin match en BD: {sin_match} | con extra: {con_extra}")
    if muestra:
        print(f"Ejemplo (_OldID={muestra[0]}):")
        print("  nuevos:", muestra[1])
        print("  extra:", muestra[2])

    if not args.commit:
        db.rollback()
        print("\n[DRY-RUN] No se ha escrito nada. Repite con --commit.")
        return
    db.commit()
    print("\nOK. Backfill aplicado.")


if __name__ == "__main__":
    main()
