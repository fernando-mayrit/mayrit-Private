"""LPAN por sección: añade columna `section` y ajusta la unicidad

La granularidad del LPAN pasa a (fdo, periodo, sección, tipo) porque un mismo risk code puede
aparecer en varias secciones del bordereau. Tablas recién creadas y vacías → cambio seguro.

Revision ID: b8d2f4a6c0e3
Revises: a7c1e3f5b9d2
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8d2f4a6c0e3"
down_revision: Union[str, Sequence[str], None] = "a7c1e3f5b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lpans", sa.Column("section", sa.Integer(), server_default="0", nullable=False))
    op.drop_constraint("uq_lpan_fdo_periodo_tipo", "lpans", type_="unique")
    op.create_unique_constraint("uq_lpan_fdo_periodo_seccion_tipo", "lpans", ["fdo_id", "periodo", "section", "tipo"])


def downgrade() -> None:
    op.drop_constraint("uq_lpan_fdo_periodo_seccion_tipo", "lpans", type_="unique")
    op.create_unique_constraint("uq_lpan_fdo_periodo_tipo", "lpans", ["fdo_id", "periodo", "tipo"])
    op.drop_column("lpans", "section")
