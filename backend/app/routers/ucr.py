"""
Módulo UCR (Unique Claims Reference) — tabla traída de Access/SharePoint (`Mayrit - TUCR`).
Una fila por UCR asignado, con su UMR / sección / risk code / signing / TPA / estado. Listado con
filtros + alta/edición manual.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Ucr

router = APIRouter(prefix="/ucr", tags=["UCR"])


class UcrRead(BaseModel):
    id: int
    coverholder: str | None = None
    umr: str | None = None
    section: str | None = None
    risk_code: str | None = None
    signing: str | None = None
    ucr: str | None = None
    notas: str | None = None
    estado: str | None = None
    tpa: str | None = None

    class Config:
        from_attributes = True


class UcrListado(BaseModel):
    items: list[UcrRead]
    n_total: int


class UcrOpciones(BaseModel):
    umrs: list[str]
    estados: list[str]
    coverholders: list[str]


class UcrWrite(BaseModel):
    coverholder: str | None = None
    umr: str | None = None
    section: str | None = None
    risk_code: str | None = None
    signing: str | None = None
    ucr: str | None = None
    notas: str | None = None
    estado: str | None = None
    tpa: str | None = None


@router.get("", response_model=UcrListado)
def listar(
    db: Session = Depends(get_db),
    umr: str | None = None,
    estado: str | None = None,
    coverholder: str | None = None,
    q: str | None = None,
    limit: int = 2000,
):
    filtros = []
    if umr:
        filtros.append(Ucr.umr == umr)
    if estado:
        filtros.append(Ucr.estado == estado)
    if coverholder:
        filtros.append(Ucr.coverholder == coverholder)
    if q:
        like = f"%{q.strip()}%"
        filtros.append(or_(
            Ucr.ucr.ilike(like), Ucr.umr.ilike(like), Ucr.coverholder.ilike(like),
            Ucr.signing.ilike(like), Ucr.risk_code.ilike(like), Ucr.tpa.ilike(like), Ucr.notas.ilike(like),
        ))
    n_total = db.scalar(select(func.count()).select_from(Ucr).where(*filtros)) or 0
    items = db.scalars(
        select(Ucr).where(*filtros).order_by(Ucr.umr, Ucr.ucr).limit(limit)
    ).all()
    return UcrListado(items=[UcrRead.model_validate(u) for u in items], n_total=n_total)


@router.get("/opciones", response_model=UcrOpciones)
def opciones(db: Session = Depends(get_db)):
    def distintos(col):
        return [v for (v,) in db.execute(select(col).where(col.is_not(None), col != "").distinct().order_by(col)).all()]
    return UcrOpciones(
        umrs=distintos(Ucr.umr), estados=distintos(Ucr.estado), coverholders=distintos(Ucr.coverholder),
    )


@router.post("", response_model=UcrRead, status_code=201)
def crear(datos: UcrWrite, db: Session = Depends(get_db)):
    u = Ucr(**{k: (v.strip() if isinstance(v, str) else v) or None for k, v in datos.model_dump().items()})
    db.add(u)
    db.commit()
    db.refresh(u)
    return UcrRead.model_validate(u)


@router.put("/{ucr_id}", response_model=UcrRead)
def actualizar(ucr_id: int, datos: UcrWrite, db: Session = Depends(get_db)):
    u = db.get(Ucr, ucr_id)
    if u is None:
        raise HTTPException(status_code=404, detail=f"UCR {ucr_id} no encontrado")
    for k, v in datos.model_dump(exclude_unset=True).items():
        setattr(u, k, (v.strip() if isinstance(v, str) else v) or None)
    db.commit()
    db.refresh(u)
    return UcrRead.model_validate(u)


@router.delete("/{ucr_id}", status_code=204)
def borrar(ucr_id: int, db: Session = Depends(get_db)):
    u = db.get(Ucr, ucr_id)
    if u is not None:
        db.delete(u)
        db.commit()
