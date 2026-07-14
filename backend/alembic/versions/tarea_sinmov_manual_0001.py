"""tareas_hechas: marca manual 'sin movimiento este mes'

Permite marcar a mano una entrega concreta (mes) de una tarea como "sin movimiento" (no hubo dato ese
mes), para que deje de salir pendiente sin afectar a los meses siguientes.

Revision ID: tarea_sinmov_manual_0001
Revises: credenciales_grupo_0001
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'tarea_sinmov_manual_0001'
down_revision: Union[str, Sequence[str], None] = 'credenciales_grupo_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tareas_hechas",
        sa.Column("sin_movimiento", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tareas_hechas", "sin_movimiento")
