"""Tablas FDO y LPAN (notas de pago a Lloyd's por risk code)

- fdos: una Declaración (FDO) por (binder, risk_code), con el signing_number que asigna Xchanging.
- lpans: nota de pago que agrupa las líneas del Premium BDX de un risk code en un periodo, bajo el
  signing de su FDO. Guarda los importes calculados al generarla.

Revision ID: a7c1e3f5b9d2
Revises: e3f4a5b6c7d8
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7c1e3f5b9d2"
down_revision: Union[str, Sequence[str], None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fdos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("signing_number", sa.String(length=60), nullable=True),
        sa.Column("fecha_generado", sa.Date(), nullable=True),
        sa.Column("fecha_signing", sa.Date(), nullable=True),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("binder_id", "risk_code", name="uq_fdo_binder_riskcode"),
    )
    op.create_table(
        "lpans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fdo_id", sa.Integer(), sa.ForeignKey("fdos.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("periodo", sa.String(length=7), nullable=False),
        sa.Column("tipo", sa.String(length=10), server_default="PM", nullable=False),
        sa.Column("num_lineas", sa.Integer(), server_default="0", nullable=False),
        sa.Column("gross_premium", sa.Numeric(18, 2), nullable=True),
        sa.Column("brokerage", sa.Numeric(18, 2), nullable=True),
        sa.Column("tax", sa.Numeric(18, 2), nullable=True),
        sa.Column("net_premium", sa.Numeric(18, 2), nullable=True),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("fecha", sa.Date(), nullable=True),
        sa.Column("estado", sa.String(length=20), server_default="Generado", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("fdo_id", "periodo", "tipo", name="uq_lpan_fdo_periodo_tipo"),
    )


def downgrade() -> None:
    op.drop_table("lpans")
    op.drop_table("fdos")
