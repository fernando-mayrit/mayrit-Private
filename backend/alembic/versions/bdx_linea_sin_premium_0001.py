"""bdx_lineas: sin_premium_motivo (linea de Risk cerrada sin premium: cancelada / otro)

La "prima 0" NO se guarda: se calcula al vuelo (net_premium_to_broker == 0). Esta columna solo
almacena el cierre MANUAL de una linea sin premium (p. ej. un riesgo cancelado en un Risk posterior).

Revision ID: bdx_linea_sin_premium_0001
Revises: binder_seccion_tpa_drop_0001
Create Date: 2026-07-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bdx_linea_sin_premium_0001'
down_revision: Union[str, Sequence[str], None] = 'binder_seccion_tpa_drop_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("bdx_lineas", sa.Column("sin_premium_motivo", sa.String(length=40), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("bdx_lineas", "sin_premium_motivo")
