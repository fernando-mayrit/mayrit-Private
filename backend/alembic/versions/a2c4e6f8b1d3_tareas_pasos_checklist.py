"""tareas: pasos (checklist) por tarea + su estado por ocurrencia

Revision ID: a2c4e6f8b1d3
Revises: f1a3c5e7b9d2
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2c4e6f8b1d3'
down_revision: Union[str, Sequence[str], None] = 'f1a3c5e7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tareas_pasos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tarea_id', sa.Integer(), sa.ForeignKey('tareas.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('orden', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('titulo', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tareas_pasos_hechos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('paso_id', sa.Integer(), sa.ForeignKey('tareas_pasos.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('fecha_ocurrencia', sa.Date(), nullable=False),
        sa.Column('fecha_hecha', sa.Date(), nullable=False),
        sa.Column('notas', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('paso_id', 'fecha_ocurrencia', name='uq_paso_ocurrencia'),
    )


def downgrade() -> None:
    op.drop_table('tareas_pasos_hechos')
    op.drop_table('tareas_pasos')
