"""
Volcado histórico DIRECTO de recibos de tipo BINDER desde SharePoint 'Mayrit - TRecibos'
(lectura en vivo), enlazándolos al binder por UMR (= NumeroPoliza).

Pensado SOLO para binders CERRADOS de años antiguos (2020, 2021…): trae los recibos
con sus importes/cobros/liquidaciones tal cual, SIN líneas BDX detrás. Para binders
activos (2022+) NO usar esto: los recibos se EMITEN desde el Risk BDX.

- Idempotente: casa por `numero`, por `sp_old_id` y por (binder, periodo).
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_recibos_binder --anios 2020 [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Binder, Recibo
from tools.migrar_recibos_excel import MAP_DIRECTO, MAP_PORC, FECHAS, IMPORTES

# field_modelo -> Título de columna (para leer_lista). Reutiliza el mapeo del importador de Excel.
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
    ap.add_argument("--anios", default="2020")
    ap.add_argument("--excluir", default="",
                    help="Números de recibo a NO migrar (coma). P. ej. duplicados de SharePoint pendientes de revisar.")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    anios = {a.strip() for a in args.anios.split(",")}
    excluir = {x.strip() for x in args.excluir.split(",") if x.strip()}

    filas = sharepoint.leer_lista("Mayrit - TRecibos", TITULO_DE, FECHAS)
    db = SessionLocal()

    by_umr: dict[str, int] = {}
    for b in db.scalars(select(Binder)).all():
        for k in (b.umr, b.agreement_number):
            if k:
                by_umr[k.strip()] = b.id

    recibos = db.scalars(select(Recibo)).all()
    por_numero = {r.numero for r in recibos if r.numero}
    por_sp = {r.sp_old_id for r in recibos if r.sp_old_id is not None}
    por_bp = {(r.binder_id, r.periodo) for r in recibos if r.binder_id and r.periodo}

    importables, sin_binder, ya = [], [], []
    for f in filas:
        numero = str(f.get("numero") or "").strip()
        if not numero or numero[:4] not in anios:
            continue
        if numero in excluir:
            continue
        if str(f.get("tipo_poliza") or "").strip() != "Binder":
            continue
        if numero in por_numero or f.get("_sp_id") in por_sp:
            ya.append(numero)
            continue
        umr = str(f.get("numero_poliza") or "").strip()
        bid = by_umr.get(umr)
        if not bid:
            sin_binder.append((numero, umr))
            continue
        fer = _fecha(f.get("fecha_efecto_recibo")) or _fecha(f.get("fecha_contable"))
        periodo = fer.strftime("%Y-%m") if fer else ""
        if (bid, periodo) in por_bp:
            ya.append(numero)  # ya hay un recibo para ese binder+periodo (p. ej. emitido del BDX)
            continue
        importables.append((f, bid, umr, periodo))

    print(f"== Recibos BINDER {sorted(anios)} desde TRecibos (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Importables: {len(importables)} · ya en BD/omitidos: {len(ya)} · binder NO encontrado: {len(sin_binder)}")
    for f, bid, umr, per in importables:
        print(f"   + {f['numero']} -> binder {bid} ({umr}) periodo {per}")
    for n, u in sin_binder:
        print(f"   ! {n} UMR {u} (binder no está en BD)")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para volcar.")
        return

    creados = 0
    for f, bid, umr, periodo in importables:
        numero = str(f["numero"]).strip()
        rec = Recibo(
            numero=numero, binder_id=bid, periodo=periodo,
            anio=int(numero[:4]) if numero[:4].isdigit() else 0,
            sp_old_id=f.get("_sp_id"), estado="Emitido",
        )
        for campo in TITULO_DE:
            if campo == "numero":
                continue
            v = f.get(campo)
            if campo in FECHAS:
                v = _fecha(v)
            elif campo in PORC_FIELDS:
                d = _dec(v, "0.000001")
                v = (d * 100).quantize(Decimal("0.0001"), ROUND_HALF_UP) if d is not None else None
            elif campo in IMPORTES:
                v = _dec(v)
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
    print(f"\nAPLICADO: {creados} recibos de binder volcados.")
    db.close()


if __name__ == "__main__":
    main()
