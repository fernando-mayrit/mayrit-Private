"""recibos: columna generada mes_contable_nombre (abreviatura ene..dic)

Revision ID: e6a8c0d2f4b7
Revises: d5f7b9c1e3a6
Create Date: 2026-07-01

Abreviatura del mes contable (ene..dic) para las dinámicas de Excel; coincide con la lista
personalizada de meses de Excel, así ordena cronológicamente (no alfabético).
"""
from alembic import op
import sqlalchemy as sa

revision = "e6a8c0d2f4b7"
down_revision = "d5f7b9c1e3a6"
branch_labels = None
depends_on = None

_EXPR = ("(ARRAY['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])"
         "[EXTRACT(MONTH FROM fecha_contable)::int]")


def upgrade() -> None:
    op.add_column("recibos", sa.Column(
        "mes_contable_nombre", sa.String(length=3),
        sa.Computed(_EXPR, persisted=True), nullable=True))


def downgrade() -> None:
    op.drop_column("recibos", "mes_contable_nombre")
