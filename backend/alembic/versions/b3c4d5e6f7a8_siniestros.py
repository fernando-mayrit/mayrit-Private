"""siniestros (Claims BDX por binder)

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'siniestros',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sp_old_id', sa.Integer(), index=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('section', sa.Integer()),
        sa.Column('yoa', sa.Integer()),
        sa.Column('risk_code', sa.String(20)),
        sa.Column('currency', sa.String(10)),
        sa.Column('certificate', sa.String(120), index=True),
        sa.Column('reference', sa.String(120)),
        sa.Column('insured', sa.String(255)),
        sa.Column('reporting_period', sa.String(60)),
        sa.Column('risk_inception', sa.Date()),
        sa.Column('risk_expiry', sa.Date()),
        sa.Column('description', sa.Text()),
        sa.Column('claim_first_advised', sa.Date()),
        sa.Column('status', sa.String(60)),
        sa.Column('refer', sa.String(120)),
        sa.Column('denial', sa.String(120)),
        sa.Column('claimant', sa.String(255)),
        sa.Column('date_opened', sa.Date()),
        sa.Column('date_closed', sa.Date()),
        sa.Column('ucr', sa.String(120)),
        sa.Column('abogado', sa.String(255)),
        sa.Column('last_bdx_change', sa.Date()),
        sa.Column('ultima_revision', sa.Date()),
        sa.Column('informacion', sa.Text()),
        sa.Column('amount_claimed', sa.Numeric(18, 2)),
        sa.Column('to_pay_indemnity', sa.Numeric(18, 2)),
        sa.Column('to_pay_fees', sa.Numeric(18, 2)),
        sa.Column('paid_indemnity', sa.Numeric(18, 2)),
        sa.Column('paid_fees', sa.Numeric(18, 2)),
        sa.Column('reserves_indemnity', sa.Numeric(18, 2)),
        sa.Column('reserves_fees', sa.Numeric(18, 2)),
        sa.Column('total_indemnity', sa.Numeric(18, 2)),
        sa.Column('total_fees', sa.Numeric(18, 2)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('siniestros')
