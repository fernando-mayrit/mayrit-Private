"""Modelos ORM de Mayrit. Importa aquí cada modelo para que Alembic los detecte."""
from .maestras import (
    Binder,
    BinderSeccion,
    Credencial,
    CredencialPermiso,
    Mercado,
    Productor,
    Ramo,
    RiskCode,
    SeccionMercado,
    SeccionRiskCode,
    Tomador,
)

__all__ = [
    "Productor",
    "Mercado",
    "Tomador",
    "Ramo",
    "RiskCode",
    "Binder",
    "BinderSeccion",
    "SeccionMercado",
    "SeccionRiskCode",
    "Credencial",
    "CredencialPermiso",
]
