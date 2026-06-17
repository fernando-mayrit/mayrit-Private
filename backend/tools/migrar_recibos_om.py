"""
Migración de los recibos de tipo Póliza / Slip (Open Market) desde SharePoint `Mayrit - TRecibos`
(lectura en vivo). Los de tipo Binder ya se migran con tools/migrar_recibos_excel.

- Enlaza cada recibo OM a su `poliza` por NumeroPoliza (= polizas.numero_poliza).
- Idempotente: casa por `numero` (NumeroRecibo) y por `sp_old_id` (Id de SharePoint).
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_recibos_om [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Poliza, Recibo
from tools.migrar_recibos_excel import MAP_DIRECTO, MAP_PORC, FECHAS, IMPORTES

# Reutilizamos el mapeo del migrador de recibos, invertido a campo_modelo -> título de columna.
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
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    filas = sharepoint.leer_lista("Mayrit - TRecibos", TITULO_DE, FECHAS)
    db = SessionLocal()
    polizas = {p.numero_poliza: p for p in db.scalars(select(Poliza)).all() if p.numero_poliza}
    recibos = db.scalars(select(Recibo)).all()
    por_numero = {r.numero for r in recibos if r.numero}
    por_sp = {r.sp_old_id for r in recibos if r.sp_old_id is not None}

    om, sin_poliza, ya = [], [], []
    for fila in filas:
        numero = str(fila.get("numero") or "").strip()
        if not numero:
            continue
        tipo = str(fila.get("tipo_poliza") or "").strip()
        if tipo == "Binder":
            continue
        if numero in por_numero or fila.get("_sp_id") in por_sp:
            ya.append(numero)
            continue
        numpol = str(fila.get("numero_poliza") or "").strip()
        pol = polizas.get(numpol)
        if not pol:
            sin_poliza.append((numero, tipo, numpol))
            continue
        om.append((fila, pol))

    print(f"== Migración recibos OM (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Recibos leídos de TRecibos: {len(filas)}")
    print(f"OM importables (póliza encontrada): {len(om)}")
    for fila, pol in om:
        print(f"   · {fila['numero']} [{fila.get('tipo_poliza')}] -> póliza {pol.numero_poliza} ({pol.asegurado})")
    print(f"OM sin póliza en BD: {len(sin_poliza)}")
    for n, t, p in sin_poliza:
        print(f"   · {n} [{t}] póliza «{p}» NO encontrada")
    print(f"Ya existían (omitidos): {len(ya)}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para migrar.")
        return

    creados = 0
    for fila, pol in om:
        numero = str(fila["numero"]).strip()
        fer = _fecha(fila.get("fecha_efecto_recibo")) or _fecha(fila.get("fecha_contable"))
        periodo = fer.strftime("%Y-%m") if fer else ""
        rec = Recibo(numero=numero, poliza_id=pol.id, binder_id=None, periodo=periodo,
                     anio=int(numero[:4]) if numero[:4].isdigit() else 0,
                     sp_old_id=fila.get("_sp_id"), estado="Emitido")
        for campo in TITULO_DE:
            if campo == "numero":
                continue
            v = fila.get(campo)
            if campo in FECHAS:
                v = _fecha(v)
            elif campo in IMPORTES:
                v = _dec(v)
            elif campo in PORC_FIELDS:
                d = _dec(v, "0.000001")
                v = (d * 100).quantize(Decimal("0.0001"), ROUND_HALF_UP) if d is not None else None
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
    print(f"\nAPLICADO: {creados} recibos OM creados.")
    db.close()


if __name__ == "__main__":
    main()
