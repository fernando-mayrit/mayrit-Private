"""ucrs: tabla de UCR traida de Access/SharePoint (Mayrit - TUCR)

Revision ID: ucr_tabla_0001
Revises: siniestro_tpa_0001
Create Date: 2026-07-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ucr_tabla_0001'
down_revision: Union[str, Sequence[str], None] = 'siniestro_tpa_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "ucrs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sp_old_id", sa.Integer(), nullable=True),
        sa.Column("titulo", sa.String(length=255), nullable=True),
        sa.Column("coverholder", sa.String(length=255), nullable=True),
        sa.Column("umr", sa.String(length=120), nullable=True),
        sa.Column("section", sa.String(length=40), nullable=True),
        sa.Column("risk_code", sa.String(length=40), nullable=True),
        sa.Column("signing", sa.String(length=120), nullable=True),
        sa.Column("ucr", sa.String(length=120), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("estado", sa.String(length=60), nullable=True),
        sa.Column("tpa", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(op.f("ix_ucrs_sp_old_id"), "ucrs", ["sp_old_id"])
    op.create_index(op.f("ix_ucrs_umr"), "ucrs", ["umr"])
    op.create_index(op.f("ix_ucrs_ucr"), "ucrs", ["ucr"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_ucrs_ucr"), table_name="ucrs")
    op.drop_index(op.f("ix_ucrs_umr"), table_name="ucrs")
    op.drop_index(op.f("ix_ucrs_sp_old_id"), table_name="ucrs")
    op.drop_table("ucrs")
