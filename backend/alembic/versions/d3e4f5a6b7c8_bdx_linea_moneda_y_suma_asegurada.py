"""bdx_lineas: renombrar columnas mal tipadas del origen

En SharePoint la columna "Original Currency Premium" trae la MONEDA (EUR), no un importe,
y "Sum Insured Currency" trae el IMPORTE de la suma asegurada (100 %), no un código de moneda.
Se renombran para reflejar el significado real:
  - original_currency_premium (Numeric) -> original_currency (String)
  - sum_insured_currency (String)        -> sum_insured_total (Numeric)

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'bdx_lineas', 'original_currency_premium',
        new_column_name='original_currency',
        type_=sa.String(length=10),
        existing_type=sa.Numeric(18, 2),
        postgresql_using='original_currency_premium::text',
    )
    op.alter_column(
        'bdx_lineas', 'sum_insured_currency',
        new_column_name='sum_insured_total',
        type_=sa.Numeric(18, 2),
        existing_type=sa.String(length=10),
        postgresql_using="NULLIF(replace(sum_insured_currency, ',', '.'), '')::numeric",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'bdx_lineas', 'sum_insured_total',
        new_column_name='sum_insured_currency',
        type_=sa.String(length=10),
        existing_type=sa.Numeric(18, 2),
        postgresql_using='sum_insured_total::text',
    )
    op.alter_column(
        'bdx_lineas', 'original_currency',
        new_column_name='original_currency_premium',
        type_=sa.Numeric(18, 2),
        existing_type=sa.String(length=10),
        postgresql_using="NULLIF(replace(original_currency, ',', '.'), '')::numeric",
    )
