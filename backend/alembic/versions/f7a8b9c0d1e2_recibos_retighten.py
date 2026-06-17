"""recibos: restaurar el único 1-por-Risk-BDX (binder, periodo)

Revierte el relajado anterior: 1 recibo por Risk BDX = único (binder_id, periodo);
binder_id y periodo vuelven a ser obligatorios. Se mantiene sp_old_id.

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=False)
    op.alter_column('recibos', 'periodo', existing_type=sa.String(length=7), nullable=False)
    op.create_unique_constraint('uq_recibo_binder_periodo', 'recibos', ['binder_id', 'periodo'])


def downgrade() -> None:
    op.drop_constraint('uq_recibo_binder_periodo', 'recibos', type_='unique')
    op.alter_column('recibos', 'periodo', existing_type=sa.String(length=7), nullable=True)
    op.alter_column('recibos', 'binder_id', existing_type=sa.Integer(), nullable=True)
