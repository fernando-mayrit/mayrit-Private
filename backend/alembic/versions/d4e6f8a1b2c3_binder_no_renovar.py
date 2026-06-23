"""binders: columna no_renovar (binder que no se va a renovar -> fuera del aviso de renovacion)

Marca un binder que no se renovara (p. ej. en run-off). Sigue 'En Vigor' (puede recibir Premium de
primas pasadas) pero deja de salir en el aviso 'Binder por vencer sin renovar'. Se activa para
MA0222HEL.

Revision ID: d4e6f8a1b2c3
Revises: c2f5a8b1d3e7
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e6f8a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c2f5a8b1d3e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'binders',
        sa.Column('no_renovar', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.execute("UPDATE binders SET no_renovar = true WHERE umr = 'B1634MA0222HEL'")


def downgrade() -> None:
    op.drop_column('binders', 'no_renovar')
