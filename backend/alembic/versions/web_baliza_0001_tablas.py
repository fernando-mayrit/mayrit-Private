"""web_baliza: lo que mide la baliza PROPIA de la web (recorrido, tiempos, búsquedas)

Complementa a `web_visitas_*` (Cloudflare), no la sustituye. Cloudflare cuenta visitas; esto guarda
el recorrido: qué páginas ve cada visita, en qué orden, cuántos segundos y cuánto llega a ver de
cada una, de dónde vino y qué buscó en el diccionario. Hace falta porque la web cambia de página
sin recargar y para Cloudflare todo es una sola página.

Revision ID: web_baliza_0001
Revises: inversiones_0001
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa

revision = "web_baliza_0001"
down_revision = "inversiones_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_sesiones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sesion", sa.String(32), nullable=False, unique=True),
        sa.Column("visitante", sa.String(32), nullable=False, server_default=""),
        sa.Column("huella", sa.String(16), nullable=False, server_default=""),
        sa.Column("dia", sa.Date(), nullable=False),
        sa.Column("inicio", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fin", sa.DateTime(timezone=True), nullable=True),
        sa.Column("segundos", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paginas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("entrada", sa.String(60), nullable=False, server_default=""),
        sa.Column("salida", sa.String(60), nullable=False, server_default=""),
        sa.Column("origen", sa.String(120), nullable=False, server_default=""),
        sa.Column("origen_ruta", sa.String(200), nullable=False, server_default=""),
        sa.Column("campana", sa.String(60), nullable=False, server_default=""),
        sa.Column("medio", sa.String(60), nullable=False, server_default=""),
        sa.Column("fuente", sa.String(60), nullable=False, server_default=""),
        sa.Column("dispositivo", sa.String(20), nullable=False, server_default=""),
        sa.Column("navegador", sa.String(20), nullable=False, server_default=""),
        sa.Column("so", sa.String(20), nullable=False, server_default=""),
        sa.Column("pais", sa.String(2), nullable=False, server_default=""),
        sa.Column("idioma", sa.String(5), nullable=False, server_default=""),
        sa.Column("nuevo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("escribio", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("creado", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_web_sesiones_dia", "web_sesiones", ["dia"])
    op.create_index("ix_web_sesiones_visitante", "web_sesiones", ["visitante"])

    op.create_table(
        "web_eventos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sesion_id", sa.Integer(),
                  sa.ForeignKey("web_sesiones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dia", sa.Date(), nullable=False),
        sa.Column("lote", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("indice", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tipo", sa.String(16), nullable=False),
        sa.Column("valor", sa.String(200), nullable=False, server_default=""),
        sa.Column("detalle", sa.String(40), nullable=False, server_default=""),
        sa.Column("segundos", sa.Integer(), nullable=True),
        sa.Column("pct", sa.Integer(), nullable=True),
        sa.Column("orden", sa.Integer(), nullable=True),
        # Volver a recoger un día ya recogido no puede duplicar ni una fila: esta es la que lo impide.
        sa.UniqueConstraint("sesion_id", "lote", "indice", name="uq_web_eventos_lote"),
    )
    op.create_index("ix_web_eventos_sesion_id", "web_eventos", ["sesion_id"])
    op.create_index("ix_web_eventos_dia_tipo", "web_eventos", ["dia", "tipo"])

    op.create_table(
        "web_baliza_dias",
        sa.Column("dia", sa.Date(), primary_key=True),
        sa.Column("lineas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cerrado", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("actualizado", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("web_baliza_dias")
    op.drop_index("ix_web_eventos_dia_tipo", table_name="web_eventos")
    op.drop_index("ix_web_eventos_sesion_id", table_name="web_eventos")
    op.drop_table("web_eventos")
    op.drop_index("ix_web_sesiones_visitante", table_name="web_sesiones")
    op.drop_index("ix_web_sesiones_dia", table_name="web_sesiones")
    op.drop_table("web_sesiones")
