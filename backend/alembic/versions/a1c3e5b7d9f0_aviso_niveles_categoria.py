"""aviso_niveles: override de categoría (alerta/dia) por tipo

Revision ID: a1c3e5b7d9f0
Revises: e4f6a8b0d2c5
Create Date: 2026-06-29

Añade la columna `categoria` (nullable) a aviso_niveles para poder mover un tipo de
aviso entre los cubos «Alertas» y «Avisos» desde la app. NULL = usa el cubo por defecto.
"""
from alembic import op
import sqlalchemy as sa

revision = "a1c3e5b7d9f0"
down_revision = "e4f6a8b0d2c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("aviso_niveles", sa.Column("categoria", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("aviso_niveles", "categoria")
