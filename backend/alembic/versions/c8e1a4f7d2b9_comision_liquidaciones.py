"""comision_liquidaciones: liquidacion mensual de comisiones (Iberian/Wii)

Revision ID: c8e1a4f7d2b9
Revises: b3d5f7a9c2e4
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e1a4f7d2b9'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'comision_liquidaciones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('fuente', sa.String(length=20), nullable=False),
        sa.Column('programa_id', sa.Integer(), sa.ForeignKey('programas.id', ondelete='SET NULL'), nullable=True),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=False),
        sa.Column('comision_premium', sa.Numeric(18, 2), nullable=False, server_default=sa.text('0')),
        sa.Column('comision_definitiva', sa.Numeric(18, 2), nullable=True),
        sa.Column('cedida_pct', sa.Numeric(7, 4), nullable=False, server_default=sa.text('85')),
        sa.Column('retenida_pct', sa.Numeric(7, 4), nullable=False, server_default=sa.text('15')),
        sa.Column('pago1_nombre', sa.String(length=200), nullable=True),
        sa.Column('pago1_importe', sa.Numeric(18, 2), nullable=True),
        sa.Column('pago2_nombre', sa.String(length=200), nullable=True),
        sa.Column('pago2_importe', sa.Numeric(18, 2), nullable=True),
        sa.Column('estado', sa.String(length=20), nullable=False, server_default='Preparado'),
        sa.Column('recibo_id', sa.Integer(), sa.ForeignKey('recibos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('fuente', 'periodo', name='uq_comision_fuente_periodo'),
    )


def downgrade() -> None:
    op.drop_table('comision_liquidaciones')
