"""transferencias: ledger de movimientos de dinero (calca TLiquidaciones)

Revision ID: d4f2a6c9e1b3
Revises: c8e1a4f7d2b9
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f2a6c9e1b3'
down_revision: Union[str, Sequence[str], None] = 'c8e1a4f7d2b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'transferencias',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sp_old_id', sa.Integer(), nullable=True),
        sa.Column('origen', sa.String(length=30), nullable=False),
        sa.Column('tipo', sa.String(length=20), nullable=False),
        sa.Column('subtipo', sa.String(length=20), nullable=False),
        sa.Column('sentido', sa.String(length=10), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=True),
        sa.Column('anio', sa.Integer(), nullable=True),
        sa.Column('periodo', sa.Date(), nullable=True),
        sa.Column('importe', sa.Numeric(18, 2), nullable=False, server_default=sa.text('0')),
        sa.Column('numero_poliza', sa.String(length=120), nullable=True),
        sa.Column('recibo_id', sa.Integer(), sa.ForeignKey('recibos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('recibo_num', sa.String(length=40), nullable=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('siniestro_id', sa.Integer(), sa.ForeignKey('siniestros.id', ondelete='SET NULL'), nullable=True),
        sa.Column('mercado', sa.String(length=200), nullable=True),
        sa.Column('cuenta_origen', sa.String(length=120), nullable=True),
        sa.Column('cuenta_destino', sa.String(length=120), nullable=True),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('manual', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_transferencias_sp_old_id', 'transferencias', ['sp_old_id'])
    op.create_index('ix_transferencias_origen', 'transferencias', ['origen'])
    op.create_index('ix_transferencias_tipo', 'transferencias', ['tipo'])
    op.create_index('ix_transferencias_sentido', 'transferencias', ['sentido'])
    op.create_index('ix_transferencias_fecha', 'transferencias', ['fecha'])
    op.create_index('ix_transferencias_anio', 'transferencias', ['anio'])
    op.create_index('ix_transferencias_numero_poliza', 'transferencias', ['numero_poliza'])
    op.create_index('ix_transferencias_recibo_id', 'transferencias', ['recibo_id'])
    op.create_index('ix_transferencias_binder_id', 'transferencias', ['binder_id'])
    op.create_index('ix_transferencias_siniestro_id', 'transferencias', ['siniestro_id'])


def downgrade() -> None:
    op.drop_table('transferencias')
