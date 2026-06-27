"""Contabilidad (Fase 1): tablas movimientos_bancarios + conta_categorias (libro de banco
categorizado, espejo de las listas SharePoint 'Contabilidad - *').

Revision ID: d3e5f7a9c1b4
Revises: c2d4e6f8a1b3
Create Date: 2026-06-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e5f7a9c1b4'
down_revision: Union[str, Sequence[str], None] = 'c2d4e6f8a1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'conta_categorias',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sp_old_id', sa.Integer(), nullable=True),
        sa.Column('concepto', sa.String(length=160), nullable=False),
        sa.Column('grupo', sa.String(length=80), nullable=True),
        sa.Column('tipo', sa.String(length=20), nullable=True),
        sa.Column('cuenta_contable', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('concepto', name='uq_conta_categoria_concepto'),
    )
    op.create_index('ix_conta_categorias_sp_old_id', 'conta_categorias', ['sp_old_id'])
    op.create_index('ix_conta_categorias_concepto', 'conta_categorias', ['concepto'])

    op.create_table(
        'movimientos_bancarios',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sp_old_id', sa.Integer(), nullable=True),
        sa.Column('sp_lista', sa.String(length=60), nullable=True),
        sa.Column('cuenta', sa.String(length=60), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=True),
        sa.Column('anio', sa.Integer(), nullable=True),
        sa.Column('concepto', sa.String(length=160), nullable=True),
        sa.Column('grupo', sa.String(length=80), nullable=True),
        sa.Column('tipo', sa.String(length=20), nullable=True),
        sa.Column('gasto', sa.Numeric(18, 2), server_default=sa.text('0'), nullable=False),
        sa.Column('ingreso', sa.Numeric(18, 2), server_default=sa.text('0'), nullable=False),
        sa.Column('saldo', sa.Numeric(18, 2), nullable=True),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('devengo', sa.Date(), nullable=True),
        sa.Column('tarjeta', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('factura', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('codigo', sa.Text(), nullable=True),
        sa.Column('transferencia_id', sa.Integer(), sa.ForeignKey('transferencias.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('sp_lista', 'sp_old_id', name='uq_movbanc_lista_spid'),
    )
    for col in ('sp_old_id', 'sp_lista', 'cuenta', 'fecha', 'anio', 'concepto', 'grupo', 'tipo', 'transferencia_id'):
        op.create_index(f'ix_movimientos_bancarios_{col}', 'movimientos_bancarios', [col])


def downgrade() -> None:
    op.drop_table('movimientos_bancarios')
    op.drop_table('conta_categorias')
