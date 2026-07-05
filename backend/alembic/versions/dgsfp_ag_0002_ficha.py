"""dgsfp agencias: ficha manual + estado mixto de vínculos

Revision ID: dgsfp_ag_0002
Revises: dgsfp_ag_0001
Create Date: 2026-07-05

Enriquece dgsfp_agencias con la ficha manual (info de cada MGA, editable) y dgsfp_vinculos con el
estado mixto (activo lo controla el usuario; en_dgsfp/revisar los informa la sync).
"""
from alembic import op
import sqlalchemy as sa

revision = "dgsfp_ag_0002"
down_revision = "dgsfp_ag_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    a = "dgsfp_agencias"
    op.add_column(a, sa.Column("cif", sa.String(30)))
    op.add_column(a, sa.Column("fecha_constitucion", sa.Date))
    op.add_column(a, sa.Column("direccion", sa.String(255)))
    op.add_column(a, sa.Column("cp", sa.String(10)))
    op.add_column(a, sa.Column("localidad", sa.String(120)))
    op.add_column(a, sa.Column("provincia", sa.String(120)))
    op.add_column(a, sa.Column("pais", sa.String(60)))
    op.add_column(a, sa.Column("contacto", sa.String(255)))
    op.add_column(a, sa.Column("telefono", sa.String(60)))
    op.add_column(a, sa.Column("web", sa.String(255)))
    op.add_column(a, sa.Column("productos", sa.Text))
    op.add_column(a, sa.Column("notas", sa.Text))
    op.add_column(a, sa.Column("activo", sa.Boolean, server_default=sa.text("true")))
    op.add_column(a, sa.Column("dudoso", sa.Boolean, server_default=sa.text("false")))
    op.add_column(a, sa.Column("revisado", sa.Boolean, server_default=sa.text("false")))

    v = "dgsfp_vinculos"
    op.add_column(v, sa.Column("en_dgsfp", sa.Boolean, server_default=sa.text("false")))
    op.add_column(v, sa.Column("dgsfp_visto", sa.Date))
    op.add_column(v, sa.Column("revisar", sa.Boolean, server_default=sa.text("false")))
    op.add_column(v, sa.Column("revisar_motivo", sa.String(40)))
    # Los vínculos ya cargados (sync DGSFP inicial) estaban vistos en el registro:
    op.execute("UPDATE dgsfp_vinculos SET en_dgsfp = true WHERE activo = true")


def downgrade() -> None:
    for c in ("en_dgsfp", "dgsfp_visto", "revisar", "revisar_motivo"):
        op.drop_column("dgsfp_vinculos", c)
    for c in ("cif", "fecha_constitucion", "direccion", "cp", "localidad", "provincia", "pais",
              "contacto", "telefono", "web", "productos", "notas", "activo", "dudoso", "revisado"):
        op.drop_column("dgsfp_agencias", c)
