"""tareas: categoria + origen (manual/auto) + fecha_fin

Revision ID: f1a3c5e7b9d2
Revises: e7f9a2c4b6d8
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a3c5e7b9d2'
down_revision: Union[str, Sequence[str], None] = 'e7f9a2c4b6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tareas', sa.Column('categoria', sa.String(length=20), nullable=False, server_default='General'))
    op.add_column('tareas', sa.Column('origen', sa.String(length=10), nullable=False, server_default='manual'))
    op.add_column('tareas', sa.Column('fecha_fin', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('tareas', 'fecha_fin')
    op.drop_column('tareas', 'origen')
    op.drop_column('tareas', 'categoria')
