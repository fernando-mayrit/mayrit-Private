"""
Claims BDX (bordereau de siniestros de un binder) — modelo replicado de Alea.

A diferencia de Risk/Premium, el Claims BDX es ACUMULATIVO: cada mes se presenta el estado
actual de TODOS los siniestros del binder y se conserva lo presentado. El "To pay this month"
se deriva = pagado acumulado actual − lo presentado el último periodo anterior (si no hay
presentación previa → 0, todo a "Previously Paid"). Presentar un mes lo BLOQUEA (BdxBloqueo
tipo='claims'); bloquear impide presentar. Export = Claims Bordereau de Lloyd's (32 columnas),
con las celdas cambiadas respecto a la última presentación en AZUL.
"""
from __future__ import annotations

import calendar
import datetime as dt
import io
import json
from decimal import Decimal

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Response
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import BdxBloqueo, Binder, ClaimsPresentacion, Productor, Siniestro

router = APIRouter(tags=["Claims BDX"])

# 32 columnas EXACTAS del Claims Bordereau de Lloyd's (orden del template).
HEADERS = [
    "UCR", "Coverholder Name", "Unique Market Reference (UMR)",
    "Binding authority or coverholder appointment agreement inception date",
    "Binding authority or coverholder appointment agreement expiry date",
    "Reporting Period (End Date)", "Lloyd's Risk Code", "Original Currency",
    "Certificate Reference", "Claim Reference / Number", "Insured Full Name or Company Name",
    "Insured Country", "Risk Inception Date", "Risk Expiry Date", "Location of loss Country",
    "Loss Description", "Date Claim First Advised/Date Claim Made", "Claim Status",
    "Refer to Underwriters", "Denial (Y/N)", "Claimant Name", "Amount Claimed",
    "Paid this month - Indemnity", "Paid this month - Fees",
    "Previously Paid - Indemnity", "Previously Paid - Fees",
    "Reserve - Indemnity", "Reserve - Fees",
    "Total Incurred - Indemnity", "Total Incurred - Fees",
    "Date Claim Opened", "Date Closed",
]
H_FECHA = {
    "Binding authority or coverholder appointment agreement inception date",
    "Binding authority or coverholder appointment agreement expiry date",
    "Reporting Period (End Date)", "Risk Inception Date", "Risk Expiry Date",
    "Date Claim First Advised/Date Claim Made", "Date Claim Opened", "Date Closed",
}
H_NUM = {
    "Amount Claimed", "Paid this month - Indemnity", "Paid this month - Fees",
    "Previously Paid - Indemnity", "Previously Paid - Fees", "Reserve - Indemnity",
    "Reserve - Fees", "Total Incurred - Indemnity", "Total Incurred - Fees",
}


def _f(x) -> float:
    return float(x) if x is not None else 0.0


def _fin_mes(periodo: str) -> dt.date:
    y, m = (int(x) for x in periodo.split("-"))
    return dt.date(y, m, calendar.monthrange(y, m)[1])


def _ord(periodo: str) -> int:
    y, m = (int(x) for x in periodo.split("-"))
    return y * 100 + m


def _yn(v) -> str:
    return "Yes" if str(v or "").strip().lower() in ("1", "yes", "y", "sí", "si", "true") else "No"


def _binder_o_404(binder_id: int, db: Session) -> Binder:
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return b


def _bloqueado(db: Session, binder_id: int, periodo: str) -> bool:
    return db.scalar(
        select(BdxBloqueo).where(BdxBloqueo.binder_id == binder_id, BdxBloqueo.tipo == "claims", BdxBloqueo.periodo == periodo)
    ) is not None


