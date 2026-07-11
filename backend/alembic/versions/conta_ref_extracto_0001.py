"""movimientos_bancarios.ref_extracto (huella del extracto para deduplicar imports Norma 43)

Revision ID: conta_ref_extracto_0001
Revises: bdx_alias_0001
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "conta_ref_extracto_0001"
down_revision = "bdx_alias_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("movimientos_bancarios")]
    if "ref_extracto" in cols:
        return  # ya creada directamente en prod
    op.add_column("movimientos_bancarios", sa.Column("ref_extracto", sa.String(64)))
    op.create_index("ix_movimientos_bancarios_ref_extracto", "movimientos_bancarios", ["ref_extracto"])


def downgrade() -> None:
    op.drop_index("ix_movimientos_bancarios_ref_extracto", table_name="movimientos_bancarios")
    op.drop_column("movimientos_bancarios", "ref_extracto")
