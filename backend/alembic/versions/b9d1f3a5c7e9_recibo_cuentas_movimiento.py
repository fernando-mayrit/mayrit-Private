"""recibos: cuentas bancarias por movimiento (cobro/liquidación/traspaso/pago)

Cada movimiento del recibo registra desde qué cuenta de Mayrit se hace. El traspaso
guarda origen y destino (ambas de Mayrit). Todas nullable.

Revision ID: b9d1f3a5c7e9
Revises: e6f7a8b9c0d1
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b9d1f3a5c7e9'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLS = [
    'cuenta_cobro_id',
    'cuenta_liquidacion_id',
    'cuenta_traspaso_origen_id',
    'cuenta_traspaso_destino_id',
    'cuenta_pago_id',
]


def upgrade() -> None:
    for col in _COLS:
        op.add_column('recibos', sa.Column(col, sa.Integer(), nullable=True))
        op.create_foreign_key(f'fk_recibos_{col}', 'recibos', 'cuentas_bancarias', [col], ['id'])


def downgrade() -> None:
    for col in _COLS:
        op.drop_constraint(f'fk_recibos_{col}', 'recibos', type_='foreignkey')
        op.drop_column('recibos', col)
