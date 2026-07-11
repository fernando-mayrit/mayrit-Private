"""merge de heads: reconcilia repo↔producción

El repo tenía DOS heads que colgaban de `dgsfp_ag_0003`:
  - `manual_secciones_0001`  (crea la tabla del Manual v2)   ← donde apuntaba prod
  - `conta_ref_extracto_0001`(vía bdx_alias_0001: crea bdx_alias y ref_extracto)
Ambas ramas están aplicadas en producción (bdx_alias, ref_extracto y manual_secciones existen). Esta
migración de MERGE las une en un único head, sin operaciones (solo junta la cadena). Tras aplicarla/hacer
stamp, el `alembic_version` de prod queda en este head y el repo tiene una sola cadena.

Revision ID: merge_reconcilia_0001
Revises: manual_secciones_0001, conta_ref_extracto_0001
Create Date: 2026-07-12
"""

revision = "merge_reconcilia_0001"
down_revision = ("manual_secciones_0001", "conta_ref_extracto_0001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
