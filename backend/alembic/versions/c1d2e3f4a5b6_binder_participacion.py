"""binders.participacion: % del contrato (reaseguro) que lleva Mayrit

Por defecto 100. La suma de participaciones por mercado de cada sección debe igualar
este valor (antes se exigía 100 fijo). Las filas existentes quedan a 100.

Revision ID: c1d2e3f4a5b6
Revises: b9d1f3a5c7e9
Create Date: 2026-06-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b9d1f3a5c7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'binders',
        sa.Column('participacion', sa.Numeric(7, 4), server_default=sa.text('100'), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('binders', 'participacion')
