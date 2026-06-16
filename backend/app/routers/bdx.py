"""
Endpoints de BDX (bordereaux Risk/Premium). Estructura:
  Binder → BDX (cabecera de un periodo) → líneas.
Claims va en otro módulo.
"""
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models.maestras import Binder, Bdx, BdxLinea
from ..schemas import maestras as sch

router = APIRouter(tags=["BDX"])


@router.get("/bdx/excel-dir")
def excel_dir(sub: str = ""):
    """Lista (SOLO LECTURA) carpetas y ficheros Excel de la carpeta base de BDX, para el
    selector dentro de la app. `sub` navega por subcarpetas, restringido a la base."""
    base = os.path.abspath(settings.bdx_excel_dir)
    destino = os.path.abspath(os.path.join(base, sub)) if sub else base
    if os.path.commonpath([base, destino]) != base:  # no salir de la base
        raise HTTPException(status_code=400, detail="Ruta fuera de la carpeta base.")
    if not os.path.isdir(destino):
        raise HTTPException(status_code=404, detail=f"No existe la carpeta: {destino}")
    dirs, files = [], []
    for nombre in sorted(os.listdir(destino), key=str.lower):
        ruta = os.path.join(destino, nombre)
        if os.path.isdir(ruta):
            dirs.append(nombre)
        elif nombre.lower().endswith((".xlsx", ".xls")):
            st = os.stat(ruta)
            files.append({"name": nombre, "size": st.st_size, "mtime": int(st.st_mtime)})
    rel = os.path.relpath(destino, base)
    return {"base": base, "sub": "" if rel == "." else rel.replace("\\", "/"), "dirs": dirs, "files": files}


def _cab(b: Bdx, num: int | None = None) -> dict:
    return {
        "id": b.id,
        "binder_id": b.binder_id,
        "tipo": b.tipo,
        "reporting_period_start": b.reporting_period_start,
        "reporting_period_end": b.reporting_period_end,
        "estado": b.estado,
        "notas": b.notas,
        "num_lineas": num if num is not None else len(b.lineas),
        "created_at": b.created_at,
        "updated_at": b.updated_at,
    }


# ─────────────────────────── Cabeceras BDX por binder ───────────────────────
@router.get("/binders/{binder_id}/bdx", response_model=list[sch.BdxRead])
def listar(binder_id: int, tipo: str | None = None, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    # nº de líneas por bdx en una sola consulta
    conteo = dict(
        db.execute(
            select(BdxLinea.bdx_id, func.count(BdxLinea.id)).group_by(BdxLinea.bdx_id)
        ).all()
    )
    stmt = select(Bdx).where(Bdx.binder_id == binder_id)
    if tipo:
        stmt = stmt.where(Bdx.tipo == tipo)
    stmt = stmt.order_by(Bdx.reporting_period_start.desc().nullslast(), Bdx.id.desc())
    return [_cab(b, conteo.get(b.id, 0)) for b in db.scalars(stmt).all()]


@router.post("/binders/{binder_id}/bdx", response_model=sch.BdxRead, status_code=201)
def crear(binder_id: int, payload: sch.BdxCreate, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    b = Bdx(binder_id=binder_id, **payload.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return _cab(b, 0)


@router.get("/bdx/{bdx_id}", response_model=sch.BdxDetalle)
def obtener(bdx_id: int, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    return {**_cab(b, len(b.lineas)), "lineas": b.lineas}


@router.put("/bdx/{bdx_id}", response_model=sch.BdxRead)
def editar(bdx_id: int, payload: sch.BdxUpdate, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return _cab(b)


@router.delete("/bdx/{bdx_id}", status_code=204)
def borrar(bdx_id: int, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    db.delete(b)
    db.commit()


# ──────────────────────────────── Líneas de un BDX ──────────────────────────
@router.post("/bdx/{bdx_id}/lineas", response_model=sch.BdxLineaRead, status_code=201)
def crear_linea(bdx_id: int, payload: sch.BdxLineaCreate, db: Session = Depends(get_db)):
    if db.get(Bdx, bdx_id) is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    linea = BdxLinea(bdx_id=bdx_id, **payload.model_dump())
    db.add(linea)
    db.commit()
    db.refresh(linea)
    return linea


@router.put("/bdx/lineas/{linea_id}", response_model=sch.BdxLineaRead)
def editar_linea(linea_id: int, payload: sch.BdxLineaUpdate, db: Session = Depends(get_db)):
    linea = db.get(BdxLinea, linea_id)
    if linea is None:
        raise HTTPException(status_code=404, detail=f"Línea {linea_id} no encontrada")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(linea, k, v)
    db.commit()
    db.refresh(linea)
    return linea


@router.delete("/bdx/lineas/{linea_id}", status_code=204)
def borrar_linea(linea_id: int, db: Session = Depends(get_db)):
    linea = db.get(BdxLinea, linea_id)
    if linea is None:
        raise HTTPException(status_code=404, detail=f"Línea {linea_id} no encontrada")
    db.delete(linea)
    db.commit()
