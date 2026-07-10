"""bdx_alias: mapeo editable de columnas de BDX por programa

Crea la tabla `bdx_alias` (alias de columna definidos por el usuario, por programa
o globales). Además FUSIONA los dos heads que había en el repo (`a1c3e5b7d9f0` y
`dgsfp_ag_0003`) en uno solo. El `upgrade` es idempotente: si la tabla ya existe
(se creó en prod fuera de alembic), no hace nada.

Revision ID: bdx_alias_0001
Revises: a1c3e5b7d9f0, dgsfp_ag_0003
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "bdx_alias_0001"
down_revision = ("a1c3e5b7d9f0", "dgsfp_ag_0003")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "bdx_alias" in sa.inspect(bind).get_table_names():
        return  # ya creada directamente en prod
    op.create_table(
        "bdx_alias",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("programa_id", sa.Integer,
                  sa.ForeignKey("programas.id", ondelete="CASCADE"), index=True),
        sa.Column("tipo", sa.String(10), nullable=False),
        sa.Column("campo", sa.String(60), nullable=False),
        sa.Column("alias_columna", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("programa_id", "tipo", "alias_columna", name="uq_bdx_alias"),
    )


def downgrade() -> None:
    op.drop_table("bdx_alias")
