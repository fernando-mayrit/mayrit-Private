"""FDO/LPAN completos: enlazables a binder O póliza, con sp_old_id y datos históricos del TLPAN

Recrea fdos y lpans (estaban vacías) con el esquema ampliado para migrar el listado TLPAN de
SharePoint: binder_id/poliza_id opcionales, sp_old_id (idempotencia), broker refs, signing,
work package, fechas (procesado/sdd/liberado/pagado), status. Se elimina la unicidad estricta
de lpans (datos históricos admiten varias notas por periodo/sección/tipo).

Revision ID: e2a4c6d8f0b1
Revises: d1f5b7c9e3a6
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2a4c6d8f0b1"
down_revision: Union[str, Sequence[str], None] = "d1f5b7c9e3a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("lpans")
    op.drop_table("fdos")

    op.create_table(
        "fdos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sp_old_id", sa.Integer(), nullable=True, index=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("poliza_id", sa.Integer(), sa.ForeignKey("polizas.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("section", sa.Integer(), server_default="0", nullable=False),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("broker_ref1", sa.String(length=120), nullable=True),
        sa.Column("broker_ref2", sa.String(length=120), nullable=True),
        sa.Column("signing_number", sa.String(length=60), nullable=True),
        sa.Column("work_package", sa.String(length=40), nullable=True),
        sa.Column("fecha_proceso", sa.Date(), nullable=True),
        sa.Column("work_package_status", sa.String(length=60), nullable=True),
        sa.Column("fecha_generado", sa.Date(), nullable=True),
        sa.Column("fecha_signing", sa.Date(), nullable=True),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("binder_id", "section", "risk_code", name="uq_fdo_binder_seccion_riskcode"),
    )

    op.create_table(
        "lpans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sp_old_id", sa.Integer(), nullable=True, index=True),
        sa.Column("fdo_id", sa.Integer(), sa.ForeignKey("fdos.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("poliza_id", sa.Integer(), sa.ForeignKey("polizas.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("section", sa.Integer(), server_default="0", nullable=False),
        sa.Column("periodo", sa.String(length=7), nullable=False),
        sa.Column("tipo", sa.String(length=10), server_default="PM", nullable=False),
        sa.Column("num_lineas", sa.Integer(), server_default="0", nullable=False),
        sa.Column("gross_premium", sa.Numeric(18, 2), nullable=True),
        sa.Column("brokerage", sa.Numeric(18, 2), nullable=True),
        sa.Column("tax", sa.Numeric(18, 2), nullable=True),
        sa.Column("net_premium", sa.Numeric(18, 2), nullable=True),
        sa.Column("signing_number", sa.String(length=60), nullable=True),
        sa.Column("work_package", sa.String(length=40), nullable=True),
        sa.Column("broker_ref1", sa.String(length=120), nullable=True),
        sa.Column("broker_ref2", sa.String(length=120), nullable=True),
        sa.Column("sdd", sa.Date(), nullable=True),
        sa.Column("liberado", sa.Date(), nullable=True),
        sa.Column("pagado", sa.Date(), nullable=True),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("fecha", sa.Date(), nullable=True),
        sa.Column("estado", sa.String(length=20), server_default="Generado", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    # Vuelve al esquema previo (mínimo) de la revisión d1f5b7c9e3a6.
    op.drop_table("lpans")
    op.drop_table("fdos")
    op.create_table(
        "fdos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("section", sa.Integer(), server_default="0", nullable=False),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("signing_number", sa.String(length=60), nullable=True),
        sa.Column("work_package", sa.String(length=40), nullable=True),
        sa.Column("fecha_proceso", sa.Date(), nullable=True),
        sa.Column("work_package_status", sa.String(length=60), nullable=True),
        sa.Column("fecha_generado", sa.Date(), nullable=True),
        sa.Column("fecha_signing", sa.Date(), nullable=True),
        sa.Column("moneda", sa.String(length=10), server_default="EUR", nullable=False),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("binder_id", "section", "risk_code", name="uq_fdo_binder_seccion_riskcode"),
    )
    op.create_table(
        "lpans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fdo_id", sa.Integer(), sa.ForeignKey("fdos.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("risk_code", sa.String(length=20), nullable=False),
        sa.Column("section", sa.Integer(), server_default="0", nullable=False),
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
        sa.UniqueConstraint("fdo_id", "periodo", "section", "tipo", name="uq_lpan_fdo_periodo_seccion_tipo"),
    )
