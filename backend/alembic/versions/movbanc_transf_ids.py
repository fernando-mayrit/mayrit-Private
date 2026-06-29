"""movimientos_bancarios: renombrar recibos_ids -> transferencia_ids (justificante por transferencias)

Revision ID: movbanc_transf1
Revises: movbanc_recibos1
Create Date: 2026-06-29

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'movbanc_transf1'
down_revision: Union[str, Sequence[str], None] = 'movbanc_recibos1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('movimientos_bancarios', 'recibos_ids', new_column_name='transferencia_ids')


def downgrade() -> None:
    op.alter_column('movimientos_bancarios', 'transferencia_ids', new_column_name='recibos_ids')
