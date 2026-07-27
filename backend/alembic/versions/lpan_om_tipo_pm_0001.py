"""LPAN de Open Market: el tipo es siempre 'PM' (no AP/RP como en binders)

Revision ID: lpan_om_tipo_pm_0001
Revises: lpan_tipo_pm_a_ap_0001
Create Date: 2026-07-27

La migración anterior (lpan_tipo_pm_a_ap_0001) pasó TODOS los 'PM' a AP/RP por el signo, pero eso
solo vale para binders: en Open Market el tipo de transacción es SIEMPRE 'PM'. Se corrigen los LPAN
de póliza (poliza_id no nulo) dejándolos en 'PM'. Idempotente.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'lpan_om_tipo_pm_0001'
down_revision: Union[str, Sequence[str], None] = 'lpan_tipo_pm_a_ap_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE lpans SET tipo = 'PM' WHERE poliza_id IS NOT NULL AND tipo <> 'PM'")


def downgrade() -> None:
    pass
