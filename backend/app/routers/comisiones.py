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
# Comisión = 10% del GWP (our line) del Premium. Verificado contra los recibos históricos de comisiones
# de Iberian: coincide al céntimo (todos los meses desde abr-2024). El Net Premium daba ~22% menos.
TASA_COMISION = Decimal("0.10")
D0 = Decimal(0)


def _programa_iberian(db: Session) -> Programa | None:
    return db.scalar(select(Programa).where(Programa.nombre.ilike(f"%{PROGRAMA_IBERIAN}%")))


def _base_por_mes(db: Session, prog: Programa) -> dict[str, Decimal]:
    """Σ GWP (our line) del Premium (incluido), por mes (YYYY-MM), de los binders del programa."""
    bids = [b.id for b in db.scalars(select(Binder).where(Binder.programa_id == prog.id)).all()]
    out: dict[str, Decimal] = defaultdict(lambda: D0)
    if not bids:
        return out
    for pbdx, gwp in db.execute(
        select(BdxLinea.premium_bdx, func.sum(BdxLinea.total_gwp_our_line))
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id.in_(bids), BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
        .group_by(BdxLinea.premium_bdx)
    ).all():
        out[pbdx.strftime("%Y-%m")] += (gwp or D0)
    return out


def _comision_de_base(base: Decimal) -> Decimal:
    """Comisión = 10% del GWP (our line)."""
    return _q2(base * TASA_COMISION)


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
    base_prima: Decimal = Decimal(0)    # Σ GWP (our line) del mes (base del 10%)
    comision_premium: Decimal           # estimación = 10% del GWP (our line)
    liq_id: int | None = None
    estado: str | None = None           # Preparado | Ratificado
    comision: Decimal | None = None     # efectiva (definitiva si la hay, si no la estimada)
    cedida: Decimal | None = None
    retenida: Decimal | None = None
    pago1_nombre: str | None = None
    pago1_importe: Decimal | None = None
    pago2_nombre: str | None = None
    pago2_importe: Decimal | None = None
    recibo_numero: str | None = None       # resumen ("2021-0090 (+1)" si hay varios)
    recibos: list[str] = []                # todos los nº de recibo del mes (para el tooltip)


def _mes_de_liq(db: Session, liq: ComisionLiquidacion, base: Decimal) -> MesComision:
    r = db.get(Recibo, liq.recibo_id) if liq.recibo_id else None
    com = _comision_efectiva(liq)
    return MesComision(
        periodo=liq.periodo, base_prima=_q2(base), comision_premium=_q2(liq.comision_premium),
        liq_id=liq.id, estado=liq.estado,
        comision=_q2(com), cedida=_q2(com * liq.cedida_pct / 100), retenida=_q2(com * liq.retenida_pct / 100),
        pago1_nombre=liq.pago1_nombre, pago1_importe=liq.pago1_importe,
        pago2_nombre=liq.pago2_nombre, pago2_importe=liq.pago2_importe,
        recibo_numero=r.numero if r else None,
    )


REF_MODULO = "comision-iberian"   # marca los recibos creados por este módulo (vs. los históricos)
PERIODO_MIN = "2021-06"           # antes de junio 2021 no se generó comisión: no se listan esos meses
# Recibos tipo «Comisiones»/Iberian que NO son la comisión de Iberian-RC Profesional (fueron otra
# cosa puntual; ya no se repetirá). Se reconocen porque van 100% cedidos (retenida = 0): la comisión
# real siempre se reparte 85/15 (retenida > 0). Esta regla los excluye todos (también los futuros).
# `EXCLUIR_RECIBOS` es una escotilla manual extra para cualquier caso raro que NO sea 100% cedido.
EXCLUIR_RECIBOS: set[str] = set()
# Correcciones puntuales del mes de comisión de recibos históricos cuyas fechas no concuerdan
# (ni fecha_contable ni periodo aciertan siempre). Recibo nº → mes real (YYYY-MM). No se toca el
# dato del recibo (fecha_contable la usa el Cierre Contable); solo afecta a la agrupación aquí.
CORRECCIONES_MES = {
    "2022-0041": "2022-03",   # es de marzo 2022 (su fecha_contable dice 2022-04-01)
    "2022-0106": "2022-09",   # es de septiembre 2022 (su fecha_contable dice octubre)
    "2023-0013": "2022-12",   # es de diciembre 2022 (6061.49 = 10% de dic; su fecha_contable dice ene-2023)
}


