"""mover fecha_notificacion del binder a cada limite de primas

La fecha de notificación (exceso de límite) es por límite, no por binder. Se elimina la
columna binders.fecha_notificacion (añadida en b9c0d1e2f3a4, sin datos) y se añade
binder_limites.fecha_notificacion.

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, Sequence[str], None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('binder_limites', sa.Column('fecha_notificacion', sa.Date(), nullable=True))
    op.drop_column('binders', 'fecha_notificacion')


def downgrade() -> None:
    op.add_column('binders', sa.Column('fecha_notificacion', sa.Date(), nullable=True))
    op.drop_column('binder_limites', 'fecha_notificacion')
