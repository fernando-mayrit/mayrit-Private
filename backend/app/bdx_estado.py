"""Estado de conciliación de una línea de Risk frente al Premium.

Una línea de Risk está RESUELTA (ni pendiente ni bloquea el cierre de producción) si:
  1. Entró en un Premium (`incluido_en_premium`), o
  2. Su prima a Mayrit es 0 (`net_premium_to_broker == 0`) → nada que cobrar, "Prima 0" (automático), o
  3. Se marcó manualmente como sin premium (`sin_premium_motivo` con valor: Cancelada / Otro).

La "Prima 0" NO se persiste: se deriva al vuelo. El flag manual es INDEPENDIENTE de `incluido_en_premium`,
así que estas líneas NO entran en las sumas de Premium/LPAN/comisiones/recibo.
"""
from __future__ import annotations

from sqlalchemy import and_, func

from .models.maestras import BdxLinea


def es_prima_cero(linea: BdxLinea) -> bool:
    return (linea.net_premium_to_broker or 0) == 0


def estado_premium(linea: BdxLinea) -> tuple[str, str | None]:
    """(estado, motivo): 'en_premium' | 'sin_premium' | 'pendiente'."""
    if linea.incluido_en_premium:
        return ("en_premium", None)
    if linea.sin_premium_motivo:
        return ("sin_premium", linea.sin_premium_motivo)
    if es_prima_cero(linea):
        return ("sin_premium", "Prima 0")
    return ("pendiente", None)


def cond_pendiente_premium():
    """Expresión SQL: la línea está PENDIENTE de Premium (no resuelta por ninguna de las 3 vías)."""
    return and_(
        BdxLinea.incluido_en_premium.is_(False),
        BdxLinea.sin_premium_motivo.is_(None),
        func.coalesce(BdxLinea.net_premium_to_broker, 0) != 0,
    )
