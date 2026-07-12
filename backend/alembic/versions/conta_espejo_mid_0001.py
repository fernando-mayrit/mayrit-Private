"""movimientos_bancarios.espejo_mid (justificante espejo: otra pata de un traspaso entre cuentas)

El "Ingreso Comisiones" que ENTRA en la cuenta de la sociedad es el mismo dinero que el
"Traspaso Comisiones" que SALE de la cuenta de clientes. Este apunte se justifica con las MISMAS
transferencias/ajustes que el apunte apuntado (espejo_mid); el PDF sale idéntico.

Revision ID: conta_espejo_mid_0001
Revises: conta_ajustes_justif_0001
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "conta_espejo_mid_0001"
down_revision = "conta_ajustes_justif_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("movimientos_bancarios")]
    if "espejo_mid" in cols:
        return
    op.add_column("movimientos_bancarios",
                  sa.Column("espejo_mid", sa.Integer(), sa.ForeignKey("movimientos_bancarios.id", ondelete="SET NULL")))
    op.create_index("ix_movimientos_bancarios_espejo_mid", "movimientos_bancarios", ["espejo_mid"])


def downgrade() -> None:
    op.drop_index("ix_movimientos_bancarios_espejo_mid", table_name="movimientos_bancarios")
    op.drop_column("movimientos_bancarios", "espejo_mid")
