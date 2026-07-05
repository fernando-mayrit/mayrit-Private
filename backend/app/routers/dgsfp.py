"""
Módulo de Agencias de Suscripción (MGAs), sobre el reflejo del Registro DGSFP + ficha manual.

- La existencia y el nombre oficial de agencias/aseguradoras, y la presencia de vínculos en el
  registro, los mantiene al día la sync local (tools/sync_agencias_dgsfp.py, Playwright).
- La FICHA de cada agencia (CIF, dirección, contacto, notas, activo/dudoso/revisado) y el estado
  `activo` de cada vínculo son MANUALES y editables desde aquí. La sync no los pisa (estado mixto:
  solo marca `revisar` cuando hay discrepancia con el registro).
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import DgsfpAgencia, DgsfpAseguradora, DgsfpVinculo, Parametro

router = APIRouter(prefix="/dgsfp", tags=["DGSFP"])

CLAVE_PARAM = "dgsfp_agencias_sync"


class ResumenDgsfp(BaseModel):
    actualizado: dt.datetime | None
    n_agencias: int
    n_agencias_activas: int
    n_aseguradoras: int
    n_vinculos: int
    n_sin_licencia: int   # aseguradoras referenciadas con licencia no activa


class VinculoDgsfp(BaseModel):
    id: int
    aseguradora_clave: str
    aseguradora_nombre: str
    aseguradora_nif: str | None
    aseguradora_situacion: str | None
    aseguradora_licencia_activa: bool
    agencia_clave: str
    agencia_nombre: str
    activo: bool
    en_dgsfp: bool


class AgenciaLista(BaseModel):
    clave: str
    nombre: str
    cif: str | None
    localidad: str | None
    provincia: str | None
    activo: bool
    dudoso: bool
    revisado: bool
    n_vinculos: int
    n_vinculos_activos: int


class AgenciaFicha(BaseModel):
    clave: str
    nombre: str
    cif: str | None = None
    fecha_constitucion: dt.date | None = None
    direccion: str | None = None
    cp: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    web: str | None = None
    productos: str | None = None
    notas: str | None = None
    activo: bool = True
    dudoso: bool = False
    revisado: bool = False
    vinculos: list[VinculoDgsfp] = []


class AgenciaUpdate(BaseModel):
    nombre: str | None = None
    cif: str | None = None
    fecha_constitucion: dt.date | None = None
    direccion: str | None = None
    cp: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    web: str | None = None
    productos: str | None = None
    notas: str | None = None
    activo: bool | None = None
    dudoso: bool | None = None
    revisado: bool | None = None


class VinculoUpdate(BaseModel):
    activo: bool | None = None
    revisar: bool | None = None   # normalmente para bajar el flag tras revisar


def _vinculo_dto(v: DgsfpVinculo) -> VinculoDgsfp:
    ase = v.aseguradora
    return VinculoDgsfp(
        id=v.id, aseguradora_clave=v.aseguradora_clave,
        aseguradora_nombre=ase.nombre if ase else v.aseguradora_clave,
        aseguradora_nif=ase.nif if ase else None,
        aseguradora_situacion=ase.situacion if ase else None,
        aseguradora_licencia_activa=ase.licencia_activa if ase else True,
        agencia_clave=v.agencia_clave,
        agencia_nombre=v.agencia.nombre if v.agencia else v.agencia_clave,
        activo=v.activo, en_dgsfp=v.en_dgsfp)


@router.get("/resumen", response_model=ResumenDgsfp)
def resumen(db: Session = Depends(get_db)):
    sello = db.get(Parametro, CLAVE_PARAM)
    return ResumenDgsfp(
        actualizado=sello.actualizado if sello else None,
        n_agencias=db.scalar(select(func.count()).select_from(DgsfpAgencia)) or 0,
        n_agencias_activas=db.scalar(select(func.count()).select_from(DgsfpAgencia).where(DgsfpAgencia.activo.is_(True))) or 0,
        n_aseguradoras=db.scalar(select(func.count(func.distinct(DgsfpVinculo.aseguradora_clave)))) or 0,
        n_vinculos=db.scalar(select(func.count()).select_from(DgsfpVinculo)) or 0,
        n_sin_licencia=db.scalar(
            select(func.count(func.distinct(DgsfpVinculo.aseguradora_clave)))
            .join(DgsfpAseguradora, DgsfpAseguradora.clave == DgsfpVinculo.aseguradora_clave)
            .where(DgsfpAseguradora.licencia_activa.is_(False))) or 0,
    )


@router.get("/vinculos", response_model=list[VinculoDgsfp])
def vinculos(db: Session = Depends(get_db)):
    """Todos los vínculos (activos e inactivos). El frontend pivota por compañía o por agencia."""
    filas = db.scalars(select(DgsfpVinculo)).all()
    return sorted((_vinculo_dto(v) for v in filas), key=lambda x: (x.agencia_nombre, x.aseguradora_nombre))


@router.get("/agencias", response_model=list[AgenciaLista])
def agencias(db: Session = Depends(get_db)):
    """Listado de agencias (MGAs) con su ficha resumida y nº de vínculos."""
    tot = dict(db.execute(select(DgsfpVinculo.agencia_clave, func.count()).group_by(DgsfpVinculo.agencia_clave)).all())
    act = dict(db.execute(select(DgsfpVinculo.agencia_clave, func.count())
                          .where(DgsfpVinculo.activo.is_(True)).group_by(DgsfpVinculo.agencia_clave)).all())
    out = []
    for a in db.scalars(select(DgsfpAgencia).order_by(DgsfpAgencia.nombre)).all():
        out.append(AgenciaLista(
            clave=a.clave, nombre=a.nombre, cif=a.cif, localidad=a.localidad, provincia=a.provincia,
            activo=a.activo, dudoso=a.dudoso, revisado=a.revisado,
            n_vinculos=int(tot.get(a.clave, 0)), n_vinculos_activos=int(act.get(a.clave, 0))))
    return out


@router.get("/agencias/{clave}", response_model=AgenciaFicha)
def agencia(clave: str, db: Session = Depends(get_db)):
    a = db.get(DgsfpAgencia, clave)
    if a is None:
        raise HTTPException(status_code=404, detail=f"Agencia {clave} no encontrada")
    vin = db.scalars(select(DgsfpVinculo).where(DgsfpVinculo.agencia_clave == clave)).all()
    ficha = AgenciaFicha.model_validate(a, from_attributes=True)
    ficha.vinculos = sorted((_vinculo_dto(v) for v in vin), key=lambda x: (not x.activo, x.aseguradora_nombre))
    return ficha


@router.put("/agencias/{clave}", response_model=AgenciaFicha)
def editar_agencia(clave: str, payload: AgenciaUpdate, db: Session = Depends(get_db)):
    a = db.get(DgsfpAgencia, clave)
    if a is None:
        raise HTTPException(status_code=404, detail=f"Agencia {clave} no encontrada")
    for campo, valor in payload.model_dump(exclude_unset=True).items():
        setattr(a, campo, valor)
    db.commit()
    return agencia(clave, db)


@router.put("/vinculos/{vinculo_id}", response_model=VinculoDgsfp)
def editar_vinculo(vinculo_id: int, payload: VinculoUpdate, db: Session = Depends(get_db)):
    v = db.get(DgsfpVinculo, vinculo_id)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Vínculo {vinculo_id} no encontrado")
    if payload.activo is not None:
        v.activo = payload.activo
        v.fecha_baja = None if payload.activo else dt.date.today()
    if payload.revisar is not None:
        v.revisar = payload.revisar
        if not payload.revisar:
            v.revisar_motivo = None
    db.commit()
    db.refresh(v)
    return _vinculo_dto(v)
