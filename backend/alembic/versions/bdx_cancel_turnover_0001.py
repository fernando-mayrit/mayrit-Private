"""bdx_lineas: cancellation_reason + turnover

Añade a cada línea de BDX dos columnas del bordereau que casi todas las plantillas traen y que
hasta ahora caían en `extra`:
  - cancellation_reason: motivo de cancelación (texto).
  - turnover: facturación / volumen del riesgo (importe).

Revision ID: bdx_cancel_turnover_0001
Revises: conta_espejo_mid_0001
Create Date: 2026-07-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bdx_cancel_turnover_0001'
down_revision: Union[str, Sequence[str], None] = 'conta_espejo_mid_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('bdx_lineas', sa.Column('cancellation_reason', sa.String(length=200), nullable=True))
    op.add_column('bdx_lineas', sa.Column('turnover', sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('bdx_lineas', 'turnover')
    op.drop_column('bdx_lineas', 'cancellation_reason')
