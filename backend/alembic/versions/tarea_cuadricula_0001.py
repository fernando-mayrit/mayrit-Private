"""Cuadrícula de tareas: tarea_columnas (config editable) + tarea_matriz_manual + siembra 8 columnas

Revision ID: tarea_cuadricula_0001
Revises: dgsfp_informe_0001
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'tarea_cuadricula_0001'
down_revision: Union[str, Sequence[str], None] = 'dgsfp_informe_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = op.create_table(
        "tarea_columnas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("grupo", sa.String(length=30), nullable=False),
        sa.Column("nombre", sa.String(length=40), nullable=False),
        sa.Column("orden", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tipo", sa.String(length=10), nullable=False),
        sa.Column("regla", sa.String(length=20), nullable=True),
        sa.Column("activa", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.create_table(
        "tarea_matriz_manual",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("binder_id", sa.Integer(), sa.ForeignKey("binders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("periodo", sa.String(length=7), nullable=False),
        sa.Column("columna_id", sa.Integer(), sa.ForeignKey("tarea_columnas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hecho", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("binder_id", "periodo", "columna_id", name="uq_tarea_matriz"),
    )
    op.create_index(op.f("ix_tarea_matriz_manual_binder_id"), "tarea_matriz_manual", ["binder_id"])
    op.create_index(op.f("ix_tarea_matriz_manual_columna_id"), "tarea_matriz_manual", ["columna_id"])
    # Siembra de las 8 columnas por defecto (Fernando 2026-08-04): recibido implícito en procesado.
    op.bulk_insert(cols, [
        {"grupo": "Risk", "nombre": "Procesado", "orden": 10, "tipo": "auto", "regla": "risk", "activa": True},
        {"grupo": "Risk", "nombre": "Enviado", "orden": 20, "tipo": "manual", "regla": None, "activa": True},
        {"grupo": "Premium", "nombre": "Procesado", "orden": 30, "tipo": "auto", "regla": "premium", "activa": True},
        {"grupo": "Premium", "nombre": "Cobrado", "orden": 40, "tipo": "auto", "regla": "cobro", "activa": True},
        {"grupo": "Premium", "nombre": "Enviado", "orden": 50, "tipo": "manual", "regla": None, "activa": True},
        {"grupo": "Premium", "nombre": "LPANs", "orden": 60, "tipo": "auto", "regla": "lpan", "activa": True},
        {"grupo": "Claims", "nombre": "Procesado", "orden": 70, "tipo": "auto", "regla": "claims", "activa": True},
        {"grupo": "Claims", "nombre": "Enviado", "orden": 80, "tipo": "manual", "regla": None, "activa": True},
    ])


def downgrade() -> None:
    op.drop_table("tarea_matriz_manual")
    op.drop_table("tarea_columnas")
