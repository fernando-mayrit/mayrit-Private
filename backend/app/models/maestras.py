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

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
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

    alias: Mapped[str | None] = mapped_column(String(50), index=True)    # alias / código corto (IdMercado)
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


class Ramo(Base):
    """Catálogo de ramos (líneas de negocio). Gestionable: se pueden añadir nuevos."""

    __tablename__ = "ramos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    risk_codes: Mapped[list["RiskCode"]] = relationship(
        back_populates="ramo", cascade="all, delete-orphan", order_by="RiskCode.codigo"
    )


class RiskCode(Base):
    """Risk Code asociado a un Ramo. Un ramo tiene varios; un risk code pertenece a un solo ramo."""

    __tablename__ = "risk_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    ramo_id: Mapped[int] = mapped_column(ForeignKey("ramos.id", ondelete="CASCADE"), index=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # único: no se repite entre ramos
    descripcion: Mapped[str | None] = mapped_column(String(255))

    ramo: Mapped["Ramo"] = relationship(back_populates="risk_codes")


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

    # ── Datos comunes del binder (no por sección) ──
    profit_commission: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    pc_porcentaje: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))   # PC % (si profit_commission)
    pc_gastos: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))       # Gastos % (si profit_commission)
    # Intervalo (Mensual/Trimestral/Semestral/Anual) + plazo en días, por tipo de bordereau
    risk_bdx_intervalo: Mapped[str | None] = mapped_column(String(20))
    risk_bdx_plazo: Mapped[int | None] = mapped_column(Integer)
    premium_bdx_intervalo: Mapped[str | None] = mapped_column(String(20))
    premium_bdx_plazo: Mapped[int | None] = mapped_column(Integer)
    claims_bdx_intervalo: Mapped[str | None] = mapped_column(String(20))
    claims_bdx_plazo: Mapped[int | None] = mapped_column(Integer)
    comision_mayrit: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # comisión Mayrit %
    cuenta_bancaria_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))

    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    productor: Mapped["Productor | None"] = relationship()
    cuenta_bancaria: Mapped["CuentaBancaria | None"] = relationship()
    secciones: Mapped[list["BinderSeccion"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderSeccion.id"
    )
    suplementos: Mapped[list["BinderSuplemento"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderSuplemento.numero"
    )


class BinderSeccion(Base):
    """Sección de un binder: un ramo con su propio conjunto de mercados y participaciones."""

    __tablename__ = "binder_secciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    ramo: Mapped[str | None] = mapped_column(String(120))
    limite_primas: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    notificacion: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))   # % de notificación
    comision: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))       # % comisión de la sección
    sujeto_pc: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    binder: Mapped["Binder"] = relationship(back_populates="secciones")
    mercados: Mapped[list["SeccionMercado"]] = relationship(
        back_populates="seccion", cascade="all, delete-orphan", order_by="SeccionMercado.id"
    )
    risk_codes: Mapped[list["SeccionRiskCode"]] = relationship(
        back_populates="seccion", cascade="all, delete-orphan", order_by="SeccionRiskCode.id"
    )


class BinderSuplemento(Base):
    """Versión del binder. Cada suplemento guarda un SNAPSHOT completo de los términos
    (en JSON) con su número y fecha de efecto. El nº 0 es el alta inicial. La versión
    vigente en una fecha es la de mayor `fecha_efecto` <= esa fecha."""

    __tablename__ = "binder_suplementos"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    numero: Mapped[int] = mapped_column(Integer)               # 0 = alta inicial, 1, 2…
    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)  # cuándo aplica (puede ser retroactiva)
    motivo: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSON)               # copia completa de los términos
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    binder: Mapped["Binder"] = relationship(back_populates="suplementos")


class SeccionMercado(Base):
    """Línea de una sección: un mercado que pone capacidad y su participación (%)."""

    __tablename__ = "seccion_mercados"

    id: Mapped[int] = mapped_column(primary_key=True)
    seccion_id: Mapped[int] = mapped_column(ForeignKey("binder_secciones.id", ondelete="CASCADE"), index=True)
    mercado_id: Mapped[int] = mapped_column(ForeignKey("mercados.id"))
    participacion: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # % de línea

    seccion: Mapped["BinderSeccion"] = relationship(back_populates="mercados")
    mercado: Mapped["Mercado"] = relationship()


class SeccionRiskCode(Base):
    """Risk code elegido en una sección (de los del ramo de esa sección). Una sección, varios."""

    __tablename__ = "seccion_risk_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    seccion_id: Mapped[int] = mapped_column(ForeignKey("binder_secciones.id", ondelete="CASCADE"), index=True)
    codigo: Mapped[str] = mapped_column(String(20))

    seccion: Mapped["BinderSeccion"] = relationship(back_populates="risk_codes")


class CuentaBancaria(Base):
    """Cuenta bancaria (catálogo de Configuración). Se usa, p. ej., en los binders."""

    __tablename__ = "cuentas_bancarias"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    nombre: Mapped[str] = mapped_column(String(160))          # alias/descripción de la cuenta
    banco: Mapped[str | None] = mapped_column(String(160))
    titular: Mapped[str | None] = mapped_column(String(160))
    iban: Mapped[str | None] = mapped_column(String(40))
    swift_bic: Mapped[str | None] = mapped_column(String(20))
    moneda: Mapped[str | None] = mapped_column(String(10))
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
