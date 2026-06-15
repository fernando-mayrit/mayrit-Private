"""productores: renombrar codigo a alias

Revision ID: 565ebecb10e5
Revises: 76ea4b50d1b1
Create Date: 2026-06-15 22:04:32.921501

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '565ebecb10e5'
down_revision: Union[str, Sequence[str], None] = '76ea4b50d1b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("productores", "codigo", new_column_name="alias")


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column("productores", "alias", new_column_name="codigo")
