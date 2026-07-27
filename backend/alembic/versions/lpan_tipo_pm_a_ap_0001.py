"""LPAN: corregir el tipo 'PM' (erróneo) a AP/RP según el signo de la prima

Revision ID: lpan_tipo_pm_a_ap_0001
Revises: poliza_mercado_id_0001
Create Date: 2026-07-27

El tipo de transacción de un LPAN es AP (Additional Premium, prima positiva) o RP (Return Premium,
prima negativa) — nunca 'PM'. La generación fijaba 'PM' por defecto, así que 168 LPAN quedaron mal
(todos con prima positiva → AP). El Word ya imprimía AP/RP bien por el signo; solo estaba mal el
campo guardado. Se corrige por el signo de gross_premium (idempotente: tras esto no queda ningún PM).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'lpan_tipo_pm_a_ap_0001'
down_revision: Union[str, Sequence[str], None] = 'poliza_mercado_id_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE lpans SET tipo = CASE WHEN gross_premium < 0 THEN 'RP' ELSE 'AP' END WHERE tipo = 'PM'"
    )


def downgrade() -> None:
    # No se revierte: 'PM' era un valor erróneo, no hay a qué volver.
    pass
