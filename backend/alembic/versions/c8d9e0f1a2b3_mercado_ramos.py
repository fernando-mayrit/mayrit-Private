"""mercados: columna ramos (ramos que trabaja cada mercado)

Lista de nombres de ramo (JSON) que trabaja el mercado. Permite, al filtrar un Mercado
con un Ramo ya elegido, mostrar solo los mercados que trabajan ese ramo.

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mercados', sa.Column('ramos', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('mercados', 'ramos')
