"""binder: fecha_notificacion (dato operativo)

Fecha en que se notificó al mercado al alcanzar el umbral de notificación del
límite de primas. No es un término del binder (no entra en los suplementos).

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a4'
down_revision: Union[str, Sequence[str], None] = 'a8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('binders', sa.Column('fecha_notificacion', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('binders', 'fecha_notificacion')
