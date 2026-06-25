"""lpan: comisión total % para separar LPAN del mismo risk code por comisión

Revision ID: a9c2e4b6d8f1
Revises: f7b9d1c3e5a8
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9c2e4b6d8f1'
down_revision: Union[str, Sequence[str], None] = 'f7b9d1c3e5a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('lpans', sa.Column('comision_pct', sa.Numeric(7, 2), nullable=True))
    op.add_column('lpan_exenciones', sa.Column('comision_pct', sa.Numeric(7, 2), nullable=False, server_default='0'))
    op.drop_constraint('uq_lpan_exencion', 'lpan_exenciones', type_='unique')
    op.create_unique_constraint('uq_lpan_exencion', 'lpan_exenciones',
                                ['binder_id', 'periodo', 'section', 'risk_code', 'comision_pct'])


def downgrade() -> None:
    op.drop_constraint('uq_lpan_exencion', 'lpan_exenciones', type_='unique')
    op.create_unique_constraint('uq_lpan_exencion', 'lpan_exenciones',
                                ['binder_id', 'periodo', 'section', 'risk_code'])
    op.drop_column('lpan_exenciones', 'comision_pct')
    op.drop_column('lpans', 'comision_pct')
