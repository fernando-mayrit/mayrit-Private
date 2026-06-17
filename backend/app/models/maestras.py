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


class Recibo(Base):
    """Recibo de comisión de Mayrit (núcleo de facturación/contabilidad).

    **1 recibo por Risk BDX** = por (binder, periodo de reporte 'YYYY-MM'). La comisión
    de Mayrit es la suma del `brokerage_amount` de las líneas Risk de ese periodo (importe
    limpio, comisión de mediación **exenta** de impuestos). La contraparte es el/los
    mercado(s) del binder (snapshot en `contraparte`). Numeración correlativa por año
    natural: `AÑO-NNNN`. Las líneas del BDX que componen el recibo apuntan a él por
    `BdxLinea.recibo_id` (y guardan su número en `BdxLinea.recibo`).
    """

    __tablename__ = "recibos"
    __table_args__ = (UniqueConstraint("binder_id", "periodo", name="uq_recibo_binder_periodo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    numero: Mapped[str] = mapped_column(String(20), index=True)   # 'AÑO-NNNN'
    anio: Mapped[int] = mapped_column(Integer, index=True)        # año natural (agrupación contable)
    binder_id: Mapped[int] = mapped_column(ForeignKey("binders.id", ondelete="CASCADE"), index=True)
    periodo: Mapped[str] = mapped_column(String(7))               # 'YYYY-MM' del Risk BDX

    fecha_emision: Mapped[dt.date | None] = mapped_column(Date)
    moneda: Mapped[str | None] = mapped_column(String(10), server_default="EUR", default="EUR")
    contraparte: Mapped[str | None] = mapped_column(String(400))  # mercado(s) del binder (snapshot)

    base_comision: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    importe: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default=text("0"), default=0)
    estado: Mapped[str] = mapped_column(String(30), server_default="Emitido", default="Emitido")

    fecha_cobro: Mapped[dt.date | None] = mapped_column(Date)
    notas: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    binder: Mapped["Binder"] = relationship()
