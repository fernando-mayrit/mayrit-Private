"""lpans.mercado: grupo de mercado del LPAN OM (partir por Lloyd's / cada compañía)

Revision ID: lpan_mercado_0001
Revises: lpan_om_riskcodes_0001
Create Date: 2026-08-03

En pólizas OM de coaseguro con mercados MIXTOS el LPAN se parte por grupo de mercado: todo lo Lloyd's
junto (mercado = 'Lloyd's') + un LPAN por cada compañía NO Lloyd's (mercado = nombre de la compañía).
Este campo guarda a qué grupo pertenece cada LPAN. NULL en LPAN de binder y en OM de un solo mercado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'lpan_mercado_0001'
down_revision: Union[str, Sequence[str], None] = 'lpan_om_riskcodes_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lpans", sa.Column("mercado", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("lpans", "mercado")
