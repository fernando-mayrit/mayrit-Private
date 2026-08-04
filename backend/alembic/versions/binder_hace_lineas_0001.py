"""binder: hace_risk/premium/claims (qué líneas hace el binder, durable para la cuadrícula de Tareas)

Revision ID: binder_hace_lineas_0001
Revises: tarea_col_binder_0001
Create Date: 2026-08-04

Añade a `binders` tres flags de qué líneas del pipeline hace el binder y los SIEMBRA con el estado de
hoy: True si el binder tiene una tarea AUTO de esa categoría (Risk/Premium/Claims). Así la cuadrícula
deja de depender de que existan las tareas auto (frágiles) y ningún binder desaparece por perderlas.
"""
from alembic import op
import sqlalchemy as sa

revision = "binder_hace_lineas_0001"
down_revision = "tarea_col_binder_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("binders", sa.Column("hace_risk", sa.Boolean(), nullable=True))
    op.add_column("binders", sa.Column("hace_premium", sa.Boolean(), nullable=True))
    op.add_column("binders", sa.Column("hace_claims", sa.Boolean(), nullable=True))
    # Sembrar = copiar la realidad de hoy: hace_<cat> = True si hay tarea auto de esa categoría.
    op.execute(
        """
        UPDATE binders b SET
          hace_risk    = EXISTS (SELECT 1 FROM tareas t WHERE t.binder_id = b.id AND t.origen = 'auto' AND t.categoria = 'Risk'),
          hace_premium = EXISTS (SELECT 1 FROM tareas t WHERE t.binder_id = b.id AND t.origen = 'auto' AND t.categoria = 'Premium'),
          hace_claims  = EXISTS (SELECT 1 FROM tareas t WHERE t.binder_id = b.id AND t.origen = 'auto' AND t.categoria = 'Claims')
        WHERE b.fecha_efecto IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("binders", "hace_claims")
    op.drop_column("binders", "hace_premium")
    op.drop_column("binders", "hace_risk")
