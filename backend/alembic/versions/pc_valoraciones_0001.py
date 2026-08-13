"""tabla pc_valoraciones: valoraciones de Profit Commission en el tiempo

Revision ID: pc_valoraciones_0001
Revises: bdx_prem_inc_0001
Create Date: 2026-08-12

La PC se recalcula año a año bajando el IBNR según se cierra la siniestralidad. Cada valoración es una
columna; al bloquearla se congela un snapshot con las cifras (lo pagado ese año).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "pc_valoraciones_0001"
down_revision = "bdx_prem_inc_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pc_valoraciones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("orden", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fecha", sa.Date(), nullable=True),
        sa.Column("bloqueado", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ibnr_pct", sa.Numeric(9, 4), nullable=True),
        sa.Column("snapshot", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("pc_valoraciones")
