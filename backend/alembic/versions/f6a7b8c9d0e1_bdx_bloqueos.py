"""bdx: bloqueo de periodos (presentado/cerrado)

Tabla `bdx_bloqueos`: un periodo (mes) de un BDX (Risk/Premium/Claims) de un binder
queda bloqueado → sus líneas no se pueden crear/editar/borrar, solo consultar.

Revision ID: f6a7b8c9d0e1
Revises: d3e4f5a6b7c8
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bdx_bloqueos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('binder_id', sa.Integer(), nullable=False),
        sa.Column('tipo', sa.String(length=20), nullable=False),
        sa.Column('periodo', sa.String(length=7), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['binder_id'], ['binders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('binder_id', 'tipo', 'periodo', name='uq_bdx_bloqueo'),
    )
    op.create_index(op.f('ix_bdx_bloqueos_binder_id'), 'bdx_bloqueos', ['binder_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bdx_bloqueos_binder_id'), table_name='bdx_bloqueos')
    op.drop_table('bdx_bloqueos')
