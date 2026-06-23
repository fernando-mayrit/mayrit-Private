"""programas: columna impuestos_locales (impuestos liquidados localmente por la agencia)

Excepción para agencias que liquidan los impuestos de forma directa/local (p. ej. agencias de
suscripción italianas): sus impuestos NO se liquidan a través de Mayrit, así que se EXCLUYEN del
importe 'A Liquidar'. Se activa para el programa 'Heca-RC Profesional'.

Revision ID: c2f5a8b1d3e7
Revises: a7c9e1f3b5d2
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2f5a8b1d3e7'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1f3b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'programas',
        sa.Column('impuestos_locales', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    # Activar la excepción para el programa italiano existente (no-op si no existe).
    op.execute("UPDATE programas SET impuestos_locales = true WHERE nombre = 'Heca-RC Profesional'")


def downgrade() -> None:
    op.drop_column('programas', 'impuestos_locales')
