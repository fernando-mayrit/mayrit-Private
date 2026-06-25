"""lpan_exenciones: grupos de Premium exentos de LPAN (no se liquidan al mercado)

Revision ID: f7b9d1c3e5a8
Revises: e5a7c9f1b3d6
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7b9d1c3e5a8'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9f1b3d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lpan_exenciones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('section', sa.Integer(), nullable=False),
        sa.Column('risk_code', sa.String(length=20), nullable=False),
        sa.Column('motivo', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('binder_id', 'periodo', 'section', 'risk_code', name='uq_lpan_exencion'),
    )


def downgrade() -> None:
    op.drop_table('lpan_exenciones')
