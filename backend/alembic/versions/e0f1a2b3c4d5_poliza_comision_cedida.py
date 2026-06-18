"""polizas: columna comision_cedida_porc (reparto de comisión corredor/Mayrit)

% de la comisión total que se lleva el corredor (cedida). La retenida (Mayrit) = total - cedida.
Se usa al emitir para repartir la comisión de cada recibo.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e0f1a2b3c4d5'
down_revision: Union[str, Sequence[str], None] = 'd9e0f1a2b3c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('polizas', sa.Column('comision_cedida_porc', sa.Numeric(7, 4), nullable=True))


def downgrade() -> None:
    op.drop_column('polizas', 'comision_cedida_porc')
