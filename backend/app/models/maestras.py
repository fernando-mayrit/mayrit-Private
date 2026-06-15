"""
Fase 1 — Maestras de Mayrit, modeladas sobre el esquema real de SharePoint
(ver docs/esquema_sharepoint.txt). Tres tablas:

  - productores  ← lista 'Mayrit - TCorredores'  (corredores Y agencias, con tipo)
  - mercados     ← lista 'Mayrit - TMercados'    (compañías/sindicatos con capacidad)
  - binders      ← lista 'Mayrit - TBinders'     (binding authority agencia↔mercado)

Convención de migración (strangler fig): cada fila conserva 'sp_old_id', el _OldID
de Access/SharePoint, para poder casar registros durante la convivencia.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base


class Productor(Base):
    """Productor de negocio: corredor o agencia de suscripción (campo 'tipo')."""

    __tablename__ = "productores"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    alias: Mapped[str | None] = mapped_column(String(50), index=True)    # alias / código corto (IdCorredor)
    nombre: Mapped[str] = mapped_column(String(255), index=True)         # NombreCorredor
    tipo: Mapped[str | None] = mapped_column(String(40))                 # Corredor / Agencia de Suscripción
    persona: Mapped[str | None] = mapped_column(String(20))              # Persona física / jurídica

    cif: Mapped[str | None] = mapped_column(String(50))
    domicilio: Mapped[str | None] = mapped_column(String(255))
    codigo_postal: Mapped[str | None] = mapped_column(String(20))
    localidad: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(120))
    pais: Mapped[str | None] = mapped_column(String(120))
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Mercado(Base):
    """Mercado asegurador: compañía o sindicato que pone capacidad de suscripción."""

    __tablename__ = "mercados"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    codigo: Mapped[str | None] = mapped_column(String(50), index=True)   # IdMercado
    nombre: Mapped[str] = mapped_column(String(255), index=True)         # NombreMercado
    id_tipo: Mapped[int | None] = mapped_column(Integer)                 # IdTipo
    tipo_mercado: Mapped[str | None] = mapped_column(String(120))        # TipoMercado
    toba: Mapped[bool] = mapped_column(Boolean, default=False)           # TOBA
    fecha: Mapped[dt.date | None] = mapped_column(Date)                  # Fecha
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Tomador(Base):
    """Tomador de las pólizas (antes 'Clientes'; renombrado para no confundir con las agencias)."""

    __tablename__ = "tomadores"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    nombre: Mapped[str] = mapped_column(String(255), index=True)         # NombreCliente
    tipo: Mapped[str | None] = mapped_column(String(40))                # Persona física / jurídica
    cif: Mapped[str | None] = mapped_column(String(50), index=True)
    domicilio: Mapped[str | None] = mapped_column(String(255))
    codigo_postal: Mapped[str | None] = mapped_column(String(20))
    localidad: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(120))
    pais: Mapped[str | None] = mapped_column(String(120))
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Binder(Base):
    """Binder (binding authority): conecta una agencia (coverholder) con uno o varios mercados."""

    __tablename__ = "binders"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    agreement_number: Mapped[str | None] = mapped_column(String(120), index=True)  # Agreement Number
    umr: Mapped[str | None] = mapped_column(String(120), index=True)     # UMR = "B1634" + Agreement Number

    # Coverholder = la agencia (un Productor de tipo "Agencia de Suscripción")
    productor_id: Mapped[int | None] = mapped_column(ForeignKey("productores.id"))

    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[dt.date | None] = mapped_column(Date)
    estado: Mapped[str | None] = mapped_column(String(60))
    moneda: Mapped[str | None] = mapped_column(String(10))
    yoa: Mapped[str | None] = mapped_column(String(20))                  # Year of Account (año del efecto)
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    productor: Mapped["Productor | None"] = relationship()
    secciones: Mapped[list["BinderSeccion"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderSeccion.id"
    )


class BinderSeccion(Base):
    """Sección de un binder: un ramo con su propio conjunto de mercados y participaciones."""

    __tablename__ = "binder_secciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    ramo: Mapped[str | None] = mapped_column(String(120))
    comision: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))      # % comisión de la sección
    limite_primas: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    binder: Mapped["Binder"] = relationship(back_populates="secciones")
    mercados: Mapped[list["SeccionMercado"]] = relationship(
        back_populates="seccion", cascade="all, delete-orphan", order_by="SeccionMercado.id"
    )


class SeccionMercado(Base):
    """Línea de una sección: un mercado que pone capacidad y su participación (%)."""

    __tablename__ = "seccion_mercados"

    id: Mapped[int] = mapped_column(primary_key=True)
    seccion_id: Mapped[int] = mapped_column(ForeignKey("binder_secciones.id", ondelete="CASCADE"), index=True)
    mercado_id: Mapped[int] = mapped_column(ForeignKey("mercados.id"))
    participacion: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # % de línea

    seccion: Mapped["BinderSeccion"] = relationship(back_populates="mercados")
    mercado: Mapped["Mercado"] = relationship()
