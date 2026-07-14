"""credenciales: añadir columna 'grupo' (nivel por encima de categoría)

Revision ID: credenciales_grupo_0001
Revises: credenciales_0001
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'credenciales_grupo_0001'
down_revision: Union[str, Sequence[str], None] = 'credenciales_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("credenciales", sa.Column("grupo", sa.String(length=80), nullable=True))
    op.create_index(op.f("ix_credenciales_grupo"), "credenciales", ["grupo"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_credenciales_grupo"), table_name="credenciales")
    op.drop_column("credenciales", "grupo")
