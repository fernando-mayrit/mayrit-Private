"""
Migración de Pólizas (Open Market) desde SharePoint `Mayrit - TPolizas` (lectura en vivo).

- Idempotente: casa por `sp_old_id` (Id de SharePoint) y, en su defecto, por `numero_poliza`.
- DRY-RUN por defecto (no escribe). Para aplicar: --apply.

Uso:
  py -m tools.migrar_polizas [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Poliza

TEXTO = {"numero_poliza", "referencia", "asegurado", "corredor", "ramo", "mercado", "produccion",
         "tipo_documento", "estado", "seguro", "pago", "moneda"}
FECHAS = {"fecha_efecto", "fecha_vencimiento"}
BOOL = {"renovacion_automatica", "coaseguro"}
INT: set[str] = set()
PORC = {"impuestos_porc", "comision_porc"}  # en SharePoint vienen como fracción → ×100
NUM = {"limite", "franquicia", "capacidad", "prima_neta", "impuestos", "recargos",
       "prima_total", "comision_total", "prima_participacion"}


def _fecha(v):
    if not v:
        return None
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


def _coaccionar(fila: dict) -> dict:
    out: dict = {"sp_old_id": fila.get("_sp_id")}
    for campo, v in fila.items():
        if campo == "_sp_id":
            continue
        if campo in FECHAS:
            out[campo] = _fecha(v)
        elif campo in BOOL:
            out[campo] = bool(v)
        elif campo in INT:
            out[campo] = int(v) if v not in (None, "") else None
        elif campo in PORC:
            d = _dec(v, "0.000001")
            out[campo] = (d * 100).quantize(Decimal("0.0001"), ROUND_HALF_UP) if d is not None else None
        elif campo in NUM:
            out[campo] = _dec(v)
        elif campo in TEXTO:
            out[campo] = str(v).strip() if v not in (None, "") else None
        else:
            out[campo] = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    filas = sharepoint.leer_lista_polizas()
    db = SessionLocal()
    existentes = db.scalars(select(Poliza)).all()
    por_sp = {p.sp_old_id: p for p in existentes if p.sp_old_id is not None}
    por_num = {p.numero_poliza: p for p in existentes if p.numero_poliza}

    # Criterio único: el mercado de la póliza se guarda como ALIAS de la maestra.
    from app.models.maestras import Mercado
    _n = lambda s: " ".join((s or "").lower().split())
    a_alias: dict[str, str] = {}
    for m in db.scalars(select(Mercado)).all():
        if m.alias:
            a_alias[_n(m.alias)] = m.alias
            if m.nombre:
                a_alias[_n(m.nombre)] = m.alias

    nuevas, actualizadas, sin_numero = 0, 0, 0
    muestra = []
    for fila in filas:
        datos = _coaccionar(fila)
        if datos.get("mercado"):
            datos["mercado"] = a_alias.get(_n(datos["mercado"]), datos["mercado"])
        if not datos.get("numero_poliza"):
            sin_numero += 1
        p = por_sp.get(datos["sp_old_id"]) or por_num.get(datos.get("numero_poliza"))
        if p is None:
            p = Poliza()
            if args.apply:
                db.add(p)
            nuevas += 1
            if len(muestra) < 6:
                muestra.append(datos)
        else:
            actualizadas += 1
        for k, v in datos.items():
            setattr(p, k, v)

    print(f"== Migración Pólizas (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Leídas de SharePoint: {len(filas)}")
    print(f"Nuevas: {nuevas} · Actualizadas: {actualizadas} · Sin numero_poliza: {sin_numero}")
    print("Muestra de nuevas:")
    for d in muestra:
        print(f"   · {d.get('numero_poliza')} | {d.get('asegurado')} | seguro={d.get('seguro')} | "
              f"prima_neta={d.get('prima_neta')} | com%={d.get('comision_porc')}")

    if not args.apply:
        db.rollback()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para migrar.")
    else:
        db.commit()
        print(f"\nAPLICADO: {nuevas} creadas, {actualizadas} actualizadas.")
    db.close()


if __name__ == "__main__":
    main()
