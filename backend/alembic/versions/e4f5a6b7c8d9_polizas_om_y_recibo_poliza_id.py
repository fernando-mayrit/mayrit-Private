"""polizas (Open Market) + recibo.poliza_id (binder_id pasa a opcional)

Crea la tabla `polizas` (sobre TPolizas) y permite que un recibo sea de un Binder O de una Póliza
(OM): `recibos.binder_id` pasa a NULLABLE y se añade `recibos.poliza_id` (FK).

Revision ID: e4f5a6b7c8d9
Revises: c0d1e2f3a4b5
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, Sequence[str], None] = 'c0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'polizas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sp_old_id', sa.Integer(), nullable=True),
        sa.Column('numero_poliza', sa.String(length=120), nullable=True),
        sa.Column('referencia', sa.String(length=200), nullable=True),
        sa.Column('asegurado', sa.String(length=300), nullable=True),
        sa.Column('corredor', sa.String(length=200), nullable=True),
        sa.Column('ramo', sa.String(length=120), nullable=True),
        sa.Column('mercado', sa.String(length=300), nullable=True),
        sa.Column('produccion', sa.String(length=120), nullable=True),
        sa.Column('tipo_documento', sa.String(length=80), nullable=True),
        sa.Column('estado', sa.String(length=40), nullable=True),
        sa.Column('seguro', sa.String(length=120), nullable=True),
        sa.Column('pago', sa.String(length=40), nullable=True),
        sa.Column('moneda', sa.String(length=10), server_default='EUR', nullable=True),
        sa.Column('fecha_efecto', sa.Date(), nullable=True),
        sa.Column('fecha_vencimiento', sa.Date(), nullable=True),
        sa.Column('yoa', sa.Integer(), nullable=True),
        sa.Column('renovacion_automatica', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('coaseguro', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('limite', sa.Numeric(18, 2), nullable=True),
        sa.Column('franquicia', sa.Numeric(18, 2), nullable=True),
        sa.Column('capacidad', sa.Numeric(18, 2), nullable=True),
        sa.Column('prima_neta', sa.Numeric(18, 2), nullable=True),
        sa.Column('impuestos_porc', sa.Numeric(7, 4), nullable=True),
        sa.Column('impuestos', sa.Numeric(18, 2), nullable=True),
        sa.Column('recargos', sa.Numeric(18, 2), nullable=True),
        sa.Column('prima_total', sa.Numeric(18, 2), nullable=True),
        sa.Column('comision_porc', sa.Numeric(7, 4), nullable=True),
        sa.Column('comision_total', sa.Numeric(18, 2), nullable=True),
        sa.Column('prima_participacion', sa.Numeric(18, 2), nullable=True),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_polizas_sp_old_id'), 'polizas', ['sp_old_id'])
    op.create_index(op.f('ix_polizas_numero_poliza'), 'polizas', ['numero_poliza'])
    op.create_index(op.f('ix_polizas_yoa'), 'polizas', ['yoa'])

    # Recibo: binder_id opcional + poliza_id
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=True)
    op.add_column('recibos', sa.Column('poliza_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_recibos_poliza_id'), 'recibos', ['poliza_id'])
    op.create_foreign_key('fk_recibos_poliza_id', 'recibos', 'polizas', ['poliza_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('fk_recibos_poliza_id', 'recibos', type_='foreignkey')
    op.drop_index(op.f('ix_recibos_poliza_id'), table_name='recibos')
    op.drop_column('recibos', 'poliza_id')
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=False)
    op.drop_index(op.f('ix_polizas_yoa'), table_name='polizas')
    op.drop_index(op.f('ix_polizas_numero_poliza'), table_name='polizas')
    op.drop_index(op.f('ix_polizas_sp_old_id'), table_name='polizas')
    op.drop_table('polizas')
