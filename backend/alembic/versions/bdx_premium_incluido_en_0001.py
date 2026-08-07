"""bdx_lineas.premium_incluido_en: fecha en que se procesa el Premium de la linea

Revision ID: bdx_prem_inc_0001
Revises: sync_estado_0001
Create Date: 2026-08-08

Sella cuando se incluye una linea en su Premium Bdx, para datar el paso auto "Procesar Premium" con la
fecha real del trabajo mensual (antes caia al created_at del Risk, que en ficheros historicos con lineas
adelantadas daba fechas anteriores al propio mes).
"""
from alembic import op
import sqlalchemy as sa

revision = "bdx_prem_inc_0001"
down_revision = "sync_estado_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bdx_lineas", sa.Column("premium_incluido_en", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("bdx_lineas", "premium_incluido_en")
