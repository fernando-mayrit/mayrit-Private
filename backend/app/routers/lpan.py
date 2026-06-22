"""
LPAN (London Premium Advice Note) y FDO por binder.

Flujo Lloyd's/Xchanging:
  - Por cada (binder, risk code) se genera un FDO (Declaración) que se envía a Xchanging; éste
    devuelve un `signing_number`.
  - A partir de ahí, cada periodo de Premium BDX genera un LPAN (nota de pago) que agrupa las
    líneas de ese risk code en el periodo y cuelga del signing del FDO.

Importes del LPAN (sobre las líneas del Premium, incluidas en premium):
  - gross_premium = Σ total_gwp_our_line            (campo 18, GWP our line)
  - brokerage     = Σ (commission_coverholder + brokerage_amount)   (campo 19)
  - tax           = Σ total_taxes_levies            (campo 17, IPT)
  - net_premium   = Σ final_net_premium_uw          (campo 25, Bureau NA Premium)

Solo se genera un LPAN si todas las líneas del grupo están cobradas.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, Fdo, Lpan

router = APIRouter(tags=["LPAN"])

D0 = Decimal("0")
MESES_ES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def _d(v) -> Decimal:
    return v if isinstance(v, Decimal) else Decimal(str(v or 0))


def _periodo_label(per: str) -> str:
    """'2025-01' -> 'Enero-2025'."""
    try:
        a, m = per.split("-")
        return f"{MESES_ES[int(m)]}-{a}"
    except (ValueError, IndexError):
        return per


# ──────────────────────────── Schemas ────────────────────────────
class FdoRead(BaseModel):
    id: int
    section: int
    risk_code: str
    signing_number: str | None = None
    fecha_generado: dt.date | None = None
    fecha_signing: dt.date | None = None
    notas: str | None = None


class LpanRead(BaseModel):
    id: int
    tipo: str
    periodo: str
    num_lineas: int
    gross_premium: Decimal | None = None
    brokerage: Decimal | None = None
    tax: Decimal | None = None
    net_premium: Decimal | None = None
    fecha: dt.date | None = None
    estado: str


class RiskCodeFdo(BaseModel):
    section: int
    risk_code: str
    fdo: FdoRead | None = None


class RcEnSeccion(BaseModel):
    risk_code: str
    signing_number: str | None = None     # del FDO del risk code (si lo tiene)
    num_lineas: int
    gross_premium: Decimal
    brokerage: Decimal
    tax: Decimal
    net_premium: Decimal
    cobrado: bool
    lpan: LpanRead | None = None


class SeccionLpan(BaseModel):
    section: int
    risk_codes: list[RcEnSeccion]


class PeriodoLpan(BaseModel):
    periodo: str
    periodo_label: str
    secciones: list[SeccionLpan]


class VistaLpan(BaseModel):
    fdos: list[RiskCodeFdo]           # FDO/signing por risk code (transversal a periodos/secciones)
    periodos: list[PeriodoLpan]


class FdoCreate(BaseModel):
    section: int = 0
    risk_code: str


class FdoUpdate(BaseModel):
    signing_number: str | None = None
    fecha_signing: dt.date | None = None
    notas: str | None = None


class LpanCreate(BaseModel):
    risk_code: str
    section: int = 0
    periodo: str
    tipo: str = "PM"


# ──────────────────────────── Helpers ────────────────────────────
def _binder_o_404(binder_id: int, db: Session) -> Binder:
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return b


def _grupos_premium(db: Session, binder_id: int) -> dict[tuple[str, int, str], dict]:
    """Líneas del Premium (incluidas en premium) agrupadas por (periodo 'YYYY-MM', sección, risk_code)."""
    lineas = db.scalars(
        select(BdxLinea)
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id == binder_id, BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
        .options(load_only(
            BdxLinea.risk_code, BdxLinea.section_no, BdxLinea.premium_bdx,
            BdxLinea.total_gwp_our_line, BdxLinea.total_taxes_levies,
            BdxLinea.commission_coverholder_amount, BdxLinea.brokerage_amount,
            BdxLinea.final_net_premium_uw, BdxLinea.prima_cobrada,
        ))
    ).all()
    grupos: dict[tuple[str, int, str], dict] = {}
    for l in lineas:
        rc = (l.risk_code or "—").strip() or "—"
        sec = int(l.section_no) if l.section_no is not None else 0
        per = l.premium_bdx.strftime("%Y-%m")
        g = grupos.setdefault((per, sec, rc), {"num": 0, "gross": D0, "brk": D0, "tax": D0, "net": D0, "cobr": 0})
        g["num"] += 1
        g["gross"] += _d(l.total_gwp_our_line)
        g["brk"] += _d(l.commission_coverholder_amount) + _d(l.brokerage_amount)
        g["tax"] += _d(l.total_taxes_levies)
        g["net"] += _d(l.final_net_premium_uw)
        if l.prima_cobrada:
            g["cobr"] += 1
    return grupos


# ──────────────────────────── Endpoints ────────────────────────────
@router.get("/binders/{binder_id}/lpan", response_model=VistaLpan)
def vista(binder_id: int, db: Session = Depends(get_db)):
    """Vista LPAN del binder, agrupada Periodo → Sección → Risk Code, con los importes agregados,
    si está cobrado y el LPAN ya generado. Aparte, el FDO/signing por risk code (transversal)."""
    _binder_o_404(binder_id, db)
    grupos = _grupos_premium(db, binder_id)
    fdos = {(f.section, f.risk_code): f for f in db.scalars(select(Fdo).where(Fdo.binder_id == binder_id)).all()}
    lpans = db.scalars(select(Lpan).where(Lpan.binder_id == binder_id)).all()
    lpan_por = {(lp.periodo, lp.section, lp.risk_code): lp for lp in lpans}

    # FDO/signing por (sección, risk code): los que aparecen en premium o ya tienen FDO.
    claves = sorted({(s, rc) for (_, s, rc) in grupos} | set(fdos.keys()))
    fdos_out = [RiskCodeFdo(
        section=sec, risk_code=rc,
        fdo=FdoRead.model_validate(fdos[(sec, rc)], from_attributes=True) if (sec, rc) in fdos else None,
    ) for (sec, rc) in claves]

    periodos: list[PeriodoLpan] = []
    for per in sorted({p for (p, _, _) in grupos}):
        secciones: list[SeccionLpan] = []
        for sec in sorted({s for (p, s, _) in grupos if p == per}):
            rcs: list[RcEnSeccion] = []
            for rc in sorted({r for (p, s, r) in grupos if p == per and s == sec}):
                g = grupos[(per, sec, rc)]
                lp = lpan_por.get((per, sec, rc))
                f = fdos.get((sec, rc))
                rcs.append(RcEnSeccion(
                    risk_code=rc,
                    signing_number=f.signing_number if f else None,
                    num_lineas=g["num"], gross_premium=g["gross"], brokerage=g["brk"],
                    tax=g["tax"], net_premium=g["net"],
                    cobrado=(g["num"] > 0 and g["cobr"] == g["num"]),
                    lpan=LpanRead.model_validate(lp, from_attributes=True) if lp else None,
                ))
            secciones.append(SeccionLpan(section=sec, risk_codes=rcs))
        periodos.append(PeriodoLpan(periodo=per, periodo_label=_periodo_label(per), secciones=secciones))

    return VistaLpan(fdos=fdos_out, periodos=periodos)


@router.post("/binders/{binder_id}/fdo", response_model=FdoRead)
def crear_fdo(binder_id: int, payload: FdoCreate, db: Session = Depends(get_db)):
    """Genera el FDO de un risk code (a la espera del signing number de Xchanging)."""
    _binder_o_404(binder_id, db)
    rc = (payload.risk_code or "").strip()
    sec = int(payload.section or 0)
    if not rc:
        raise HTTPException(status_code=400, detail="Falta el risk code.")
    if db.scalar(select(Fdo).where(Fdo.binder_id == binder_id, Fdo.section == sec, Fdo.risk_code == rc)):
        raise HTTPException(status_code=409, detail=f"Ya existe un FDO para el risk code {rc} (sección {sec}).")
    f = Fdo(binder_id=binder_id, section=sec, risk_code=rc, fecha_generado=dt.date.today())
    db.add(f)
    db.commit()
    db.refresh(f)
    return FdoRead.model_validate(f, from_attributes=True)


@router.put("/fdo/{fdo_id}", response_model=FdoRead)
def actualizar_fdo(fdo_id: int, payload: FdoUpdate, db: Session = Depends(get_db)):
    """Asigna/edita el signing number (y fecha/notas) que devuelve Xchanging."""
    f = db.get(Fdo, fdo_id)
    if f is None:
        raise HTTPException(status_code=404, detail=f"FDO {fdo_id} no encontrado")
    datos = payload.model_dump(exclude_unset=True)
    for k, v in datos.items():
        setattr(f, k, v)
    if "signing_number" in datos and datos["signing_number"] and not f.fecha_signing:
        f.fecha_signing = dt.date.today()
    db.commit()
    db.refresh(f)
    return FdoRead.model_validate(f, from_attributes=True)


@router.delete("/fdo/{fdo_id}")
def borrar_fdo(fdo_id: int, db: Session = Depends(get_db)):
    """Borra un FDO (y, en cascada, sus LPAN)."""
    f = db.get(Fdo, fdo_id)
    if f is None:
        raise HTTPException(status_code=404, detail=f"FDO {fdo_id} no encontrado")
    db.delete(f)
    db.commit()
    return {"ok": True}


@router.post("/binders/{binder_id}/lpan", response_model=LpanRead)
def generar_lpan(binder_id: int, payload: LpanCreate, db: Session = Depends(get_db)):
    """Genera el LPAN de (risk code, periodo): exige FDO con signing y todas las líneas cobradas."""
    _binder_o_404(binder_id, db)
    rc, per = (payload.risk_code or "").strip(), (payload.periodo or "").strip()
    sec = int(payload.section or 0)
    tipo = payload.tipo or "PM"
    f = db.scalar(select(Fdo).where(Fdo.binder_id == binder_id, Fdo.section == sec, Fdo.risk_code == rc))
    if f is None:
        raise HTTPException(status_code=409, detail=f"Genera antes el FDO del risk code {rc} (sección {sec}).")
    if not f.signing_number:
        raise HTTPException(status_code=409, detail=f"El FDO del risk code {rc} (sección {sec}) aún no tiene signing number.")
    grupos = _grupos_premium(db, binder_id)
    g = grupos.get((per, sec, rc))
    if not g or g["num"] == 0:
        raise HTTPException(status_code=404, detail=f"No hay líneas de Premium para {rc} (sección {sec}) en {per}.")
    if g["cobr"] != g["num"]:
        raise HTTPException(status_code=409, detail=f"Hay líneas sin cobrar en {rc} {per}: no se puede generar el LPAN.")
    if db.scalar(select(Lpan).where(Lpan.fdo_id == f.id, Lpan.periodo == per, Lpan.section == sec, Lpan.tipo == tipo)):
        raise HTTPException(status_code=409, detail=f"Ya existe un LPAN {tipo} para {rc} sección {sec} {per}.")
    lp = Lpan(
        fdo_id=f.id, binder_id=binder_id, risk_code=rc, section=sec, periodo=per, tipo=tipo,
        num_lineas=g["num"], gross_premium=g["gross"], brokerage=g["brk"], tax=g["tax"], net_premium=g["net"],
        fecha=dt.date.today(), estado="Generado",
    )
    db.add(lp)
    db.commit()
    db.refresh(lp)
    return LpanRead.model_validate(lp, from_attributes=True)


@router.delete("/lpan/{lpan_id}")
def borrar_lpan(lpan_id: int, db: Session = Depends(get_db)):
    lp = db.get(Lpan, lpan_id)
    if lp is None:
        raise HTTPException(status_code=404, detail=f"LPAN {lpan_id} no encontrado")
    db.delete(lp)
    db.commit()
    return {"ok": True}
