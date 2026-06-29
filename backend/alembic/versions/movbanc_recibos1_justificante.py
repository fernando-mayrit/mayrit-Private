"""movimientos_bancarios.recibos_ids: recibos que componen el apunte (justificante)

Revision ID: movbanc_recibos1
Revises: a1c3e5b7d9f0
Create Date: 2026-06-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'movbanc_recibos1'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5b7d9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('movimientos_bancarios', sa.Column('recibos_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('movimientos_bancarios', 'recibos_ids')
