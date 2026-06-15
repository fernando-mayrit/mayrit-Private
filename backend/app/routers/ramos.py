"""
Endpoints de Ramos (catálogo). Cada ramo tiene varios Risk Codes (un risk code pertenece
a un solo ramo → 'codigo' es único). Lógica propia por los risk_codes anidados.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Ramo, RiskCode
from ..schemas import maestras as sch

router = APIRouter(prefix="/ramos", tags=["Ramos"])


def _serializar(r: Ramo) -> dict:
    return {
        "id": r.id,
        "nombre": r.nombre,
        "risk_codes": [
            {"id": rc.id, "codigo": rc.codigo, "descripcion": rc.descripcion} for rc in r.risk_codes
        ],
    }


def _aplicar_risk_codes(r: Ramo, risk_codes: list[sch.RiskCodeIn]) -> None:
    r.risk_codes.clear()
    for rc in risk_codes:
        if not rc.codigo.strip():
            continue
        r.risk_codes.append(RiskCode(codigo=rc.codigo.strip(), descripcion=(rc.descripcion or "").strip() or None))


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Hay un Risk Code repetido (un Risk Code no puede estar en dos ramos).",
        )


@router.get("", response_model=list[sch.RamoRead])
def listar(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Ramo).order_by(Ramo.nombre)
    if q:
        stmt = stmt.where(Ramo.nombre.ilike(f"%{q}%"))
    return [_serializar(r) for r in db.scalars(stmt).all()]


@router.get("/{ramo_id}", response_model=sch.RamoRead)
def obtener(ramo_id: int, db: Session = Depends(get_db)):
    r = db.get(Ramo, ramo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Ramo {ramo_id} no encontrado")
    return _serializar(r)


@router.post("", response_model=sch.RamoRead, status_code=201)
def crear(payload: sch.RamoCreate, db: Session = Depends(get_db)):
    r = Ramo(nombre=payload.nombre.strip())
    _aplicar_risk_codes(r, payload.risk_codes)
    db.add(r)
    _commit(db)
    db.refresh(r)
    return _serializar(r)


@router.put("/{ramo_id}", response_model=sch.RamoRead)
def editar(ramo_id: int, payload: sch.RamoUpdate, db: Session = Depends(get_db)):
    r = db.get(Ramo, ramo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Ramo {ramo_id} no encontrado")
    if payload.nombre is not None:
        r.nombre = payload.nombre.strip()
    if payload.risk_codes is not None:
        _aplicar_risk_codes(r, payload.risk_codes)
    _commit(db)
    db.refresh(r)
    return _serializar(r)


@router.delete("/{ramo_id}", status_code=204)
def borrar(ramo_id: int, db: Session = Depends(get_db)):
    r = db.get(Ramo, ramo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Ramo {ramo_id} no encontrado")
    db.delete(r)
    db.commit()
