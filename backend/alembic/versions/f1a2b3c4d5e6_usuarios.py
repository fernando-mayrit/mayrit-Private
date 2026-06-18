"""usuarios: tabla de usuarios de la app (identificación)

Lista de usuarios para identificar quién usa la app (sin contraseña; se elige de la lista
o autologin por equipo vía MAYRIT_USUARIO).

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-06-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e0f1a2b3c4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'usuarios',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nombre', sa.String(length=120), nullable=False),
        sa.Column('activa', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_usuarios_nombre', 'usuarios', ['nombre'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_usuarios_nombre', table_name='usuarios')
    op.drop_table('usuarios')
