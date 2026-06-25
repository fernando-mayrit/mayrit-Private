"""
Módulo de Comisiones — fuentes de ingreso de comisiones (de momento Iberian; luego Wii).

Iberian: cada mes liquida la comisión del Premium (comisión del coverholder) del programa
'Iberian-RC Profesional'. Mayrit PREPARA un recibo (tipo «Comisiones», prima 0, día 1 del mes) con la
comisión ESTIMADA del Premium, y queda PENDIENTE DE RATIFICAR hasta que Iberian envía la comisión
DEFINITIVA y el reparto del 85% cedido entre sus sociedades (Iberian Insurance Broker / Hauora).
Mayrit retiene el 15%.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, ComisionLiquidacion, Programa, Recibo
from .recibos import _q2, _siguiente_numero

router = APIRouter(tags=["Comisiones"])

PROGRAMA_IBERIAN = "Iberian-RC Profesional"        # se busca por nombre (ilike)
PAGO1_DEFECTO = "Iberian Insurance Broker, S.L."
PAGO2_DEFECTO = "Hauora Brokerage, S.L."
TASA_COMISION = Decimal("0.10")                    # comisión = 10% del Net Premium to Broker
D0 = Decimal(0)


def _programa_iberian(db: Session) -> Programa | None:
    return db.scalar(select(Programa).where(Programa.nombre.ilike(f"%{PROGRAMA_IBERIAN}%")))


def _net_por_mes(db: Session, prog: Programa) -> dict[str, Decimal]:
    """Σ Net Premium to Broker del Premium (incluido), por mes (YYYY-MM), de los binders del programa."""
    bids = [b.id for b in db.scalars(select(Binder).where(Binder.programa_id == prog.id)).all()]
    out: dict[str, Decimal] = defaultdict(lambda: D0)
    if not bids:
        return out
    for pbdx, net in db.execute(
        select(BdxLinea.premium_bdx, func.sum(BdxLinea.net_premium_to_broker))
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id.in_(bids), BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
        .group_by(BdxLinea.premium_bdx)
    ).all():
        out[pbdx.strftime("%Y-%m")] += (net or D0)
    return out


def _comision_de_net(net: Decimal) -> Decimal:
    """Comisión = 10% del Net Premium to Broker."""
    return _q2(net * TASA_COMISION)


def _comision_efectiva(liq: ComisionLiquidacion) -> Decimal:
    return liq.comision_definitiva if liq.comision_definitiva is not None else liq.comision_premium


def _aplicar_a_recibo(liq: ComisionLiquidacion, r: Recibo) -> None:
    """Vuelca al recibo la comisión efectiva (deducción) y el reparto cedida(85%)/retenida(15%)."""
    com = _comision_efectiva(liq)
    r.deduccion_total = com
    r.comision_cedida_porc = liq.cedida_pct
    r.comision_cedida = _q2(com * liq.cedida_pct / 100)
    r.comision_retenida_porc = liq.retenida_pct
    r.comision_retenida = _q2(com * liq.retenida_pct / 100)


def _dia1(periodo: str) -> dt.date:
    y, m = (int(x) for x in periodo.split("-"))
    return dt.date(y, m, 1)


# ── Schemas ──
class MesComision(BaseModel):
    periodo: str
    base_neta: Decimal = Decimal(0)     # Σ Net Premium to Broker del mes (base del 10%)
    comision_premium: Decimal           # estimación = 10% del Net Premium to Broker
    liq_id: int | None = None
    estado: str | None = None           # Preparado | Ratificado
    comision: Decimal | None = None     # efectiva (definitiva si la hay, si no la estimada)
    cedida: Decimal | None = None
    retenida: Decimal | None = None
    pago1_nombre: str | None = None
    pago1_importe: Decimal | None = None
    pago2_nombre: str | None = None
    pago2_importe: Decimal | None = None
    recibo_numero: str | None = None


def _mes_de_liq(db: Session, liq: ComisionLiquidacion, net: Decimal) -> MesComision:
    r = db.get(Recibo, liq.recibo_id) if liq.recibo_id else None
    com = _comision_efectiva(liq)
    return MesComision(
        periodo=liq.periodo, base_neta=_q2(net), comision_premium=_q2(liq.comision_premium),
        liq_id=liq.id, estado=liq.estado,
        comision=_q2(com), cedida=_q2(com * liq.cedida_pct / 100), retenida=_q2(com * liq.retenida_pct / 100),
        pago1_nombre=liq.pago1_nombre, pago1_importe=liq.pago1_importe,
        pago2_nombre=liq.pago2_nombre, pago2_importe=liq.pago2_importe,
        recibo_numero=r.numero if r else None,
    )


@router.get("/comisiones/iberian", response_model=list[MesComision])
def listar_iberian(db: Session = Depends(get_db)):
    prog = _programa_iberian(db)
    if not prog:
        raise HTTPException(status_code=404, detail="No se encuentra el programa Iberian-RC Profesional")
    nets = _net_por_mes(db, prog)
    liqs = {l.periodo: l for l in db.scalars(
        select(ComisionLiquidacion).where(ComisionLiquidacion.fuente == "Iberian")).all()}
    out: list[MesComision] = []
    for per in sorted(set(nets) | set(liqs), reverse=True):
        net = nets.get(per, D0)
        l = liqs.get(per)
        if l:
            out.append(_mes_de_liq(db, l, net))
        else:
            out.append(MesComision(periodo=per, base_neta=_q2(net), comision_premium=_comision_de_net(net)))
    return out


@router.post("/comisiones/iberian/{periodo}/preparar", response_model=MesComision)
def preparar_iberian(periodo: str, db: Session = Depends(get_db)):
    prog = _programa_iberian(db)
    if not prog:
        raise HTTPException(status_code=404, detail="No se encuentra el programa Iberian-RC Profesional")
    if db.scalar(select(ComisionLiquidacion).where(
            ComisionLiquidacion.fuente == "Iberian", ComisionLiquidacion.periodo == periodo)):
        raise HTTPException(status_code=409, detail=f"Ya existe una liquidación para {periodo}")
    net = _net_por_mes(db, prog).get(periodo, D0)
    fecha = _dia1(periodo)
    liq = ComisionLiquidacion(
        fuente="Iberian", programa_id=prog.id, periodo=periodo, fecha=fecha,
        comision_premium=_comision_de_net(net), cedida_pct=Decimal(85), retenida_pct=Decimal(15),
        pago1_nombre=PAGO1_DEFECTO, pago2_nombre=PAGO2_DEFECTO, estado="Preparado",
    )
    r = Recibo(
        periodo=periodo, anio=fecha.year, estado="Emitido", numero=_siguiente_numero(db, fecha.year),
        tipo_poliza="Comisiones", asegurado=prog.nombre, corredor="Iberian", ramo="Comisiones", moneda="EUR",
        fecha_efecto=fecha, fecha_vencimiento=fecha, fecha_contable=fecha,
        fecha_efecto_recibo=fecha, fecha_vcto_recibo=fecha,
        prima_bruta_recibo=D0, prima_neta_recibo=D0, prima_adeudada=D0,
    )
    _aplicar_a_recibo(liq, r)
    db.add(r)
    db.flush()
    liq.recibo_id = r.id
    db.add(liq)
    db.commit()
    return _mes_de_liq(db, liq, net)


class RatificarIn(BaseModel):
    comision_definitiva: Decimal
    pago1_importe: Decimal | None = None
    pago2_importe: Decimal | None = None


@router.put("/comisiones/{liq_id}/ratificar", response_model=MesComision)
def ratificar(liq_id: int, payload: RatificarIn, db: Session = Depends(get_db)):
    liq = db.get(ComisionLiquidacion, liq_id)
    if liq is None:
        raise HTTPException(status_code=404, detail=f"Liquidación {liq_id} no encontrada")
    liq.comision_definitiva = _q2(payload.comision_definitiva)
    liq.pago1_importe = _q2(payload.pago1_importe) if payload.pago1_importe is not None else None
    liq.pago2_importe = _q2(payload.pago2_importe) if payload.pago2_importe is not None else None
    liq.estado = "Ratificado"
    r = db.get(Recibo, liq.recibo_id) if liq.recibo_id else None
    if r:
        _aplicar_a_recibo(liq, r)
    db.commit()
    prog = _programa_iberian(db)
    net = _net_por_mes(db, prog).get(liq.periodo, D0) if prog else D0
    return _mes_de_liq(db, liq, net)


@router.delete("/comisiones/{liq_id}", status_code=204)
def borrar(liq_id: int, db: Session = Depends(get_db)):
    liq = db.get(ComisionLiquidacion, liq_id)
    if liq is None:
        raise HTTPException(status_code=404, detail=f"Liquidación {liq_id} no encontrada")
    if liq.recibo_id:
        r = db.get(Recibo, liq.recibo_id)
        if r:
            db.delete(r)
    db.delete(liq)
    db.commit()
