"""
Lectura del reflejo del Registro DGSFP (aseguradoras ↔ agencias de suscripción). Solo lectura:
los datos los mantiene al día la herramienta local tools/sync_agencias_dgsfp.py (Playwright).
"""
import datetime as dt

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import DgsfpAgencia, DgsfpAseguradora, DgsfpVinculo, Parametro

router = APIRouter(prefix="/dgsfp", tags=["DGSFP"])

CLAVE_PARAM = "dgsfp_agencias_sync"


class ResumenDgsfp(BaseModel):
    actualizado: dt.datetime | None
    n_aseguradoras: int
    n_agencias: int
    n_vinculos: int


class VinculoDgsfp(BaseModel):
    aseguradora_clave: str
    aseguradora_nombre: str
    aseguradora_nif: str | None
    aseguradora_situacion: str | None
    agencia_clave: str
    agencia_nombre: str


@router.get("/resumen", response_model=ResumenDgsfp)
def resumen(db: Session = Depends(get_db)):
    sello = db.get(Parametro, CLAVE_PARAM)
    n_vin = db.scalar(select(func.count()).select_from(DgsfpVinculo).where(DgsfpVinculo.activo.is_(True))) or 0
    n_ase = db.scalar(select(func.count(func.distinct(DgsfpVinculo.aseguradora_clave)))
                      .where(DgsfpVinculo.activo.is_(True))) or 0
    n_ag = db.scalar(select(func.count(func.distinct(DgsfpVinculo.agencia_clave)))
                     .where(DgsfpVinculo.activo.is_(True))) or 0
    return ResumenDgsfp(actualizado=sello.actualizado if sello else None,
                        n_aseguradoras=int(n_ase), n_agencias=int(n_ag), n_vinculos=int(n_vin))


@router.get("/vinculos", response_model=list[VinculoDgsfp])
def vinculos(db: Session = Depends(get_db)):
    """Todos los vínculos activos aseguradora↔agencia. El frontend pivota para ver por compañía o
    por agencia (son ~300 filas, van en una sola carga)."""
    filas = db.execute(
        select(DgsfpVinculo.aseguradora_clave, DgsfpAseguradora.nombre, DgsfpAseguradora.nif,
               DgsfpAseguradora.situacion, DgsfpVinculo.agencia_clave, DgsfpAgencia.nombre)
        .join(DgsfpAseguradora, DgsfpAseguradora.clave == DgsfpVinculo.aseguradora_clave)
        .join(DgsfpAgencia, DgsfpAgencia.clave == DgsfpVinculo.agencia_clave)
        .where(DgsfpVinculo.activo.is_(True))
        .order_by(DgsfpAseguradora.nombre, DgsfpAgencia.nombre)
    ).all()
    return [VinculoDgsfp(aseguradora_clave=a, aseguradora_nombre=an, aseguradora_nif=nif,
                         aseguradora_situacion=sit, agencia_clave=ag, agencia_nombre=agn)
            for a, an, nif, sit, ag, agn in filas]
