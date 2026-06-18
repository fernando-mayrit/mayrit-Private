"""claims_presentaciones (snapshots mensuales del Claims BDX)

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'claims_presentaciones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('periodo', sa.String(7), nullable=False, index=True),
        sa.Column('periodo_ord', sa.Integer(), nullable=False, index=True),
        sa.Column('siniestro_id', sa.Integer(), index=True),
        sa.Column('paid_indemnity_acum', sa.Numeric(18, 2)),
        sa.Column('paid_fees_acum', sa.Numeric(18, 2)),
        sa.Column('to_pay_indemnity', sa.Numeric(18, 2)),
        sa.Column('to_pay_fees', sa.Numeric(18, 2)),
        sa.Column('reserves_indemnity', sa.Numeric(18, 2)),
        sa.Column('reserves_fees', sa.Numeric(18, 2)),
        sa.Column('status', sa.String(60)),
        sa.Column('fila_json', sa.Text()),
        sa.Column('fecha_presentacion', sa.Date()),
        sa.Column('usuario', sa.String(120)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('binder_id', 'periodo', 'siniestro_id', name='uq_claims_pres'),
    )


def downgrade() -> None:
    op.drop_table('claims_presentaciones')
