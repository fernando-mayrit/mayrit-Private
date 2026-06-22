"""facturación consultoría (día/aviso) + niveles de avisos (semáforo)

Revision ID: a7c9e1f3b5d2
Revises: f3b5d7e9a1c2
Create Date: 2026-06-22

Añade a consultoria_contratos el día de facturación y los días de antelación del aviso,
y crea la tabla aviso_niveles (override de importancia por tipo de aviso).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7c9e1f3b5d2"
down_revision: Union[str, Sequence[str], None] = "f3b5d7e9a1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("consultoria_contratos", sa.Column("dia_facturacion", sa.Integer(), nullable=True))
    op.add_column(
        "consultoria_contratos",
        sa.Column("aviso_dias_antes", sa.Integer(), server_default=sa.text("5"), nullable=False),
    )
    op.create_table(
        "aviso_niveles",
        sa.Column("tipo", sa.String(length=60), primary_key=True),
        sa.Column("nivel", sa.String(length=10), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("aviso_niveles")
    op.drop_column("consultoria_contratos", "aviso_dias_antes")
    op.drop_column("consultoria_contratos", "dia_facturacion")
