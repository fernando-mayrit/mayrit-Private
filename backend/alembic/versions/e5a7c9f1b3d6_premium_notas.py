"""premium_notas: nota libre por mes de Premium de un binder

Revision ID: e5a7c9f1b3d6
Revises: d4f2a6c9e1b3
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5a7c9f1b3d6'
down_revision: Union[str, Sequence[str], None] = 'd4f2a6c9e1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'premium_notas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('nota', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('binder_id', 'periodo', name='uq_premium_nota'),
    )


def downgrade() -> None:
    op.drop_table('premium_notas')
