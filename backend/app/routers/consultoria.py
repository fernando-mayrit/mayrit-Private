"""
Consultoría (honorarios / fees) — módulo sencillo.

Un **contrato** con pocos datos (cliente=Productor, fecha inicio, duración en meses [o indefinido],
frecuencia de cobro, importe por cobro, sujeto a impuestos + % IVA). De cada cobro se **genera un
recibo tipo 'Consultoría'** cuando toca (no se crean los futuros). El recibo reutiliza el modelo
`recibos`: Base Imponible = `comision_retenida` = importe; IVA = `impuestos_recibo` (lo que ya usa
el cierre contable). El cobro/edición se gestiona luego en la pantalla de Recibos como cualquier otro.
"""
from __future__ import annotations

import calendar
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import ConsultoriaContrato, CuentaBancaria, Productor, Recibo
from .recibos import _exigir_mes_abierto, _recompute, _siguiente_numero

router = APIRouter(tags=["Consultoría"])

PASO_MESES = {"Mensual": 1, "Trimestral": 3, "Semestral": 6, "Anual": 12}


def _add_months(d: dt.date, n: int) -> dt.date:
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return dt.date(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def _fechas_cobro(c: ConsultoriaContrato) -> list[dt.date]:
    """Fechas de los cobros del contrato según su frecuencia y duración. Indefinido (sin duración):
    hasta hoy + un periodo por delante (siempre hay un cobro 'actual/próximo' que emitir)."""
    if c.frecuencia == "Único":
        return [c.fecha_inicio]
    paso = PASO_MESES.get(c.frecuencia)
    if not paso:
        return [c.fecha_inicio]
    fin = _add_months(c.fecha_inicio, c.duracion_meses) if c.duracion_meses else None
    tope = fin if fin is not None else _add_months(dt.date.today(), paso)
    fechas, k = [], 0
    while k < 1200:
        f = _add_months(c.fecha_inicio, k * paso)
        if (fin is not None and f >= fin) or (fin is None and f > tope):
            break
        fechas.append(f)
        k += 1
    return fechas


def _iva(c: ConsultoriaContrato, base: Decimal) -> Decimal:
    if not c.sujeto_impuestos:
        return Decimal("0.00")
    return (base * (c.impuestos_porc or Decimal(0)) / Decimal(100)).quantize(Decimal("0.01"))


# ── Schemas ──
class ContratoIn(BaseModel):
    productor_id: int
    concepto: str | None = None
    fecha_inicio: dt.date
    duracion_meses: int | None = None      # None = indefinido
    frecuencia: str                        # Mensual/Trimestral/Semestral/Anual/Único
    importe: Decimal
    sujeto_impuestos: bool = True
    impuestos_porc: Decimal = Decimal("21")
    moneda: str = "EUR"
    cuenta_bancaria_id: int | None = None
    estado: str = "Activo"
    notas: str | None = None


class ContratoUpdate(BaseModel):
    productor_id: int | None = None
    concepto: str | None = None
    fecha_inicio: dt.date | None = None
    duracion_meses: int | None = None
    frecuencia: str | None = None
    importe: Decimal | None = None
    sujeto_impuestos: bool | None = None
    impuestos_porc: Decimal | None = None
    moneda: str | None = None
    cuenta_bancaria_id: int | None = None
    estado: str | None = None
    notas: str | None = None


class ContratoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    productor_id: int
    productor_nombre: str | None = None
    concepto: str | None = None
    fecha_inicio: dt.date
    duracion_meses: int | None = None
    frecuencia: str
    importe: Decimal
    sujeto_impuestos: bool
    impuestos_porc: Decimal
    moneda: str
    cuenta_bancaria_id: int | None = None
    cuenta_bancaria_nombre: str | None = None
    estado: str
    notas: str | None = None
    n_cobros: int = 0          # cobros previstos
    n_generados: int = 0       # recibos ya generados
    proximo_cobro: dt.date | None = None  # primer cobro sin recibo


def _serializar(db: Session, c: ConsultoriaContrato) -> ContratoRead:
    d = ContratoRead.model_validate(c)
    d.productor_nombre = c.productor.nombre if c.productor else None
    d.cuenta_bancaria_nombre = c.cuenta_bancaria.nombre if c.cuenta_bancaria else None
    fechas = _fechas_cobro(c)
    generados = {r.periodo for r in db.scalars(
        select(Recibo).where(Recibo.consultoria_id == c.id)
    ).all()}
    d.n_cobros = len(fechas)
    d.n_generados = len(generados)
    d.proximo_cobro = next((f for f in fechas if f.strftime("%Y-%m") not in generados), None)
    return d


@router.get("/consultoria")
def listar(db: Session = Depends(get_db)):
    cs = db.scalars(select(ConsultoriaContrato).order_by(ConsultoriaContrato.id.desc())).all()
    return [_serializar(db, c) for c in cs]


@router.get("/consultoria/{contrato_id}")
def obtener(contrato_id: int, db: Session = Depends(get_db)):
    c = db.get(ConsultoriaContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Contrato {contrato_id} no encontrado")
    return _serializar(db, c)


@router.post("/consultoria", status_code=201)
def crear(payload: ContratoIn, db: Session = Depends(get_db)):
    c = ConsultoriaContrato(**payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serializar(db, c)


@router.put("/consultoria/{contrato_id}")
def editar(contrato_id: int, payload: ContratoUpdate, db: Session = Depends(get_db)):
    c = db.get(ConsultoriaContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Contrato {contrato_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return _serializar(db, c)


@router.delete("/consultoria/{contrato_id}", status_code=204)
def borrar(contrato_id: int, db: Session = Depends(get_db)):
    c = db.get(ConsultoriaContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Contrato {contrato_id} no encontrado")
    db.delete(c)  # los recibos enlazados quedan con consultoria_id NULL (SET NULL)
    db.commit()


@router.get("/consultoria/{contrato_id}/cobros")
def cobros(contrato_id: int, db: Session = Depends(get_db)):
    """Calendario de cobros del contrato, con su recibo si ya se generó."""
    c = db.get(ConsultoriaContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Contrato {contrato_id} no encontrado")
    recibos = {r.periodo: r for r in db.scalars(select(Recibo).where(Recibo.consultoria_id == c.id)).all()}
    out = []
    for f in _fechas_cobro(c):
        per = f.strftime("%Y-%m")
        base = Decimal(c.importe or 0)
        iva = _iva(c, base)
        r = recibos.get(per)
        out.append({
            "periodo": per, "fecha": f.isoformat(),
            "base": float(base), "iva": float(iva), "total": float(base + iva),
            "recibo_id": r.id if r else None, "recibo_numero": r.numero if r else None,
        })
    return {"contrato_id": c.id, "moneda": c.moneda, "cobros": out}


class GenerarCobro(BaseModel):
    periodo: str   # 'YYYY-MM' del cobro a generar


@router.post("/consultoria/{contrato_id}/cobros/generar", status_code=201)
def generar_cobro(contrato_id: int, payload: GenerarCobro, db: Session = Depends(get_db)):
    c = db.get(ConsultoriaContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Contrato {contrato_id} no encontrado")
    fecha = next((f for f in _fechas_cobro(c) if f.strftime("%Y-%m") == payload.periodo), None)
    if fecha is None:
        raise HTTPException(status_code=422, detail=f"El periodo {payload.periodo} no es un cobro de este contrato.")
    ya = db.scalar(select(Recibo).where(Recibo.consultoria_id == c.id, Recibo.periodo == payload.periodo))
    if ya is not None:
        raise HTTPException(status_code=409, detail=f"El cobro {payload.periodo} ya tiene recibo ({ya.numero}).")
    _exigir_mes_abierto(db, fecha)

    base = Decimal(c.importe or 0)
    iva = _iva(c, base)
    cuenta = c.cuenta_bancaria.nombre if c.cuenta_bancaria else None
    r = Recibo(
        consultoria_id=c.id, periodo=payload.periodo, anio=fecha.year, estado="Emitido",
        numero=_siguiente_numero(db, fecha.year),
        tipo_poliza="Consultoría", asegurado=(c.concepto or (c.productor.nombre if c.productor else None)),
        corredor=(c.productor.nombre if c.productor else None), pagador=(c.productor.nombre if c.productor else None),
        ramo="Consultoría", moneda=c.moneda, cuenta=cuenta,
        fecha_efecto=fecha, fecha_vencimiento=fecha, fecha_contable=fecha,
        honorarios=base, comision_retenida=base, impuestos_porc=c.impuestos_porc,
        impuestos_recibo=iva, prima_bruta_recibo=base + iva, prima_adeudada=base + iva,
    )
    _recompute(r)
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"recibo_id": r.id, "numero": r.numero, "periodo": r.periodo, "total": float(base + iva)}
