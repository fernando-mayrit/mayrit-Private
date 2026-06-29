"""
Módulo de Contabilidad — libro de banco categorizado (espejo de las listas SharePoint
`Contabilidad - <cuenta>`). Cada movimiento: fecha, cuenta, concepto/grupo/tipo (clasificación),
gasto/ingreso, saldo. La conciliación con el ledger de Transferencias es la Fase 2.
"""
from __future__ import annotations

import datetime as dt
import io
from collections import defaultdict
from decimal import Decimal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import (
    Bdx, BdxLinea, Binder, ContaCategoria, CuentaBancaria, MovimientoBancario, Productor, Recibo, Transferencia,
)

router = APIRouter(prefix="/contabilidad", tags=["Contabilidad"])


# ── Schemas ──
class MovimientoRead(BaseModel):
    id: int
    cuenta: str
    iden: int | None
    identificador: str | None
    fecha: dt.date | None
    devengo: dt.date | None
    anio: int | None
    concepto: str | None
    grupo: str | None
    tipo: str | None
    gasto: Decimal
    ingreso: Decimal
    saldo: Decimal | None
    descripcion: str | None
    codigo: str | None
    movimiento_bancario: bool = True
    tarjeta: bool
    factura: bool
    conciliado: bool = False
    transferencia_ids: list[int] | None = None

    class Config:
        from_attributes = True


class MovimientosListados(BaseModel):
    items: list[MovimientoRead]
    total_gasto: Decimal
    total_ingreso: Decimal
    neto: Decimal               # ingreso − gasto
    saldo_cuenta: Decimal | None  # saldo del último movimiento (solo si se filtra por UNA cuenta)
    n_total: int


class OpcionesConta(BaseModel):
    cuentas: list[str]
    grupos: list[str]
    tipos: list[str]
    conceptos: list[str]
    anios: list[int]


class CategoriaRead(BaseModel):
    concepto: str
    grupo: str | None
    tipo: str | None
    cuenta_contable: str | None

    class Config:
        from_attributes = True


# ── Listado con filtros + totales ──
@router.get("", response_model=MovimientosListados)
def listar(
    db: Session = Depends(get_db),
    cuenta: str | None = None,
    anio: int | None = None,
    grupo: str | None = None,
    tipo: str | None = None,
    concepto: str | None = None,
    q: str | None = None,
    limit: int = 500,
):
    filtros = []
    if cuenta:
        filtros.append(MovimientoBancario.cuenta == cuenta)
    if anio:
        filtros.append(MovimientoBancario.anio == anio)
    if grupo:
        filtros.append(MovimientoBancario.grupo == grupo)
    if tipo:
        filtros.append(MovimientoBancario.tipo == tipo)
    if concepto:
        filtros.append(MovimientoBancario.concepto == concepto)
    if q:
        like = f"%{q.strip()}%"
        filtros.append(or_(
            MovimientoBancario.descripcion.ilike(like),
            MovimientoBancario.concepto.ilike(like),
            MovimientoBancario.codigo.ilike(like),
        ))

    base = select(MovimientoBancario).where(*filtros)

    tg, ti, n = db.execute(
        select(func.coalesce(func.sum(MovimientoBancario.gasto), 0),
               func.coalesce(func.sum(MovimientoBancario.ingreso), 0),
               func.count()).where(*filtros)
    ).one()

    # Saldo de la cuenta = saldo del movimiento más reciente, solo si se filtró por una sola cuenta.
    saldo_cuenta = None
    if cuenta:
        saldo_cuenta = db.scalar(
            select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.saldo.is_not(None))
            .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
        )

    items = db.scalars(
        base.order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(limit)
    ).all()

    return MovimientosListados(
        items=[_read(m) for m in items],
        total_gasto=Decimal(tg), total_ingreso=Decimal(ti), neto=Decimal(ti) - Decimal(tg),
        saldo_cuenta=saldo_cuenta, n_total=n,
    )


def _read(m: MovimientoBancario) -> MovimientoRead:
    out = MovimientoRead.model_validate(m)
    out.conciliado = m.transferencia_id is not None
    return out


