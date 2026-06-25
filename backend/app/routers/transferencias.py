"""
Módulo de Transferencias — ledger de movimientos de dinero (entradas y salidas), calcado de la
lista SharePoint `TLiquidaciones`. Cada fila es un movimiento clasificado por:
  - Origen:  Binder | Póliza | Comisiones | Consultoría | Slip de Reaseguro  (de qué nace)
  - Tipo:    Primas | Siniestros | Comisiones | Honorarios                    (concepto)
  - Subtipo: Cobro | Liquidación | Traspaso                                   (marca el sentido)

El subtipo determina el sentido: Cobro = entrada, Liquidación = salida (pago al mercado/cía o
comisión cedida), Traspaso = interno (entre cuentas propias).

Los movimientos de Primas/Comisiones/Honorarios se generan al gestionar los recibos; los de
Siniestros (Cobro/Liquidación) se dan de alta A MANO (solo registran, no tocan el siniestro).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Recibo, Transferencia

router = APIRouter(prefix="/transferencias", tags=["Transferencias"])

# Sentido del movimiento según el subtipo (Cobro entra, Liquidación sale, Traspaso es interno).
SENTIDO = {"Cobro": "entrada", "Liquidación": "salida", "Liquidacion": "salida", "Traspaso": "interno"}


def _sentido(subtipo: str) -> str:
    return SENTIDO.get((subtipo or "").strip(), "interno")


# ── Schemas ──
class TransferenciaRead(BaseModel):
    id: int
    origen: str
    tipo: str
    subtipo: str
    sentido: str
    fecha: dt.date | None
    anio: int | None
    periodo: dt.date | None
    importe: Decimal
    numero_poliza: str | None
    recibo_id: int | None
    recibo_num: str | None
    binder_id: int | None
    siniestro_id: int | None
    mercado: str | None
    cuenta_origen: str | None
    cuenta_destino: str | None
    notas: str | None
    manual: bool

    class Config:
        from_attributes = True


class TransferenciaListada(BaseModel):
    items: list[TransferenciaRead]
    total_entradas: Decimal
    total_salidas: Decimal
    total_traspasos: Decimal
    neto: Decimal
    n_total: int
    # Cuadro de mando (mismas fórmulas que el Excel): caja Primas y caja Siniestros.
    primas_cobros: Decimal = Decimal(0)
    primas_liquidaciones: Decimal = Decimal(0)
    comisiones_liquidacion: Decimal = Decimal(0)
    comisiones_traspaso: Decimal = Decimal(0)
    primas_total: Decimal = Decimal(0)            # cobros − liquidaciones − liq.comisiones − traspasos com.
    siniestros_cobros: Decimal = Decimal(0)
    siniestros_liquidaciones: Decimal = Decimal(0)
    siniestros_total: Decimal = Decimal(0)        # cobros − liquidaciones


class TransferenciaCrear(BaseModel):
    # Por defecto, un movimiento manual de siniestro (Origen Binder · Tipo Siniestros).
    origen: str = "Binder"
    tipo: str = "Siniestros"
    subtipo: str = "Cobro"                 # Cobro | Liquidación
    fecha: dt.date | None = None
    periodo: dt.date | None = None
    importe: Decimal = Decimal(0)
    numero_poliza: str | None = None
    recibo_num: str | None = None
    binder_id: int | None = None
    siniestro_id: int | None = None
    mercado: str | None = None
    cuenta_origen: str | None = None
    cuenta_destino: str | None = None
    notas: str | None = None


class TransferenciaEditar(BaseModel):
    subtipo: str | None = None
    fecha: dt.date | None = None
    periodo: dt.date | None = None
    importe: Decimal | None = None
    numero_poliza: str | None = None
    recibo_num: str | None = None
    binder_id: int | None = None
    siniestro_id: int | None = None
    mercado: str | None = None
    cuenta_origen: str | None = None
    cuenta_destino: str | None = None
    notas: str | None = None


class Opciones(BaseModel):
    origenes: list[str]
    tipos: list[str]
    subtipos: list[str]
    anios: list[int]
    cuentas: list[str]


# ── Listado con filtros + totales ──
@router.get("", response_model=TransferenciaListada)
def listar(
    db: Session = Depends(get_db),
    anio: int | None = None,
    origen: str | None = None,
    tipo: str | None = None,
    subtipo: str | None = None,
    sentido: str | None = None,
    cuenta: str | None = None,
    q: str | None = None,
    limit: int = 500,
):
    filtros = []
    if anio:
        filtros.append(Transferencia.anio == anio)
    if origen:
        filtros.append(Transferencia.origen == origen)
    if tipo:
        filtros.append(Transferencia.tipo == tipo)
    if subtipo:
        filtros.append(Transferencia.subtipo == subtipo)
    if sentido:
        filtros.append(Transferencia.sentido == sentido)
    if cuenta:
        filtros.append(or_(
            Transferencia.cuenta_origen == cuenta,
            Transferencia.cuenta_destino == cuenta,
        ))
    if q:
        like = f"%{q.strip()}%"
        filtros.append(or_(
            Transferencia.numero_poliza.ilike(like),
            Transferencia.recibo_num.ilike(like),
            Transferencia.mercado.ilike(like),
            Transferencia.notas.ilike(like),
        ))

    base = select(Transferencia).where(*filtros)

    # Totales por sentido sobre TODO el conjunto filtrado (no solo la página).
    sums = db.execute(
        select(Transferencia.sentido, func.coalesce(func.sum(Transferencia.importe), 0), func.count())
        .where(*filtros).group_by(Transferencia.sentido)
    ).all()
    por_sentido = {s: (tot, n) for s, tot, n in sums}
    ent = Decimal(por_sentido.get("entrada", (0, 0))[0])
    sal = Decimal(por_sentido.get("salida", (0, 0))[0])
    tra = Decimal(por_sentido.get("interno", (0, 0))[0])
    n_total = sum(n for _, n in por_sentido.values())

    # Cuadro de mando por (tipo, subtipo) sobre TODO el conjunto filtrado.
    desg = db.execute(
        select(Transferencia.tipo, Transferencia.subtipo, func.coalesce(func.sum(Transferencia.importe), 0))
        .where(*filtros).group_by(Transferencia.tipo, Transferencia.subtipo)
    ).all()
    g = {(t, s): Decimal(v) for t, s, v in desg}
    pc = g.get(("Primas", "Cobro"), Decimal(0))
    pl = g.get(("Primas", "Liquidación"), Decimal(0))
    cl = g.get(("Comisiones", "Liquidación"), Decimal(0))
    ct = g.get(("Comisiones", "Traspaso"), Decimal(0))
    sc = g.get(("Siniestros", "Cobro"), Decimal(0))
    sl = g.get(("Siniestros", "Liquidación"), Decimal(0))

    items = db.scalars(
        base.order_by(Transferencia.fecha.desc().nullslast(), Transferencia.id.desc()).limit(limit)
    ).all()

    return TransferenciaListada(
        items=items, total_entradas=ent, total_salidas=sal,
        total_traspasos=tra, neto=ent - sal, n_total=n_total,
        primas_cobros=pc, primas_liquidaciones=pl,
        comisiones_liquidacion=cl, comisiones_traspaso=ct,
        primas_total=pc - pl - cl - ct,
        siniestros_cobros=sc, siniestros_liquidaciones=sl,
        siniestros_total=sc - sl,
    )


@router.get("/opciones", response_model=Opciones)
def opciones(db: Session = Depends(get_db)):
    def distintos(col):
        return [v for (v,) in db.execute(select(col).where(col.isnot(None)).distinct().order_by(col)).all() if v]
    cuentas = set(distintos(Transferencia.cuenta_origen)) | set(distintos(Transferencia.cuenta_destino))
    anios = [a for (a,) in db.execute(
        select(Transferencia.anio).where(Transferencia.anio.isnot(None)).distinct().order_by(Transferencia.anio.desc())
    ).all()]
    return Opciones(
        origenes=distintos(Transferencia.origen),
        tipos=distintos(Transferencia.tipo),
        subtipos=distintos(Transferencia.subtipo),
        anios=anios,
        cuentas=sorted(cuentas),
    )


def _enlazar_recibo(db: Session, recibo_num: str | None) -> int | None:
    if not recibo_num:
        return None
    r = db.scalar(select(Recibo).where(Recibo.numero == recibo_num.strip()))
    return r.id if r else None


# ── Alta manual (siniestros y ajustes) ──
@router.post("", response_model=TransferenciaRead)
def crear(payload: TransferenciaCrear, db: Session = Depends(get_db)):
    if payload.importe is None or Decimal(payload.importe) <= 0:
        raise HTTPException(400, "El importe debe ser mayor que 0.")
    t = Transferencia(
        origen=payload.origen,
        tipo=payload.tipo,
        subtipo=payload.subtipo,
        sentido=_sentido(payload.subtipo),
        fecha=payload.fecha,
        anio=payload.fecha.year if payload.fecha else None,
        periodo=payload.periodo,
        importe=Decimal(payload.importe),
        numero_poliza=payload.numero_poliza,
        recibo_num=payload.recibo_num,
        recibo_id=_enlazar_recibo(db, payload.recibo_num),
        binder_id=payload.binder_id,
        siniestro_id=payload.siniestro_id,
        mercado=payload.mercado,
        cuenta_origen=payload.cuenta_origen,
        cuenta_destino=payload.cuenta_destino,
        notas=payload.notas,
        manual=True,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.put("/{tid}", response_model=TransferenciaRead)
def editar(tid: int, payload: TransferenciaEditar, db: Session = Depends(get_db)):
    t = db.get(Transferencia, tid)
    if not t:
        raise HTTPException(404, "Transferencia no encontrada.")
    if not t.manual:
        raise HTTPException(400, "Solo se pueden editar movimientos dados de alta a mano.")
    datos = payload.model_dump(exclude_unset=True)
    if "subtipo" in datos and datos["subtipo"]:
        t.sentido = _sentido(datos["subtipo"])
    if "fecha" in datos:
        t.anio = datos["fecha"].year if datos["fecha"] else None
    if "recibo_num" in datos:
        t.recibo_id = _enlazar_recibo(db, datos["recibo_num"])
    for k, v in datos.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{tid}")
def borrar(tid: int, db: Session = Depends(get_db)):
    t = db.get(Transferencia, tid)
    if not t:
        raise HTTPException(404, "Transferencia no encontrada.")
    if not t.manual:
        raise HTTPException(400, "Solo se pueden borrar movimientos dados de alta a mano (los automáticos los genera el recibo).")
    db.delete(t)
    db.commit()
    return {"ok": True}
