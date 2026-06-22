"""
Avisos / tareas pendientes de la app. Se calculan AL VUELO desde los datos (no hay estado que
mantener), así nunca se desincronizan. Cada generador añade avisos a la lista.

Primer aviso: 'risk_sin_recibo' — periodos con Risk BDX (líneas cuyo reporting_period_start cae en
ese mes) cuyo Recibo aún no se ha generado. Si un mes no tiene Risk BDX, no se espera recibo.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, Poliza, Productor, Recibo

router = APIRouter(tags=["Avisos"])

# Productores que NO generan Recibo del Risk porque facturan por honorarios (módulo Consultoría),
# no por comisión. Sus binders no deben avisar de "recibo pendiente".
PRODUCTORES_SIN_RECIBO = {"insurart"}


class Aviso(BaseModel):
    tipo: str                       # 'premium_sin_recibo', …
    severidad: str = "warning"      # info | warning | danger
    titulo: str
    detalle: str
    binder_id: int | None = None
    umr: str | None = None
    periodos: list[str] = []
    pagina: str | None = None       # a dónde ir para resolverlo (p. ej. 'binders')


def _risk_sin_recibo(db: Session) -> list[Aviso]:
    # Periodos de Risk BDX por binder (mes del reporting_period_start de las líneas Risk).
    risk: dict[int, set[str]] = defaultdict(set)
    for bid, rp in db.execute(
        select(Bdx.binder_id, BdxLinea.reporting_period_start)
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.tipo == "Risk", BdxLinea.reporting_period_start.is_not(None))
    ).all():
        risk[bid].add(rp.strftime("%Y-%m"))
    # Periodos con Recibo generado por binder (el recibo se indexa por reporting period).
    rec: dict[int, set[str]] = defaultdict(set)
    for bid, per in db.execute(
        select(Recibo.binder_id, Recibo.periodo).where(Recibo.binder_id.is_not(None), Recibo.periodo.is_not(None))
    ).all():
        rec[bid].add(per)

    binders = {b.id: b for b in db.scalars(select(Binder)).all()}
    prods = {p.id: (p.nombre or "").lower() for p in db.scalars(select(Productor)).all()}
    avisos: list[Aviso] = []
    for bid, periodos in risk.items():
        b = binders.get(bid)
        # Saltar productores de honorarios (no generan recibo del Risk).
        nombre_prod = prods.get(b.productor_id, "") if b else ""
        if any(x in nombre_prod for x in PRODUCTORES_SIN_RECIBO):
            continue
        pendientes = sorted(periodos - rec.get(bid, set()))
        if not pendientes:
            continue
        avisos.append(Aviso(
            tipo="risk_sin_recibo", severidad="warning",
            titulo="Recibo pendiente de generar",
            detalle=f"{b.umr if b else ''}: hay Risk BDX sin recibo en {', '.join(pendientes)}",
            binder_id=bid, umr=b.umr if b else None, periodos=pendientes, pagina="binders",
        ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


def _mas_un_mes(d: dt.date) -> dt.date:
    """d + 1 mes (ajustando fin de mes)."""
    m = d.month % 12 + 1
    y = d.year + (1 if d.month == 12 else 0)
    import calendar
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def _es_anual(efecto: dt.date | None, venc: dt.date | None) -> bool:
    """Duración exactamente anual: efecto +1 año = día siguiente al vencimiento."""
    if not efecto or not venc:
        return False
    try:
        mas = efecto.replace(year=efecto.year + 1)
    except ValueError:       # 29-feb
        mas = efecto.replace(year=efecto.year + 1, day=28)
    return mas == venc + dt.timedelta(days=1)


def _vencimientos_sin_renovar(db: Session) -> list[Aviso]:
    """Binders y pólizas que vencen en ≤1 mes (o ya vencidos) en vigor y sin renovación generada."""
    hoy = dt.date.today()
    limite = _mas_un_mes(hoy)
    avisos: list[Aviso] = []

    # ── Binders: el último de cada programa (sin otro posterior) que venza pronto ──
    binders = list(db.scalars(select(Binder)).all())
    for b in binders:
        if (b.estado or "") != "En Vigor" or not b.fecha_vencimiento or b.fecha_vencimiento > limite:
            continue
        renovado = b.programa_id is not None and any(
            x.id != b.id and x.programa_id == b.programa_id and x.fecha_efecto and b.fecha_efecto
            and x.fecha_efecto > b.fecha_efecto for x in binders)
        if renovado:
            continue
        avisos.append(Aviso(
            tipo="binder_sin_renovar", severidad="warning",
            titulo="Binder por vencer sin renovar",
            detalle=f"{b.umr or b.agreement_number}: vence el {b.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
            binder_id=b.id, umr=b.umr, pagina="binders",
        ))

    # ── Pólizas anuales en vigor que vencen pronto y no tienen renovación (mismo asegurado+ramo) ──
    polizas = list(db.scalars(select(Poliza)).all())
    def _k(s):
        return (str(s).strip().lower() if s else "")
    for p in polizas:
        if (p.estado or "") != "En Vigor" or not p.fecha_vencimiento or p.fecha_vencimiento > limite:
            continue
        if not _es_anual(p.fecha_efecto, p.fecha_vencimiento):
            continue
        objetivo = p.fecha_vencimiento + dt.timedelta(days=1)
        renovada = any(
            x.id != p.id and _k(x.asegurado) == _k(p.asegurado) and _k(x.ramo) == _k(p.ramo)
            and x.fecha_efecto == objetivo for x in polizas)
        if renovada:
            continue
        avisos.append(Aviso(
            tipo="poliza_sin_renovar", severidad="warning",
            titulo="Póliza por vencer sin renovar",
            detalle=f"{p.numero_poliza or p.asegurado}: vence el {p.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
            umr=p.numero_poliza, pagina="polizas",
        ))
    return avisos


@router.get("/avisos", response_model=list[Aviso])
def listar_avisos(db: Session = Depends(get_db)):
    """Lista de avisos/tareas pendientes (calculados al vuelo)."""
    avisos: list[Aviso] = []
    avisos += _risk_sin_recibo(db)
    avisos += _vencimientos_sin_renovar(db)
    return avisos