@router.get("/opciones", response_model=OpcionesConta)
def opciones(db: Session = Depends(get_db)):
    def distintos(col):
        return [v for (v,) in db.execute(select(col).where(col.is_not(None)).distinct().order_by(col)).all() if v]
    anios = [a for (a,) in db.execute(
        select(MovimientoBancario.anio).where(MovimientoBancario.anio.is_not(None)).distinct().order_by(MovimientoBancario.anio.desc())
    ).all()]
    # Las cuentas DESACTIVADAS en Configuración (cuentas_bancarias.activa=False) no muestran pestaña.
    inactivas = {n for (n,) in db.execute(
        select(CuentaBancaria.nombre).where(CuentaBancaria.activa.is_(False))
    ).all()}
    cuentas = [c for c in distintos(MovimientoBancario.cuenta) if c not in inactivas]
    return OpcionesConta(
        cuentas=cuentas,
        grupos=distintos(MovimientoBancario.grupo),
        tipos=distintos(MovimientoBancario.tipo),
        conceptos=distintos(MovimientoBancario.concepto),
        anios=anios,
    )


@router.get("/categorias", response_model=list[CategoriaRead])
def categorias(db: Session = Depends(get_db)):
    return db.scalars(select(ContaCategoria).order_by(ContaCategoria.grupo, ContaCategoria.concepto)).all()


# ── Alta de movimiento (al estilo Access) ──
class BaseAlta(BaseModel):
    ultimo_saldo: Decimal | None   # saldo del último movimiento de la cuenta
    next_iden: int                 # siguiente Iden correlativo de la cuenta para ese año


@router.get("/base", response_model=BaseAlta)
def base_alta(cuenta: str, anio: int, db: Session = Depends(get_db)):
    """Datos para el alta de un movimiento de `cuenta`: saldo de partida y siguiente Iden del año."""
    ultimo = db.scalar(
        select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.saldo.is_not(None))
        .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
    )
    maxiden = db.scalar(
        select(func.max(MovimientoBancario.iden)).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.anio == anio)
    )
    return BaseAlta(ultimo_saldo=ultimo, next_iden=(maxiden or 0) + 1)


class MovimientoCrear(BaseModel):
    cuenta: str
    fecha: dt.date
    devengo: dt.date | None = None
    tipo: str                       # Gasto | Ingreso
    grupo: str | None = None
    concepto: str | None = None
    importe: Decimal
    saldo: Decimal | None = None    # si no viene, se calcula (saldo anterior ± importe)
    descripcion: str | None = None
    movimiento_bancario: bool = True
    factura: bool = False           # 'Justificante'
    tarjeta: bool = False
    transferencia_ids: list[int] | None = None


