"""polizas: columna coaseguro_lineas (compañías que comparten nuestra capacidad)

Lista JSON de {mercado, participacion} cuando la póliza es coaseguro nuestro. La suma de
participaciones = Capacidad; cada compañía participa menos que la Capacidad.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd9e0f1a2b3c4'
down_revision: Union[str, Sequence[str], None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('polizas', sa.Column('coaseguro_lineas', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('polizas', 'coaseguro_lineas')
