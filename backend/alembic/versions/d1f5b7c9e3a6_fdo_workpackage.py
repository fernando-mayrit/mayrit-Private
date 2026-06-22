"""FDO: campos work_package, fecha_proceso y work_package_status

Revision ID: d1f5b7c9e3a6
Revises: c9e3a5b7d1f4
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1f5b7c9e3a6"
down_revision: Union[str, Sequence[str], None] = "c9e3a5b7d1f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fdos", sa.Column("work_package", sa.String(length=40), nullable=True))
    op.add_column("fdos", sa.Column("fecha_proceso", sa.Date(), nullable=True))
    op.add_column("fdos", sa.Column("work_package_status", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("fdos", "work_package_status")
    op.drop_column("fdos", "fecha_proceso")
    op.drop_column("fdos", "work_package")
