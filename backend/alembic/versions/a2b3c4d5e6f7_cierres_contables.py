"""cierres_contables: cierre contable mensual

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cierres_contables',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('anio', sa.Integer(), nullable=False, index=True),
        sa.Column('mes', sa.Integer(), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=False),
        sa.Column('usuario', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('anio', 'mes', name='uq_cierre_anio_mes'),
    )


def downgrade() -> None:
    op.drop_table('cierres_contables')
