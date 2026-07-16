"""binder_secciones: quitar tpa (el TPA se asigna en los UCR, no en el binder)

Revierte solo la columna binder_secciones.tpa (siniestros.tpa se mantiene).

Revision ID: binder_seccion_tpa_drop_0001
Revises: ucr_tabla_0001
Create Date: 2026-07-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'binder_seccion_tpa_drop_0001'
down_revision: Union[str, Sequence[str], None] = 'ucr_tabla_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("binder_secciones", "tpa")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("binder_secciones", sa.Column("tpa", sa.String(length=255), nullable=True))
