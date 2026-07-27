"""polizas.capacidad a Numeric(18,6): la capacidad es una fracción (0.5665 = 56,65%)

Revision ID: poliza_capacidad_prec_0001
Revises: lpan_om_tipo_pm_0001
Create Date: 2026-07-27

La capacidad se guarda como FRACCIÓN sobre el total (0.57 = 57%). Estaba en Numeric(18,2), así que
56,65% (=0.5665) se redondeaba a 0.57 y parecía que no guardaba. Se amplía a 6 decimales para
representar porcentajes con hasta 4 decimales.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'poliza_capacidad_prec_0001'
down_revision: Union[str, Sequence[str], None] = 'lpan_om_tipo_pm_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("polizas", "capacidad", type_=sa.Numeric(18, 6), existing_nullable=True)


def downgrade() -> None:
    op.alter_column("polizas", "capacidad", type_=sa.Numeric(18, 2), existing_nullable=True)
