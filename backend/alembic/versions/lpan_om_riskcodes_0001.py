"""LPAN OM por risk code: polizas.codigos_riesgo (JSON) + lpans.linea_pct

Revision ID: lpan_om_riskcodes_0001
Revises: poliza_capacidad_prec_0001
Create Date: 2026-07-27

Los LPAN de Open Market se parten por RISK CODE (un LPAN por risk code y periodo). El reparto se
teclea en la póliza (codigos_riesgo = [{codigo, pct}], suman 100). El LPAN guarda linea_pct (la
participación/capacidad, fracción) para sacar la casilla 18 al 100% (gross/linea_pct) en el Word.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'lpan_om_riskcodes_0001'
down_revision: Union[str, Sequence[str], None] = 'poliza_capacidad_prec_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("polizas", sa.Column("codigos_riesgo", sa.JSON(), nullable=True))
    op.add_column("lpans", sa.Column("linea_pct", sa.Numeric(9, 6), nullable=True))


def downgrade() -> None:
    op.drop_column("lpans", "linea_pct")
    op.drop_column("polizas", "codigos_riesgo")
