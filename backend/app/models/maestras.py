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

from sqlalchemy import JSON, Boolean, Computed, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

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
    activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)  # se desactiva al dejar de trabajar con él

    cif: Mapped[str | None] = mapped_column(String(50))
    domicilio: Mapped[str | None] = mapped_column(String(255))
    codigo_postal: Mapped[str | None] = mapped_column(String(20))
    localidad: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(120))
    pais: Mapped[str | None] = mapped_column(String(120))
    notas: Mapped[str | None] = mapped_column(Text)

    # Mapeo recordado del Excel de Premium de esta agencia (nombres de columna del Excel):
    premium_col_certificado: Mapped[str | None] = mapped_column(String(200))
    premium_col_importe: Mapped[str | None] = mapped_column(String(200))

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
    activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)  # se desactiva al dejar de trabajar con él
    ramos: Mapped[list | None] = mapped_column(JSON, default=list)       # ramos (nombres) que trabaja este mercado
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Usuario(Base):
    """Usuario de la app (para identificar quién la usa). Sin login con contraseña: se elige
    de la lista (o autologin por equipo vía MAYRIT_USUARIO)."""

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
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


class Programa(Base):
    """Programa: cadena de binders consecutivos que se comparan entre sí en la triangulación.
    El vínculo es manual (un cambio de mercado/capacidad NO crea programa nuevo); al renovar
    un binder, el nuevo hereda el programa. Distingue, p. ej., 'Crouco Beazley' de 'Crouco QBE'."""

    __tablename__ = "programas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(160), index=True)
    productor_id: Mapped[int | None] = mapped_column(ForeignKey("productores.id"))  # agencia / coverholder
    notas: Mapped[str | None] = mapped_column(Text)
    activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
    # Impuestos liquidados localmente por la agencia (p. ej. agencias italianas): sus impuestos NO
    # se liquidan a través de Mayrit → se EXCLUYEN del importe 'A Liquidar' de sus binders.
    impuestos_locales: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False, nullable=False)
    # Programa de REASEGURO (p. ej. caución Iberian/Hamilton): la economía del recibo es distinta — el
    # Cobro = Net Premium to pay to Reinsurance Broker (net_premium_to_broker) y 'A Liquidar' = Final
    # Net Premium to UW (final_net_premium_uw); hay una capa extra de comisión del reasegurado.
    reaseguro: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False, nullable=False)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    productor: Mapped["Productor | None"] = relationship()


class Binder(Base):
    """Binder (binding authority): conecta una agencia (coverholder) con uno o varios mercados."""

    __tablename__ = "binders"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)
    # Programa al que pertenece (cadena de renovaciones para la triangulación). Manual y opcional.
    programa_id: Mapped[int | None] = mapped_column(ForeignKey("programas.id"), index=True)

    agreement_number: Mapped[str | None] = mapped_column(String(120), index=True)  # Agreement Number
    umr: Mapped[str | None] = mapped_column(String(120), index=True)     # UMR = "B1634" + Agreement Number

    # Coverholder = la agencia (un Productor de tipo "Agencia de Suscripción")
    productor_id: Mapped[int | None] = mapped_column(ForeignKey("productores.id"))

    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[dt.date | None] = mapped_column(Date)
    estado: Mapped[str | None] = mapped_column(String(60))
    # % del contrato (reaseguro) que lleva Mayrit. Por defecto 100. La suma de participaciones
    # por mercado de cada sección debe igualar este valor.
    participacion: Mapped[Decimal] = mapped_column(Numeric(7, 4), server_default=text("100"), default=Decimal("100"))
    # PROVISIONAL (se eliminará): marca binders a los que aún les faltan snapshots de Claims.
    faltan_snapshots: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False, nullable=False)
    # El binder no se va a renovar (run-off): sigue 'En Vigor' pero no sale en el aviso de renovación.
    no_renovar: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False, nullable=False)
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
    programa: Mapped["Programa | None"] = relationship()
    cuenta_bancaria: Mapped["CuentaBancaria | None"] = relationship()
    secciones: Mapped[list["BinderSeccion"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderSeccion.id"
    )
    suplementos: Mapped[list["BinderSuplemento"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderSuplemento.numero"
    )
    limites: Mapped[list["BinderLimite"]] = relationship(
        back_populates="binder", cascade="all, delete-orphan", order_by="BinderLimite.id"
    )


class BinderLimite(Base):
    """Grupo de Límite de Primas: un par (límite + % de notificación) que aplica a UNA o
    VARIAS secciones del binder. Permite fijar el límite de forma genérica (un grupo con
    todas las secciones), por sección (un grupo por sección) o por subconjuntos. La
    producción notificada en los BDX de todas las secciones de un mismo grupo se compara
    contra ese límite (aviso al excederlo — Fase BDX)."""

    __tablename__ = "binder_limites"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    limite_primas: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    notificacion: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))   # % de notificación
    # Dato operativo: fecha en que se notificó al mercado el exceso de este límite.
    fecha_notificacion: Mapped[dt.date | None] = mapped_column(Date)

    binder: Mapped["Binder"] = relationship(back_populates="limites")
    secciones: Mapped[list["BinderSeccion"]] = relationship(back_populates="limite")


class BinderSeccion(Base):
    """Sección de un binder: un ramo con su propio conjunto de mercados y participaciones.
    El Límite de Primas no vive aquí: la sección apunta a un grupo de límite (`BinderLimite`)
    que puede compartir con otras secciones."""

    __tablename__ = "binder_secciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    ramo: Mapped[str | None] = mapped_column(String(120))
    limite_id: Mapped[int | None] = mapped_column(
        ForeignKey("binder_limites.id", ondelete="SET NULL"), index=True
    )
    comision: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))       # % comisión de la sección
    comision_mayrit: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # % comisión Mayrit (override de la del binder)
    sujeto_pc: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    binder: Mapped["Binder"] = relationship(back_populates="secciones")
    limite: Mapped["BinderLimite | None"] = relationship(back_populates="secciones")
    mercados: Mapped[list["SeccionMercado"]] = relationship(
        back_populates="seccion", cascade="all, delete-orphan", order_by="SeccionMercado.id"
    )
    risk_codes: Mapped[list["SeccionRiskCode"]] = relationship(
        back_populates="seccion", cascade="all, delete-orphan", order_by="SeccionRiskCode.id"
    )

    # Compatibilidad de lectura: el límite/notificación efectivos de la sección vienen de su grupo.
    @property
    def limite_primas(self) -> Decimal | None:
        return self.limite.limite_primas if self.limite else None

    @property
    def notificacion(self) -> Decimal | None:
        return self.limite.notificacion if self.limite else None


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
    comision_mayrit: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # % comisión Mayrit (override de la sección)

    seccion: Mapped["BinderSeccion"] = relationship(back_populates="risk_codes")


