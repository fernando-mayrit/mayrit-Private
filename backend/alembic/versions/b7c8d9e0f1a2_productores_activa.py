"""productores: columna activa (activo/inactivo)

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a6b7c8d9e0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('productores', sa.Column('activa', sa.Boolean(), server_default=sa.text('true'), nullable=False))


def downgrade() -> None:
    op.drop_column('productores', 'activa')
