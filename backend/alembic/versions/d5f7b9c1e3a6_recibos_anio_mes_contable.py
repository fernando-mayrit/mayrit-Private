"""recibos: columnas generadas anio_contable y mes_contable (para dinámicas de Excel)

Revision ID: d5f7b9c1e3a6
Revises: c4e6a8b0d2f1
Create Date: 2026-07-01

Columnas GENERADAS (STORED) derivadas de fecha_contable, para poder segmentar por año/mes en las
dinámicas de Excel sin la agrupación automática de fechas (que se topa y no coge los meses nuevos).
"""
from alembic import op
import sqlalchemy as sa

revision = "d5f7b9c1e3a6"
down_revision = "c4e6a8b0d2f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("recibos", sa.Column(
        "anio_contable", sa.Integer(),
        sa.Computed("EXTRACT(YEAR FROM fecha_contable)::int", persisted=True), nullable=True))
    op.add_column("recibos", sa.Column(
        "mes_contable", sa.Integer(),
        sa.Computed("EXTRACT(MONTH FROM fecha_contable)::int", persisted=True), nullable=True))


def downgrade() -> None:
    op.drop_column("recibos", "mes_contable")
    op.drop_column("recibos", "anio_contable")
