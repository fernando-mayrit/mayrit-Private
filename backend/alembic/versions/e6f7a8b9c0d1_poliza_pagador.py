"""polizas.pagador: quién paga a Mayrit (Corredor / Tomador)

Corredor: paga neto descontando su comisión cedida (se salda al cobrar).
Tomador: paga el 100% de la prima y luego se paga la comisión al corredor.
Nullable; el histórico sin valor se trata como 'Corredor' (comportamiento previo).

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('polizas', sa.Column('pagador', sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column('polizas', 'pagador')
