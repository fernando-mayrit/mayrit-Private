"""movimientos_bancarios.ajustes_justif (líneas manuales de ajuste del justificante)

Para cuadrar un apunte de banco cuando además de los recibos hay compensaciones manuales
(p. ej. siniestros compensados con primas, devolución de fees). JSONB: [{"texto", "importe"}].

Revision ID: conta_ajustes_justif_0001
Revises: merge_reconcilia_0001
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "conta_ajustes_justif_0001"
down_revision = "merge_reconcilia_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("movimientos_bancarios")]
    if "ajustes_justif" in cols:
        return
    op.add_column("movimientos_bancarios", sa.Column("ajustes_justif", JSONB))


def downgrade() -> None:
    op.drop_column("movimientos_bancarios", "ajustes_justif")
