"""Consultoría: tabla consultoria_contratos + recibos.consultoria_id

Revision ID: f3b5d7e9a1c2
Revises: e2a4c6d8f0b1
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3b5d7e9a1c2"
down_revision: Union[str, Sequence[str], None] = "e2a4c6d8f0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "consultoria_contratos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("productor_id", sa.Integer(), sa.ForeignKey("productores.id"), nullable=False),
        sa.Column("concepto", sa.String(length=300)),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("duracion_meses", sa.Integer()),
        sa.Column("frecuencia", sa.String(length=20), nullable=False),
        sa.Column("importe", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("sujeto_impuestos", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("impuestos_porc", sa.Numeric(precision=7, scale=4), server_default=sa.text("21"), nullable=False),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("cuenta_bancaria_id", sa.Integer(), sa.ForeignKey("cuentas_bancarias.id")),
        sa.Column("estado", sa.String(length=20), server_default="Activo", nullable=False),
        sa.Column("notas", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_consultoria_contratos_productor_id", "consultoria_contratos", ["productor_id"])
    op.add_column("recibos", sa.Column("consultoria_id", sa.Integer()))
    op.create_foreign_key(
        "fk_recibos_consultoria_id", "recibos", "consultoria_contratos",
        ["consultoria_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_recibos_consultoria_id", "recibos", ["consultoria_id"])


def downgrade() -> None:
    op.drop_index("ix_recibos_consultoria_id", table_name="recibos")
    op.drop_constraint("fk_recibos_consultoria_id", "recibos", type_="foreignkey")
    op.drop_column("recibos", "consultoria_id")
    op.drop_index("ix_consultoria_contratos_productor_id", table_name="consultoria_contratos")
    op.drop_table("consultoria_contratos")
