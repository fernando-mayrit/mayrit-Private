"""Índices de rendimiento (solo aceleran lecturas; no tocan datos ni lógica)

Añade índices para los agregados/filtros más frecuentes detectados en la revisión:
  - bdx (binder_id, tipo): casi todos los cálculos de GWP filtran Risk/Premium de un binder.
  - bdx_lineas (premium_bdx): filtros por rango de mes de Premium (recibos premium).
  - recibos (fecha_contable): cierre contable (el beneficio pleno llega al cambiar los
    extract(year/mes) por filtros de rango; el índice es additivo y no estorba).
  - claims_presentaciones (binder_id, periodo_ord): última presentación por binder.

Todos con IF NOT EXISTS para ser idempotente y no fallar si alguno ya existiera.
Reversible: downgrade los elimina. No modifica ninguna fila.

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-21

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDICES = [
    ("ix_bdx_binder_id_tipo", "bdx", "(binder_id, tipo)"),
    ("ix_bdx_lineas_premium_bdx", "bdx_lineas", "(premium_bdx)"),
    ("ix_recibos_fecha_contable", "recibos", "(fecha_contable)"),
    ("ix_claims_presentaciones_binder_id_periodo_ord", "claims_presentaciones", "(binder_id, periodo_ord)"),
]


def upgrade() -> None:
    for nombre, tabla, cols in INDICES:
        op.execute(f'CREATE INDEX IF NOT EXISTS {nombre} ON {tabla} {cols}')


def downgrade() -> None:
    for nombre, _tabla, _cols in INDICES:
        op.execute(f'DROP INDEX IF EXISTS {nombre}')