class CuentaBancaria(Base):
    """Cuenta bancaria (catálogo de Configuración). Se usa, p. ej., en los binders."""

    __tablename__ = "cuentas_bancarias"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    nombre: Mapped[str] = mapped_column(String(160))          # alias/descripción de la cuenta
    categoria: Mapped[str | None] = mapped_column(String(20))  # Primas / Gastos / Siniestros
    banco: Mapped[str | None] = mapped_column(String(160))
    titular: Mapped[str | None] = mapped_column(String(160))
    iban: Mapped[str | None] = mapped_column(String(40))
    swift_bic: Mapped[str | None] = mapped_column(String(20))
    moneda: Mapped[str | None] = mapped_column(String(10))
    notas: Mapped[str | None] = mapped_column(Text)
    # Activa/inactiva: una cuenta inactiva no se puede elegir en ningún sitio (p. ej. binders).
    activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ───────────────────────────────── BDX (bordereaux) ──────────────────────────
class Bdx(Base):
    """Cabecera de un bordereau: una entrega de un periodo de reporte para un binder.
    Risk y Premium comparten estructura (campo `tipo`); Claims va en otra tabla.
    Coverholder/UMR/YOA NO se repiten aquí: salen del binder."""

    __tablename__ = "bdx"
    # El patrón `tipo='Risk'/'Premium' AND binder_id IN (...)` se usa por toda la app (siniestros,
    # binders, avisos, triangulación, contabilidad). El índice compuesto ya existe en la BD (creado en
    # la migración de índices de rendimiento); se declara aquí para que el modelo lo refleje.
    __table_args__ = (Index("ix_bdx_binder_id_tipo", "binder_id", "tipo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(20))                # 'Risk' | 'Premium'
    reporting_period_start: Mapped[dt.date | None] = mapped_column(Date)
    reporting_period_end: Mapped[dt.date | None] = mapped_column(Date)
    estado: Mapped[str | None] = mapped_column(String(40))
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()
    lineas: Mapped[list["BdxLinea"]] = relationship(
        back_populates="bdx", cascade="all, delete-orphan", order_by="BdxLinea.id"
    )


class BdxLinea(Base):
    """Línea de un bordereau Risk/Premium (Lloyd's Coverholder Reporting Standard).
    Columnas 8–77 del estándar + bloque interno de control de cobro/pago (80–90)."""

    __tablename__ = "bdx_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)   # _OldID del origen
    bdx_id: Mapped[int] = mapped_column(ForeignKey("bdx.id", ondelete="CASCADE"), index=True)

    # ── Periodo de reporte (por línea) ──
    # El BDX es único por binder; cada periodo (mensual/trimestral…) se distingue por esta fecha.
    reporting_period_start: Mapped[dt.date | None] = mapped_column(Date, index=True)
    reporting_period_end: Mapped[dt.date | None] = mapped_column(Date)

    # ── Identificación de la línea ──
    section_no: Mapped[int | None] = mapped_column(Integer)
    class_of_business: Mapped[str | None] = mapped_column(String(120))
    risk_code: Mapped[str | None] = mapped_column(String(20))
    type_of_insurance: Mapped[str | None] = mapped_column(String(40))   # Direct / Reinsurance
    certificate_ref: Mapped[str | None] = mapped_column(String(120))

    # ── Asegurado ──
    insured_name: Mapped[str | None] = mapped_column(String(255))
    insured_id: Mapped[str | None] = mapped_column(String(60))
    insured_address: Mapped[str | None] = mapped_column(String(255))
    insured_province: Mapped[str | None] = mapped_column(String(120))
    insured_postcode: Mapped[str | None] = mapped_column(String(20))
    insured_country: Mapped[str | None] = mapped_column(String(80))

    # ── Riesgo ──
    risk_inception_date: Mapped[dt.date | None] = mapped_column(Date)
    risk_expiry_date: Mapped[dt.date | None] = mapped_column(Date)
    location_risk_province: Mapped[str | None] = mapped_column(String(120))
    location_risk_country: Mapped[str | None] = mapped_column(String(80))
    risk_transaction_type: Mapped[str | None] = mapped_column(String(40))   # New/Renewal/Endorsement/Cancellation
    transaction_type: Mapped[str | None] = mapped_column(String(40))        # Original/Additional/Return premium
    effective_date_transaction: Mapped[dt.date | None] = mapped_column(Date)
    expiry_date_transaction: Mapped[dt.date | None] = mapped_column(Date)

    # ── Prima ──
    original_currency: Mapped[str | None] = mapped_column(String(10))   # moneda de la prima (p. ej. EUR)
    gross_written_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    written_line_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    total_gwp_our_line: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    fees: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    commission_coverholder_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    commission_coverholder_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    total_taxes_levies: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    total_gwp_including_tax: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    net_premium_to_broker: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    # ── Suma asegurada / deducible ──
    sum_insured_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))  # suma asegurada 100 %
    sum_insured_our_line: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    deductible_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    deductible_basis: Mapped[str | None] = mapped_column(String(40))

    # ── Impuestos 1–4 (desglosados) ──
    tax1_jurisdiction: Mapped[str | None] = mapped_column(String(120))
    tax1_type: Mapped[str | None] = mapped_column(String(80))
    tax1_taxable_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax1_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    tax1_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax1_administered_by: Mapped[str | None] = mapped_column(String(80))
    tax1_payable_by: Mapped[str | None] = mapped_column(String(80))

    tax2_jurisdiction: Mapped[str | None] = mapped_column(String(120))
    tax2_type: Mapped[str | None] = mapped_column(String(80))
    tax2_taxable_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax2_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    tax2_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax2_administered_by: Mapped[str | None] = mapped_column(String(80))
    tax2_payable_by: Mapped[str | None] = mapped_column(String(80))

    tax3_jurisdiction: Mapped[str | None] = mapped_column(String(120))
    tax3_type: Mapped[str | None] = mapped_column(String(80))
    tax3_taxable_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax3_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    tax3_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax3_administered_by: Mapped[str | None] = mapped_column(String(80))
    tax3_payable_by: Mapped[str | None] = mapped_column(String(80))

    tax4_jurisdiction: Mapped[str | None] = mapped_column(String(120))
    tax4_type: Mapped[str | None] = mapped_column(String(80))
    tax4_taxable_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax4_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    tax4_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax4_administered_by: Mapped[str | None] = mapped_column(String(80))
    tax4_payable_by: Mapped[str | None] = mapped_column(String(80))

    # ── Plazos / Lloyd's / brokerage ──
    instalment_number: Mapped[int | None] = mapped_column(Integer)
    number_of_instalments: Mapped[int | None] = mapped_column(Integer)
    referred_to_london: Mapped[str | None] = mapped_column(String(10))   # Yes/No
    pct_for_lloyds: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    policy_issuance_date: Mapped[dt.date | None] = mapped_column(Date)
    policy_number_reinsured: Mapped[str | None] = mapped_column(String(120))
    brokerage_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    brokerage_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    final_net_premium_uw: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    # ── Identificación adicional (algunas plantillas la traen por línea, p. ej. Axeria/Myrtea) ──
    coverholder_name: Mapped[str | None] = mapped_column(String(200))
    broker_name: Mapped[str | None] = mapped_column(String(200))
    broker_id: Mapped[str | None] = mapped_column(String(60))
    yoa: Mapped[int | None] = mapped_column(Integer)
    umr: Mapped[str | None] = mapped_column(String(60))
    invoice_number: Mapped[str | None] = mapped_column(String(120))

    # ── Premium (subconjunto): la fila entra en el Premium Bdx y con qué fecha ──
    incluido_en_premium: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    premium_bdx: Mapped[dt.date | None] = mapped_column(Date)

    # ── Control interno (no viene en el BDX; gestión de cobro/pago) ──
    prima_cobrada: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    ingresado: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    premium_payment_date: Mapped[dt.date | None] = mapped_column(Date)
    traspaso: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    traspasado: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    fecha_traspaso: Mapped[dt.date | None] = mapped_column(Date)
    liquidado: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    liquidado_uw: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    fecha_liquidacion: Mapped[dt.date | None] = mapped_column(Date)
    recibo: Mapped[str | None] = mapped_column(String(120))   # nº de recibo (texto, para mostrar)
    recibo_id: Mapped[int | None] = mapped_column(
        ForeignKey("recibos.id", ondelete="SET NULL"), index=True
    )
    notas: Mapped[str | None] = mapped_column(Text)
    # Fila original ÍNTEGRA del bordereau de origen (todas sus columnas con su nombre tal cual), para
    # bordereaux con encabezados no estándar (p. ej. caución Hamilton/CGICE): garantiza que no se
    # pierde ningún dato aunque no exista una columna específica donde mapearlo.
    extra: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    bdx: Mapped["Bdx"] = relationship(back_populates="lineas")


