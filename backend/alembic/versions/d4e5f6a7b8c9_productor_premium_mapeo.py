"""productores: mapeo recordado del Excel de Premium (columnas certificado/importe)

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('productores', sa.Column('premium_col_certificado', sa.String(length=200), nullable=True))
    op.add_column('productores', sa.Column('premium_col_importe', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('productores', 'premium_col_importe')
    op.drop_column('productores', 'premium_col_certificado')
