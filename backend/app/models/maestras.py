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

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Productor(Base):
    """Productor de negocio: corredor o agencia de suscripción (campo 'tipo')."""

    __tablename__ = "productores"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    codigo: Mapped[str | None] = mapped_column(String(50), index=True)   # IdCorredor
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
    alias: Mapped[str | None] = mapped_column(String(255))              # Alias
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
    """Binding authority entre una agencia (coverholder) y un mercado asegurador."""

    __tablename__ = "binders"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Identificación
    titulo: Mapped[str] = mapped_column(String(120), index=True)         # Title (código B1634...)
    umr: Mapped[str | None] = mapped_column(String(120), index=True)     # UMR
    agreement_number: Mapped[str | None] = mapped_column(String(120))    # AgreementNumber
    referencia_bar: Mapped[str | None] = mapped_column(String(120))      # ReferenciaBAR

    # Partes (de momento por texto; se enlazarán a productores/mercados más adelante)
    coverholder: Mapped[str | None] = mapped_column(String(255))         # Coverholder (agencia)
    mercado: Mapped[str | None] = mapped_column(String(255))             # Mercado

    # Vigencia y estado
    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[dt.date | None] = mapped_column(Date)
    estado: Mapped[str | None] = mapped_column(String(60))
    yoa: Mapped[str | None] = mapped_column(String(20))                  # Year of Account

    # Económico
    moneda: Mapped[str | None] = mapped_column(String(10))
    limite_primas: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))   # LimitePrimas
    comision: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))          # Comision (%)
    comision_retenida: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # ComisionRetenida (%)
    profit_commission: Mapped[bool] = mapped_column(Boolean, default=False)   # ProfitCommission
    gwp: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))               # GWP
    netto_uw: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))          # NettoUW
    number_policies: Mapped[int | None] = mapped_column(Integer)              # NumberPolicies

    # Ramos / secciones
    ramo: Mapped[str | None] = mapped_column(String(120))
    numero_secciones: Mapped[int | None] = mapped_column(Integer)
    ramo_seccion1: Mapped[str | None] = mapped_column(String(120))
    ramo_seccion2: Mapped[str | None] = mapped_column(String(120))
    ramo_seccion3: Mapped[str | None] = mapped_column(String(120))
    ramo_seccion4: Mapped[str | None] = mapped_column(String(120))

    # Operativa (intervalos/plazos de envío de bordereaux)
    intervalo_risk: Mapped[str | None] = mapped_column(String(60))
    plazo_envio_risk: Mapped[str | None] = mapped_column(String(60))
    intervalo_premium: Mapped[str | None] = mapped_column(String(60))
    plazo_envio_premium: Mapped[str | None] = mapped_column(String(60))
    intervalo_claims: Mapped[str | None] = mapped_column(String(60))
    plazo_envio_claims: Mapped[str | None] = mapped_column(String(60))
    plazo_pago: Mapped[str | None] = mapped_column(String(60))
    cuenta: Mapped[str | None] = mapped_column(String(120))
    claims_bdx: Mapped[str | None] = mapped_column(String(120))

    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
