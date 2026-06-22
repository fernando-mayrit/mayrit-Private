"""
Avisos / tareas pendientes de la app. Se calculan AL VUELO desde los datos (no hay estado que
mantener), así nunca se desincronizan. Cada generador añade avisos a la lista.

Primer aviso: 'premium_sin_recibo' — periodos con Premium (incluido) cuyo Recibo aún no se ha
generado (no se puede cobrar/liquidar/traspasar sin recibo).
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, Recibo

router = APIRouter(tags=["Avisos"])


class Aviso(BaseModel):
    tipo: str                       # 'premium_sin_recibo', …
    severidad: str = "warning"      # info | warning | danger
    titulo: str
    detalle: str
    binder_id: int | None = None
    umr: str | None = None
    periodos: list[str] = []
    pagina: str | None = None       # a dónde ir para resolverlo (p. ej. 'binders')


def _premium_sin_recibo(db: Session) -> list[Aviso]:
    # Periodos de Premium (incluido) por binder.
    prem: dict[int, set[str]] = defaultdict(set)
    for bid, pb in db.execute(
        select(Bdx.binder_id, BdxLinea.premium_bdx)
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
    ).all():
        prem[bid].add(pb.strftime("%Y-%m"))
    # Periodos con Recibo generado por binder.
    rec: dict[int, set[str]] = defaultdict(set)
    for bid, per in db.execute(
        select(Recibo.binder_id, Recibo.periodo).where(Recibo.binder_id.is_not(None), Recibo.periodo.is_not(None))
    ).all():
        rec[bid].add(per)

    binders = {b.id: b for b in db.scalars(select(Binder)).all()}
    avisos: list[Aviso] = []
    for bid, periodos in prem.items():
        pendientes = sorted(periodos - rec.get(bid, set()))
        if not pendientes:
            continue
        b = binders.get(bid)
        avisos.append(Aviso(
            tipo="premium_sin_recibo", severidad="warning",
            titulo="Recibo pendiente de generar",
            detalle=f"{b.umr if b else ''}: faltan recibos de {', '.join(pendientes)}",
            binder_id=bid, umr=b.umr if b else None, periodos=pendientes, pagina="binders",
        ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


@router.get("/avisos", response_model=list[Aviso])
def listar_avisos(db: Session = Depends(get_db)):
    """Lista de avisos/tareas pendientes (calculados al vuelo)."""
    avisos: list[Aviso] = []
    avisos += _premium_sin_recibo(db)
    return avisos