class BdxAlias(Base):
    """Alias de columna de BDX definido por el usuario (mapeo editable desde la app). Dice que el título
    de columna `alias_columna` del Excel debe leerse como el campo interno `campo`, para un `tipo` de BDX
    (risk/premium/claims) y opcionalmente un `programa` (NULL = vale para todos, fallback global). Se
    fusiona con el MAPEO base de código al importar, así los programas con plantillas raras se domestican
    desde la UI sin tocar código ni desplegar. La columna sin asignar sigue yendo a `extra` (no se pierde)."""

    __tablename__ = "bdx_alias"
    __table_args__ = (UniqueConstraint("programa_id", "tipo", "alias_columna", name="uq_bdx_alias"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    programa_id: Mapped[int | None] = mapped_column(
        ForeignKey("programas.id", ondelete="CASCADE"), index=True)   # NULL = alias global
    tipo: Mapped[str] = mapped_column(String(10))            # risk | premium | claims
    campo: Mapped[str] = mapped_column(String(60))           # campo interno destino (clave del MAPEO)
    alias_columna: Mapped[str] = mapped_column(String(200))  # título de columna del Excel tal cual
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BdxBloqueo(Base):
    """Bloqueo de un periodo (mes) de un BDX de un binder.

    Cuando un periodo está bloqueado se considera el bordereau de ese periodo ya
    presentado/cerrado: sus líneas no se pueden crear, editar ni borrar (solo
    consultar). Se identifica por (binder, tipo de BDX, mes 'YYYY-MM') para casar
    con la pestaña Bloqueo, donde se bloquea por columna (Risk/Premium/Claims) y mes.
    """

    __tablename__ = "bdx_bloqueos"
    __table_args__ = (UniqueConstraint("binder_id", "tipo", "periodo", name="uq_bdx_bloqueo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(20))   # 'risk' | 'premium' | 'claims'
    periodo: Mapped[str] = mapped_column(String(7))  # 'YYYY-MM'
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PremiumNota(Base):
    """Nota libre de UN mes de Premium de un binder (binder + periodo 'YYYY-MM'). Para apuntar cosas
    del cierre/liquidación de ese mes (p. ej. 'riesgos no liquidados al mercado')."""

    __tablename__ = "premium_notas"
    __table_args__ = (UniqueConstraint("binder_id", "periodo", name="uq_premium_nota"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    periodo: Mapped[str] = mapped_column(String(7))   # 'YYYY-MM'
    nota: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LpanExencion(Base):
    """Grupo de Premium (binder + periodo + sección + risk code) marcado como EXENTO de LPAN: una
    decisión explícita de que esas primas NO se liquidan al mercado, así que no se espera LPAN. Sirve
    para que el mes no salga como pendiente sin confundirlo con un LPAN realmente por hacer."""

    __tablename__ = "lpan_exenciones"
    __table_args__ = (UniqueConstraint("binder_id", "periodo", "section", "risk_code", "comision_pct", name="uq_lpan_exencion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    periodo: Mapped[str] = mapped_column(String(7))   # 'YYYY-MM'
    section: Mapped[int] = mapped_column(Integer)
    risk_code: Mapped[str] = mapped_column(String(20))
    comision_pct: Mapped[Decimal] = mapped_column(Numeric(7, 2), server_default="0")  # comisión total % del grupo
    motivo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Fdo(Base):
    """FDO (Declaración) que se envía a Xchanging por cada (binder, risk code). Xchanging devuelve un
    `signing_number`; a partir de ahí los LPAN de ese risk code cuelgan de ese signing."""

    __tablename__ = "fdos"
    __table_args__ = (UniqueConstraint("binder_id", "section", "risk_code", name="uq_fdo_binder_seccion_riskcode"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)  # Id del elemento en SharePoint (idempotencia)
    # Apunta a un binder O a una póliza OM (uno de los dos).
    binder_id: Mapped[int | None] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    poliza_id: Mapped[int | None] = mapped_column(ForeignKey("polizas.id", ondelete="SET NULL"), index=True)
    section: Mapped[int] = mapped_column(Integer, server_default="0", default=0)  # nº de sección del bordereau
    risk_code: Mapped[str] = mapped_column(String(20))
    broker_ref1: Mapped[str | None] = mapped_column(String(120))     # caja (10): parte del UMR
    broker_ref2: Mapped[str | None] = mapped_column(String(120))     # caja (11): nombre del FDO
    signing_number: Mapped[str | None] = mapped_column(String(60))   # caja (8) del LPAN, p.ej. 21285*18/06/2026
    work_package: Mapped[str | None] = mapped_column(String(40))     # paquete de trabajo de Xchanging (p.ej. BNIXQUR)
    fecha_proceso: Mapped[dt.date | None] = mapped_column(Date)      # fecha en la que se procesa
    work_package_status: Mapped[str | None] = mapped_column(String(60))
    fecha_generado: Mapped[dt.date | None] = mapped_column(Date)
    fecha_signing: Mapped[dt.date | None] = mapped_column(Date)
    moneda: Mapped[str] = mapped_column(String(10), server_default="EUR", default="EUR")
    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lpans: Mapped[list["Lpan"]] = relationship(back_populates="fdo", cascade="all, delete-orphan")


class Lpan(Base):
    """LPAN (London Premium Advice Note): nota de pago a Lloyd's que agrupa las líneas del Premium
    BDX de un risk code en un periodo, bajo el signing number de su FDO."""

    __tablename__ = "lpans"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)  # Id del elemento en SharePoint (idempotencia)
    fdo_id: Mapped[int | None] = mapped_column(ForeignKey("fdos.id", ondelete="SET NULL"), index=True)
    # Apunta a un binder O a una póliza OM (uno de los dos).
    binder_id: Mapped[int | None] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    poliza_id: Mapped[int | None] = mapped_column(ForeignKey("polizas.id", ondelete="SET NULL"), index=True)
    risk_code: Mapped[str] = mapped_column(String(20))
    section: Mapped[int] = mapped_column(Integer, server_default="0", default=0)  # nº de sección del bordereau
    periodo: Mapped[str] = mapped_column(String(7))     # 'YYYY-MM' del Premium BDX
    tipo: Mapped[str] = mapped_column(String(10), server_default="PM", default="PM")  # FDO/PM/AP/RP
    # Comisión total % del grupo (coverholder % + brokerage %). Separa LPAN distintos del mismo
    # (sección, risk code, periodo) cuando hay líneas con comisiones distintas.
    comision_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    num_lineas: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    # Importes (campos del LPAN): 18 gross our line, 19 brokerage+coverholder, 17 tax, 25 net a UW
    gross_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    brokerage: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tax: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    net_premium: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    # Datos del LPAN histórico (de SharePoint TLPAN)
    signing_number: Mapped[str | None] = mapped_column(String(60))   # BureauOriginalRef (caja 8)
    work_package: Mapped[str | None] = mapped_column(String(40))
    broker_ref1: Mapped[str | None] = mapped_column(String(120))
    broker_ref2: Mapped[str | None] = mapped_column(String(120))
    sdd: Mapped[dt.date | None] = mapped_column(Date)
    liberado: Mapped[dt.date | None] = mapped_column(Date)
    pagado: Mapped[dt.date | None] = mapped_column(Date)
    moneda: Mapped[str] = mapped_column(String(10), server_default="EUR", default="EUR")
    fecha: Mapped[dt.date | None] = mapped_column(Date)   # Procesado
    estado: Mapped[str] = mapped_column(String(20), server_default="Generado", default="Generado")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fdo: Mapped["Fdo | None"] = relationship(back_populates="lpans")


class Poliza(Base):
    """Póliza de Open Market (OM): negocio directo de Mayrit (no de binder). Modelada sobre la
    lista de SharePoint `Mayrit - TPolizas`. De ella cuelgan recibos (1..N por fraccionamiento)."""

    __tablename__ = "polizas"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    numero_poliza: Mapped[str | None] = mapped_column(String(120), index=True)  # clave de casado con recibos
    asegurado: Mapped[str | None] = mapped_column(String(300))
    corredor: Mapped[str | None] = mapped_column(String(200))
    ramo: Mapped[str | None] = mapped_column(String(120))
    mercado: Mapped[str | None] = mapped_column(String(300))
    produccion: Mapped[str | None] = mapped_column(String(120))
    tipo_documento: Mapped[str | None] = mapped_column(String(80))
    estado: Mapped[str | None] = mapped_column(String(40))
    seguro: Mapped[str | None] = mapped_column(String(120))
    pago: Mapped[str | None] = mapped_column(String(40))
    moneda: Mapped[str | None] = mapped_column(String(10), server_default="EUR", default="EUR")
    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[dt.date | None] = mapped_column(Date)
    renovacion_automatica: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    coaseguro: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    coaseguro_lineas: Mapped[list | None] = mapped_column(JSON, default=list)  # [{mercado, participacion}] cuando hay coaseguro

    limite: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    franquicia: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    capacidad: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_neta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    impuestos_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    impuestos: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    recargos: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    comision_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))            # comisión total %
    comision_cedida_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))     # % de la comisión para el corredor (cedida)
    comision_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_participacion: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    # Quién paga a Mayrit: "Corredor" (paga neto, descontando su comisión cedida → se salda al
    # cobrar) o "Tomador" (paga el 100% de la prima y luego pagamos la comisión al corredor).
    pagador: Mapped[str | None] = mapped_column(String(40))

    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ConsultoriaContrato(Base):
    """Contrato de Consultoría (honorarios/fees). Datos mínimos; genera recibos tipo 'Consultoría'
    por periodo según su frecuencia. El cliente facturado es un Productor (p. ej. una agencia)."""

    __tablename__ = "consultoria_contratos"

    id: Mapped[int] = mapped_column(primary_key=True)
    productor_id: Mapped[int] = mapped_column(ForeignKey("productores.id"), index=True)  # cliente facturado
    concepto: Mapped[str | None] = mapped_column(String(300))
    fecha_inicio: Mapped[dt.date] = mapped_column(Date)
    duracion_meses: Mapped[int | None] = mapped_column(Integer)        # None = indefinido
    frecuencia: Mapped[str] = mapped_column(String(20))                # Mensual/Trimestral/Semestral/Anual/Único
    importe: Mapped[Decimal] = mapped_column(Numeric(18, 2))           # por cobro (base imponible)
    sujeto_impuestos: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
    impuestos_porc: Mapped[Decimal] = mapped_column(Numeric(7, 4), server_default=text("21"), default=Decimal("21"))
    moneda: Mapped[str] = mapped_column(String(10), server_default="EUR", default="EUR")
    cuenta_bancaria_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))
    # Día del mes en que se factura (1–31). El aviso "enviar factura" salta `aviso_dias_antes`
    # días antes de esa fecha. None = se factura el día del fecha_inicio.
    dia_facturacion: Mapped[int | None] = mapped_column(Integer)
    aviso_dias_antes: Mapped[int] = mapped_column(Integer, server_default=text("5"), default=5)
    estado: Mapped[str] = mapped_column(String(20), server_default="Activo", default="Activo")  # Activo | Finalizado
    notas: Mapped[str | None] = mapped_column(Text)

    productor: Mapped["Productor"] = relationship()
    cuenta_bancaria: Mapped["CuentaBancaria | None"] = relationship()

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AvisoNivel(Base):
    """Override de importancia (semáforo) y de cubo por TIPO de aviso. Los avisos se calculan al
    vuelo; aquí solo se guarda, por tipo, el nivel (alto/medio/bajo) y la categoría (alerta/dia)
    elegidos por el usuario. Si un tipo no tiene fila o el campo es NULL, se usa el valor por
    defecto definido en el router de avisos."""

    __tablename__ = "aviso_niveles"

    tipo: Mapped[str] = mapped_column(String(60), primary_key=True)
    nivel: Mapped[str] = mapped_column(String(10))            # alto | medio | bajo
    categoria: Mapped[str | None] = mapped_column(String(10), nullable=True)   # alerta | dia (override)


class Recibo(Base):
    """Recibo (núcleo de facturación/contabilidad). Modelado sobre la lista de SharePoint
    `Mayrit - TRecibos`: ciclo completo prima → impuestos → comisiones (cedida/retenida) →
    cobro → liquidación a la Cía → pago de comisión cedida → contable.

    En la app se **emite 1 por Risk BDX** (binder + periodo 'YYYY-MM'); la comisión de Mayrit
    es `comision_retenida` (= Σ brokerage del periodo). El **cobro llega con los Premium BDX**
    (rara vez coinciden con el Risk BDX) → puede ser parcial. Casado con SharePoint por `numero`
    (NumeroRecibo, 'AÑO-NNNN'). Las líneas del BDX apuntan por `BdxLinea.recibo_id`.
    Los "pendientes" (cobro/liquidación/traspaso) los recalcula el backend.
    """

    __tablename__ = "recibos"
    # 1 recibo por Risk BDX = único (binder, periodo). Un binder tiene MUCHOS (uno por periodo).
    __table_args__ = (UniqueConstraint("binder_id", "periodo", name="uq_recibo_binder_periodo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)   # _OldID de SharePoint (migración)
    # ── Enlace en la app ── (un recibo es de un Binder O de una Póliza OM)
    binder_id: Mapped[int | None] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    poliza_id: Mapped[int | None] = mapped_column(ForeignKey("polizas.id", ondelete="CASCADE"), index=True)
    consultoria_id: Mapped[int | None] = mapped_column(ForeignKey("consultoria_contratos.id", ondelete="SET NULL"), index=True)
    periodo: Mapped[str] = mapped_column(String(7))               # 'YYYY-MM' del Risk BDX (vacío en OM puntuales)
    anio: Mapped[int] = mapped_column(Integer, index=True)        # año contable
    estado: Mapped[str] = mapped_column(String(30), server_default="Emitido", default="Emitido")  # Emitido | Anulado

    # ── Contexto (TRecibos) ──
    numero: Mapped[str] = mapped_column(String(20), index=True)   # NumeroRecibo 'AÑO-NNNN' (clave de casado)
    referencia: Mapped[str | None] = mapped_column(String(200))
    nombre_mercado: Mapped[str | None] = mapped_column(String(300))   # Nombre_Mercado
    mercado: Mapped[str | None] = mapped_column(String(300))          # Mercado (alias/código)
    numero_poliza: Mapped[str | None] = mapped_column(String(120))
    asegurado: Mapped[str | None] = mapped_column(String(300))
    corredor: Mapped[str | None] = mapped_column(String(200))
    ramo: Mapped[str | None] = mapped_column(String(120))
    tipo_poliza: Mapped[str | None] = mapped_column(String(80))
    produccion: Mapped[str | None] = mapped_column(String(120))
    fecha_efecto: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[dt.date | None] = mapped_column(Date)
    yoa: Mapped[int | None] = mapped_column(Integer)
    pago: Mapped[str | None] = mapped_column(String(40))              # Único / Fraccionado
    moneda: Mapped[str | None] = mapped_column(String(10), server_default="EUR", default="EUR")
    prima_neta_poliza: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    participacion: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    recibo_num: Mapped[int | None] = mapped_column(Integer)           # Recibo (nº de plazo)
    recibos_totales: Mapped[str | None] = mapped_column(String(40))   # RecibosTotales (ej: "12")

    # ── Importe del recibo + impuestos ──
    fecha_efecto_recibo: Mapped[dt.date | None] = mapped_column(Date)
    fecha_vcto_recibo: Mapped[dt.date | None] = mapped_column(Date)
    prima_neta_recibo: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    impuestos_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    impuestos_sobre_recibo: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    impuestos_sobre_total_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    impuestos_sobre_recibo_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    otros_impuestos: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    impuestos_recibo: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    prima_bruta_recibo: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    deduccion_total_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    deduccion_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    honorarios: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)

    # ── Comisiones ──
    comision_cedida_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))    # al corredor
    comision_cedida: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    comision_retenida_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))  # de Mayrit
    comision_retenida: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    pagador: Mapped[str | None] = mapped_column(String(60))

    # ── Cobro de primas / comisión ──
    prima_adeudada: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    prima_cobrada: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    prima_fecha_cobro: Mapped[dt.date | None] = mapped_column(Date)
    comision_retenida_cobrada: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    comision_retenida_traspasada: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    comision_fecha_traspaso: Mapped[dt.date | None] = mapped_column(Date)
    comision_pendiente_cobro: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)

    # ── Liquidación a la Cía ──
    liquidar: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    liquidar_cobrado: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    liquidar_pendiente_cobro: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    liquidar_liquidado: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    liquidar_fecha_liquidacion: Mapped[dt.date | None] = mapped_column(Date)

    # ── Comisión cedida — pago ──
    comision_cedida_a_pagar: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    comision_cedida_pagada: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    comision_cedida_fecha_pago: Mapped[dt.date | None] = mapped_column(Date)

    # ── Cuentas bancarias por movimiento (cobro, liquidación, traspaso origen→destino, pago) ──
    cuenta_cobro_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))
    cuenta_liquidacion_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))
    cuenta_traspaso_origen_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))
    cuenta_traspaso_destino_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))
    cuenta_pago_id: Mapped[int | None] = mapped_column(ForeignKey("cuentas_bancarias.id"))

    # ── Contable / control ──
    notas: Mapped[str | None] = mapped_column(Text)
    cuenta: Mapped[str | None] = mapped_column(String(120))
    fecha_contable: Mapped[dt.date | None] = mapped_column(Date)
    # Año/mes contable derivados de fecha_contable (columnas GENERADAS por la BD). Para dinámicas de
    # Excel: evitan la agrupación automática de fechas (que se topa y no coge los meses nuevos).
    anio_contable: Mapped[int | None] = mapped_column(
        Integer, Computed("EXTRACT(YEAR FROM fecha_contable)::int", persisted=True))
    mes_contable: Mapped[int | None] = mapped_column(
        Integer, Computed("EXTRACT(MONTH FROM fecha_contable)::int", persisted=True))
    # Abreviatura del mes (ene..dic): coincide con la lista personalizada de Excel → ordena solo.
    mes_contable_nombre: Mapped[str | None] = mapped_column(String(3), Computed(
        "(ARRAY['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])"
        "[EXTRACT(MONTH FROM fecha_contable)::int]", persisted=True))

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()

    @validates("fecha_contable")
    def _fecha_contable_siempre_dia_1(self, key, value):
        """La fecha contable imputa el recibo a un MES (cierre contable): se normaliza SIEMPRE al
        día 1 de ese mes. Se elige el mes libremente (el del periodo o, si está cerrado, otro
        abierto), pero el día siempre es 1. Aplica a toda alta/edición de recibo."""
        return value.replace(day=1) if value else value


