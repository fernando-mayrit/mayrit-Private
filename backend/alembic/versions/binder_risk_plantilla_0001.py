"""binders: risk_plantilla (JSONB) — formato del Risk Excel del binder para reproducirlo en el Premium/LPAN

Guarda { hoja, headers: [orden exacto de columnas], por_cabecera: {cabecera -> campo interno | null} }.
Se captura al importar/capturar el Risk Excel del binder. Si es null, el Premium sale en el formato
Lloyd's estandar de 61 columnas (comportamiento actual).

Revision ID: binder_risk_plantilla_0001
Revises: bdx_linea_sin_premium_0001
Create Date: 2026-07-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'binder_risk_plantilla_0001'
down_revision: Union[str, Sequence[str], None] = 'bdx_linea_sin_premium_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("binders", sa.Column("risk_plantilla", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("binders", "risk_plantilla")