@router.post("", response_model=MovimientoRead, status_code=201)
def crear(payload: MovimientoCrear, db: Session = Depends(get_db)):
    dev = payload.devengo or payload.fecha
    es_gasto = payload.tipo == "Gasto"
    importe = Decimal(payload.importe or 0)
    gasto = importe if es_gasto else Decimal(0)
    ingreso = Decimal(0) if es_gasto else importe

    # Iden correlativo por cuenta y AÑO; Id visible = '{iden}.{mes}' (mes del devengo).
    anio = payload.fecha.year
    maxiden = db.scalar(
        select(func.max(MovimientoBancario.iden)).where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.anio == anio)
    )
    iden = (maxiden or 0) + 1
    identificador = f"{iden:03d}.{dev.month:02d}"   # Id a 3 cifras (XXX.MM), con ceros delante

    # Saldo = el dado, o el del último movimiento ± importe.
    if payload.saldo is not None:
        saldo = Decimal(payload.saldo)
    else:
        ult = db.scalar(
            select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.saldo.is_not(None))
            .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
        )
        saldo = Decimal(ult or 0) + ingreso - gasto

    pgc = db.scalar(select(ContaCategoria.cuenta_contable).where(ContaCategoria.concepto == payload.concepto)) if payload.concepto else None
    codigo = f"{identificador}. {pgc or ''}. {payload.concepto or ''}".strip()

    m = MovimientoBancario(
        cuenta=payload.cuenta, iden=iden, identificador=identificador,
        fecha=payload.fecha, anio=anio, devengo=dev,
        concepto=payload.concepto, grupo=payload.grupo, tipo=payload.tipo,
        gasto=gasto, ingreso=ingreso, saldo=saldo,
        descripcion=payload.descripcion, codigo=codigo,
        movimiento_bancario=payload.movimiento_bancario, factura=payload.factura, tarjeta=payload.tarjeta,
        transferencia_ids=payload.transferencia_ids,
        sp_lista=None, sp_old_id=None,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _read(m)


class MovimientoUpdate(BaseModel):
    fecha: dt.date | None = None
    devengo: dt.date | None = None
    tipo: str | None = None
    grupo: str | None = None
    concepto: str | None = None
    importe: Decimal | None = None         # magnitud (va a gasto o ingreso según el tipo)
    saldo: Decimal | None = None
    descripcion: str | None = None
    factura: bool | None = None            # 'Justificante'
    tarjeta: bool | None = None
    movimiento_bancario: bool | None = None
    transferencia_ids: list[int] | None = None   # transferencias que componen el apunte (justificante)


@router.put("/{mid}", response_model=MovimientoRead)
def actualizar(mid: int, payload: MovimientoUpdate, db: Session = Depends(get_db)):
    """Edición de un movimiento. Solo aplica los campos enviados (toggle del justificante, o edición
    completa desde el modal)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    datos = payload.model_dump(exclude_unset=True)
    for k in ("grupo", "concepto", "saldo", "descripcion", "factura", "tarjeta", "movimiento_bancario", "transferencia_ids"):
        if k in datos:
            setattr(m, k, datos[k])
    if datos.get("fecha"):
        m.fecha = datos["fecha"]
        m.anio = datos["fecha"].year
    if "devengo" in datos:
        m.devengo = datos["devengo"]
    # tipo/importe → recalcular gasto/ingreso
    if "tipo" in datos or "importe" in datos:
        tipo = datos.get("tipo") or m.tipo
        imp = Decimal(datos["importe"]) if datos.get("importe") is not None else Decimal(m.gasto or 0) + Decimal(m.ingreso or 0)
        m.tipo = tipo
        m.gasto = imp if tipo == "Gasto" else Decimal(0)
        m.ingreso = Decimal(0) if tipo == "Gasto" else imp
    db.commit()
    db.refresh(m)
    return _read(m)


# ──────────── Justificante de movimiento (TRANSFERENCIAS del ledger que lo componen) ────────────
# Cada Transferencia es el importe REAL movido (cobro/liquidación parcial), con su fecha; sumadas por
# fecha cuadran con el importe del apunte. El cuadre es automático: se ofrecen las del mismo tipo y
# fecha del apunte (ocultando las ya usadas en otro apunte) y se autoseleccionan.
def _num_es(x) -> str:
    s = f"{Decimal(x or 0):,.2f}"
    return s.replace(",", "·").replace(".", ",").replace("·", ".")


# Clase del apunte (deducida del concepto) → subtipo(s) de Transferencia.
_CLASE_SUBTIPOS = {
    "cobro": ["Cobro"],
    "liquidacion": ["Liquidación", "Liquidacion"],
    "traspaso": ["Traspaso"],
}
_IMP_LABEL = {"cobro": "Cobrado", "liquidacion": "Liquidado al UW", "traspaso": "Traspasado"}


def _clase_de_concepto(concepto: str | None) -> str:
    c = (concepto or "").lower()
    if "liquid" in c:
        return "liquidacion"
    if "traspas" in c:
        return "traspaso"
    return "cobro"


class TransferJustif(BaseModel):
    id: int
    fecha: dt.date | None
    importe: Decimal
    referencia: str | None     # UMR / nº póliza
    recibo: str | None         # nº de recibo (si la transferencia lo lleva)
    cliente: str | None        # coverholder (agencia) deducido del UMR
    mercado: str | None


class ReciboJustif(BaseModel):
    """Una fila POR RECIBO del justificante. Varias filas pueden compartir `transferencia_id`
    (un cobro que paga varios recibos); el cuadre con el apunte se hace por transferencia, por eso
    se incluye `importe_transferencia` (el importe real movido) además del importe individual."""
    transferencia_id: int
    importe_transferencia: Decimal
    fecha: dt.date | None
    importe: Decimal           # importe individual de ESTE recibo
    referencia: str | None
    recibo: str | None
    cliente: str | None
    mercado: str | None


def _coverholders(db: Session, umrs: set[str]) -> dict[str, str]:
    """UMR de binder → nombre del coverholder (agencia), para la columna Cliente."""
    umrs = {u for u in umrs if u}
    if not umrs:
        return {}
    rows = db.execute(
        select(Binder.umr, Productor.nombre).join(Productor, Productor.id == Binder.productor_id)
        .where(Binder.umr.in_(umrs))
    ).all()
    return {umr: nom for (umr, nom) in rows if umr}


def _recibos_de(db: Session, trs: list[Transferencia]) -> dict[int, str | None]:
    """Mapea cada transferencia → nº de recibo(s) para el desglose, en este orden de fiabilidad:
      1) `recibo_num` directo de la transferencia.
      2) `recibo_id` directo → su número.
      3) DEDUCCIÓN por las LÍNEAS del Premium (fuente de verdad): los recibos de las líneas cuyo
         binder + mes de `premium_bdx` coinciden con el (binder, periodo) de la transferencia. Así,
         cualquier cobro/liquidación hecho en la app queda deducido aunque el mes de premium no
         coincida con el de riesgo del recibo. Si hay varios recibos, se listan separados por coma."""
    # binder de las que no traen binder_id, por su UMR
    umrs = {t.numero_poliza for t in trs if t.numero_poliza and t.binder_id is None}
    umr2bid: dict[str, int] = (
        {u: i for (u, i) in db.execute(select(Binder.umr, Binder.id).where(Binder.umr.in_(umrs))).all()} if umrs else {}
    )
    bid_de = lambda t: t.binder_id or umr2bid.get(t.numero_poliza or "")

    # recibo por id directo
    rids = {t.recibo_id for t in trs if t.recibo_id}
    rec_por_id: dict[int, str] = (
        {i: n for (i, n) in db.execute(select(Recibo.id, Recibo.numero).where(Recibo.id.in_(rids))).all()} if rids else {}
    )

    bids = {bid_de(t) for t in trs}
    bids.discard(None)

    # deducción A: por (binder, 'YYYY-MM' del premium_bdx de las líneas) ↔ periodo de la transferencia
    por_premio: dict[tuple[int, str], set[str]] = defaultdict(set)
    # deducción B (más fiable para movimientos sueltos): por la FECHA de pago/liquidación/traspaso de
    # las líneas ↔ fecha de la transferencia, según el subtipo. Campo de fecha por subtipo:
    campo_fecha = {
        "Cobro": BdxLinea.premium_payment_date,
        "Liquidación": BdxLinea.fecha_liquidacion, "Liquidacion": BdxLinea.fecha_liquidacion,
        "Traspaso": BdxLinea.fecha_traspaso,
    }
    por_fecha: dict[tuple[str, int, dt.date], set[str]] = defaultdict(set)
    if bids:
        for (b, pbdx, num) in db.execute(
            select(Bdx.binder_id, BdxLinea.premium_bdx, Recibo.numero)
            .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
            .where(Bdx.binder_id.in_(bids), BdxLinea.premium_bdx.is_not(None), Recibo.numero.is_not(None))
        ).all():
            por_premio[(b, pbdx.strftime("%Y-%m"))].add(num)
        for sub, col in (("Cobro", BdxLinea.premium_payment_date), ("Liquidación", BdxLinea.fecha_liquidacion), ("Traspaso", BdxLinea.fecha_traspaso)):
            for (b, f, num) in db.execute(
                select(Bdx.binder_id, col, Recibo.numero)
                .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
                .where(Bdx.binder_id.in_(bids), col.is_not(None), Recibo.numero.is_not(None))
            ).all():
                por_fecha[(sub, b, f)].add(num)

    def _sub(t):  # normaliza el subtipo de la transferencia a la clave de fecha
        return "Liquidación" if (t.subtipo or "").startswith("Liquidaci") else t.subtipo

    out: dict[int, str | None] = {}
    for t in trs:
        if t.recibo_num:
            out[t.id] = t.recibo_num
            continue
        if t.recibo_id and t.recibo_id in rec_por_id:
            out[t.id] = rec_por_id[t.recibo_id]
            continue
        b = bid_de(t)
        # PREFERIR periodo (A): es preciso (1 recibo por transferencia). La fecha (B) empareja TODOS
        # los recibos cobrados ese día → solo se usa como respaldo cuando A no da nada.
        nums: set[str] = set()
        if b and t.periodo:
            nums = set(por_premio.get((b, t.periodo.strftime("%Y-%m")), set()))
        if not nums and b and t.fecha:
            nums = set(por_fecha.get((_sub(t), b, t.fecha), set()))
        out[t.id] = ", ".join(sorted(nums)) if nums else None
    return out


def _transfer_row(t: Transferencia, cliente: str | None, recibo: str | None) -> TransferJustif:
    return TransferJustif(
        id=t.id, fecha=t.fecha, importe=Decimal(t.importe or 0),
        referencia=t.numero_poliza, recibo=recibo, cliente=cliente, mercado=t.mercado,
    )


def _desglose_recibos(db: Session, trs: list[Transferencia]) -> dict[int, list[tuple[str | None, Decimal]]]:
    """tid → [(recibo|None, importe_individual)]: el DESGLOSE POR RECIBO de cada transferencia.

    Conjunto de recibos: 1) recibo_num / recibo_id directos; si no, 2) por (binder, mes de premium_bdx)
    == periodo de la transferencia (preciso), con respaldo por la FECHA de pago/liq./traspaso.
    Importe por recibo (solo cuando hay varios): Σ de la columna del subtipo (ingresado / liquidado_uw
    / traspasado) de las líneas de ese recibo en la fecha de la transferencia. Con un solo recibo se usa
    el importe de la transferencia (evita el ruido de redondeo)."""
    umrs = {t.numero_poliza for t in trs if t.numero_poliza and t.binder_id is None}
    umr2bid = ({u: i for (u, i) in db.execute(select(Binder.umr, Binder.id).where(Binder.umr.in_(umrs))).all()}
               if umrs else {})
    bid_de = lambda t: t.binder_id or umr2bid.get(t.numero_poliza or "")
    rids = {t.recibo_id for t in trs if t.recibo_id}
    rec_por_id = ({i: n for (i, n) in db.execute(select(Recibo.id, Recibo.numero).where(Recibo.id.in_(rids))).all()}
                  if rids else {})
    bids = {bid_de(t) for t in trs}
    bids.discard(None)

    por_premio: dict[tuple[int, str], set[str]] = defaultdict(set)
    por_fecha_set: dict[tuple[str, int, dt.date], set[str]] = defaultdict(set)
    por_fecha_amt: dict[tuple[str, int, dt.date, str], Decimal] = {}
    if bids:
        for (b, pbdx, num) in db.execute(
            select(Bdx.binder_id, BdxLinea.premium_bdx, Recibo.numero)
            .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
            .where(Bdx.binder_id.in_(bids), BdxLinea.premium_bdx.is_not(None), Recibo.numero.is_not(None))
        ).all():
            por_premio[(b, pbdx.strftime("%Y-%m"))].add(num)
        for sub, dcol, acol in (("Cobro", BdxLinea.premium_payment_date, BdxLinea.ingresado),
                                ("Liquidación", BdxLinea.fecha_liquidacion, BdxLinea.liquidado_uw),
                                ("Traspaso", BdxLinea.fecha_traspaso, BdxLinea.traspasado)):
            for (b, f, num, amt) in db.execute(
                select(Bdx.binder_id, dcol, Recibo.numero, func.sum(acol))
                .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
                .where(Bdx.binder_id.in_(bids), dcol.is_not(None), Recibo.numero.is_not(None))
                .group_by(Bdx.binder_id, dcol, Recibo.numero)
            ).all():
                por_fecha_set[(sub, b, f)].add(num)
                por_fecha_amt[(sub, b, f, num)] = Decimal(amt or 0)

    def _sub(t):
        return "Liquidación" if (t.subtipo or "").startswith("Liquidaci") else t.subtipo

    out: dict[int, list[tuple[str | None, Decimal]]] = {}
    for t in trs:
        imp_t = Decimal(t.importe or 0)
        if t.recibo_num:
            out[t.id] = [(t.recibo_num, imp_t)]
            continue
        if t.recibo_id and t.recibo_id in rec_por_id:
            out[t.id] = [(rec_por_id[t.recibo_id], imp_t)]
            continue
        # El desglose por recibo SOLO aplica a Primas: Siniestros/Comisiones/Honorarios no tienen
        # recibo de prima → una sola fila con el importe de la transferencia (si no, salen recibos
        # de prima ajenos con importe 0 y la suma no cuadra).
        if (t.tipo or "") != "Primas":
            out[t.id] = [(None, imp_t)]
            continue
        b = bid_de(t)
        sub = _sub(t)
        recibos: set[str] = set()
        if b and t.periodo:
            recibos = set(por_premio.get((b, t.periodo.strftime("%Y-%m")), set()))
        if not recibos and b and t.fecha:
            recibos = set(por_fecha_set.get((sub, b, t.fecha), set()))
        if not recibos:
            out[t.id] = [(None, imp_t)]
        elif len(recibos) == 1:
            out[t.id] = [(next(iter(recibos)), imp_t)]
        else:
            out[t.id] = [(r, por_fecha_amt.get((sub, b, t.fecha, r), Decimal(0))) for r in sorted(recibos)]
    return out


def _filas_recibo(trs: list[Transferencia], cov: dict[str, str],
                  desg: dict[int, list[tuple[str | None, Decimal]]]) -> list["ReciboJustif"]:
    """Aplana las transferencias a filas POR RECIBO (conservando el orden de `trs`)."""
    filas: list[ReciboJustif] = []
    for t in trs:
        for (rec, imp) in desg.get(t.id, [(None, Decimal(t.importe or 0))]):
            filas.append(ReciboJustif(
                transferencia_id=t.id, importe_transferencia=Decimal(t.importe or 0),
                fecha=t.fecha, importe=imp, referencia=t.numero_poliza, recibo=rec,
                cliente=cov.get(t.numero_poliza or ""), mercado=t.mercado,
            ))
    return filas


def _transferencias_ya_justificadas(db: Session, excluir_mid: int | None) -> set[int]:
    """Transferencias ya asignadas al justificante de ALGÚN apunte (para no ofrecerlas otra vez)."""
    usados: set[int] = set()
    for (lst, mid_) in db.execute(
        select(MovimientoBancario.transferencia_ids, MovimientoBancario.id)
        .where(MovimientoBancario.transferencia_ids.is_not(None))
    ).all():
        if excluir_mid is not None and mid_ == excluir_mid:
            continue
        usados.update(lst or [])
    return usados


@router.get("/transferencias-justificante", response_model=list[ReciboJustif])
def transferencias_justificante(
    clase: str = "cobro", fecha: dt.date | None = None, ambito: str | None = None,
    excluir_mid: int | None = None, limit: int = 1500, db: Session = Depends(get_db),
):
    """Transferencias candidatas (del subtipo de la clase) para componer un apunte, filtradas por la
    FECHA del movimiento y ocultando las ya usadas en otro apunte. Se autoseleccionan en el front y su
    suma debe cuadrar con el importe del apunte.

    `ambito` (Primas/Siniestros/Comisiones/Honorarios, deducido del concepto del apunte) acota el
    `tipo` de transferencia: un apunte «Cobro Primas» NO debe mezclar transferencias de Siniestros."""
    # Sin fecha NO se devuelve nada: el justificante siempre se cuadra por la fecha del apunte; así se
    # evita autoseleccionar TODAS las transferencias por error.
    if fecha is None:
        return []
    subtipos = _CLASE_SUBTIPOS.get(clase, _CLASE_SUBTIPOS["cobro"])
    stmt = select(Transferencia).where(Transferencia.subtipo.in_(subtipos), Transferencia.fecha == fecha)
    if ambito:
        stmt = stmt.where(Transferencia.tipo == ambito)
    usados = _transferencias_ya_justificadas(db, excluir_mid)
    if usados:
        stmt = stmt.where(Transferencia.id.not_in(usados))
    stmt = stmt.order_by(Transferencia.fecha.desc().nullslast(), Transferencia.numero_poliza).limit(limit)
    trs = list(db.scalars(stmt).all())
    cov = _coverholders(db, {t.numero_poliza for t in trs if t.numero_poliza})
    return _filas_recibo(trs, cov, _desglose_recibos(db, trs))


def _build_justificante_pdf(m: MovimientoBancario, filas: list[ReciboJustif], clase: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm, title=m.identificador or "Justificante")
    styles = getSampleStyleSheet()
    elems = []
    naranja = colors.HexColor("#da5833")
    elems.append(Paragraph(f"<b>Concepto</b>&nbsp;&nbsp; {m.concepto or ''}", styles["Normal"]))
    elems.append(Paragraph(f"<b>Fecha</b>&nbsp;&nbsp; {m.fecha.strftime('%d/%m/%Y') if m.fecha else ''}", styles["Normal"]))
    elems.append(Paragraph(f"<b>Movimiento</b>&nbsp;&nbsp; {m.identificador or ''} &nbsp;·&nbsp; {m.cuenta}", styles["Normal"]))
    elems.append(Spacer(1, 8))

    imp_label = _IMP_LABEL.get(clase, "Importe")
    cli = styles["Normal"].clone("cli"); cli.fontSize = 8
    data = [["Recibo", "Fecha", imp_label, "Referencia", "Cliente"]]
    total = Decimal(0)
    for f in filas:
        total += f.importe
        data.append([
            f.recibo or "", f.fecha.strftime("%d/%m/%Y") if f.fecha else "",
            _num_es(f.importe), f.referencia or "", Paragraph(f.cliente or f.mercado or "", cli),
        ])
    data.append(["", "Total", _num_es(total), "", ""])

    t = Table(data, colWidths=[24 * mm, 22 * mm, 28 * mm, 36 * mm, 68 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), naranja),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f6f6f6")]),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fff1ea")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elems.append(t)
    doc.build(elems)
    return buf.getvalue()


@router.get("/{mid}/justificante.pdf")
def justificante_pdf(mid: int, db: Session = Depends(get_db)):
    """PDF del justificante del apunte con las transferencias que lo componen (transferencia_ids)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    ids = m.transferencia_ids or []
    clase = _clase_de_concepto(m.concepto)
    filas: list[ReciboJustif] = []
    if ids:
        trs = list(db.scalars(select(Transferencia).where(Transferencia.id.in_(ids))).all())
        cov = _coverholders(db, {t.numero_poliza for t in trs if t.numero_poliza})
        byid = {t.id: t for t in trs}
        trs_ord = [byid[i] for i in ids if i in byid]   # conserva el orden de selección
        filas = _filas_recibo(trs_ord, cov, _desglose_recibos(db, trs_ord))
    if not filas:
        raise HTTPException(status_code=409, detail="Este apunte no tiene transferencias asociadas para el justificante.")
    pdf = _build_justificante_pdf(m, filas, clase)
    nombre = f"{m.identificador or m.id}. {m.concepto or 'Justificante'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nombre)}"},
    )
