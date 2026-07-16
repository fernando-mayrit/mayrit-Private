"""siniestros.tpa + binder_secciones.tpa (TPA por seccion, preasigna el del siniestro)

Revision ID: siniestro_tpa_0001
Revises: lpan_pais_0001
Create Date: 2026-07-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'siniestro_tpa_0001'
down_revision: Union[str, Sequence[str], None] = 'lpan_pais_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("siniestros", sa.Column("tpa", sa.String(length=255), nullable=True))
    op.add_column("binder_secciones", sa.Column("tpa", sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("binder_secciones", "tpa")
    op.drop_column("siniestros", "tpa")
