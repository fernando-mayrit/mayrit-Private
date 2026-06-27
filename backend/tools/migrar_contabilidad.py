"""
Volcado del módulo Contabilidad desde SharePoint a la BD:
  - 'Contabilidad - Categorias' → tabla `conta_categorias` (catálogo concepto→grupo/tipo/cuenta contable).
  - 'Contabilidad - <cuenta>' (12 listas de movimientos) → tabla `movimientos_bancarios`.

Las listas de CATÁLOGO (Categorias/Concepto/Cuenta/Grupo/Grupo1/Tipo) NO son de movimientos.

- Idempotente: categorías por `concepto`; movimientos por (`sp_lista`, `sp_old_id`) (los Id se repiten
  entre listas, por eso la lista forma parte de la clave).
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_contabilidad [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import ContaCategoria, MovimientoBancario

PREFIJO = "Contabilidad - "
CATALOGOS = {"Categorias", "Concepto", "Cuenta", "Grupo", "Grupo1", "Tipo"}

MAPEO_MOV = {
    "iden": "Iden", "identificador": "Identificador",
    "fecha": "Fecha", "tipo": "Tipo", "grupo": "Grupo", "concepto": "Concepto",
    "gasto": "Gasto", "ingreso": "Ingreso", "saldo": "Saldo", "descripcion": "Descripcion",
    "cuenta": "Cuenta", "devengo": "Devengo", "tarjeta": "Tarjeta", "factura": "Factura",
    "codigo": "Codigo",
}
DATE_MOV = {"fecha", "devengo"}
MAPEO_CAT = {"concepto": "Concepto", "grupo": "Grupo", "tipo": "Tipo", "cuenta_contable": "CuentaContable"}


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


def _dec(v):
    if v in (None, ""):
        return Decimal(0)
    try:
        return Decimal(str(v).replace(",", ".")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return Decimal(0)


def _b(v):
    return str(v).strip().lower() in ("1", "true", "sí", "si", "yes", "y") if v is not None else False


def _s(v):
    return (str(v).strip() if v not in (None, "") else None)


def _listas_movimientos() -> list[str]:
    ctx = sharepoint.get_context()
    lists = ctx.web.lists
    ctx.load(lists)
    ctx.execute_query()
    out = []
    for l in lists:
        t = l.properties.get("Title") or ""
        if t.startswith(PREFIJO) and t[len(PREFIJO):] not in CATALOGOS:
            out.append(t)
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()

    def _existentes(modelo, getkey):
        """Filas ya en BD (vacío si la tabla aún no existe → permite previsualizar antes de migrar)."""
        try:
            return {getkey(x) for x in db.scalars(select(modelo)).all()}
        except Exception:
            db.rollback()
            return set()

    # ── Catálogo de categorías ──
    cats = sharepoint.leer_lista("Contabilidad - Categorias", MAPEO_CAT, set())
    ya_cat = _existentes(ContaCategoria, lambda c: c.concepto)
    nuevas_cat = []
    for c in cats:
        concepto = _s(c.get("concepto"))
        if not concepto or concepto in ya_cat:
            continue
        ya_cat.add(concepto)
        nuevas_cat.append(ContaCategoria(
            sp_old_id=c.get("_sp_id"), concepto=concepto,
            grupo=_s(c.get("grupo")), tipo=_s(c.get("tipo")), cuenta_contable=_s(c.get("cuenta_contable")),
        ))

    # ── Movimientos por lista ──
    listas = _listas_movimientos()
    ya_mov = _existentes(MovimientoBancario, lambda m: (m.sp_lista, m.sp_old_id))
    nuevas_mov = []
    por_lista, por_tipo = Counter(), Counter()
    for titulo in listas:
        cuenta_def = titulo[len(PREFIJO):]
        es_fondos = cuenta_def == "Movimiento Fondos"   # traspasos internos: van APARTE, no a cuentas
        filas = sharepoint.leer_lista(titulo, MAPEO_MOV, DATE_MOV)
        for f in filas:
            clave = (titulo, f.get("_sp_id"))
            if clave in ya_mov:
                continue
            ya_mov.add(clave)
            fecha = _fecha(f.get("fecha"))
            tipo = _s(f.get("tipo"))
            # La cuenta real es el campo 'Cuenta' de la fila (más preciso que el nombre de la lista),
            # SALVO en 'Movimiento Fondos', que se trata aparte como su propia "cuenta".
            cuenta = "Movimiento Fondos" if es_fondos else (_s(f.get("cuenta")) or cuenta_def)
            por_lista[cuenta] += 1
            por_tipo[tipo or "—"] += 1
            iden = f.get("iden")
            try:
                iden = int(iden) if iden not in (None, "") else None
            except (TypeError, ValueError):
                iden = None
            nuevas_mov.append(MovimientoBancario(
                sp_old_id=f.get("_sp_id"), sp_lista=titulo,
                cuenta=cuenta, iden=iden, identificador=_s(f.get("identificador")),
                fecha=fecha, anio=fecha.year if fecha else None,
                concepto=_s(f.get("concepto")), grupo=_s(f.get("grupo")), tipo=tipo,
                gasto=_dec(f.get("gasto")), ingreso=_dec(f.get("ingreso")), saldo=(_dec(f.get("saldo")) if f.get("saldo") not in (None, "") else None),
                descripcion=_s(f.get("descripcion")), devengo=_fecha(f.get("devengo")),
                tarjeta=_b(f.get("tarjeta")), factura=_b(f.get("factura")), codigo=_s(f.get("codigo")),
            ))

    print(f"== Migración Contabilidad (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Categorías: nuevas {len(nuevas_cat)} (de {len(cats)} en SP)")
    print(f"Listas de movimientos ({len(listas)}): {[t[len(PREFIJO):] for t in listas]}")
    print(f"Movimientos nuevos: {len(nuevas_mov)}")
    print(f"  Por cuenta: {dict(por_lista)}")
    print(f"  Por tipo:   {dict(por_tipo)}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para volcar.")
        return

    db.add_all(nuevas_cat)
    db.add_all(nuevas_mov)
    db.commit()
    print(f"\nAPLICADO: {len(nuevas_cat)} categorías + {len(nuevas_mov)} movimientos.")
    db.close()


if __name__ == "__main__":
    main()
