"""
Avisos / tareas pendientes de la app. Se calculan AL VUELO desde los datos (no hay estado que
mantener), así nunca se desincronizan. Cada generador añade avisos a la lista.

Primer aviso: 'risk_sin_recibo' — periodos con Risk BDX (líneas cuyo reporting_period_start cae en
ese mes) cuyo Recibo aún no se ha generado. Si un mes no tiene Risk BDX, no se espera recibo.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, Productor, Recibo

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


@router.get("/avisos", response_model=list[Aviso])
def listar_avisos(db: Session = Depends(get_db)):
    """Lista de avisos/tareas pendientes (calculados al vuelo)."""
    avisos: list[Aviso] = []
    avisos += _risk_sin_recibo(db)
    return avisos
