"""Valoraciones de Profit Commission de un binder (pestaña PC).

La PC se recalcula año a año bajando el IBNR según se cierra la siniestralidad. Cada valoración es una
columna (izq→dcha por `orden`); la última (abierta) se calcula EN VIVO en el frontend con la
siniestralidad actual, y al BLOQUEARLA el frontend envía el `snapshot` con todas las cifras congeladas
(foto de lo que se pagó ese año). Aquí solo se persisten los metadatos y ese snapshot.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Binder, PcValoracion

router = APIRouter(tags=["PC"])


class PcValoracionRead(BaseModel):
    id: int
    orden: int
    fecha: dt.date | None = None
    bloqueado: bool = False
    manual: bool = False
    ibnr_pct: Decimal | None = None
    deficit: Decimal | None = None
    snapshot: dict | None = None


class PcValoracionCreate(BaseModel):
    ibnr_pct: Decimal | None = None
    deficit: Decimal | None = None
    fecha: dt.date | None = None
    manual: bool = False
    snapshot: dict | None = None


class PcValoracionUpdate(BaseModel):
    fecha: dt.date | None = None
    ibnr_pct: Decimal | None = None
    deficit: Decimal | None = None
    bloqueado: bool | None = None
    manual: bool | None = None
    snapshot: dict | None = None


def _binder_o_404(binder_id: int, db: Session) -> Binder:
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return b


@router.get("/binders/{binder_id}/pc/valoraciones", response_model=list[PcValoracionRead])
def listar(binder_id: int, db: Session = Depends(get_db)):
    _binder_o_404(binder_id, db)
    vs = db.scalars(select(PcValoracion).where(PcValoracion.binder_id == binder_id)
                    .order_by(PcValoracion.orden, PcValoracion.id)).all()
    return [PcValoracionRead.model_validate(v, from_attributes=True) for v in vs]


@router.post("/binders/{binder_id}/pc/valoraciones", response_model=PcValoracionRead)
def crear(binder_id: int, payload: PcValoracionCreate, db: Session = Depends(get_db)):
    """Crea una valoración nueva (la primera, o «duplicar» = la siguiente columna a la derecha)."""
    _binder_o_404(binder_id, db)
    orden = (db.scalar(select(func.max(PcValoracion.orden)).where(PcValoracion.binder_id == binder_id)) or 0) + 1
    v = PcValoracion(binder_id=binder_id, orden=orden, ibnr_pct=payload.ibnr_pct, deficit=payload.deficit,
                     fecha=payload.fecha, bloqueado=False, manual=payload.manual, snapshot=payload.snapshot)
    db.add(v)
    db.commit()
    db.refresh(v)
    return PcValoracionRead.model_validate(v, from_attributes=True)


@router.put("/pc/valoraciones/{vid}", response_model=PcValoracionRead)
def actualizar(vid: int, payload: PcValoracionUpdate, db: Session = Depends(get_db)):
    v = db.get(PcValoracion, vid)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Valoración {vid} no encontrada")
    datos = payload.model_dump(exclude_unset=True)
    if datos.get("bloqueado") is True and "snapshot" not in datos and v.snapshot is None:
        raise HTTPException(status_code=422, detail="Al bloquear hay que enviar el snapshot con las cifras.")
    for k, val in datos.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return PcValoracionRead.model_validate(v, from_attributes=True)


@router.delete("/pc/valoraciones/{vid}")
def borrar(vid: int, db: Session = Depends(get_db)):
    v = db.get(PcValoracion, vid)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Valoración {vid} no encontrada")
    if v.bloqueado:
        raise HTTPException(status_code=409, detail="No se puede borrar una valoración bloqueada; desbloquéala antes.")
    db.delete(v)
    db.commit()
    return {"ok": True}
