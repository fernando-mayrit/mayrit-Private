"""registro DGSFP: aseguradoras, agencias de suscripción y sus vínculos

Revision ID: dgsfp_ag_0001
Revises: param_kpi_0001
Create Date: 2026-07-05

Reflejo del Registro Público de la DGSFP (solo lectura desde la app). Se sincroniza con una
herramienta local (Playwright); producción solo lee.
"""
from alembic import op
import sqlalchemy as sa

revision = "dgsfp_ag_0001"
down_revision = "param_kpi_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dgsfp_aseguradoras",
        sa.Column("clave", sa.String(10), primary_key=True),
        sa.Column("nombre", sa.String(255), nullable=False),
        sa.Column("nif", sa.String(20)),
        sa.Column("telefono", sa.String(30)),
        sa.Column("situacion", sa.String(40)),
        sa.Column("actualizado", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "dgsfp_agencias",
        sa.Column("clave", sa.String(10), primary_key=True),
        sa.Column("nombre", sa.String(255), nullable=False),
        sa.Column("actualizado", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "dgsfp_vinculos",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("aseguradora_clave", sa.String(10),
                  sa.ForeignKey("dgsfp_aseguradoras.clave", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("agencia_clave", sa.String(10),
                  sa.ForeignKey("dgsfp_agencias.clave", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("activo", sa.Boolean, server_default=sa.text("true")),
        sa.Column("primera_sync", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("ultima_sync", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("fecha_baja", sa.Date),
        sa.UniqueConstraint("aseguradora_clave", "agencia_clave", name="uq_dgsfp_vinculo"),
    )


def downgrade() -> None:
    op.drop_table("dgsfp_vinculos")
    op.drop_table("dgsfp_agencias")
    op.drop_table("dgsfp_aseguradoras")
