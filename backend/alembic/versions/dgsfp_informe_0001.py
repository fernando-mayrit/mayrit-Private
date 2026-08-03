"""dgsfp_informes: informe de cambios de la sync DGSFP en BD (antes fichero local)

Revision ID: dgsfp_informe_0001
Revises: lpan_mercado_0001
Create Date: 2026-08-04

El informe de cambios de cada sincronización del registro DGSFP se guardaba como fichero .md en el
disco del PC que corría la sync → la alerta solo salía en el backend local, nunca en la app de Azure.
Se pasa a la BD para que la alerta ("listado actualizado, informe pendiente") aparezca en producción.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'dgsfp_informe_0001'
down_revision: Union[str, Sequence[str], None] = 'lpan_mercado_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dgsfp_informes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("contenido", sa.Text(), nullable=False),
        sa.Column("revisado", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("creado", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_dgsfp_informes_fecha"), "dgsfp_informes", ["fecha"])


def downgrade() -> None:
    op.drop_index(op.f("ix_dgsfp_informes_fecha"), table_name="dgsfp_informes")
    op.drop_table("dgsfp_informes")
