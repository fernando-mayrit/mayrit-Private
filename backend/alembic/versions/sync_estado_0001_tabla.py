"""tabla sync_estado: candado + estado de las sincronizaciones automáticas

Revision ID: sync_estado_0001
Revises: paso_columna_enlace_0001
Create Date: 2026-08-08

Permite que las tareas locales (DGSFP mensual, proyección de ingresos diaria) corran desde CUALQUIER
PC de la oficina encendido sin pisarse: un candado por job (con caducidad) hace que solo uno lo
ejecute. Guarda último intento/OK/error por job.
"""
from alembic import op
import sqlalchemy as sa

revision = "sync_estado_0001"
down_revision = "paso_columna_enlace_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_estado",
        sa.Column("clave", sa.String(length=40), primary_key=True),
        sa.Column("ultimo_intento", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ultimo_ok", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ultimo_error", sa.Text(), nullable=True),
        sa.Column("en_curso", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("host", sa.String(length=120), nullable=True),
        sa.Column("lease_hasta", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sync_estado")
