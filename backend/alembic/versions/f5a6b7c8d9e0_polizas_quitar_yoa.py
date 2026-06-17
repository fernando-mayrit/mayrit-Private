"""polizas: quitar columna yoa

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f5a6b7c8d9e0'
down_revision: Union[str, Sequence[str], None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_polizas_yoa'), table_name='polizas')
    op.drop_column('polizas', 'yoa')


def downgrade() -> None:
    op.add_column('polizas', sa.Column('yoa', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_polizas_yoa'), 'polizas', ['yoa'])
