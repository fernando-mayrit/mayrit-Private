"""tareas_pasos: regla de auto-marcado (risk/premium/lpan/claims) por paso

Revision ID: b3d5f7a9c2e4
Revises: a2c4e6f8b1d3
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d5f7a9c2e4'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tareas_pasos', sa.Column('regla_auto', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('tareas_pasos', 'regla_auto')
