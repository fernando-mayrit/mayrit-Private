"""
Importa el HISTÓRICO de presentaciones del Claims BDX de un binder desde el Excel de bordereaux
(una pestaña por mes, formato Claims Bordereau de Lloyd's de 32 columnas).

- El periodo de cada pestaña se toma de la celda "Reporting Period (End Date)" (NO del nombre de
  la pestaña, que va desfasado).
- Crea una fila en `claims_presentaciones` por (binder, periodo, siniestro) con el snapshot
  congelado (fila_json) y los acumulados; y BLOQUEA cada mes (BdxBloqueo tipo='claims').
- Empareja el siniestro por Certificate (y, en su defecto, por Claim Reference).
- Idempotente: por cada periodo hace DELETE+INSERT. DRY-RUN por defecto (--apply para escribir).

Uso:  py -m tools.migrar_claims_presentaciones --excel "RUTA.xlsx" --binder-id 12 [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from decimal import Decimal

import openpyxl
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.maestras import BdxBloqueo, Binder, ClaimsPresentacion, Siniestro
from app.routers.claims_bdx import HEADERS

H_FECHA = {
    "Binding authority or coverholder appointment agreement inception date",
    "Binding authority or coverholder appointment agreement expiry date",
    "Reporting Period (End Date)", "Risk Inception Date", "Risk Expiry Date",
    "Date Claim First Advised/Date Claim Made", "Date Claim Opened", "Date Closed",
}


def _num(v) -> float:
    try:
        return float(str(v).replace(",", ".")) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _safe(h: str, v):
    if v is None or v == "":
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if h in H_FECHA:
        return str(v)[:10]
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel", required=True)
    ap.add_argument("--binder-id", type=int)
    ap.add_argument("--agreement")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    b = db.get(Binder, args.binder_id) if args.binder_id else \
        db.scalar(select(Binder).where(Binder.agreement_number == args.agreement))
    if b is None:
        print("Binder no encontrado.")
        return

    # Mapa de siniestros del binder para casar (por certificate y por reference).
    sins = db.scalars(select(Siniestro).where(Siniestro.binder_id == b.id)).all()
    por_cert = {(s.certificate or "").strip(): s.id for s in sins if s.certificate}
    por_ref = {(s.reference or "").strip(): s.id for s in sins if s.reference}

    wb = openpyxl.load_workbook(args.excel, data_only=True)
    # periodo -> lista de (fila_dict, meta)
    por_periodo: dict[str, list] = {}
    for hoja in wb.sheetnames:
        ws = wb[hoja]
        ix = {str(c.value).strip(): i for i, c in enumerate(ws[1]) if c.value}
        if "Certificate Reference" not in ix or "Reporting Period (End Date)" not in ix:
            continue
        filas = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[ix["Certificate Reference"]]]
        if not filas:
            continue
        rp = filas[0][ix["Reporting Period (End Date)"]]
        if not isinstance(rp, (dt.datetime, dt.date)):
            print(f"  ⚠ hoja {hoja!r}: sin Reporting Period válido, omitida")
            continue
        periodo = f"{rp.year:04d}-{rp.month:02d}"
        po = rp.year * 100 + rp.month
        registros = []
        for r in filas:
            def g(h):
                return r[ix[h]] if h in ix else None
            cert = str(g("Certificate Reference") or "").strip()
            ref = str(g("Claim Reference / Number") or "").strip()
            sid = por_cert.get(cert) or por_ref.get(ref)
            fila = {h: _safe(h, g(h)) for h in HEADERS}
            meta = {
                "siniestro_id": sid,
                "paid_indemnity_acum": _num(g("Previously Paid - Indemnity")) + _num(g("Paid this month - Indemnity")),
                "paid_fees_acum": _num(g("Previously Paid - Fees")) + _num(g("Paid this month - Fees")),
                "to_pay_indemnity": _num(g("Paid this month - Indemnity")),
                "to_pay_fees": _num(g("Paid this month - Fees")),
                "reserves_indemnity": _num(g("Reserve - Indemnity")),
                "reserves_fees": _num(g("Reserve - Fees")),
                "status": g("Claim Status"),
            }
            registros.append((fila, meta, po))
        por_periodo[periodo] = registros  # un periodo = una hoja (la última gana si se repite)

    periodos = sorted(por_periodo)
    print(f"== Histórico Claims BDX — binder {b.umr} (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Periodos detectados: {len(periodos)}")
    sin_match = 0
    for p in periodos:
        regs = por_periodo[p]
        nm = sum(1 for _, m, _ in regs if m["siniestro_id"] is None)
        sin_match += nm
        print(f"  {p}: {len(regs)} siniestro(s)" + (f"  ⚠ {nm} sin casar" if nm else ""))
    print(f"Filas sin casar con un siniestro del binder: {sin_match}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para volcar el histórico.")
        return

    total = 0
    for p in periodos:
        regs = por_periodo[p]
        po = regs[0][2]
        db.execute(delete(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == b.id, ClaimsPresentacion.periodo == p))
        for fila, meta, _ in regs:
            db.add(ClaimsPresentacion(
                binder_id=b.id, periodo=p, periodo_ord=po, siniestro_id=meta["siniestro_id"],
                paid_indemnity_acum=Decimal(str(meta["paid_indemnity_acum"])),
                paid_fees_acum=Decimal(str(meta["paid_fees_acum"])),
                to_pay_indemnity=Decimal(str(meta["to_pay_indemnity"])),
                to_pay_fees=Decimal(str(meta["to_pay_fees"])),
                reserves_indemnity=Decimal(str(meta["reserves_indemnity"])),
                reserves_fees=Decimal(str(meta["reserves_fees"])),
                status=(str(meta["status"]) if meta["status"] is not None else None),
                fila_json=json.dumps(fila, ensure_ascii=False, default=str),
                fecha_presentacion=None, usuario="histórico",
            ))
            total += 1
        # Bloquear el mes (presentado).
        if not db.scalar(select(BdxBloqueo).where(BdxBloqueo.binder_id == b.id, BdxBloqueo.tipo == "claims", BdxBloqueo.periodo == p)):
            db.add(BdxBloqueo(binder_id=b.id, tipo="claims", periodo=p))
    db.commit()
    print(f"\nAPLICADO: {total} filas de presentación en {len(periodos)} periodos. Meses bloqueados.")
    db.close()


if __name__ == "__main__":
    main()
