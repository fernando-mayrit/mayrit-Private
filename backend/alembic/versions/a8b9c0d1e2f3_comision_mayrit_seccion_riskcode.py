"""binder: comision_mayrit por seccion y por risk code

Permite que la comisión de Mayrit se fije a nivel de sección y de código de riesgo
(override de la del binder). Jerarquía: risk code -> sección -> binder.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, Sequence[str], None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('binder_secciones', sa.Column('comision_mayrit', sa.Numeric(precision=7, scale=4), nullable=True))
    op.add_column('seccion_risk_codes', sa.Column('comision_mayrit', sa.Numeric(precision=7, scale=4), nullable=True))


def downgrade() -> None:
    op.drop_column('seccion_risk_codes', 'comision_mayrit')
    op.drop_column('binder_secciones', 'comision_mayrit')