def _hist_por_periodo(db: Session) -> dict[str, dict]:
    """Recibos tipo «Comisiones» de Iberian que YA existían (históricos, no creados por el módulo),
    agregados por periodo: comisión (Σ deducción), cedida, retenida y nº(s) de recibo."""
    out: dict[str, dict] = {}
    for r in db.scalars(select(Recibo).where(
            Recibo.tipo_poliza == "Comisiones", Recibo.corredor == "Iberian")).all():
        if (r.referencia or "") == REF_MODULO:
            continue
        # 100% cedido (retenida 0) = no es comisión de Iberian-RC Profesional → se excluye.
        if (r.comision_retenida or D0) == 0 or r.numero in EXCLUIR_RECIBOS:
            continue
        # El mes REAL de la comisión es la fecha CONTABLE (el `periodo` a veces apunta al mes en que se
        # emitió, no al de la comisión: p. ej. 2025-0034 es de enero pero su periodo dice marzo).
        # Algunos recibos sueltos no cuadran con ninguna fecha → corrección explícita por número.
        per = CORRECCIONES_MES.get(r.numero) or (r.fecha_contable.strftime("%Y-%m") if r.fecha_contable else r.periodo)
        d = out.setdefault(per, {"comision": D0, "cedida": D0, "retenida": D0, "nums": [], "recibo_id": r.id})
        d["comision"] += (r.deduccion_total or D0)
        d["cedida"] += (r.comision_cedida or D0)
        d["retenida"] += (r.comision_retenida or D0)
        d["nums"].append(r.numero)
    return out


@router.get("/comisiones/iberian", response_model=list[MesComision])
def listar_iberian(db: Session = Depends(get_db)):
    prog = _programa_iberian(db)
    if not prog:
        raise HTTPException(status_code=404, detail="No se encuentra el programa Iberian-RC Profesional")
    bases = _base_por_mes(db, prog)
    hist = _hist_por_periodo(db)
    liqs = {l.periodo: l for l in db.scalars(
        select(ComisionLiquidacion).where(ComisionLiquidacion.fuente == "Iberian")).all()}
    out: list[MesComision] = []
    for per in sorted(set(bases) | set(hist) | set(liqs), reverse=True):
        if per < PERIODO_MIN:   # antes de jun-2021 no hubo comisión: se omite
            continue
        base = bases.get(per, D0)
        l, h = liqs.get(per), hist.get(per)
        est = _comision_de_base(base)
        # Por defecto (mes sin preparar) se muestran la cedida/retenida ESTIMADAS (85/15 del 10%);
        # si hay recibo histórico o liquidación, se sobreescriben con las reales más abajo.
        m = MesComision(periodo=per, base_prima=_q2(base), comision_premium=est,
                        cedida=_q2(est * Decimal("0.85")), retenida=_q2(est * Decimal("0.15")))
        if h:   # ya hay recibo histórico: la comisión/cedida/retenida salen de él
            m.comision = _q2(h["comision"]); m.cedida = _q2(h["cedida"]); m.retenida = _q2(h["retenida"])
            m.estado = "Emitido"
            m.recibos = h["nums"]
            m.recibo_numero = h["nums"][0] if len(h["nums"]) == 1 else f"{h['nums'][0]} (+{len(h['nums']) - 1})"
        if l:   # hay liquidación del módulo (estado + reparto; y comisión propia si es mes nuevo)
            m.liq_id = l.id; m.estado = l.estado
            m.pago1_nombre, m.pago1_importe = l.pago1_nombre, l.pago1_importe
            m.pago2_nombre, m.pago2_importe = l.pago2_nombre, l.pago2_importe
            if not h:
                r = db.get(Recibo, l.recibo_id) if l.recibo_id else None
                com = _comision_efectiva(l)
                m.comision = _q2(com); m.cedida = _q2(com * l.cedida_pct / 100); m.retenida = _q2(com * l.retenida_pct / 100)
                m.recibo_numero = r.numero if r else None
                m.recibos = [r.numero] if r else []
        out.append(m)
    return out


