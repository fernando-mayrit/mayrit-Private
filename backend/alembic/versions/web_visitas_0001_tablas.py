"""web_visitas: archivo propio de la analítica de la web pública (Cloudflare Web Analytics)

Cloudflare purga el detalle a los pocos días; estas dos tablas guardan el histórico de Mayrit,
que no caduca: resumen por día + desglose por página/país/dispositivo/navegador/SO/referente.

Revision ID: web_visitas_0001
Revises: pc_valoraciones_0003
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "web_visitas_0001"
down_revision = "pc_valoraciones_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_visitas_dia",
        sa.Column("dia", sa.Date(), primary_key=True),
        sa.Column("visitas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paginas_vistas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actualizado", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "web_visitas_detalle",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dia", sa.Date(), nullable=False),
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("valor", sa.String(300), nullable=False),
        sa.Column("visitas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paginas_vistas", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("dia", "tipo", "valor", name="uq_web_visitas_detalle"),
    )
    op.create_index("ix_web_visitas_detalle_dia", "web_visitas_detalle", ["dia"])
    op.create_index("ix_web_visitas_detalle_tipo", "web_visitas_detalle", ["tipo"])


def downgrade() -> None:
    op.drop_index("ix_web_visitas_detalle_tipo", table_name="web_visitas_detalle")
    op.drop_index("ix_web_visitas_detalle_dia", table_name="web_visitas_detalle")
    op.drop_table("web_visitas_detalle")
    op.drop_table("web_visitas_dia")
