"""inversiones: control de las inversiones de la casa (fondos, depósitos, cuentas remuneradas)

Tres tablas: la inversión (con el origen del dinero, Propio o Primas), sus movimientos de dinero y
sus valoraciones (la foto de cuánto vale a una fecha, tecleada del extracto de la entidad).

Revision ID: inversiones_0001
Revises: web_visitas_0001
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa

revision = "inversiones_0001"
down_revision = "web_visitas_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inv_inversiones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nombre", sa.String(160), nullable=False),
        sa.Column("entidad", sa.String(120)),
        sa.Column("tipo", sa.String(30), nullable=False),
        sa.Column("isin", sa.String(20)),
        sa.Column("referencia", sa.String(60)),
        sa.Column("origen", sa.String(10), nullable=False),
        sa.Column("capital_garantizado", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fecha_alta", sa.Date()),
        sa.Column("fecha_vencimiento", sa.Date()),
        sa.Column("tae_pct", sa.Numeric(7, 4)),
        sa.Column("moneda", sa.String(10), server_default="EUR"),
        sa.Column("estado", sa.String(15), nullable=False, server_default="Abierta"),
        sa.Column("notas", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_inv_inversiones_entidad", "inv_inversiones", ["entidad"])
    op.create_index("ix_inv_inversiones_origen", "inv_inversiones", ["origen"])
    op.create_index("ix_inv_inversiones_fecha_alta", "inv_inversiones", ["fecha_alta"])
    op.create_index("ix_inv_inversiones_fecha_vencimiento", "inv_inversiones", ["fecha_vencimiento"])

    op.create_table(
        "inv_movimientos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("inversion_id", sa.Integer(),
                  sa.ForeignKey("inv_inversiones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("importe", sa.Numeric(18, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("participaciones", sa.Numeric(18, 6)),
        sa.Column("interno", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("concepto", sa.String(200)),
        sa.Column("movimiento_bancario_id", sa.Integer(),
                  sa.ForeignKey("movimientos_bancarios.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_inv_movimientos_inversion_id", "inv_movimientos", ["inversion_id"])
    op.create_index("ix_inv_movimientos_fecha", "inv_movimientos", ["fecha"])
    op.create_index("ix_inv_movimientos_tipo", "inv_movimientos", ["tipo"])
    op.create_index("ix_inv_movimientos_movbanc", "inv_movimientos", ["movimiento_bancario_id"])

    op.create_table(
        "inv_valoraciones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("inversion_id", sa.Integer(),
                  sa.ForeignKey("inv_inversiones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("valor", sa.Numeric(18, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("participaciones", sa.Numeric(18, 6)),
        sa.Column("valor_liquidativo", sa.Numeric(18, 6)),
        sa.Column("notas", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("inversion_id", "fecha", name="uq_inv_valoracion_fecha"),
    )
    op.create_index("ix_inv_valoraciones_inversion_id", "inv_valoraciones", ["inversion_id"])
    op.create_index("ix_inv_valoraciones_fecha", "inv_valoraciones", ["fecha"])


def downgrade() -> None:
    op.drop_table("inv_valoraciones")
    op.drop_table("inv_movimientos")
    op.drop_table("inv_inversiones")
