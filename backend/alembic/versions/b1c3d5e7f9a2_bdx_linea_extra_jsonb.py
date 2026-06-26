"""bdx_lineas: columna extra (JSONB) para guardar la fila original integra de bordereaux
no estandar (p. ej. caucion Hamilton/CGICE) y no perder ningun dato.

Revision ID: b1c3d5e7f9a2
Revises: a9c2e4b6d8f1
Create Date: 2026-06-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b1c3d5e7f9a2'
down_revision: Union[str, Sequence[str], None] = 'a9c2e4b6d8f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bdx_lineas', sa.Column('extra', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('bdx_lineas', 'extra')
