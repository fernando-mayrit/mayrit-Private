"""bdx_lineas: periodo de reporte por linea + marca de premium

Añade a cada línea de BDX:
  - reporting_period_start / reporting_period_end: el periodo va por línea, porque el
    BDX es único por binder y los periodos se distinguen por esta fecha.
  - incluido_en_premium / premium_bdx: la fila entra (o no) en el Premium Bdx y con qué fecha.

Revision ID: c2d3e4f5a6b7
Revises: b1f2c3d4e5a6
Create Date: 2026-06-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'b1f2c3d4e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('bdx_lineas', sa.Column('reporting_period_start', sa.Date(), nullable=True))
    op.add_column('bdx_lineas', sa.Column('reporting_period_end', sa.Date(), nullable=True))
    op.add_column(
        'bdx_lineas',
        sa.Column('incluido_en_premium', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column('bdx_lineas', sa.Column('premium_bdx', sa.Date(), nullable=True))
    op.create_index(
        op.f('ix_bdx_lineas_reporting_period_start'), 'bdx_lineas', ['reporting_period_start']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bdx_lineas_reporting_period_start'), table_name='bdx_lineas')
    op.drop_column('bdx_lineas', 'premium_bdx')
    op.drop_column('bdx_lineas', 'incluido_en_premium')
    op.drop_column('bdx_lineas', 'reporting_period_end')
    op.drop_column('bdx_lineas', 'reporting_period_start')
