"""Contabilidad: añade iden + identificador a movimientos_bancarios (Id correlativo por cuenta,
para el alta de movimientos al estilo Access '246.06').

Revision ID: e4f6a8b0d2c5
Revises: d3e5f7a9c1b4
Create Date: 2026-06-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4f6a8b0d2c5'
down_revision: Union[str, Sequence[str], None] = 'd3e5f7a9c1b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('movimientos_bancarios', sa.Column('iden', sa.Integer(), nullable=True))
    op.add_column('movimientos_bancarios', sa.Column('identificador', sa.String(length=40), nullable=True))
    op.add_column('movimientos_bancarios', sa.Column('movimiento_bancario', sa.Boolean(), server_default=sa.text('true'), nullable=False))


def downgrade() -> None:
    op.drop_column('movimientos_bancarios', 'movimiento_bancario')
    op.drop_column('movimientos_bancarios', 'identificador')
    op.drop_column('movimientos_bancarios', 'iden')
