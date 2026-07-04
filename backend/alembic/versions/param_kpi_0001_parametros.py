"""tabla parametros (clave-valor numérico)

Revision ID: param_kpi_0001
Revises: e6a8c0d2f4b7
Create Date: 2026-07-05

Parámetros sueltos de la app. Primer uso: la proyección de ingresos del presupuesto (celda del
Ppto 2026.xlsx), sincronizada desde el Excel con una herramienta local.
"""
from alembic import op
import sqlalchemy as sa

revision = "param_kpi_0001"
down_revision = "e6a8c0d2f4b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parametros",
        sa.Column("clave", sa.String(length=80), primary_key=True),
        sa.Column("valor", sa.Numeric(18, 2), nullable=True),
        sa.Column("descripcion", sa.String(length=200), nullable=True),
        sa.Column("actualizado", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("parametros")
