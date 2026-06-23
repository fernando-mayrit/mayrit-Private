"""
Tareas recurrentes MANUALES enganchadas a un binder. La recurrencia se ajusta a la VIGENCIA del
binder: arranca en `fecha_inicio` (o la fecha de efecto del binder) y se repite con su frecuencia
hasta el vencimiento del binder. Cada ocurrencia se marca 'Hecha' (registro en `tareas_hechas`).
Saltan como aviso en la campana `aviso_dias_antes` antes de cada ocurrencia.
"""
from __future__ import annotations

import calendar
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Binder, Tarea, TareaHecha

router = APIRouter(tags=["Tareas"])

PASO_MESES = {"Mensual": 1, "Trimestral": 3, "Semestral": 6, "Anual": 12}


def _add_months(d: dt.date, n: int) -> dt.date:
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return dt.date(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def _paso(t: Tarea) -> int:
    """Paso en meses de la recurrencia. 0 = Única."""
    if t.frecuencia == "Personalizada":
        return int(t.intervalo_meses or 1)
    return PASO_MESES.get(t.frecuencia, 0)


def _ocurrencias(t: Tarea, binder: Binder) -> list[dt.date]:
    """Fechas de las ocurrencias: desde fecha_inicio (o efecto del binder), cada `paso` meses, hasta
    el vencimiento del binder (con tope de seguridad si el binder no tuviera vencimiento)."""
    inicio = t.fecha_inicio or binder.fecha_efecto
    if not inicio:
        return []
    paso = _paso(t)
    if paso <= 0:
        return [inicio]
    fin = binder.fecha_vencimiento or _add_months(inicio, 120)
    out, k = [], 0
    while k < 1200:
        f = _add_months(inicio, k * paso)
        if f > fin:
            break
        out.append(f)
        k += 1
    return out


def _debida(t: Tarea, f: dt.date, hoy: dt.date, hecha: bool) -> bool:
    """Una ocurrencia 'cuenta' si ya está hecha o su aviso ya ha saltado (aviso_dias_antes antes)."""
    return hecha or (f - dt.timedelta(days=int(t.aviso_dias_antes or 0)) <= hoy)


# ── Schemas ──
class TareaIn(BaseModel):
    titulo: str
    descripcion: str | None = None
    frecuencia: str = "Mensual"
    intervalo_meses: int | None = None     # para frecuencia 'Personalizada'
    fecha_inicio: dt.date | None = None    # None = fecha de efecto del binder
    aviso_dias_antes: int = 5
    estado: str = "Activa"


class TareaUpdate(BaseModel):
    titulo: str | None = None
    descripcion: str | None = None
    frecuencia: str | None = None
    intervalo_meses: int | None = None
    fecha_inicio: dt.date | None = None
    aviso_dias_antes: int | None = None
    estado: str | None = None


class TareaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    binder_id: int
    titulo: str
    descripcion: str | None = None
    frecuencia: str
    intervalo_meses: int | None = None
    fecha_inicio: dt.date | None = None
    aviso_dias_antes: int
    estado: str
    n_ocurrencias: int = 0      # ocurrencias debidas (hasta hoy/aviso)
    n_hechas: int = 0
    proxima: dt.date | None = None   # próxima ocurrencia pendiente y debida


def _serializar(db: Session, t: Tarea) -> TareaRead:
    binder = db.get(Binder, t.binder_id)
    d = TareaRead.model_validate(t)
    ocs = _ocurrencias(t, binder) if binder else []
    hechas = {h.fecha_ocurrencia for h in t.hechas}
    hoy = dt.date.today()
    debidas = [f for f in ocs if _debida(t, f, hoy, f in hechas)]
    d.n_ocurrencias = len(debidas)
    d.n_hechas = len([f for f in ocs if f in hechas])
    d.proxima = next((f for f in ocs if f not in hechas and _debida(t, f, hoy, False)), None)
    return d


@router.get("/binders/{binder_id}/tareas", response_model=list[TareaRead])
def listar(binder_id: int, db: Session = Depends(get_db)):
    ts = db.scalars(select(Tarea).where(Tarea.binder_id == binder_id).order_by(Tarea.id)).all()
    return [_serializar(db, t) for t in ts]


@router.post("/binders/{binder_id}/tareas", response_model=TareaRead, status_code=201)
def crear(binder_id: int, payload: TareaIn, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    t = Tarea(binder_id=binder_id, **payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serializar(db, t)


@router.put("/tareas/{tarea_id}", response_model=TareaRead)
def editar(tarea_id: int, payload: TareaUpdate, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _serializar(db, t)


@router.delete("/tareas/{tarea_id}", status_code=204)
def borrar(tarea_id: int, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    db.delete(t)
    db.commit()


# ── Ocurrencias (calendario de la tarea) ──
class OcurrenciaOut(BaseModel):
    fecha: dt.date
    hecha: bool
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    estado: str   # 'hecha' | 'vencida' | 'pendiente' | 'futura'


@router.get("/tareas/{tarea_id}/ocurrencias")
def ocurrencias(tarea_id: int, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    binder = db.get(Binder, t.binder_id)
    hechas = {h.fecha_ocurrencia: h for h in t.hechas}
    hoy = dt.date.today()
    out: list[OcurrenciaOut] = []
    for f in _ocurrencias(t, binder):
        h = hechas.get(f)
        if h:
            estado = "hecha"
        elif f < hoy:
            estado = "vencida"
        elif _debida(t, f, hoy, False):
            estado = "pendiente"
        else:
            estado = "futura"
        out.append(OcurrenciaOut(
            fecha=f, hecha=h is not None,
            fecha_hecha=h.fecha_hecha if h else None, notas=h.notas if h else None, estado=estado,
        ))
    return {"tarea_id": t.id, "titulo": t.titulo, "ocurrencias": out}


class HechaIn(BaseModel):
    fecha_ocurrencia: dt.date
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    deshacer: bool = False


@router.post("/tareas/{tarea_id}/hecha", status_code=200)
def marcar_hecha(tarea_id: int, payload: HechaIn, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    h = db.scalar(select(TareaHecha).where(
        TareaHecha.tarea_id == tarea_id, TareaHecha.fecha_ocurrencia == payload.fecha_ocurrencia))
    if payload.deshacer:
        if h:
            db.delete(h)
            db.commit()
        return {"ok": True, "hecha": False}
    if h is None:
        h = TareaHecha(tarea_id=tarea_id, fecha_ocurrencia=payload.fecha_ocurrencia,
                       fecha_hecha=payload.fecha_hecha or dt.date.today(), notas=payload.notas)
        db.add(h)
    else:
        h.fecha_hecha = payload.fecha_hecha or dt.date.today()
        h.notas = payload.notas
    db.commit()
    return {"ok": True, "hecha": True}
