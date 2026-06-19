"""programas: maestra de programas + binders.programa_id

Un Programa es la cadena de binders consecutivos que se comparan entre sí en la
triangulación (p. ej. 'Crouco Beazley' vs 'Crouco QBE'). El vínculo es manual y el
binder lo arrastra al renovar. binders.programa_id es opcional (el histórico queda sin asignar).

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'programas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nombre', sa.String(length=160), nullable=False),
        sa.Column('productor_id', sa.Integer(), sa.ForeignKey('productores.id'), nullable=True),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('activa', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_programas_nombre', 'programas', ['nombre'])

    op.add_column('binders', sa.Column('programa_id', sa.Integer(), nullable=True))
    op.create_index('ix_binders_programa_id', 'binders', ['programa_id'])
    op.create_foreign_key(
        'fk_binders_programa_id', 'binders', 'programas', ['programa_id'], ['id']
    )


def downgrade() -> None:
    op.drop_constraint('fk_binders_programa_id', 'binders', type_='foreignkey')
    op.drop_index('ix_binders_programa_id', table_name='binders')
    op.drop_column('binders', 'programa_id')
    op.drop_index('ix_programas_nombre', table_name='programas')
    op.drop_table('programas')