def _construir(db: Session, b: Binder, periodo: str) -> tuple[list[dict], list[dict]]:
    """Filas (32 col) + meta (por siniestro) del Claims BDX del binder para ese periodo."""
    siniestros = db.scalars(
        select(Siniestro).where(Siniestro.binder_id == b.id).order_by(Siniestro.certificate, Siniestro.reference, Siniestro.id)
    ).all()
    coverholder = db.get(Productor, b.productor_id).nombre if b.productor_id else None
    fin = _fin_mes(periodo)
    po = _ord(periodo)

    # Última presentación ANTERIOR por siniestro → base de "Previously Paid".
    prev_rows = db.scalars(
        select(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == b.id, ClaimsPresentacion.periodo_ord < po)
    ).all()
    prev: dict[int, tuple[float, float]] = {}
    for p in sorted(prev_rows, key=lambda x: x.periodo_ord):
        prev[p.siniestro_id] = (_f(p.paid_indemnity_acum), _f(p.paid_fees_acum))  # se queda con la más reciente

    filas, meta = [], []
    for s in siniestros:
        paid_i, paid_f = _f(s.paid_indemnity), _f(s.paid_fees)
        res_i, res_f = _f(s.reserves_indemnity), _f(s.reserves_fees)
        prev_i, prev_f = prev.get(s.id, (paid_i, paid_f))  # sin previa: to_pay=0, todo previamente pagado
        fila = {
            "UCR": s.ucr,
            "Coverholder Name": coverholder,
            "Unique Market Reference (UMR)": b.umr,
            "Binding authority or coverholder appointment agreement inception date": b.fecha_efecto,
            "Binding authority or coverholder appointment agreement expiry date": b.fecha_vencimiento,
            "Reporting Period (End Date)": fin,
            "Lloyd's Risk Code": s.risk_code,
            "Original Currency": s.currency or "EUR",
            "Certificate Reference": s.certificate,
            "Claim Reference / Number": s.reference,
            "Insured Full Name or Company Name": s.insured,
            "Insured Country": "Spain",
            "Risk Inception Date": s.risk_inception,
            "Risk Expiry Date": s.risk_expiry,
            "Location of loss Country": "Spain",
            "Loss Description": s.description,
            "Date Claim First Advised/Date Claim Made": s.claim_first_advised,
            "Claim Status": s.status,
            "Refer to Underwriters": _yn(s.refer),
            "Denial (Y/N)": _yn(s.denial),
            "Claimant Name": s.claimant,
            "Amount Claimed": _f(s.amount_claimed),
            "Paid this month - Indemnity": paid_i - prev_i,
            "Paid this month - Fees": paid_f - prev_f,
            "Previously Paid - Indemnity": prev_i,
            "Previously Paid - Fees": prev_f,
            "Reserve - Indemnity": res_i,
            "Reserve - Fees": res_f,
            # Total Incurred = cifra REAL del claims (no mecánicamente pagado+reserva).
            "Total Incurred - Indemnity": _f(s.total_indemnity) if s.total_indemnity is not None else paid_i + res_i,
            "Total Incurred - Fees": _f(s.total_fees) if s.total_fees is not None else paid_f + res_f,
            "Date Claim Opened": s.date_opened,
            "Date Closed": s.date_closed,
        }
        filas.append({h: fila.get(h) for h in HEADERS})
        meta.append({
            "siniestro_id": s.id, "paid_indemnity_acum": paid_i, "paid_fees_acum": paid_f,
            "to_pay_indemnity": paid_i - prev_i, "to_pay_fees": paid_f - prev_f,
            "reserves_indemnity": res_i, "reserves_fees": res_f, "status": s.status,
        })
    return filas, meta


def _norm(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, (int, float, Decimal)):
        return f"{float(v):.2f}"
    return str(v)


def _diff(filas: list[dict], base: dict[str, dict]) -> list[set]:
    """Conjunto de columnas cambiadas por fila respecto a la baseline (por clave UCR/Certificate+Ref)."""
    out = []
    for f in filas:
        clave = (f.get("Certificate Reference") or "", f.get("Claim Reference / Number") or "")
        prev = base.get(clave)
        if prev is None:
            out.append({h for h in HEADERS if _norm(f.get(h))})  # siniestro nuevo: marca lo no vacío
            continue
        out.append({h for h in HEADERS if h != "Reporting Period (End Date)" and _norm(f.get(h)) != _norm(prev.get(h))})
    return out


def _baseline(db: Session, binder_id: int, antes_de_ord: int | None = None) -> dict[str, dict]:
    """Filas (fila_json) de la última presentación del binder (la más reciente, o la más reciente
    ESTRICTAMENTE anterior a `antes_de_ord`), indexadas por (certificate, reference)."""
    stmt = select(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == binder_id)
    if antes_de_ord is not None:
        stmt = stmt.where(ClaimsPresentacion.periodo_ord < antes_de_ord)
    rows = db.scalars(stmt).all()
    if not rows:
        return {}
    ult = max(r.periodo_ord for r in rows)
    base: dict[str, dict] = {}
    for r in rows:
        if r.periodo_ord != ult or not r.fila_json:
            continue
        fila = json.loads(r.fila_json)
        base[(fila.get("Certificate Reference") or "", fila.get("Claim Reference / Number") or "")] = fila
    return base


# ── Excel ──
HEAD_FONT = Font(name="Calibri", size=9, bold=True)
HEAD_FILL = PatternFill("solid", fgColor="D9D9D9")
BODY_FONT = Font(name="Calibri", size=9)
AZUL = Font(name="Calibri", size=9, bold=True, color="0070C0")


def _excel(filas: list[dict], cambios: list[set]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Claims BDX"
    ws.append(HEADERS)
    for c in ws[1]:
        c.font = HEAD_FONT
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 70
    for i, f in enumerate(filas):
        ws.append([f.get(h) for h in HEADERS])
        fila_xl = ws[i + 2]
        camb = cambios[i] if i < len(cambios) else set()
        for j, h in enumerate(HEADERS):
            c = fila_xl[j]
            c.font = AZUL if h in camb else BODY_FONT
            if h in H_FECHA:
                c.number_format = "dd/mm/yyyy"
            elif h in H_NUM:
                c.number_format = "#,##0.00"
    for j, h in enumerate(HEADERS, start=1):
        ancho = max([len(h)] + [len(_norm(f.get(h))) for f in filas]) if filas else len(h)
        ws.column_dimensions[get_column_letter(j)].width = min(max(ancho + 1, 10), 45)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(HEADERS))}{max(ws.max_row, 1)}"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ─────────────────────────────── Endpoints ───────────────────────────────