@router.post("/comisiones/iberian/{periodo}/preparar", response_model=MesComision)
def preparar_iberian(periodo: str, db: Session = Depends(get_db)):
    prog = _programa_iberian(db)
    if not prog:
        raise HTTPException(status_code=404, detail="No se encuentra el programa Iberian-RC Profesional")
    if db.scalar(select(ComisionLiquidacion).where(
            ComisionLiquidacion.fuente == "Iberian", ComisionLiquidacion.periodo == periodo)):
        raise HTTPException(status_code=409, detail=f"Ya existe una liquidación para {periodo}")
    base = _base_por_mes(db, prog).get(periodo, D0)
    fecha = _dia1(periodo)
    liq = ComisionLiquidacion(
        fuente="Iberian", programa_id=prog.id, periodo=periodo, fecha=fecha,
        comision_premium=_comision_de_base(base), cedida_pct=Decimal(85), retenida_pct=Decimal(15),
        pago1_nombre=PAGO1_DEFECTO, pago2_nombre=PAGO2_DEFECTO, estado="Preparado",
    )
    r = Recibo(
        periodo=periodo, anio=fecha.year, estado="Emitido", numero=_siguiente_numero(db, fecha.year),
        tipo_poliza="Comisiones", asegurado=prog.nombre, corredor="Iberian", ramo="Comisiones", moneda="EUR",
        referencia=REF_MODULO,
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
    return next(m for m in listar_iberian(db) if m.periodo == periodo)


class RepartoIn(BaseModel):
    pago1_importe: Decimal | None = None
    pago2_importe: Decimal | None = None
    comision_definitiva: Decimal | None = None   # opcional: solo si Iberian ajusta la comisión


@router.put("/comisiones/iberian/{periodo}/reparto", response_model=MesComision)
def reparto(periodo: str, payload: RepartoIn, db: Session = Depends(get_db)):
    """Guarda el reparto del 85% cedido entre las dos sociedades (varía cada mes). Si el mes aún no
    tiene recibo, se GENERA aquí (un recibo no se prepara sin su reparto). Si ya tenía recibo histórico,
    se enlaza sin tocarlo."""
    prog = _programa_iberian(db)
    if not prog:
        raise HTTPException(status_code=404, detail="No se encuentra el programa Iberian-RC Profesional")
    base = _base_por_mes(db, prog).get(periodo, D0)
    liq = db.scalar(select(ComisionLiquidacion).where(
        ComisionLiquidacion.fuente == "Iberian", ComisionLiquidacion.periodo == periodo))
    if liq is None:
        h = _hist_por_periodo(db).get(periodo)
        fecha = _dia1(periodo)
        liq = ComisionLiquidacion(
            fuente="Iberian", programa_id=prog.id, periodo=periodo, fecha=fecha,
            comision_premium=_comision_de_base(base),
            comision_definitiva=_q2(h["comision"]) if h else None,
            cedida_pct=Decimal(85), retenida_pct=Decimal(15),
            pago1_nombre=PAGO1_DEFECTO, pago2_nombre=PAGO2_DEFECTO, estado="Ratificado",
            recibo_id=h["recibo_id"] if h else None,
        )
        if not h:   # mes nuevo: se genera el recibo del módulo al guardar el reparto
            r = Recibo(
                periodo=periodo, anio=fecha.year, estado="Emitido", numero=_siguiente_numero(db, fecha.year),
                tipo_poliza="Comisiones", asegurado=prog.nombre, corredor="Iberian", ramo="Comisiones", moneda="EUR",
                referencia=REF_MODULO, fecha_efecto=fecha, fecha_vencimiento=fecha, fecha_contable=fecha,
                fecha_efecto_recibo=fecha, fecha_vcto_recibo=fecha,
                prima_bruta_recibo=D0, prima_neta_recibo=D0, prima_adeudada=D0,
            )
            _aplicar_a_recibo(liq, r)
            db.add(r)
            db.flush()
            liq.recibo_id = r.id
        db.add(liq)
    if payload.comision_definitiva is not None:
        liq.comision_definitiva = _q2(payload.comision_definitiva)
    liq.pago1_importe = _q2(payload.pago1_importe) if payload.pago1_importe is not None else None
    liq.pago2_importe = _q2(payload.pago2_importe) if payload.pago2_importe is not None else None
    liq.estado = "Ratificado"
    # Solo se recalcula el recibo si es PROPIO del módulo; los históricos no se tocan.
    r = db.get(Recibo, liq.recibo_id) if liq.recibo_id else None
    if r and (r.referencia or "") == REF_MODULO:
        _aplicar_a_recibo(liq, r)
    db.commit()
    return next(m for m in listar_iberian(db) if m.periodo == periodo)


@router.delete("/comisiones/{liq_id}", status_code=204)
def borrar(liq_id: int, db: Session = Depends(get_db)):
    liq = db.get(ComisionLiquidacion, liq_id)
    if liq is None:
        raise HTTPException(status_code=404, detail=f"Liquidación {liq_id} no encontrada")
    # Borra el recibo SOLO si lo creó el módulo (los históricos no se tocan).
    if liq.recibo_id:
        r = db.get(Recibo, liq.recibo_id)
        if r and (r.referencia or "") == REF_MODULO:
            db.delete(r)
    db.delete(liq)
    db.commit()
