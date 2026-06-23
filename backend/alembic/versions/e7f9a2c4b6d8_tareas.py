"""tareas: tareas recurrentes manuales enganchadas a un binder (+ tareas_hechas)

Revision ID: e7f9a2c4b6d8
Revises: d4e6f8a1b2c3
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7f9a2c4b6d8'
down_revision: Union[str, Sequence[str], None] = 'd4e6f8a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tareas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('binder_id', sa.Integer(), sa.ForeignKey('binders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('titulo', sa.String(length=200), nullable=False),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('frecuencia', sa.String(length=20), nullable=False),
        sa.Column('intervalo_meses', sa.Integer(), nullable=True),
        sa.Column('fecha_inicio', sa.Date(), nullable=True),
        sa.Column('aviso_dias_antes', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('estado', sa.String(length=20), nullable=False, server_default='Activa'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tareas_hechas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tarea_id', sa.Integer(), sa.ForeignKey('tareas.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('fecha_ocurrencia', sa.Date(), nullable=False),
        sa.Column('fecha_hecha', sa.Date(), nullable=False),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('tarea_id', 'fecha_ocurrencia', name='uq_tarea_ocurrencia'),
    )


def downgrade() -> None:
    op.drop_table('tareas_hechas')
    op.drop_table('tareas')
