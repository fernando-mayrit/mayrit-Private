"""
Importador de bordereaux RISK de caución (Hamilton/CGICE) con encabezados NO estándar.

Estos binders (B1634SB0125IBE, B1634SB0226IBE) traen el Risk en un Excel con 12 hojas (una por mes)
y hasta 5 layouts de cabecera distintos. Se mapea POR NOMBRE DE COLUMNA (no por posición) a los
campos estándar de BdxLinea que encajan, y se guarda la FILA ORIGINAL ÍNTEGRA en `extra` (JSONB)
para no perder ningún dato.

Uso:
  python -m tools.importar_caucion_risk --file "<ruta.xlsx>" --binder B1634SB0125IBE          # DRY-RUN
  python -m tools.importar_caucion_risk --file "<ruta.xlsx>" --binder B1634SB0125IBE --commit  # escribe
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation

import openpyxl
from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Bdx, BdxLinea, Binder


def norm(h) -> str:
    """Normaliza un encabezado: minúsculas, espacios colapsados, apóstrofo recto."""
    s = str(h or "").replace("’", "'").replace("‘", "'")
    return " ".join(s.strip().lower().split())


# encabezado normalizado -> (campo BdxLinea, tipo)   tipo: date|num|pct|int|str
MAP: dict[str, tuple[str, str]] = {
    "reporting period start date": ("reporting_period_start", "date"),
    "reporting period end date": ("reporting_period_end", "date"),
    "bondnumber": ("certificate_ref", "str"),
    "certificate ref": ("certificate_ref", "str"),
    "registrationname": ("insured_name", "str"),
    "insured full name, last name or company name": ("insured_name", "str"),
    "mainclientnationalid": ("insured_id", "str"),
    "street": ("insured_address", "str"),
    "zipcode": ("insured_postcode", "str"),
    "region": ("insured_province", "str"),
    "maxtotalliability": ("sum_insured_total", "num"),
    "maxtotalliability (hamilton line)": ("sum_insured_our_line", "num"),
    "firstissuedate": ("policy_issuance_date", "date"),
    "validfrom": ("risk_inception_date", "date"),
    "validto": ("risk_expiry_date", "date"),
    "coveredpaidperiodfrom": ("effective_date_transaction", "date"),
    "coveredpaidperiodto": ("expiry_date_transaction", "date"),
    "bondstatus": ("risk_transaction_type", "str"),
    "risk transaction type (new, renewal, endorsement, cancellation)": ("risk_transaction_type", "str"),
    "bondtypeid": ("class_of_business", "str"),
    "netpremiumgwpforpaidperiod": ("gross_written_premium", "num"),
    "hamilton line (%)": ("written_line_pct", "pct"),
    "total gross written premium (our line)": ("total_gwp_our_line", "num"),
    "total gross written premium (hamilton line)": ("total_gwp_our_line", "num"),
    "commission coverholder %": ("commission_coverholder_pct", "pct"),
    "commission coverholder amount": ("commission_coverholder_amount", "num"),
    "commission (hamilton line)": ("commission_coverholder_amount", "num"),
    "total taxes and levies": ("total_taxes_levies", "num"),
    "fees": ("fees", "num"),
    "net premium to lloyd's broker in original currency": ("net_premium_to_broker", "num"),
    "brokerage %": ("brokerage_pct", "pct"),
    "brokerage amount (original currency)": ("brokerage_amount", "num"),
    "brokerage amount": ("brokerage_amount", "num"),
    "final net premium to uw (original currency)": ("final_net_premium_uw", "num"),
    "final net premium to hamilton": ("final_net_premium_uw", "num"),
    "risk code": ("risk_code", "str"),
    "referral": ("referred_to_london", "str"),
    "instalment number": ("instalment_number", "int"),
    "number of instalments": ("number_of_instalments", "int"),
}


def _as_date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None   # serial/textos raros NO se fuerzan: quedan íntegros en `extra`


def _as_dec(v):
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def _as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _jsonable(v):
    if isinstance(v, dt.datetime):
        return v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def fila_extra(headers: list[str], valores: tuple) -> dict:
    """Fila original íntegra -> dict JSON. Conserva duplicados de encabezado con sufijo (coln)."""
    out: dict = {}
    for i, (h, v) in enumerate(zip(headers, valores), start=1):
        if h is None or str(h).strip() == "":
            continue
        if v is None or v == "":
            continue
        key = str(h).strip()
        if key in out:
            key = f"{key} (col{i})"
        out[key] = _jsonable(v)
    return out


def construir_linea(headers: list[str], valores: tuple) -> BdxLinea:
    linea = BdxLinea(original_currency="EUR", section_no=1)   # 1 sección para todo (decidido)
    for h, v in zip(headers, valores):
        m = MAP.get(norm(h))
        if not m or v is None or v == "":
            continue
        campo, tipo = m
        if tipo == "date":
            val = _as_date(v)
        elif tipo == "num":
            val = _as_dec(v)
        elif tipo == "pct":
            d = _as_dec(v)
            val = (d * 100) if d is not None else None
        elif tipo == "int":
            val = _as_int(v)
        else:
            val = str(v).strip()
        if val is not None:
            setattr(linea, campo, val)
    linea.extra = fila_extra(headers, valores)
    return linea


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--binder", required=True, help="UMR del binder destino")
    ap.add_argument("--commit", action="store_true", help="escribe en la BD (por defecto dry-run)")
    ap.add_argument("--force", action="store_true", help="permite importar aunque ya existan BDX Risk")
    args = ap.parse_args()

    db = SessionLocal()
    binder = db.scalar(select(Binder).where(Binder.umr == args.binder))
    if not binder:
        raise SystemExit(f"Binder {args.binder} no encontrado")
    print(f"Binder {args.binder} id={binder.id} participacion={binder.participacion}")

    existentes = db.scalar(select(Bdx).where(Bdx.binder_id == binder.id, Bdx.tipo == "Risk"))
    if existentes and not args.force:
        raise SystemExit("Ya existen BDX Risk para este binder. Usa --force si de verdad quieres reimportar.")

    wb = openpyxl.load_workbook(args.file, read_only=True, data_only=True)
    total_lineas = 0
    sum_gwp100 = sum_gwp_our = sum_com = sum_neto = Decimal(0)
    print(f"\n{'Hoja':<16}{'filas':>7}{'GWP 100%':>16}{'GWP our line':>16}{'Com.CH':>14}{'Neto a UW':>14}  dup?")
    print("-" * 95)

    bdx_a_crear = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        headers = [("" if c is None else str(c)) for c in rows[0]]
        norms = [norm(h) for h in headers]
        dup = len(set(n for n in norms if n)) != len([n for n in norms if n])
        lineas, starts, ends = [], [], []
        s_gwp100 = s_our = s_com = s_neto = Decimal(0)
        for r in rows[1:]:
            # fila de datos: debe tener UMR (col2) no vacío
            if len(r) < 2 or r[1] in (None, ""):
                continue
            ln = construir_linea(headers, r)
            lineas.append(ln)
            if ln.reporting_period_start:
                starts.append(ln.reporting_period_start)
            if ln.reporting_period_end:
                ends.append(ln.reporting_period_end)
            s_gwp100 += ln.gross_written_premium or 0
            s_our += ln.total_gwp_our_line or 0
            s_com += ln.commission_coverholder_amount or 0
            s_neto += ln.final_net_premium_uw or 0
        if not lineas:
            print(f"{ws.title:<16}{0:>7}{'—':>16}{'—':>16}{'—':>14}{'—':>14}  (vacía)")
            continue
        bdx = Bdx(binder_id=binder.id, tipo="Risk",
                  reporting_period_start=min(starts) if starts else None,
                  reporting_period_end=max(ends) if ends else None,
                  estado="Importado", notas=f"Importado de Excel caución — hoja '{ws.title}'")
        bdx.lineas = lineas
        bdx_a_crear.append(bdx)
        total_lineas += len(lineas)
        sum_gwp100 += s_gwp100; sum_gwp_our += s_our; sum_com += s_com; sum_neto += s_neto
        print(f"{ws.title:<16}{len(lineas):>7}{float(s_gwp100):>16,.2f}{float(s_our):>16,.2f}"
              f"{float(s_com):>14,.2f}{float(s_neto):>14,.2f}  {'SÍ' if dup else ''}")

    print("-" * 95)
    print(f"{'TOTAL':<16}{total_lineas:>7}{float(sum_gwp100):>16,.2f}{float(sum_gwp_our):>16,.2f}"
          f"{float(sum_com):>14,.2f}{float(sum_neto):>14,.2f}")

    # Comprobación de integridad: nº de claves en `extra` vs columnas no vacías (muestra)
    faltan = 0
    for bdx in bdx_a_crear:
        for ln in bdx.lineas:
            if not ln.extra:
                faltan += 1
    print(f"\nLíneas sin `extra`: {faltan}  (debe ser 0)")

    if args.commit:
        for bdx in bdx_a_crear:
            db.add(bdx)
        db.commit()
        print(f"\n✅ COMMIT: {len(bdx_a_crear)} BDX (cabeceras) y {total_lineas} líneas escritas.")
    else:
        print("\n(DRY-RUN: no se ha escrito nada. Añade --commit para grabar.)")
    db.close()


if __name__ == "__main__":
    main()
