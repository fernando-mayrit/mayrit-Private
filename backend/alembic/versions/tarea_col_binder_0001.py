"""tarea_columna_binder: config por binder de cada columna de la cuadrícula (aplica + desde/hasta)

Revision ID: tarea_col_binder_0001
Revises: tarea_cuadricula_0001
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'tarea_col_binder_0001'
down_revision: Union[str, Sequence[str], None] = 'tarea_cuadricula_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tarea_columna_binder",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("columna_id", sa.Integer(), sa.ForeignKey("tarea_columnas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("aplica", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("desde", sa.String(length=7), nullable=True),
        sa.Column("hasta", sa.String(length=7), nullable=True),
        sa.UniqueConstraint("binder_id", "columna_id", name="uq_tarea_col_binder"),
    )
    op.create_index(op.f("ix_tarea_columna_binder_binder_id"), "tarea_columna_binder", ["binder_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_tarea_columna_binder_binder_id"), table_name="tarea_columna_binder")
    op.drop_table("tarea_columna_binder")
