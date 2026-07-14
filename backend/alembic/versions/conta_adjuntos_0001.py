"""contabilidad: adjuntos de movimiento (tickets) + extractos mensuales

Dos tablas nuevas para el flujo de justificantes de gastos:
  - movimiento_adjuntos: ticket/factura escaneado pegado a un movimiento bancario (contenido en BD).
  - extractos_bancarios: extracto mensual del banco (PDF real) por cuenta y mes.

Revision ID: conta_adjuntos_0001
Revises: bdx_cancel_turnover_0001
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'conta_adjuntos_0001'
down_revision: Union[str, Sequence[str], None] = 'bdx_cancel_turnover_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "movimiento_adjuntos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("movimiento_id", sa.Integer(), nullable=False),
        sa.Column("nombre_original", sa.String(length=255), nullable=False),
        sa.Column("mime", sa.String(length=120), nullable=True),
        sa.Column("contenido", sa.LargeBinary(), nullable=False),
        sa.Column("subido_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["movimiento_id"], ["movimientos_bancarios.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_movimiento_adjuntos_movimiento_id"), "movimiento_adjuntos", ["movimiento_id"])

    op.create_table(
        "extractos_bancarios",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cuenta", sa.String(length=60), nullable=False),
        sa.Column("periodo", sa.String(length=7), nullable=False),
        sa.Column("nombre_original", sa.String(length=255), nullable=False),
        sa.Column("mime", sa.String(length=120), nullable=True),
        sa.Column("contenido", sa.LargeBinary(), nullable=False),
        sa.Column("subido_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("cuenta", "periodo", name="uq_extracto_cuenta_periodo"),
    )
    op.create_index(op.f("ix_extractos_bancarios_cuenta"), "extractos_bancarios", ["cuenta"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_extractos_bancarios_cuenta"), table_name="extractos_bancarios")
    op.drop_table("extractos_bancarios")
    op.drop_index(op.f("ix_movimiento_adjuntos_movimiento_id"), table_name="movimiento_adjuntos")
    op.drop_table("movimiento_adjuntos")