class CierreContable(Base):
    """Cierre contable mensual: cuando se envían los recibos de un mes a contabilidad,
    se cierra ese (año, mes) y sus recibos (por FechaContable) quedan 'Contabilizado'."""

    __tablename__ = "cierres_contables"
    __table_args__ = (UniqueConstraint("anio", "mes", name="uq_cierre_anio_mes"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    anio: Mapped[int] = mapped_column(Integer, index=True)
    mes: Mapped[int] = mapped_column(Integer)              # 1-12
    fecha: Mapped[dt.date] = mapped_column(Date)           # fecha en que se cerró
    usuario: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Siniestro(Base):
    """Siniestro (Claims BDX de un binder), estándar Lloyd's. Una fila por siniestro,
    enlazado al binder. Se importa de la lista de SharePoint `Mayrit - Claims<agreement>`.
    Casado/idempotencia por `sp_old_id` (_OldID) y, en su defecto, (binder, certificate, reference)."""

    __tablename__ = "siniestros"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)

    # Identificación
    section: Mapped[int | None] = mapped_column(Integer)
    yoa: Mapped[int | None] = mapped_column(Integer)
    risk_code: Mapped[str | None] = mapped_column(String(20))
    currency: Mapped[str | None] = mapped_column(String(10))
    certificate: Mapped[str | None] = mapped_column(String(120), index=True)
    reference: Mapped[str | None] = mapped_column(String(120))
    insured: Mapped[str | None] = mapped_column(String(255))
    reporting_period: Mapped[str | None] = mapped_column(String(60))
    risk_inception: Mapped[dt.date | None] = mapped_column(Date)
    risk_expiry: Mapped[dt.date | None] = mapped_column(Date)

    # Siniestro
    description: Mapped[str | None] = mapped_column(Text)
    claim_first_advised: Mapped[dt.date | None] = mapped_column(Date)
    status: Mapped[str | None] = mapped_column(String(60))
    refer: Mapped[str | None] = mapped_column(String(120))
    denial: Mapped[str | None] = mapped_column(String(120))
    claimant: Mapped[str | None] = mapped_column(String(255))
    date_opened: Mapped[dt.date | None] = mapped_column(Date)
    date_closed: Mapped[dt.date | None] = mapped_column(Date)
    ucr: Mapped[str | None] = mapped_column(String(120))
    abogado: Mapped[str | None] = mapped_column(String(255))
    last_bdx_change: Mapped[dt.date | None] = mapped_column(Date)
    ultima_revision: Mapped[dt.date | None] = mapped_column(Date)
    informacion: Mapped[str | None] = mapped_column(Text)

    # Importes (indemnización y honorarios)
    amount_claimed: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    to_pay_indemnity: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    to_pay_fees: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    paid_indemnity: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    paid_fees: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    reserves_indemnity: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    reserves_fees: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    total_indemnity: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    total_fees: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()


class ClaimsPresentacion(Base):
    """Snapshot mensual del Claims BDX de un binder (presentación a Lloyd's). A diferencia de
    Risk/Premium, el Claims BDX es acumulativo: cada mes se presenta el estado actual y se conserva
    lo presentado. Una fila por (binder, periodo, siniestro): guarda el pagado ACUMULADO (base del
    'To pay this month' del mes siguiente), el to_pay del mes, reservas, estado y la fila congelada
    (32 columnas) en `fila_json`. Presentar un mes lo BLOQUEA (BdxBloqueo tipo='claims')."""

    __tablename__ = "claims_presentaciones"
    __table_args__ = (UniqueConstraint("binder_id", "periodo", "siniestro_id", name="uq_claims_pres"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    periodo: Mapped[str] = mapped_column(String(7), index=True)   # 'YYYY-MM' (fin de mes)
    periodo_ord: Mapped[int] = mapped_column(Integer, index=True)  # aaaamm (orden/comparación)
    siniestro_id: Mapped[int | None] = mapped_column(Integer, index=True)

    paid_indemnity_acum: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    paid_fees_acum: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    to_pay_indemnity: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    to_pay_fees: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    reserves_indemnity: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    reserves_fees: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    status: Mapped[str | None] = mapped_column(String(60))
    fila_json: Mapped[str | None] = mapped_column(Text)            # fila de 32 columnas congelada

    fecha_presentacion: Mapped[dt.date | None] = mapped_column(Date)
    usuario: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Tarea(Base):
    """Tarea recurrente manual enganchada a un binder. La recurrencia se ajusta a la VIGENCIA del
    binder: arranca en `fecha_inicio` (o la fecha de efecto del binder) y se repite con su frecuencia
    hasta el vencimiento del binder. Cada ocurrencia se marca 'Hecha' (registro en TareaHecha)."""

    __tablename__ = "tareas"

    id: Mapped[int] = mapped_column(primary_key=True)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    titulo: Mapped[str] = mapped_column(String(200))
    descripcion: Mapped[str | None] = mapped_column(Text)
    # Categoría: Risk / Premium / Claims / General. Las tres primeras pueden auto-generarse del binder.
    categoria: Mapped[str] = mapped_column(String(20), server_default="General", default="General")
    # Origen: 'manual' (creada a mano) o 'auto' (generada del intervalo+plazo de BDX del binder).
    origen: Mapped[str] = mapped_column(String(10), server_default="manual", default="manual")
    # Única / Mensual / Trimestral / Semestral / Anual / Personalizada (cada N meses → intervalo_meses)
    frecuencia: Mapped[str] = mapped_column(String(20))
    intervalo_meses: Mapped[int | None] = mapped_column(Integer)
    fecha_inicio: Mapped[dt.date | None] = mapped_column(Date)   # ancla (None = fecha de efecto del binder)
    fecha_fin: Mapped[dt.date | None] = mapped_column(Date)      # fin (None = vencimiento del binder)
    aviso_dias_antes: Mapped[int] = mapped_column(Integer, server_default=text("5"), default=5)
    estado: Mapped[str] = mapped_column(String(20), server_default="Activa", default="Activa")  # Activa | Pausada | Finalizada
    # Pasos secuenciales: cada paso se desbloquea al completar el anterior (por 'orden'). Solo afecta al
    # checklist (el resto de la tarea igual). False = todos los pasos disponibles a la vez.
    secuencial: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()
    hechas: Mapped[list["TareaHecha"]] = relationship(
        back_populates="tarea", cascade="all, delete-orphan", order_by="TareaHecha.fecha_ocurrencia"
    )
    # Pasos (checklist): la MISMA lista para todas las ocurrencias. Cada paso se marca por ocurrencia.
    pasos: Mapped[list["TareaPaso"]] = relationship(
        back_populates="tarea", cascade="all, delete-orphan", order_by="TareaPaso.orden, TareaPaso.id"
    )


class TareaHecha(Base):
    """Una ocurrencia concreta de una tarea, marcada como hecha (fecha de la ocurrencia + cuándo se hizo).
    Si la tarea tiene pasos (checklist), este registro se crea/borra AUTOMÁTICAMENTE: existe cuando todos
    los pasos de esa ocurrencia están hechos."""

    __tablename__ = "tareas_hechas"
    __table_args__ = (UniqueConstraint("tarea_id", "fecha_ocurrencia", name="uq_tarea_ocurrencia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tarea_id: Mapped[int] = mapped_column(ForeignKey("tareas.id", ondelete="CASCADE"), index=True)
    fecha_ocurrencia: Mapped[dt.date] = mapped_column(Date)   # fecha (calendario) de la ocurrencia
    fecha_hecha: Mapped[dt.date] = mapped_column(Date)        # cuándo se marcó hecha
    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tarea: Mapped["Tarea"] = relationship(back_populates="hechas")


class TareaPaso(Base):
    """Un paso (checklist) de una tarea. La lista de pasos es la misma para todas las ocurrencias; lo que
    cambia por ocurrencia es si ese paso está hecho o no (TareaPasoHecho)."""

    __tablename__ = "tareas_pasos"

    id: Mapped[int] = mapped_column(primary_key=True)
    tarea_id: Mapped[int] = mapped_column(ForeignKey("tareas.id", ondelete="CASCADE"), index=True)
    orden: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)
    titulo: Mapped[str] = mapped_column(String(200))
    # Regla de auto-marcado: el paso se da por hecho cuando el dato del periodo ya existe en la app.
    # Valores: 'risk' | 'premium' | 'lpan' | 'claims' (claims = claims/snapshot). NULL = manual.
    regla_auto: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tarea: Mapped["Tarea"] = relationship(back_populates="pasos")
    hechos: Mapped[list["TareaPasoHecho"]] = relationship(
        back_populates="paso", cascade="all, delete-orphan"
    )


class TareaPasoHecho(Base):
    """Un paso concreto, marcado como hecho en UNA ocurrencia (fecha) de la tarea."""

    __tablename__ = "tareas_pasos_hechos"
    __table_args__ = (UniqueConstraint("paso_id", "fecha_ocurrencia", name="uq_paso_ocurrencia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    paso_id: Mapped[int] = mapped_column(ForeignKey("tareas_pasos.id", ondelete="CASCADE"), index=True)
    fecha_ocurrencia: Mapped[dt.date] = mapped_column(Date)   # a qué ocurrencia pertenece
    fecha_hecha: Mapped[dt.date] = mapped_column(Date)        # cuándo se marcó hecho
    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    paso: Mapped["TareaPaso"] = relationship(back_populates="hechos")


class ComisionLiquidacion(Base):
    """Liquidación mensual de comisiones de una fuente (p. ej. Iberian). Se PREPARA con la comisión
    estimada del Premium (coverholder) y queda PENDIENTE DE RATIFICAR hasta que la fuente envía las
    cifras definitivas (comisión total + reparto del 85% cedido entre sus sociedades). Genera un recibo
    tipo «Comisiones» (prima 0; deducción = comisión; cedida 85%; retenida Mayrit 15%)."""

    __tablename__ = "comision_liquidaciones"
    __table_args__ = (UniqueConstraint("fuente", "periodo", name="uq_comision_fuente_periodo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fuente: Mapped[str] = mapped_column(String(20))                 # 'Iberian' | 'Wii'
    programa_id: Mapped[int | None] = mapped_column(ForeignKey("programas.id", ondelete="SET NULL"))
    periodo: Mapped[str] = mapped_column(String(7))                 # 'YYYY-MM'
    fecha: Mapped[dt.date] = mapped_column(Date)                    # día 1 del mes
    comision_premium: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)   # estimada
    comision_definitiva: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))                              # la que ratifica la fuente
    cedida_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), server_default=text("85"), default=85)
    retenida_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), server_default=text("15"), default=15)
    pago1_nombre: Mapped[str | None] = mapped_column(String(200))   # sociedad 1 (Iberian Insurance Broker, S.L.)
    pago1_importe: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    pago2_nombre: Mapped[str | None] = mapped_column(String(200))   # sociedad 2 (Hauora Brokerage, S.L. — desaparecerá)
    pago2_importe: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    estado: Mapped[str] = mapped_column(String(20), server_default="Preparado", default="Preparado")  # Preparado | Ratificado
    recibo_id: Mapped[int | None] = mapped_column(ForeignKey("recibos.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    recibo: Mapped["Recibo | None"] = relationship()


class Transferencia(Base):
    """Movimiento de dinero (ledger). Calca la lista SharePoint `TLiquidaciones`: una fila por
    movimiento, clasificada por Origen (de qué nace) · Tipo (concepto) · Subtipo (Cobro/Traspaso/
    Liquidación). El subtipo marca el sentido: Cobro = entrada, Liquidación = salida (pago al
    mercado/cía o comisión cedida), Traspaso = movimiento interno entre cuentas propias.

    Origen normal:  los movimientos de Primas/Comisiones/Honorarios se generan al gestionar los
    recibos (cobrar/traspasar/liquidar/pagar). Los de Siniestros (Cobro/Liquidación) se dan de
    ALTA A MANO y solo registran el movimiento (no tocan el siniestro). Enlaza con Contabilidad."""

    __tablename__ = "transferencias"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)   # _OldID de TLiquidaciones (idempotencia)

    origen: Mapped[str] = mapped_column(String(30), index=True)          # Binder | Póliza | Comisiones | Consultoría | Slip de Reaseguro
    tipo: Mapped[str] = mapped_column(String(20), index=True)            # Primas | Siniestros | Comisiones | Honorarios
    subtipo: Mapped[str] = mapped_column(String(20))                     # Cobro | Liquidación | Traspaso
    sentido: Mapped[str] = mapped_column(String(10), index=True)         # entrada | salida | interno

    fecha: Mapped[dt.date | None] = mapped_column(Date, index=True)      # fecha del movimiento
    anio: Mapped[int | None] = mapped_column(Integer, index=True)        # año del movimiento (filtro)
    periodo: Mapped[dt.date | None] = mapped_column(Date)                # periodo de riesgo al que corresponde
    importe: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)

    numero_poliza: Mapped[str | None] = mapped_column(String(120), index=True)
    recibo_id: Mapped[int | None] = mapped_column(ForeignKey("recibos.id", ondelete="SET NULL"), index=True)
    recibo_num: Mapped[str | None] = mapped_column(String(40))           # nº de recibo del origen (p.ej. '2017-0001')
    binder_id: Mapped[int | None] = mapped_column(ForeignKey("binders.id", ondelete="SET NULL"), index=True)
    siniestro_id: Mapped[int | None] = mapped_column(ForeignKey("siniestros.id", ondelete="SET NULL"), index=True)

    mercado: Mapped[str | None] = mapped_column(String(200))
    cuenta_origen: Mapped[str | None] = mapped_column(String(120))
    cuenta_destino: Mapped[str | None] = mapped_column(String(120))
    notas: Mapped[str | None] = mapped_column(Text)

    manual: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)  # alta a mano (siniestros/ajustes)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    recibo: Mapped["Recibo | None"] = relationship()


