"""recibos: reconstruir la tabla reflejando SharePoint 'Mayrit - TRecibos'

Ciclo completo prima → impuestos → comisiones (cedida/retenida) → cobro → liquidación a la
Cía → pago de comisión cedida → contable. Se recrea la tabla (solo había recibos de prueba);
se limpian los enlaces de bdx_lineas.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _num(scale=2):
    return sa.Numeric(precision=18 if scale == 2 else 7, scale=scale)


def upgrade() -> None:
    """Upgrade schema."""
    # Soltar el enlace de las líneas y limpiar los recibos de prueba.
    op.drop_constraint('fk_bdx_lineas_recibo_id', 'bdx_lineas', type_='foreignkey')
    op.execute("UPDATE bdx_lineas SET recibo_id = NULL, recibo = NULL")
    op.drop_table('recibos')

    op.create_table(
        'recibos',
        sa.Column('id', sa.Integer(), nullable=False),
        # Enlace app
        sa.Column('binder_id', sa.Integer(), nullable=False),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('anio', sa.Integer(), nullable=False),
        sa.Column('estado', sa.String(length=30), server_default='Emitido', nullable=False),
        # Contexto
        sa.Column('numero', sa.String(length=20), nullable=False),
        sa.Column('referencia', sa.String(length=200), nullable=True),
        sa.Column('nombre_mercado', sa.String(length=300), nullable=True),
        sa.Column('mercado', sa.String(length=300), nullable=True),
        sa.Column('numero_poliza', sa.String(length=120), nullable=True),
        sa.Column('asegurado', sa.String(length=300), nullable=True),
        sa.Column('corredor', sa.String(length=200), nullable=True),
        sa.Column('ramo', sa.String(length=120), nullable=True),
        sa.Column('tipo_poliza', sa.String(length=80), nullable=True),
        sa.Column('produccion', sa.String(length=120), nullable=True),
        sa.Column('fecha_efecto', sa.Date(), nullable=True),
        sa.Column('fecha_vencimiento', sa.Date(), nullable=True),
        sa.Column('yoa', sa.Integer(), nullable=True),
        sa.Column('pago', sa.String(length=40), nullable=True),
        sa.Column('moneda', sa.String(length=10), server_default='EUR', nullable=True),
        sa.Column('prima_neta_poliza', _num(), nullable=True),
        sa.Column('participacion', _num(4), nullable=True),
        sa.Column('recibo_num', sa.Integer(), nullable=True),
        sa.Column('recibos_totales', sa.String(length=40), nullable=True),
        # Importe recibo + impuestos
        sa.Column('fecha_efecto_recibo', sa.Date(), nullable=True),
        sa.Column('fecha_vcto_recibo', sa.Date(), nullable=True),
        sa.Column('prima_neta_recibo', _num(), server_default='0', nullable=False),
        sa.Column('impuestos_porc', _num(4), nullable=True),
        sa.Column('impuestos_sobre_recibo', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('impuestos_sobre_total_porc', _num(4), nullable=True),
        sa.Column('impuestos_sobre_recibo_porc', _num(4), nullable=True),
        sa.Column('otros_impuestos', _num(), server_default='0', nullable=False),
        sa.Column('impuestos_recibo', _num(), server_default='0', nullable=False),
        sa.Column('prima_bruta_recibo', _num(), server_default='0', nullable=False),
        sa.Column('deduccion_total_porc', _num(4), nullable=True),
        sa.Column('deduccion_total', _num(), server_default='0', nullable=False),
        sa.Column('honorarios', _num(), server_default='0', nullable=False),
        # Comisiones
        sa.Column('comision_cedida_porc', _num(4), nullable=True),
        sa.Column('comision_cedida', _num(), server_default='0', nullable=False),
        sa.Column('comision_retenida_porc', _num(4), nullable=True),
        sa.Column('comision_retenida', _num(), server_default='0', nullable=False),
        sa.Column('pagador', sa.String(length=60), nullable=True),
        # Cobro
        sa.Column('prima_adeudada', _num(), server_default='0', nullable=False),
        sa.Column('prima_cobrada', _num(), server_default='0', nullable=False),
        sa.Column('prima_fecha_cobro', sa.Date(), nullable=True),
        sa.Column('comision_retenida_cobrada', _num(), server_default='0', nullable=False),
        sa.Column('comision_retenida_traspasada', _num(), server_default='0', nullable=False),
        sa.Column('comision_fecha_traspaso', sa.Date(), nullable=True),
        sa.Column('comision_pendiente_cobro', _num(), server_default='0', nullable=False),
        # Liquidación
        sa.Column('liquidar', _num(), server_default='0', nullable=False),
        sa.Column('liquidar_cobrado', _num(), server_default='0', nullable=False),
        sa.Column('liquidar_pendiente_cobro', _num(), server_default='0', nullable=False),
        sa.Column('liquidar_liquidado', _num(), server_default='0', nullable=False),
        sa.Column('liquidar_fecha_liquidacion', sa.Date(), nullable=True),
        # Comisión cedida — pago
        sa.Column('comision_cedida_a_pagar', _num(), server_default='0', nullable=False),
        sa.Column('comision_cedida_pagada', _num(), server_default='0', nullable=False),
        sa.Column('comision_cedida_fecha_pago', sa.Date(), nullable=True),
        # Contable
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('cuenta', sa.String(length=120), nullable=True),
        sa.Column('fecha_contable', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['binder_id'], ['binders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('binder_id', 'periodo', name='uq_recibo_binder_periodo'),
    )
    op.create_index(op.f('ix_recibos_numero'), 'recibos', ['numero'])
    op.create_index(op.f('ix_recibos_anio'), 'recibos', ['anio'])
    op.create_index(op.f('ix_recibos_binder_id'), 'recibos', ['binder_id'])

    op.create_foreign_key(
        'fk_bdx_lineas_recibo_id', 'bdx_lineas', 'recibos',
        ['recibo_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema: vuelve a la tabla recibos simple (previa)."""
    op.drop_constraint('fk_bdx_lineas_recibo_id', 'bdx_lineas', type_='foreignkey')
    op.execute("UPDATE bdx_lineas SET recibo_id = NULL, recibo = NULL")
    op.drop_index(op.f('ix_recibos_binder_id'), table_name='recibos')
    op.drop_index(op.f('ix_recibos_anio'), table_name='recibos')
    op.drop_index(op.f('ix_recibos_numero'), table_name='recibos')
    op.drop_table('recibos')

    op.create_table(
        'recibos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('numero', sa.String(length=20), nullable=False),
        sa.Column('anio', sa.Integer(), nullable=False),
        sa.Column('binder_id', sa.Integer(), nullable=False),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('fecha_emision', sa.Date(), nullable=True),
        sa.Column('moneda', sa.String(length=10), server_default='EUR', nullable=True),
        sa.Column('contraparte', sa.String(length=400), nullable=True),
        sa.Column('base_comision', sa.Numeric(18, 2), server_default='0', nullable=False),
        sa.Column('importe', sa.Numeric(18, 2), server_default='0', nullable=False),
        sa.Column('cobrado', sa.Numeric(18, 2), server_default='0', nullable=False),
        sa.Column('estado', sa.String(length=30), server_default='Emitido', nullable=False),
        sa.Column('fecha_cobro', sa.Date(), nullable=True),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['binder_id'], ['binders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('binder_id', 'periodo', name='uq_recibo_binder_periodo'),
    )
    op.create_index(op.f('ix_recibos_numero'), 'recibos', ['numero'])
    op.create_index(op.f('ix_recibos_anio'), 'recibos', ['anio'])
    op.create_index(op.f('ix_recibos_binder_id'), 'recibos', ['binder_id'])
    op.create_foreign_key(
        'fk_bdx_lineas_recibo_id', 'bdx_lineas', 'recibos',
        ['recibo_id'], ['id'], ondelete='SET NULL',
    )
