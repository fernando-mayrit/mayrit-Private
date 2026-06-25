"""
Generación AUTOMÁTICA de transferencias (movimientos de dinero) a partir de la gestión de recibos.
Cierra el ciclo: cada vez que un recibo se cobra / traspasa / liquida / paga (o un Premium de binder),
se crea (o se borra, al deshacer) la fila correspondiente en `transferencias`.

Idempotente: cada movimiento automático se identifica por una clave estable y se reemplaza al
re-ejecutar la acción. Solo afecta a las filas automáticas (`manual = False`); las dadas de alta a
mano (siniestros/ajustes) no se tocan. Mapeo a la taxonomía de TLiquidaciones:

  acción 'cobrar'    → Tipo Primas/Honorarios/Comisiones · Subtipo Cobro       (entrada)
  acción 'traspasar' → Tipo Comisiones                  · Subtipo Traspaso     (interno)
  acción 'liquidar'  → Tipo Primas                      · Subtipo Liquidación  (salida, a la cía)
  acción 'pagar'     → Tipo Comisiones                  · Subtipo Liquidación  (salida, comisión cedida)
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models.maestras import Binder, CuentaBancaria, Recibo, Transferencia

D0 = Decimal(0)
SENTIDO = {"Cobro": "entrada", "Liquidación": "salida", "Traspaso": "interno"}
# tipo_poliza del recibo → Origen de la transferencia (coinciden salvo el binder, que va por Premium).
ORIGEN_DE_TIPO = {
    "Binder": "Binder", "Póliza": "Póliza", "Consultoría": "Consultoría",
    "Comisiones": "Comisiones", "Slip de Reaseguro": "Slip de Reaseguro",
}


def tipo_cobro(r: Recibo) -> str:
    """Tipo del movimiento de COBRO según el tipo de recibo."""
    if r.tipo_poliza == "Consultoría":
        return "Honorarios"
    if r.tipo_poliza == "Comisiones":
        return "Comisiones"
    return "Primas"


def importe_cobro(r: Recibo) -> Decimal:
    """Lo que entra al cobrar: la prima cobrada; en Comisiones, la comisión total (deducción)."""
    if r.tipo_poliza == "Comisiones":
        return r.deduccion_total or D0
    return r.prima_cobrada or D0


def _cuenta_nombre(db: Session, cid: int | None) -> str | None:
    if not cid:
        return None
    c = db.get(CuentaBancaria, cid)
    return c.nombre if c else None


def _dec(v) -> Decimal:
    try:
        return Decimal(v) if v is not None else D0
    except Exception:
        return D0


# ── Recibos NO-binder (póliza OM / consultoría / comisiones), gestionados uno a uno ──
def sync_recibo(
    db: Session, r: Recibo, *, tipo: str, subtipo: str,
    importe, fecha: dt.date | None,
    cuenta_origen_id: int | None = None, cuenta_destino_id: int | None = None,
) -> None:
    """Crea/actualiza (o borra, si importe<=0 o sin fecha) el movimiento automático de esta acción.
    Clave de idempotencia: (recibo_id, tipo, subtipo, manual=False)."""
    db.execute(delete(Transferencia).where(
        Transferencia.recibo_id == r.id,
        Transferencia.tipo == tipo,
        Transferencia.subtipo == subtipo,
        Transferencia.manual.is_(False),
    ))
    imp = _dec(importe)
    if fecha is None or imp <= 0:
        return
    db.add(Transferencia(
        origen=ORIGEN_DE_TIPO.get(r.tipo_poliza or "", r.tipo_poliza or "—"),
        tipo=tipo, subtipo=subtipo, sentido=SENTIDO[subtipo],
        fecha=fecha, anio=fecha.year, periodo=r.fecha_efecto_recibo,
        importe=imp,
        numero_poliza=r.numero_poliza,
        recibo_id=r.id, recibo_num=r.numero,
        binder_id=r.binder_id,
        mercado=r.nombre_mercado or r.mercado,
        cuenta_origen=_cuenta_nombre(db, cuenta_origen_id),
        cuenta_destino=_cuenta_nombre(db, cuenta_destino_id),
        manual=False,
    ))


def sync_recibo_accion(db: Session, r: Recibo, accion: str) -> None:
    """Sincroniza el movimiento automático correspondiente a una acción de gestión del recibo.
    Lee el estado YA aplicado en `r` (tras _recompute): al deshacer, los importes/fechas están a
    0/None y la fila se borra sola."""
    if accion == "cobrar":
        sync_recibo(db, r, tipo=tipo_cobro(r), subtipo="Cobro",
                    importe=importe_cobro(r), fecha=r.prima_fecha_cobro,
                    cuenta_destino_id=r.cuenta_cobro_id)
    elif accion == "traspasar":
        sync_recibo(db, r, tipo="Comisiones", subtipo="Traspaso",
                    importe=r.comision_retenida_traspasada, fecha=r.comision_fecha_traspaso,
                    cuenta_origen_id=r.cuenta_traspaso_origen_id, cuenta_destino_id=r.cuenta_traspaso_destino_id)
    elif accion == "liquidar":
        sync_recibo(db, r, tipo="Primas", subtipo="Liquidación",
                    importe=r.liquidar_liquidado, fecha=r.liquidar_fecha_liquidacion,
                    cuenta_origen_id=r.cuenta_liquidacion_id)
    elif accion == "pagar":
        sync_recibo(db, r, tipo="Comisiones", subtipo="Liquidación",
                    importe=r.comision_cedida_pagada, fecha=r.comision_cedida_fecha_pago,
                    cuenta_origen_id=r.cuenta_pago_id)


# ── Binders: el cobro/traspaso/liquidación llega por Premium (por binder + periodo) ──
def _periodo_date(periodo: str) -> dt.date | None:
    """'YYYY-MM' → primer día del mes (como en TLiquidaciones)."""
    try:
        y, m = periodo.split("-")[:2]
        return dt.date(int(y), int(m), 1)
    except Exception:
        return None


def sync_binder(
    db: Session, binder: Binder, *, periodo: str, tipo: str, subtipo: str,
    importe, fecha: dt.date | None,
) -> None:
    """Crea/actualiza (o borra, si importe<=0) el movimiento automático del Premium de un binder.
    Clave de idempotencia: (binder_id, periodo, tipo, subtipo, recibo_id NULL, manual=False)."""
    pdate = _periodo_date(periodo)
    db.execute(delete(Transferencia).where(
        Transferencia.binder_id == binder.id,
        Transferencia.periodo == pdate,
        Transferencia.tipo == tipo,
        Transferencia.subtipo == subtipo,
        Transferencia.recibo_id.is_(None),
        Transferencia.manual.is_(False),
    ))
    imp = _dec(importe)
    if fecha is None or imp <= 0:
        return
    db.add(Transferencia(
        origen="Binder", tipo=tipo, subtipo=subtipo, sentido=SENTIDO[subtipo],
        fecha=fecha, anio=fecha.year, periodo=pdate, importe=imp,
        numero_poliza=binder.umr or binder.agreement_number,
        binder_id=binder.id,
        manual=False,
    ))
