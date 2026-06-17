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

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func, text
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

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    bdx: Mapped["Bdx"] = relationship(back_populates="lineas")


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


class Poliza(Base):
    """Póliza de Open Market (OM): negocio directo de Mayrit (no de binder). Modelada sobre la
    lista de SharePoint `Mayrit - TPolizas`. De ella cuelgan recibos (1..N por fraccionamiento)."""

    __tablename__ = "polizas"

    id: Mapped[int] = mapped_column(primary_key=True)
    sp_old_id: Mapped[int | None] = mapped_column(Integer, index=True)

    numero_poliza: Mapped[str | None] = mapped_column(String(120), index=True)  # clave de casado con recibos
    referencia: Mapped[str | None] = mapped_column(String(200))
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

    limite: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    franquicia: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    capacidad: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_neta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    impuestos_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    impuestos: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    recargos: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    comision_porc: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    comision_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    prima_participacion: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


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

    # ── Contable / control ──
    notas: Mapped[str | None] = mapped_column(Text)
    cuenta: Mapped[str | None] = mapped_column(String(120))
    fecha_contable: Mapped[dt.date | None] = mapped_column(Date)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()
