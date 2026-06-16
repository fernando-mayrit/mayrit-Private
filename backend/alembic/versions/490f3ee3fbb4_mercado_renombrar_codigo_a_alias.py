"""mercado: renombrar codigo a alias

Revision ID: 490f3ee3fbb4
Revises: 2cf10c066d9a
Create Date: 2026-06-16 13:05:37.879783

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '490f3ee3fbb4'
down_revision: Union[str, Sequence[str], None] = '2cf10c066d9a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("mercados", "codigo", new_column_name="alias")
    op.execute("ALTER INDEX IF EXISTS ix_mercados_codigo RENAME TO ix_mercados_alias")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER INDEX IF EXISTS ix_mercados_alias RENAME TO ix_mercados_codigo")
    op.alter_column("mercados", "alias", new_column_name="codigo")
