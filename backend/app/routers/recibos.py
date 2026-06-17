"""
Recibos: núcleo de facturación/contabilidad. Modelo basado en SharePoint 'Mayrit - TRecibos'.

En la app se **emite 1 recibo por Risk BDX** (binder + periodo 'YYYY-MM'); la comisión de Mayrit
es `comision_retenida` = Σ `brokerage_amount` de las líneas Risk de ese periodo. El cobro llega
con los Premium BDX (rara vez coinciden con el Risk BDX) → puede ser parcial. Numeración por año
natural 'AÑO-NNNN'. Los "pendientes" (cobro/liquidación) los recalcula el backend.
"""
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import (
    Bdx,
    BdxLinea,
    Binder,
    BinderSeccion,
    Mercado,
    Recibo,
    SeccionMercado,
)
from ..schemas import maestras as sch

router = APIRouter(tags=["Recibos"])

D0 = Decimal(0)


def _siguiente_numero(db: Session, anio: int) -> str:
    """'AÑO-NNNN' correlativo por año natural (último + 1)."""
    numeros = db.scalars(select(Recibo.numero).where(Recibo.anio == anio)).all()
    maximo = 0
    for n in numeros:
        try:
            maximo = max(maximo, int(str(n).split("-")[-1]))
        except (ValueError, IndexError):
            pass
    return f"{anio}-{maximo + 1:04d}"


def _rango_mes(periodo: str) -> tuple[dt.date, dt.date]:
    """'YYYY-MM' → (primer día del mes, primer día del mes siguiente)."""
    try:
        y, m = (int(x) for x in periodo.split("-"))
        ini = dt.date(y, m, 1)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"Periodo inválido: {periodo!r} (use 'YYYY-MM').")
    fin = dt.date(y + 1, 1, 1) if m == 12 else dt.date(y, m + 1, 1)
    return ini, fin


def _lineas_risk_periodo(db: Session, binder_id: int, periodo: str):
    """Líneas del BDX (Risk) del binder cuyo reporting_period_start cae en el mes `periodo`."""
    ini, fin = _rango_mes(periodo)
    return db.scalars(
        select(BdxLinea)
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(
            Bdx.binder_id == binder_id,
            BdxLinea.reporting_period_start >= ini,
            BdxLinea.reporting_period_start < fin,
        )
    ).all()


def _mercados_binder(db: Session, binder_id: int) -> str | None:
    """Snapshot de los mercados del binder (nombres, sin repetir)."""
    nombres = db.execute(
        select(Mercado.nombre)
        .join(SeccionMercado, SeccionMercado.mercado_id == Mercado.id)
        .join(BinderSeccion, BinderSeccion.id == SeccionMercado.seccion_id)
        .where(BinderSeccion.binder_id == binder_id)
        .distinct()
    ).scalars().all()
    nombres = [n for n in nombres if n]
    return ", ".join(sorted(set(nombres))) if nombres else None


def _yoa_int(binder: Binder) -> int | None:
    return int(binder.yoa) if binder.yoa and str(binder.yoa).isdigit() else None


def _recompute(r: Recibo) -> None:
    """Recalcula los 'pendientes' a partir de los importes base."""
    r.comision_pendiente_cobro = (r.comision_retenida or D0) - (r.comision_retenida_cobrada or D0)
    r.liquidar_pendiente_cobro = (r.liquidar or D0) - (r.liquidar_cobrado or D0)


def _read(db: Session, r: Recibo) -> sch.ReciboRead:
    """ReciboRead enriquecido con UMR del binder y nº de líneas enlazadas."""
    binder = db.get(Binder, r.binder_id)
    num_lineas = db.scalar(select(func.count(BdxLinea.id)).where(BdxLinea.recibo_id == r.id)) or 0
    data = sch.ReciboRead.model_validate(r)
    data.binder_umr = (binder.umr or binder.agreement_number) if binder else None
    data.num_lineas = num_lineas
    return data


# ──────────────────────────────── Listados ──────────────────────────────────
@router.get("/recibos", response_model=list[sch.ReciboRead])
def listar(anio: int | None = None, binder_id: int | None = None, q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Recibo)
    if anio is not None:
        stmt = stmt.where(Recibo.anio == anio)
    if binder_id is not None:
        stmt = stmt.where(Recibo.binder_id == binder_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Recibo.numero.ilike(like) | Recibo.nombre_mercado.ilike(like) | Recibo.asegurado.ilike(like)
        )
    stmt = stmt.order_by(Recibo.anio.desc(), Recibo.numero.desc())
    return [_read(db, r) for r in db.scalars(stmt).all()]


