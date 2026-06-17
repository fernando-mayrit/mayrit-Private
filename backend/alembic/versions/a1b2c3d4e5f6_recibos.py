"""recibos: comisión de Mayrit por Risk BDX (facturación/contabilidad)

Tabla `recibos` (1 por binder+periodo) + columna `recibo_id` en `bdx_lineas` que enlaza
cada línea con su recibo.

Revision ID: a1b2c3d4e5f6
Revises: f6a7b8c9d0e1
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
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
        sa.Column('base_comision', sa.Numeric(precision=18, scale=2), server_default='0', nullable=False),
        sa.Column('importe', sa.Numeric(precision=18, scale=2), server_default='0', nullable=False),
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

    op.add_column('bdx_lineas', sa.Column('recibo_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_bdx_lineas_recibo_id'), 'bdx_lineas', ['recibo_id'])
    op.create_foreign_key(
        'fk_bdx_lineas_recibo_id', 'bdx_lineas', 'recibos',
        ['recibo_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_bdx_lineas_recibo_id', 'bdx_lineas', type_='foreignkey')
    op.drop_index(op.f('ix_bdx_lineas_recibo_id'), table_name='bdx_lineas')
    op.drop_column('bdx_lineas', 'recibo_id')

    op.drop_index(op.f('ix_recibos_binder_id'), table_name='recibos')
    op.drop_index(op.f('ix_recibos_anio'), table_name='recibos')
    op.drop_index(op.f('ix_recibos_numero'), table_name='recibos')
    op.drop_table('recibos')
