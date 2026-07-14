"""gestor de contraseñas: credenciales + permisos de visibilidad

Dos tablas nuevas para el gestor de contraseñas del equipo:
  - credenciales: una entrada por contraseña; el secreto va CIFRADO (Fernet, app/seguridad.py).
  - credencial_permisos: usuarios que pueden ver cada credencial PÚBLICA (buena fe; la privacidad
    entre usuarios no es criptográfica, el cifrado protege el dato en reposo).

Revision ID: credenciales_0001
Revises: conta_adjuntos_0001
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'credenciales_0001'
down_revision: Union[str, Sequence[str], None] = 'conta_adjuntos_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "credenciales",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("propietario", sa.String(length=120), nullable=False),
        sa.Column("titulo", sa.String(length=200), nullable=False),
        sa.Column("categoria", sa.String(length=80), nullable=True),
        sa.Column("usuario", sa.String(length=255), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("secreto_cifrado", sa.Text(), nullable=False),
        sa.Column("visibilidad", sa.String(length=10), server_default=sa.text("'privada'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(op.f("ix_credenciales_propietario"), "credenciales", ["propietario"])
    op.create_index(op.f("ix_credenciales_categoria"), "credenciales", ["categoria"])

    op.create_table(
        "credencial_permisos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credencial_id", sa.Integer(), nullable=False),
        sa.Column("usuario", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["credencial_id"], ["credenciales.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("credencial_id", "usuario", name="uq_credencial_permiso"),
    )
    op.create_index(op.f("ix_credencial_permisos_credencial_id"), "credencial_permisos", ["credencial_id"])
    op.create_index(op.f("ix_credencial_permisos_usuario"), "credencial_permisos", ["usuario"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_credencial_permisos_usuario"), table_name="credencial_permisos")
    op.drop_index(op.f("ix_credencial_permisos_credencial_id"), table_name="credencial_permisos")
    op.drop_table("credencial_permisos")
    op.drop_index(op.f("ix_credenciales_categoria"), table_name="credenciales")
    op.drop_index(op.f("ix_credenciales_propietario"), table_name="credenciales")
    op.drop_table("credenciales")
