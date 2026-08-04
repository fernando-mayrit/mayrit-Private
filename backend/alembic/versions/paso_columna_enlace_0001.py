"""tareas_pasos: columna_id (enlace opcional de un paso a una fase/columna de la cuadrícula)

Revision ID: paso_columna_enlace_0001
Revises: binder_hace_lineas_0001
Create Date: 2026-08-04

Añade un enlace OPCIONAL de un paso del checklist a una columna (fase) de la cuadrícula. Si está puesto,
la pastilla de la parrilla refleja ese paso (un solo sitio donde marcar). No toca nada existente: todos
los pasos quedan con columna_id = NULL (sin enlace) y se comportan como hasta ahora.
"""
from alembic import op
import sqlalchemy as sa

revision = "paso_columna_enlace_0001"
down_revision = "binder_hace_lineas_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tareas_pasos", sa.Column("columna_id", sa.Integer(), nullable=True))
    op.create_index("ix_tareas_pasos_columna_id", "tareas_pasos", ["columna_id"])
    op.create_foreign_key("fk_tareas_pasos_columna", "tareas_pasos", "tarea_columnas",
                          ["columna_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_tareas_pasos_columna", "tareas_pasos", type_="foreignkey")
    op.drop_index("ix_tareas_pasos_columna_id", table_name="tareas_pasos")
    op.drop_column("tareas_pasos", "columna_id")
