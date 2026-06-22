"""FDO por sección: añade columna `section` a fdos y ajusta la unicidad

El FDO pasa a ser por (binder, sección, risk code). Tablas nuevas y vacías → cambio seguro.

Revision ID: c9e3a5b7d1f4
Revises: b8d2f4a6c0e3
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9e3a5b7d1f4"
down_revision: Union[str, Sequence[str], None] = "b8d2f4a6c0e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fdos", sa.Column("section", sa.Integer(), server_default="0", nullable=False))
    op.drop_constraint("uq_fdo_binder_riskcode", "fdos", type_="unique")
    op.create_unique_constraint("uq_fdo_binder_seccion_riskcode", "fdos", ["binder_id", "section", "risk_code"])


def downgrade() -> None:
    op.drop_constraint("uq_fdo_binder_seccion_riskcode", "fdos", type_="unique")
    op.create_unique_constraint("uq_fdo_binder_riskcode", "fdos", ["binder_id", "risk_code"])
    op.drop_column("fdos", "section")
