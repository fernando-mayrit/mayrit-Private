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


def _aplicar_risk_codes(db: Session, r: Ramo, risk_codes: list[sch.RiskCodeIn]) -> None:
    """Sincroniza los risk codes del ramo por DIFERENCIA (mantener / actualizar descripción / quitar /
    añadir), NO borrar-y-recrear: reinsertar los que YA existían chocaba con el índice único de `codigo`
    (SQLAlchemy hacía el INSERT del nuevo antes del DELETE del viejo) → falso «Risk Code repetido» al
    editar un ramo sin cambiar nada. Un code que ya está en OTRO ramo sí se rechaza, con mensaje claro."""
    nuevos: dict[str, str | None] = {}
    for rc in risk_codes:
        cod = (rc.codigo or "").strip()
        if cod:
            nuevos[cod] = (rc.descripcion or "").strip() or None
    existentes = {rc.codigo: rc for rc in r.risk_codes}

    # Rechazo CLARO (nombrando el code y el ramo) si alguno de los NUEVOS ya pertenece a otro ramo.
    a_comprobar = [c for c in nuevos if c not in existentes]
    if a_comprobar:
        cond = [RiskCode.codigo.in_(a_comprobar)]
        if r.id is not None:                       # al crear (r.id None) se comprueban todos los ramos
            cond.append(RiskCode.ramo_id != r.id)
        choques = db.execute(
            select(RiskCode.codigo, Ramo.nombre).join(Ramo, Ramo.id == RiskCode.ramo_id).where(*cond)
        ).all()
        if choques:
            lista = ", ".join(f"«{c}» (ya está en {n})" for c, n in choques)
            raise HTTPException(status_code=400,
                detail=f"Estos Risk Code ya pertenecen a otro ramo: {lista}. Un Risk Code no puede estar en dos ramos.")

    for cod, rc in list(existentes.items()):       # quitar los que ya no están
        if cod not in nuevos:
            r.risk_codes.remove(rc)
    for cod, desc in nuevos.items():               # actualizar los que siguen + añadir los nuevos
        if cod in existentes:
            existentes[cod].descripcion = desc
        else:
            r.risk_codes.append(RiskCode(codigo=cod, descripcion=desc))


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
    db.add(r)
    _aplicar_risk_codes(db, r, payload.risk_codes)
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
        _aplicar_risk_codes(db, r, payload.risk_codes)
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
