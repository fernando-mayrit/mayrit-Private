"""bdx_lineas: campos de identificación adicional (coverholder/broker/yoa/umr/invoice)

Revision ID: b2d4f6a8c0e1
Revises: movbanc_transf1
Create Date: 2026-06-29

Algunas plantillas de Risk BDX (p. ej. Axeria/Myrtea) traen por línea el coverholder,
el broker, el YOA, el UMR y el nº de factura. Se promueven a campos propios para
reconocerlos en la importación (antes caían en `extra`).
"""
from alembic import op
import sqlalchemy as sa

revision = "b2d4f6a8c0e1"
down_revision = "movbanc_transf1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bdx_lineas", sa.Column("coverholder_name", sa.String(length=200), nullable=True))
    op.add_column("bdx_lineas", sa.Column("broker_name", sa.String(length=200), nullable=True))
    op.add_column("bdx_lineas", sa.Column("broker_id", sa.String(length=60), nullable=True))
    op.add_column("bdx_lineas", sa.Column("yoa", sa.Integer(), nullable=True))
    op.add_column("bdx_lineas", sa.Column("umr", sa.String(length=60), nullable=True))
    op.add_column("bdx_lineas", sa.Column("invoice_number", sa.String(length=120), nullable=True))


def downgrade() -> None:
    for col in ("invoice_number", "umr", "yoa", "broker_id", "broker_name", "coverholder_name"):
        op.drop_column("bdx_lineas", col)