@router.get("/binders/{binder_id}/claims-bdx")
def vista(binder_id: int, periodo: str | None = None, db: Session = Depends(get_db)):
    """Vista en vivo del Claims BDX. `meses` = solo periodos YA presentados (los que existen);
    para presentar uno nuevo se elige el mes libremente en el frontend. Por defecto abre en el
    último presentado (o el mes actual si aún no hay ninguno)."""
    b = _binder_o_404(binder_id, db)
    presentadas = sorted(
        {p.periodo for p in db.scalars(select(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == b.id)).all()},
        reverse=True,
    )
    periodo = periodo or (presentadas[0] if presentadas else dt.date.today().strftime("%Y-%m"))
    filas, _ = _construir(db, b, periodo)
    # Meses candidatos a PRESENTAR: del efecto del binder a hoy, menos los ya presentados.
    pend, ini, hoy, ya = [], (b.fecha_efecto or dt.date.today()), dt.date.today(), set(presentadas)
    y, m = ini.year, ini.month
    while (y, m) <= (hoy.year, hoy.month):
        mm = f"{y:04d}-{m:02d}"
        if mm not in ya:
            pend.append(mm)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return {
        "periodo": periodo,
        "meses": presentadas,
        "meses_pendientes": pend,
        "presentado": periodo in presentadas,
        "bloqueado": _bloqueado(db, b.id, periodo),
        "headers": HEADERS,
        "filas": filas,
    }


@router.get("/binders/{binder_id}/claims-bdx/periodos")
def periodos_presentados(binder_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == binder_id)
    ).all()
    agg: dict[str, dict] = {}
    for r in rows:
        g = agg.setdefault(r.periodo, {"periodo": r.periodo, "n": 0, "fecha": r.fecha_presentacion})
        g["n"] += 1
        if r.fecha_presentacion and (not g["fecha"] or r.fecha_presentacion > g["fecha"]):
            g["fecha"] = r.fecha_presentacion
    return sorted(agg.values(), key=lambda x: x["periodo"], reverse=True)


class PresentarPayload(BaseModel):
    periodo: str
    usuario: str | None = None


@router.post("/binders/{binder_id}/claims-bdx/presentar")
def presentar(binder_id: int, payload: PresentarPayload, db: Session = Depends(get_db)):
    """Congela el snapshot del periodo y lo BLOQUEA. Reemplaza si ya existía."""
    b = _binder_o_404(binder_id, db)
    periodo = payload.periodo
    if _bloqueado(db, b.id, periodo):
        raise HTTPException(status_code=409, detail=f"El Claims BDX de {periodo} está bloqueado. Desbloquéalo para volver a presentarlo.")
    filas, meta = _construir(db, b, periodo)
    db.execute(delete(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == b.id, ClaimsPresentacion.periodo == periodo))
    hoy = dt.date.today()
    po = _ord(periodo)
    for f, m in zip(filas, meta):
        db.add(ClaimsPresentacion(
            binder_id=b.id, periodo=periodo, periodo_ord=po, siniestro_id=m["siniestro_id"],
            paid_indemnity_acum=m["paid_indemnity_acum"], paid_fees_acum=m["paid_fees_acum"],
            to_pay_indemnity=m["to_pay_indemnity"], to_pay_fees=m["to_pay_fees"],
            reserves_indemnity=m["reserves_indemnity"], reserves_fees=m["reserves_fees"],
            status=m["status"], fila_json=json.dumps(f, ensure_ascii=False, default=str),
            fecha_presentacion=hoy, usuario=payload.usuario,
        ))
    # Presentar = bloquear ese mes (BdxBloqueo claims).
    if not _bloqueado(db, b.id, periodo):
        db.add(BdxBloqueo(binder_id=b.id, tipo="claims", periodo=periodo))
    db.commit()
    return {"periodo": periodo, "presentados": len(filas)}


@router.get("/binders/{binder_id}/claims-bdx/excel")
def excel(binder_id: int, periodo: str, modo: str = "vivo", db: Session = Depends(get_db)):
    """Descarga el Claims BDX (32 col) del periodo. modo=vivo (estado actual) o presentado (snapshot)."""
    b = _binder_o_404(binder_id, db)
    if modo == "presentado":
        rows = db.scalars(
            select(ClaimsPresentacion).where(ClaimsPresentacion.binder_id == b.id, ClaimsPresentacion.periodo == periodo).order_by(ClaimsPresentacion.id)
        ).all()
        filas = [json.loads(r.fila_json) for r in rows if r.fila_json]
        # Diff respecto a la presentación ANTERIOR a este periodo.
        cambios = _diff(filas, _baseline(db, b.id, _ord(periodo)))
    else:
        filas, _ = _construir(db, b, periodo)
        cambios = _diff(filas, _baseline(db, b.id, _ord(periodo)))
    contenido = _excel(filas, cambios)
    nombre = f"Claims BDX {b.umr or binder_id} {periodo}.xlsx"
    return Response(
        content=contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )
