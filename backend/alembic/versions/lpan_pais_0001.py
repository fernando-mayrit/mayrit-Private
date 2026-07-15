"""lpans: pais (separar LPAN por pais cuando la seccion tiene IPT distinto, ES/PT)

Revision ID: lpan_pais_0001
Revises: tarea_sinmov_manual_0001
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'lpan_pais_0001'
down_revision: Union[str, Sequence[str], None] = 'tarea_sinmov_manual_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("lpans", sa.Column("pais", sa.String(length=2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("lpans", "pais")
