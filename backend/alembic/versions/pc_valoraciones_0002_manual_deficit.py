"""pc_valoraciones: + manual (rellenar a mano) y deficit (brought from previous YOAs)

Revision ID: pc_valoraciones_0002
Revises: pc_valoraciones_0001
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa

revision = "pc_valoraciones_0002"
down_revision = "pc_valoraciones_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pc_valoraciones", sa.Column("manual", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("pc_valoraciones", sa.Column("deficit", sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("pc_valoraciones", "deficit")
    op.drop_column("pc_valoraciones", "manual")
