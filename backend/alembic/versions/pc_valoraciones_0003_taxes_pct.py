"""pc_valoraciones: + taxes_pct (Taxes del PC como % de GWP, editable, por defecto 0)

Revision ID: pc_valoraciones_0003
Revises: pc_valoraciones_0002
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa

revision = "pc_valoraciones_0003"
down_revision = "pc_valoraciones_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pc_valoraciones", sa.Column("taxes_pct", sa.Numeric(9, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("pc_valoraciones", "taxes_pct")
