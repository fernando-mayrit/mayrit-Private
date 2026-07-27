"""polizas.mercado_id: FK al maestro de mercados (para tipo Lloyd's/Compañía en LPAN OM)

Revision ID: poliza_mercado_id_0001
Revises: binder_risk_plantilla_0001
Create Date: 2026-07-27

Añade polizas.mercado_id → mercados.id. La columna `mercado` es texto libre traído de
SharePoint y coincide EXACTAMENTE con el alias del maestro (verificado: 115/115 casan), así
que se siembra la FK casando `polizas.mercado` con `mercados.alias` (case-insensitive). El
tipo_mercado del maestro decide luego si una póliza OM va por el flujo Lloyd's (FDO+signing).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'poliza_mercado_id_0001'
down_revision: Union[str, Sequence[str], None] = 'binder_risk_plantilla_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("polizas", sa.Column("mercado_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_polizas_mercado_id"), "polizas", ["mercado_id"])
    op.create_foreign_key(
        "fk_polizas_mercado_id", "polizas", "mercados", ["mercado_id"], ["id"], ondelete="SET NULL",
    )
    # Sembrar por alias del maestro (el texto libre de polizas.mercado ES el alias). Solo casa donde
    # hay un único alias que coincide, para no adivinar ante ambigüedades.
    op.execute(
        """
        UPDATE polizas p
           SET mercado_id = m.id
          FROM mercados m
         WHERE lower(btrim(m.alias)) = lower(btrim(p.mercado))
           AND p.mercado IS NOT NULL AND btrim(p.mercado) <> ''
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_polizas_mercado_id", "polizas", type_="foreignkey")
    op.drop_index(op.f("ix_polizas_mercado_id"), table_name="polizas")
    op.drop_column("polizas", "mercado_id")
