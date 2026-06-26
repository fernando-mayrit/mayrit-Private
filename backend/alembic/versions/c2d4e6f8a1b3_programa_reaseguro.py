"""programas: flag reaseguro (economia de recibo distinta: Cobro=net_premium_to_broker,
A Liquidar=final_net_premium_uw) para binders de reaseguro (caucion Iberian/Hamilton).

Revision ID: c2d4e6f8a1b3
Revises: b1c3d5e7f9a2
Create Date: 2026-06-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2d4e6f8a1b3'
down_revision: Union[str, Sequence[str], None] = 'b1c3d5e7f9a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('programas', sa.Column('reaseguro', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('programas', 'reaseguro')