class ContaCategoria(Base):
    """Catálogo de Contabilidad: clasifica cada Concepto de banco en Grupo/Tipo y su Cuenta Contable
    (código del PGC). Calca la lista SharePoint `Contabilidad - Categorias`."""

    __tablename__ = "conta_categorias"
    __table_args__ = (UniqueConstraint("concepto", name="uq_conta_categoria_concepto"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)
    concepto: Mapped[str] = mapped_column(String(160), index=True)
    grupo: Mapped[str | None] = mapped_column(String(80))
    tipo: Mapped[str | None] = mapped_column(String(20))             # Gasto | Ingreso
    cuenta_contable: Mapped[str | None] = mapped_column(String(20))  # código PGC (p. ej. 62110001)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MovimientoBancario(Base):
    """Movimiento de banco (extracto categorizado) — núcleo del módulo Contabilidad. Calca las listas
    SharePoint `Contabilidad - <cuenta>`: una fila por apunte, con importe en Gasto o Ingreso según el
    sentido, su saldo, y la clasificación (Concepto · Grupo · Tipo). La cuenta enlaza por nombre con
    `CuentaBancaria`. `transferencia_id` (Fase 2) lo concilia con el movimiento del ledger de
    Transferencias cuando el apunte es de seguros (prima cobrada, liquidación, …)."""

    __tablename__ = "movimientos_bancarios"
    __table_args__ = (UniqueConstraint("sp_lista", "sp_old_id", name="uq_movbanc_lista_spid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)   # Id del elemento EN SU lista
    sp_lista: Mapped[str | None] = mapped_column(String(60), index=True)  # lista de origen (idempotencia)

    cuenta: Mapped[str] = mapped_column(String(60), index=True)           # nombre de la cuenta bancaria
    iden: Mapped[int | None] = mapped_column(Integer)                     # correlativo por cuenta (nº del alta)
    identificador: Mapped[str | None] = mapped_column(String(40))         # Id visible: '{iden}.{mes}' (p. ej. 246.06)
    fecha: Mapped[dt.date | None] = mapped_column(Date, index=True)
    anio: Mapped[int | None] = mapped_column(Integer, index=True)

    concepto: Mapped[str | None] = mapped_column(String(160), index=True)
    grupo: Mapped[str | None] = mapped_column(String(80), index=True)
    tipo: Mapped[str | None] = mapped_column(String(20), index=True)      # Gasto | Ingreso

    gasto: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    ingreso: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    saldo: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    descripcion: Mapped[str | None] = mapped_column(Text)
    devengo: Mapped[dt.date | None] = mapped_column(Date)
    movimiento_bancario: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
    tarjeta: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    factura: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)  # 'Justificante'
    codigo: Mapped[str | None] = mapped_column(Text)   # Id + cuenta contable + concepto concatenados (largo)

    # Huella del apunte en el extracto del banco (Norma 43): hash estable de cuenta+fecha+importe+
    # documento+referencias+descripción. Permite deduplicar al reimportar extractos que solapan.
    ref_extracto: Mapped[str | None] = mapped_column(String(64), index=True)

    # Conciliación (Fase 2): movimiento del ledger de Transferencias que cuadra con este apunte.
    transferencia_id: Mapped[int | None] = mapped_column(ForeignKey("transferencias.id", ondelete="SET NULL"), index=True)
    # Justificante: TRANSFERENCIAS (ledger) que componen este apunte bancario (lista de
    # transferencia.id). Cada transferencia es el importe REAL movido (cobro/liquidación parcial), con
    # su fecha; sumadas por fecha cuadran con el importe del apunte. Con ellas se genera el PDF.
    transferencia_ids: Mapped[list[int] | None] = mapped_column(JSONB)
    # Líneas MANUALES de ajuste del justificante: [{"texto": str, "importe": float}]. Para cuadrar un
    # apunte cuando además de recibos hay compensaciones (p. ej. siniestros compensados con primas,
    # devolución de fees). Suman al cuadre y salen en el PDF. En Bankinter es habitual.
    ajustes_justif: Mapped[list[dict] | None] = mapped_column(JSONB)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Parametro(Base):
    """Parámetros sueltos de la app (clave-valor numérico). P. ej. la proyección de ingresos del
    presupuesto, que se sincroniza desde el Excel con una herramienta local (producción no puede
    leer el fichero de OneDrive; la BD local es la de producción)."""
    __tablename__ = "parametros"

    clave: Mapped[str] = mapped_column(String(80), primary_key=True)
    valor: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    descripcion: Mapped[str | None] = mapped_column(String(200))
    actualizado: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Registro DGSFP: aseguradoras y sus agencias de suscripción ──────────────────────────────────
# Reflejo (solo lectura desde la app) del Registro Público de la DGSFP. Se sincroniza con una
# herramienta LOCAL (tools/sync_agencias_dgsfp.py) que raspa el registro con Playwright y hace
# upsert aquí; producción (Azure) no puede scrapear (anti-bot), así que solo LEE de estas tablas.

class DgsfpAseguradora(Base):
    """Entidad aseguradora activa del registro de la DGSFP (clave tipo C0001/E0237/L1228)."""
    __tablename__ = "dgsfp_aseguradoras"

    clave: Mapped[str] = mapped_column(String(10), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(255))
    nif: Mapped[str | None] = mapped_column(String(20))
    telefono: Mapped[str | None] = mapped_column(String(30))
    situacion: Mapped[str | None] = mapped_column(String(40))
    # Licencia activa en el registro DGSFP (la sync la pone True si la aseguradora está en la lista de
    # activas; False = licencia retirada / no opera). Sustituye al 'revisar' de vínculo.
    licencia_activa: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
    actualizado: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DgsfpAgencia(Base):
    """Agencia de suscripción (MGA). `clave`/`nombre` vienen del registro DGSFP (clave tipo AS0108);
    el resto de campos es FICHA MANUAL (editable en la app, la sync del DGSFP NO los toca). `activo`
    permite conservar agencias que ya no operan."""
    __tablename__ = "dgsfp_agencias"

    clave: Mapped[str] = mapped_column(String(10), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(255))
    # Ficha manual (origen inicial: Access MGAs; luego editable en la app)
    cif: Mapped[str | None] = mapped_column(String(30))
    fecha_constitucion: Mapped[dt.date | None] = mapped_column(Date)
    direccion: Mapped[str | None] = mapped_column(String(255))
    cp: Mapped[str | None] = mapped_column(String(10))
    localidad: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(120))
    pais: Mapped[str | None] = mapped_column(String(60))
    contacto: Mapped[str | None] = mapped_column(String(255))
    telefono: Mapped[str | None] = mapped_column(String(60))
    web: Mapped[str | None] = mapped_column(String(255))
    productos: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    activo: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)
    dudoso: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    revisado: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)
    actualizado: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DgsfpVinculo(Base):
    """Vínculo aseguradora ↔ agencia de suscripción. Estado MIXTO: `activo` lo controla el usuario
    (histórico curado, no se borra); la sync del DGSFP solo informa de presencia (`en_dgsfp`,
    `dgsfp_visto`) y levanta `revisar` cuando hay discrepancia (nuevo en DGSFP / ya no en DGSFP),
    sin cambiar `activo`."""
    __tablename__ = "dgsfp_vinculos"
    __table_args__ = (UniqueConstraint("aseguradora_clave", "agencia_clave", name="uq_dgsfp_vinculo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aseguradora_clave: Mapped[str] = mapped_column(
        ForeignKey("dgsfp_aseguradoras.clave", ondelete="CASCADE"), index=True)
    agencia_clave: Mapped[str] = mapped_column(
        ForeignKey("dgsfp_agencias.clave", ondelete="CASCADE"), index=True)
    activo: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), default=True)   # estado del usuario
    en_dgsfp: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)  # visto en la última sync
    dgsfp_visto: Mapped[dt.date | None] = mapped_column(Date)          # última vez visto en el registro
    revisar: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)   # discrepancia por revisar
    revisar_motivo: Mapped[str | None] = mapped_column(String(40))    # 'nuevo en DGSFP' | 'ya no en DGSFP'
    primera_sync: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ultima_sync: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    fecha_baja: Mapped[dt.date | None] = mapped_column(Date)

    aseguradora: Mapped["DgsfpAseguradora"] = relationship()
    agencia: Mapped["DgsfpAgencia"] = relationship()


class ManualSeccion(Base):
    """Sección del Manual de uso de la app (editable desde la propia app). El cuerpo es Markdown.
    El orden lo da `orden` (menor primero)."""

    __tablename__ = "manual_secciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    orden: Mapped[int] = mapped_column(Integer, server_default="0", default=0, index=True)
    emoji: Mapped[str] = mapped_column(String(16), server_default="", default="")
    titulo: Mapped[str] = mapped_column(String(160), server_default="", default="")
    cuerpo: Mapped[str] = mapped_column(Text, server_default="", default="")   # Markdown
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
