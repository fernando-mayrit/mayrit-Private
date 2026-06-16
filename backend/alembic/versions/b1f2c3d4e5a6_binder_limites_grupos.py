"""binder: limites de primas como grupos (1..N secciones por grupo)

Saca el Límite de Primas + % de notificación de la sección a su propia tabla
`binder_limites`. Cada sección apunta a un grupo de límite (`limite_id`), que puede
compartir con otras secciones. Permite fijar el límite genérico (un grupo con todas
las secciones), por sección o por subconjuntos.

Migración de datos: cada sección existente conserva su límite creando un grupo propio
(equivale al modo "por sección" de antes).

Revision ID: b1f2c3d4e5a6
Revises: a8ec1d2b6f7e
Create Date: 2026-06-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1f2c3d4e5a6'
down_revision: Union[str, Sequence[str], None] = 'a8ec1d2b6f7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'binder_limites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('binder_id', sa.Integer(), nullable=False),
        sa.Column('limite_primas', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('notificacion', sa.Numeric(precision=7, scale=4), nullable=True),
        sa.ForeignKeyConstraint(['binder_id'], ['binders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_binder_limites_binder_id'), 'binder_limites', ['binder_id'])

    op.add_column('binder_secciones', sa.Column('limite_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_binder_secciones_limite_id'), 'binder_secciones', ['limite_id'])
    op.create_foreign_key(
        'fk_binder_secciones_limite_id', 'binder_secciones', 'binder_limites',
        ['limite_id'], ['id'], ondelete='SET NULL',
    )

    # Datos: un grupo de límite por sección (conserva el límite actual de cada sección).
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, binder_id, limite_primas, notificacion FROM binder_secciones")
    ).fetchall()
    for r in rows:
        lid = conn.execute(
            sa.text(
                "INSERT INTO binder_limites (binder_id, limite_primas, notificacion) "
                "VALUES (:b, :l, :n) RETURNING id"
            ),
            {"b": r.binder_id, "l": r.limite_primas, "n": r.notificacion},
        ).scalar()
        conn.execute(
            sa.text("UPDATE binder_secciones SET limite_id = :lid WHERE id = :sid"),
            {"lid": lid, "sid": r.id},
        )

    op.drop_column('binder_secciones', 'limite_primas')
    op.drop_column('binder_secciones', 'notificacion')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('binder_secciones', sa.Column('limite_primas', sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column('binder_secciones', sa.Column('notificacion', sa.Numeric(precision=7, scale=4), nullable=True))

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE binder_secciones s SET limite_primas = l.limite_primas, "
            "notificacion = l.notificacion FROM binder_limites l WHERE s.limite_id = l.id"
        )
    )

    op.drop_constraint('fk_binder_secciones_limite_id', 'binder_secciones', type_='foreignkey')
    op.drop_index(op.f('ix_binder_secciones_limite_id'), table_name='binder_secciones')
    op.drop_column('binder_secciones', 'limite_id')

    op.drop_index(op.f('ix_binder_limites_binder_id'), table_name='binder_limites')
    op.drop_table('binder_limites')
