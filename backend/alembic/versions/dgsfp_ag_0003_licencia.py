"""dgsfp aseguradoras: licencia_activa

Revision ID: dgsfp_ag_0003
Revises: dgsfp_ag_0002
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "dgsfp_ag_0003"
down_revision = "dgsfp_ag_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dgsfp_aseguradoras", sa.Column("licencia_activa", sa.Boolean, server_default=sa.text("true")))


def downgrade() -> None:
    op.drop_column("dgsfp_aseguradoras", "licencia_activa")
