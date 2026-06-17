"""recibos: permitir histórico (varios por binder)

Relaja el modelo para migrar TRecibos (recibos por póliza, varios por binder):
quita el único (binder_id, periodo), hace binder_id/periodo opcionales y añade sp_old_id.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('recibos', sa.Column('sp_old_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_recibos_sp_old_id'), 'recibos', ['sp_old_id'])
    op.drop_constraint('uq_recibo_binder_periodo', 'recibos', type_='unique')
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=True)
    op.alter_column('recibos', 'periodo', existing_type=sa.String(length=7), nullable=True)


def downgrade() -> None:
    op.alter_column('recibos', 'periodo', existing_type=sa.String(length=7), nullable=False)
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint('uq_recibo_binder_periodo', 'recibos', ['binder_id', 'periodo'])
    op.drop_index(op.f('ix_recibos_sp_old_id'), table_name='recibos')
    op.drop_column('recibos', 'sp_old_id')
