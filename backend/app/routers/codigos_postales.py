"""Endpoint de consulta de códigos postales (datos compartidos con Alea)."""
from fastapi import APIRouter

from .. import codigos_postales as cp

router = APIRouter(prefix="/codigos-postales", tags=["Códigos postales"])


@router.get("/{codigo}")
def consultar(codigo: str):
    """Devuelve las localidades y la provincia de un código postal español."""
    return {"codigo_postal": codigo, "resultados": cp.buscar(codigo)}