@router.get("/binders/{binder_id}/recibos", response_model=list[sch.ReciboRead])
def listar_de_binder(binder_id: int, db: Session = Depends(get_db)):
    filas = db.scalars(
        select(Recibo).where(Recibo.binder_id == binder_id).order_by(Recibo.periodo.desc())
    ).all()
    return [_read(db, r) for r in filas]


@router.get("/recibos/{recibo_id}", response_model=sch.ReciboRead)
def obtener(recibo_id: int, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    return _read(db, r)


# ───────────────────────── Generar desde un Risk BDX ─────────────────────────
def _calcular(db: Session, binder: Binder, periodo: str):
    """Valida y devuelve (lineas, comision_retenida, honorarios) del Risk BDX. 409/400 si procede."""
    _rango_mes(periodo)  # valida el formato
    existe = db.scalar(
        select(Recibo).where(Recibo.binder_id == binder.id, Recibo.periodo == periodo)
    )
    if existe is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe el recibo {existe.numero} para este Risk BDX ({periodo}).",
        )
    lineas = _lineas_risk_periodo(db, binder.id, periodo)
    if not lineas:
        raise HTTPException(status_code=400, detail=f"No hay líneas Risk en el periodo {periodo}.")
    comision = sum((l.brokerage_amount or D0) for l in lineas)
    honorarios = sum((l.fees or D0) for l in lineas)
    return lineas, comision, honorarios


def _campos_emision(db: Session, binder: Binder, periodo: str, comision, honorarios, fecha: dt.date) -> dict:
    """Campos precalculados de un recibo emitido desde un Risk BDX (comunes a preview y generar)."""
    mercados = _mercados_binder(db, binder.id)
    return dict(
        binder_id=binder.id,
        periodo=periodo,
        anio=fecha.year,
        estado="Emitido",
        nombre_mercado=mercados,
        mercado=mercados,
        moneda=binder.moneda or "EUR",
        yoa=_yoa_int(binder),
        fecha_efecto=binder.fecha_efecto,
        fecha_vencimiento=binder.fecha_vencimiento,
        comision_retenida=comision,
        comision_pendiente_cobro=comision,
        honorarios=honorarios,
        fecha_contable=fecha,
    )


@router.get("/binders/{binder_id}/recibos/preview", response_model=sch.ReciboPreview)
def preview(binder_id: int, periodo: str, db: Session = Depends(get_db)):
    """Calcula el recibo SIN guardarlo, para precumplimentar el formulario de emisión."""
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    lineas, comision, honorarios = _calcular(db, binder, periodo)
    fecha = dt.date.today()
    campos = _campos_emision(db, binder, periodo, comision, honorarios, fecha)
    return sch.ReciboPreview(
        numero=_siguiente_numero(db, fecha.year),
        binder_umr=binder.umr or binder.agreement_number,
        num_lineas=len(lineas),
        **campos,
    )


@router.post("/binders/{binder_id}/recibos/generar", response_model=sch.ReciboRead, status_code=201)
def generar(binder_id: int, payload: sch.ReciboGenerar, db: Session = Depends(get_db)):
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")

    periodo = payload.periodo
    lineas, comision, honorarios = _calcular(db, binder, periodo)
    overrides = payload.model_dump(exclude_unset=True, exclude={"periodo"})
    fecha = overrides.get("fecha_contable") or dt.date.today()

    campos = _campos_emision(db, binder, periodo, comision, honorarios, fecha)
    campos.update(overrides)  # lo editado en el formulario prevalece (salvo la comisión recalculada)
    recibo = Recibo(numero=_siguiente_numero(db, campos["anio"]), **campos)
    _recompute(recibo)
    db.add(recibo)
    db.flush()                  # asigna recibo.id

    # Enlaza las líneas del periodo con el recibo (y guarda el nº en texto).
    for l in lineas:
        l.recibo_id = recibo.id
        l.recibo = recibo.numero

    db.commit()
    db.refresh(recibo)
    return _read(db, recibo)


# ──────────────────────────── Editar / borrar ───────────────────────────────
@router.put("/recibos/{recibo_id}", response_model=sch.ReciboRead)
def editar(recibo_id: int, payload: sch.ReciboUpdate, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    _recompute(r)
    db.commit()
    db.refresh(r)
    return _read(db, r)


@router.delete("/recibos/{recibo_id}", status_code=204)
def borrar(recibo_id: int, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    # Desenlaza las líneas antes de borrar (el FK es SET NULL, pero limpiamos también el texto).
    db.execute(
        update(BdxLinea).where(BdxLinea.recibo_id == recibo_id).values(recibo_id=None, recibo=None)
    )
    db.execute(delete(Recibo).where(Recibo.id == recibo_id))
    db.commit()
