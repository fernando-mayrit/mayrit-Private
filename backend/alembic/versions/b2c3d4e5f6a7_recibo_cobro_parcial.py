"""recibos: cobro parcial (columna `cobrado`)

El cobro del recibo llega con los Premium BDX (que rara vez coinciden con el Risk BDX),
así que se acumula poco a poco. `cobrado` = importe cobrado hasta la fecha.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'recibos',
        sa.Column('cobrado', sa.Numeric(precision=18, scale=2), server_default='0', nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('recibos', 'cobrado')
