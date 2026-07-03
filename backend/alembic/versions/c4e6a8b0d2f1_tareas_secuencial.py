"""tareas: pasos secuenciales (flag por tarea)

Revision ID: c4e6a8b0d2f1
Revises: b2d4f6a8c0e1
Create Date: 2026-07-03

Modo secuencial del checklist de una tarea: cada paso se desbloquea al completar el
anterior (por 'orden'). Columna booleana `secuencial` en `tareas` (por defecto false =
comportamiento actual, todos los pasos disponibles a la vez).
"""
from alembic import op
import sqlalchemy as sa

revision = "c4e6a8b0d2f1"
down_revision = "b2d4f6a8c0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tareas",
        sa.Column("secuencial", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("tareas", "secuencial")
