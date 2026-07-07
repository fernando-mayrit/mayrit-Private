"""Manual de uso de la app — secciones editables (cuerpo en Markdown), ordenables.

Cualquier usuario puede editar (decisión de negocio). El orden lo da `orden`; el reordenado
recibe la lista de ids en el nuevo orden y reasigna `orden` = posición.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import ManualSeccion
from ..schemas import maestras as sch

router = APIRouter(tags=["Manual"])


@router.get("/manual", response_model=list[sch.ManualSeccionRead])
def listar(db: Session = Depends(get_db)):
    return db.scalars(
        select(ManualSeccion).order_by(ManualSeccion.orden, ManualSeccion.id)
    ).all()


@router.post("/manual", response_model=sch.ManualSeccionRead, status_code=201)
def crear(payload: sch.ManualSeccionWrite, db: Session = Depends(get_db)):
    orden = payload.orden
    if orden is None:
        maximo = db.scalar(select(func.max(ManualSeccion.orden)))
        orden = (maximo if maximo is not None else -1) + 1
    s = ManualSeccion(emoji=payload.emoji, titulo=payload.titulo, cuerpo=payload.cuerpo, orden=orden)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.put("/manual/reordenar", response_model=list[sch.ManualSeccionRead])
def reordenar(payload: sch.ManualReorden, db: Session = Depends(get_db)):
    """Reasigna `orden` según la posición en la lista de ids recibida."""
    for pos, sid in enumerate(payload.ids):
        s = db.get(ManualSeccion, sid)
        if s is not None:
            s.orden = pos
    db.commit()
    return db.scalars(select(ManualSeccion).order_by(ManualSeccion.orden, ManualSeccion.id)).all()


@router.put("/manual/{seccion_id}", response_model=sch.ManualSeccionRead)
def actualizar(seccion_id: int, payload: sch.ManualSeccionWrite, db: Session = Depends(get_db)):
    s = db.get(ManualSeccion, seccion_id)
    if s is None:
        raise HTTPException(status_code=404, detail=f"Sección {seccion_id} no encontrada")
    s.emoji = payload.emoji
    s.titulo = payload.titulo
    s.cuerpo = payload.cuerpo
    if payload.orden is not None:
        s.orden = payload.orden
    db.commit()
    db.refresh(s)
    return s


@router.delete("/manual/{seccion_id}", status_code=204)
def borrar(seccion_id: int, db: Session = Depends(get_db)):
    s = db.get(ManualSeccion, seccion_id)
    if s is None:
        raise HTTPException(status_code=404, detail=f"Sección {seccion_id} no encontrada")
    db.delete(s)
    db.commit()
