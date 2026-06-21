"""
Esquemas Pydantic para las maestras (Fase 1). Por cada entidad:
  - *Base   : campos editables (los que viajan al crear/editar).
  - *Create : igual que Base (alta).
  - *Update : todos opcionales (edición parcial).
  - *Read   : Base + id + timestamps (lo que devuelve la API).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


# ─────────────────────────────── Productor ───────────────────────────────
class ProductorBase(BaseModel):
    nombre: str
    alias: str | None = None
    tipo: str | None = None
    persona: str | None = None
    activa: bool = True
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class ProductorCreate(ProductorBase):
    pass


class ProductorUpdate(BaseModel):
    nombre: str | None = None
    alias: str | None = None
    tipo: str | None = None
    persona: str | None = None
    activa: bool | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None


class ProductorRead(ProductorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────────── Mercado ────────────────────────────────
class MercadoBase(BaseModel):
    nombre: str
    alias: str | None = None
    id_tipo: int | None = None
    tipo_mercado: str | None = None
    toba: bool = False
    fecha: dt.date | None = None
    activa: bool = True
    ramos: list[str] = []
    notas: str | None = None
    sp_old_id: int | None = None

    @field_validator("ramos", mode="before")
    @classmethod
    def _ramos_no_none(cls, v):
        return v or []


class MercadoCreate(MercadoBase):
    pass


class MercadoUpdate(BaseModel):
    nombre: str | None = None
    alias: str | None = None
    id_tipo: int | None = None
    tipo_mercado: str | None = None
    toba: bool | None = None
    fecha: dt.date | None = None
    activa: bool | None = None
    ramos: list[str] | None = None
    notas: str | None = None


class MercadoRead(MercadoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────────── Siniestro ──────────────────────────────
class SiniestroRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    binder_id: int
    sp_old_id: int | None = None
    section: int | None = None
    yoa: int | None = None
    risk_code: str | None = None
    currency: str | None = None
    certificate: str | None = None
    reference: str | None = None
    insured: str | None = None
    reporting_period: str | None = None
    risk_inception: dt.date | None = None
    risk_expiry: dt.date | None = None
    description: str | None = None
    claim_first_advised: dt.date | None = None
    status: str | None = None
    refer: str | None = None
    denial: str | None = None
    claimant: str | None = None
    date_opened: dt.date | None = None
    date_closed: dt.date | None = None
    ucr: str | None = None
    abogado: str | None = None
    last_bdx_change: dt.date | None = None
    ultima_revision: dt.date | None = None
    informacion: str | None = None
    amount_claimed: Decimal | None = None
    to_pay_indemnity: Decimal | None = None
    to_pay_fees: Decimal | None = None
    paid_indemnity: Decimal | None = None
    paid_fees: Decimal | None = None
    reserves_indemnity: Decimal | None = None
    reserves_fees: Decimal | None = None
    total_indemnity: Decimal | None = None
    total_fees: Decimal | None = None


class SiniestroReadGlobal(SiniestroRead):
    """Siniestro con el contexto de su binder, para el listado global de siniestros."""
    binder_umr: str | None = None
    binder_agreement: str | None = None
    binder_programa: str | None = None


# ──────────────────────────── Cierre contable ────────────────────────────
class CierreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    anio: int
    mes: int
    fecha: dt.date
    usuario: str | None = None
    created_at: dt.datetime


# ──────────────────────────────── Usuario ────────────────────────────────
class UsuarioBase(BaseModel):
    nombre: str
    activa: bool = True


class UsuarioCreate(UsuarioBase):
    pass


class UsuarioUpdate(BaseModel):
    nombre: str | None = None
    activa: bool | None = None


class UsuarioRead(UsuarioBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ───────────────────────────────── Programa ──────────────────────────────
class ProgramaBase(BaseModel):
    nombre: str
    productor_id: int | None = None
    notas: str | None = None
    activa: bool = True


class ProgramaCreate(ProgramaBase):
    pass


class ProgramaUpdate(BaseModel):
    nombre: str | None = None
    productor_id: int | None = None
    notas: str | None = None
    activa: bool | None = None


class ProgramaRead(ProgramaBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────────── Tomador ────────────────────────────────
class TomadorBase(BaseModel):
    nombre: str
    tipo: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class TomadorCreate(TomadorBase):
    pass


class TomadorUpdate(BaseModel):
    nombre: str | None = None
    tipo: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None


class TomadorRead(TomadorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────── Cuenta bancaria ────────────────────────────
class CuentaBancariaBase(BaseModel):
    nombre: str
    categoria: str | None = None
    banco: str | None = None
    titular: str | None = None
    iban: str | None = None
    swift_bic: str | None = None
    moneda: str | None = None
    notas: str | None = None
    activa: bool = True
    sp_old_id: int | None = None


class CuentaBancariaCreate(CuentaBancariaBase):
    pass


class CuentaBancariaUpdate(BaseModel):
    nombre: str | None = None
    categoria: str | None = None
    banco: str | None = None
    titular: str | None = None
    iban: str | None = None
    swift_bic: str | None = None
    moneda: str | None = None
    notas: str | None = None
    activa: bool | None = None


class CuentaBancariaRead(CuentaBancariaBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ───────────────────────────────── Póliza (OM) ───────────────────────────────
class PolizaBase(BaseModel):
    numero_poliza: str | None = None
    asegurado: str | None = None
    corredor: str | None = None
    ramo: str | None = None
    mercado: str | None = None
    produccion: str | None = None
    tipo_documento: str | None = None
    estado: str | None = None
    seguro: str | None = None            # 1=Seguro Directo / 2=Reaseguro
    pago: str | None = None
    moneda: str | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    renovacion_automatica: bool = False
    coaseguro: bool = False
    coaseguro_lineas: list[dict] = []   # [{mercado, participacion}] cuando hay coaseguro
    limite: Decimal | None = None
    franquicia: Decimal | None = None
    capacidad: Decimal | None = None
    prima_neta: Decimal | None = None
    impuestos_porc: Decimal | None = None
    impuestos: Decimal | None = None
    recargos: Decimal | None = None
    prima_total: Decimal | None = None
    comision_porc: Decimal | None = None
    comision_cedida_porc: Decimal | None = None
    comision_total: Decimal | None = None
    prima_participacion: Decimal | None = None
    pagador: str | None = None          # "Corredor" | "Tomador"
    notas: str | None = None
    sp_old_id: int | None = None

    @field_validator("coaseguro_lineas", mode="before")
    @classmethod
    def _coa_no_none(cls, v):
        return v or []


class PolizaCreate(PolizaBase):
    pass


class PolizaUpdate(BaseModel):
    numero_poliza: str | None = None
    asegurado: str | None = None
    corredor: str | None = None
    ramo: str | None = None
    mercado: str | None = None
    produccion: str | None = None
    tipo_documento: str | None = None
    estado: str | None = None
    seguro: str | None = None
    pago: str | None = None
    moneda: str | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    renovacion_automatica: bool | None = None
    coaseguro: bool | None = None
    coaseguro_lineas: list[dict] | None = None
    limite: Decimal | None = None
    franquicia: Decimal | None = None
    capacidad: Decimal | None = None
    prima_neta: Decimal | None = None
    impuestos_porc: Decimal | None = None
    impuestos: Decimal | None = None
    recargos: Decimal | None = None
    prima_total: Decimal | None = None
    comision_porc: Decimal | None = None
    comision_cedida_porc: Decimal | None = None
    comision_total: Decimal | None = None
    prima_participacion: Decimal | None = None
    pagador: str | None = None
    notas: str | None = None


class PolizaRead(PolizaBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ────────────────────────────────── Ramo ─────────────────────────────────
class RiskCodeIn(BaseModel):
    codigo: str
    descripcion: str | None = None


class RiskCodeOut(BaseModel):
    id: int
    codigo: str
    descripcion: str | None = None


class RamoBase(BaseModel):
    nombre: str


class RamoCreate(RamoBase):
    risk_codes: list[RiskCodeIn] = []


class RamoUpdate(BaseModel):
    nombre: str | None = None
    risk_codes: list[RiskCodeIn] | None = None


class RamoRead(RamoBase):
    id: int
    risk_codes: list[RiskCodeOut] = []


# ───────────────────────────────── Binder ────────────────────────────────
# Estructura: Binder → Secciones → (Mercado + participación)
class SeccionMercadoIn(BaseModel):
    mercado_id: int
    participacion: Decimal | None = None


class SeccionMercadoOut(BaseModel):
    mercado_id: int
    participacion: Decimal | None = None
    mercado_nombre: str | None = None


# Grupo de Límite de Primas: un par (límite + % notificación) que cubre 1..N secciones.
class BinderLimiteIn(BaseModel):
    limite_primas: Decimal | None = None
    notificacion: Decimal | None = None
    fecha_notificacion: dt.date | None = None  # fecha en que se notificó el exceso de este límite


class BinderLimiteOut(BinderLimiteIn):
    estado: str | None = None        # 'verde' | 'ambar' | 'rojo' (consumo de este límite)
    consumo_pct: float | None = None  # % de consumo de este límite


# Código de riesgo de una sección, con su comisión Mayrit opcional (override de la sección).
class RiskCodeSeccionIn(BaseModel):
    codigo: str
    comision_mayrit: Decimal | None = None


class RiskCodeSeccionOut(BaseModel):
    codigo: str
    comision_mayrit: Decimal | None = None


class BinderSeccionIn(BaseModel):
    ramo: str | None = None
    risk_codes: list[RiskCodeSeccionIn] = []
    # Índice (0-based) del grupo de límite (en `limites`) al que pertenece la sección.
    limite_grupo: int | None = None
    comision: Decimal | None = None
    comision_mayrit: Decimal | None = None   # override de la comisión Mayrit del binder
    sujeto_pc: bool = False
    mercados: list[SeccionMercadoIn] = []


class BinderSeccionOut(BaseModel):
    id: int
    ramo: str | None = None
    risk_codes: list[RiskCodeSeccionOut] = []
    limite_grupo: int | None = None
    # Límite/notificación efectivos (derivados del grupo) para mostrar sin recombinar.
    limite_primas: Decimal | None = None
    notificacion: Decimal | None = None
    comision: Decimal | None = None
    comision_mayrit: Decimal | None = None
    sujeto_pc: bool = False
    mercados: list[SeccionMercadoOut] = []


class BinderBase(BaseModel):
    agreement_number: str
    umr: str | None = None
    productor_id: int | None = None
    programa_id: int | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    estado: str | None = None
    participacion: Decimal | None = None   # % del contrato (reaseguro) que lleva Mayrit (def. 100)
    faltan_snapshots: bool = False         # PROVISIONAL: marca binders sin snapshots de Claims
    moneda: str | None = None
    yoa: str | None = None
    # Datos comunes del binder
    profit_commission: bool = False
    pc_porcentaje: Decimal | None = None
    pc_gastos: Decimal | None = None
    risk_bdx_intervalo: str | None = None
    risk_bdx_plazo: int | None = None
    premium_bdx_intervalo: str | None = None
    premium_bdx_plazo: int | None = None
    claims_bdx_intervalo: str | None = None
    claims_bdx_plazo: int | None = None
    comision_mayrit: Decimal | None = None
    cuenta_bancaria_id: int | None = None
    notas: str | None = None


class BinderCreate(BinderBase):
    limites: list[BinderLimiteIn] = []
    secciones: list[BinderSeccionIn] = []


class BinderUpdate(BinderBase):
    agreement_number: str | None = None
    limites: list[BinderLimiteIn] | None = None
    secciones: list[BinderSeccionIn] | None = None


class BinderRead(BinderBase):
    id: int
    coverholder_nombre: str | None = None
    coverholder_alias: str | None = None
    programa_nombre: str | None = None
    cuenta_bancaria_nombre: str | None = None
    gwp_our_line: float | None = None  # Σ total_gwp_our_line del Risk BDX (calculado)
    notif_estado: str | None = None       # semáforo: 'verde' | 'ambar' | 'rojo' (límite más crítico)
    notif_consumo_pct: float | None = None  # % de consumo del límite más crítico
    limites: list[BinderLimiteOut] = []
    secciones: list[BinderSeccionOut] = []
    created_at: dt.datetime
    updated_at: dt.datetime


# Suplemento = nueva versión del binder: los términos completos + fecha de efecto y motivo.
class SuplementoCreate(BinderBase):
    limites: list[BinderLimiteIn] = []
    secciones: list[BinderSeccionIn] = []
    suplemento_fecha_efecto: dt.date | None = None
    motivo: str | None = None


# ───────────────────────────────── BDX (bordereaux) ──────────────────────────
class BdxLineaBase(BaseModel):
    """Todos los campos editables de una línea (todos opcionales: en import vienen vacíos)."""
    # Periodo de reporte (por línea; identifica el periodo dentro del BDX único del binder)
    reporting_period_start: dt.date | None = None
    reporting_period_end: dt.date | None = None
    # Identificación
    section_no: int | None = None
    class_of_business: str | None = None
    risk_code: str | None = None
    type_of_insurance: str | None = None
    certificate_ref: str | None = None
    # Asegurado
    insured_name: str | None = None
    insured_id: str | None = None
    insured_address: str | None = None
    insured_province: str | None = None
    insured_postcode: str | None = None
    insured_country: str | None = None
    # Riesgo
    risk_inception_date: dt.date | None = None
    risk_expiry_date: dt.date | None = None
    location_risk_province: str | None = None
    location_risk_country: str | None = None
    risk_transaction_type: str | None = None
    transaction_type: str | None = None
    effective_date_transaction: dt.date | None = None
    expiry_date_transaction: dt.date | None = None
    # Prima
    original_currency: str | None = None
    gross_written_premium: Decimal | None = None
    written_line_pct: Decimal | None = None
    total_gwp_our_line: Decimal | None = None
    fees: Decimal | None = None
    commission_coverholder_pct: Decimal | None = None
    commission_coverholder_amount: Decimal | None = None
    total_taxes_levies: Decimal | None = None
    total_gwp_including_tax: Decimal | None = None
    net_premium_to_broker: Decimal | None = None
    # Suma asegurada / deducible
    sum_insured_total: Decimal | None = None
    sum_insured_our_line: Decimal | None = None
    deductible_amount: Decimal | None = None
    deductible_basis: str | None = None
    # Impuestos 1–4
    tax1_jurisdiction: str | None = None
    tax1_type: str | None = None
    tax1_taxable_premium: Decimal | None = None
    tax1_pct: Decimal | None = None
    tax1_amount: Decimal | None = None
    tax1_administered_by: str | None = None
    tax1_payable_by: str | None = None
    tax2_jurisdiction: str | None = None
    tax2_type: str | None = None
    tax2_taxable_premium: Decimal | None = None
    tax2_pct: Decimal | None = None
    tax2_amount: Decimal | None = None
    tax2_administered_by: str | None = None
    tax2_payable_by: str | None = None
    tax3_jurisdiction: str | None = None
    tax3_type: str | None = None
    tax3_taxable_premium: Decimal | None = None
    tax3_pct: Decimal | None = None
    tax3_amount: Decimal | None = None
    tax3_administered_by: str | None = None
    tax3_payable_by: str | None = None
    tax4_jurisdiction: str | None = None
    tax4_type: str | None = None
    tax4_taxable_premium: Decimal | None = None
    tax4_pct: Decimal | None = None
    tax4_amount: Decimal | None = None
    tax4_administered_by: str | None = None
    tax4_payable_by: str | None = None
    # Plazos / Lloyd's / brokerage
    instalment_number: int | None = None
    number_of_instalments: int | None = None
    referred_to_london: str | None = None
    pct_for_lloyds: Decimal | None = None
    policy_issuance_date: dt.date | None = None
    policy_number_reinsured: str | None = None
    brokerage_pct: Decimal | None = None
    brokerage_amount: Decimal | None = None
    final_net_premium_uw: Decimal | None = None
    # Premium (subconjunto): la fila entra en el Premium Bdx y con qué fecha
    incluido_en_premium: bool = False
    premium_bdx: dt.date | None = None
    # Control interno
    prima_cobrada: bool = False
    ingresado: Decimal | None = None
    premium_payment_date: dt.date | None = None
    traspaso: bool = False
    traspasado: Decimal | None = None
    fecha_traspaso: dt.date | None = None
    liquidado: bool = False
    liquidado_uw: Decimal | None = None
    fecha_liquidacion: dt.date | None = None
    recibo: str | None = None
    notas: str | None = None


class BdxLineaCreate(BdxLineaBase):
    pass


class BdxLineaUpdate(BdxLineaBase):
    """Edición parcial: los bool pasan a opcionales para no forzarlos."""
    incluido_en_premium: bool | None = None
    prima_cobrada: bool | None = None
    traspaso: bool | None = None
    liquidado: bool | None = None


class BdxLineaRead(BdxLineaBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bdx_id: int
    sp_old_id: int | None = None


class BdxBase(BaseModel):
    tipo: str                                    # 'Risk' | 'Premium'
    reporting_period_start: dt.date | None = None
    reporting_period_end: dt.date | None = None
    estado: str | None = None
    notas: str | None = None


class BdxCreate(BdxBase):
    pass


class BdxUpdate(BaseModel):
    tipo: str | None = None
    reporting_period_start: dt.date | None = None
    reporting_period_end: dt.date | None = None
    estado: str | None = None
    notas: str | None = None


class BdxRead(BdxBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    binder_id: int
    num_lineas: int = 0
    created_at: dt.datetime
    updated_at: dt.datetime


class BdxDetalle(BdxRead):
    lineas: list[BdxLineaRead] = []


# ───────────────────────────────── Recibos ──────────────────────────────────
# Modelado sobre SharePoint 'Mayrit - TRecibos'. Los "pendientes" los recalcula el backend.
class ReciboCampos(BaseModel):
    """Campos de datos del recibo (editables). Todos opcionales para edición parcial."""
    estado: str | None = None
    # Contexto
    referencia: str | None = None
    nombre_mercado: str | None = None
    mercado: str | None = None
    numero_poliza: str | None = None
    asegurado: str | None = None
    corredor: str | None = None
    ramo: str | None = None
    tipo_poliza: str | None = None
    produccion: str | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    yoa: int | None = None
    pago: str | None = None
    moneda: str | None = None
    prima_neta_poliza: Decimal | None = None
    participacion: Decimal | None = None
    recibo_num: int | None = None
    recibos_totales: str | None = None
    # Importe + impuestos
    fecha_efecto_recibo: dt.date | None = None
    fecha_vcto_recibo: dt.date | None = None
    prima_neta_recibo: Decimal | None = None
    impuestos_porc: Decimal | None = None
    impuestos_sobre_recibo: bool | None = None
    impuestos_sobre_total_porc: Decimal | None = None
    impuestos_sobre_recibo_porc: Decimal | None = None
    otros_impuestos: Decimal | None = None
    impuestos_recibo: Decimal | None = None
    prima_bruta_recibo: Decimal | None = None
    deduccion_total_porc: Decimal | None = None
    deduccion_total: Decimal | None = None
    honorarios: Decimal | None = None
    # Comisiones
    comision_cedida_porc: Decimal | None = None
    comision_cedida: Decimal | None = None
    comision_retenida_porc: Decimal | None = None
    comision_retenida: Decimal | None = None
    pagador: str | None = None
    # Cobro
    prima_adeudada: Decimal | None = None
    prima_cobrada: Decimal | None = None
    prima_fecha_cobro: dt.date | None = None
    comision_retenida_cobrada: Decimal | None = None
    comision_retenida_traspasada: Decimal | None = None
    comision_fecha_traspaso: dt.date | None = None
    # Liquidación
    liquidar: Decimal | None = None
    liquidar_cobrado: Decimal | None = None
    liquidar_liquidado: Decimal | None = None
    liquidar_fecha_liquidacion: dt.date | None = None
    # Comisión cedida — pago
    comision_cedida_a_pagar: Decimal | None = None
    comision_cedida_pagada: Decimal | None = None
    comision_cedida_fecha_pago: dt.date | None = None
    # Cuentas bancarias por movimiento
    cuenta_cobro_id: int | None = None
    cuenta_liquidacion_id: int | None = None
    cuenta_traspaso_origen_id: int | None = None
    cuenta_traspaso_destino_id: int | None = None
    cuenta_pago_id: int | None = None
    # Contable
    notas: str | None = None
    cuenta: str | None = None
    fecha_contable: dt.date | None = None


class ReciboUpdate(ReciboCampos):
    """Edición de un recibo (todos los campos opcionales)."""


class ReciboGenerar(ReciboCampos):
    """Emitir el recibo de un Risk BDX (binder + periodo 'YYYY-MM'). La comisión retenida
    (Σ brokerage) la recalcula el servidor; el resto puede venir editado del formulario."""
    periodo: str


class ReciboRead(ReciboCampos):
    model_config = ConfigDict(from_attributes=True)
    id: int
    binder_id: int | None = None
    poliza_id: int | None = None
    periodo: str | None = None
    anio: int
    numero: str
    # Pendientes (recalculados por el backend) y enriquecidos:
    comision_pendiente_cobro: Decimal = Decimal(0)
    liquidar_pendiente_cobro: Decimal = Decimal(0)
    created_at: dt.datetime
    updated_at: dt.datetime
    binder_umr: str | None = None
    poliza_numero: str | None = None     # OM: nº de póliza enlazada
    num_lineas: int = 0


class ReciboPreview(ReciboCampos):
    """Recibo calculado SIN persistir, para precumplimentar el formulario de emisión."""
    binder_id: int
    binder_umr: str | None = None
    periodo: str
    anio: int
    numero: str                 # nº provisional (el definitivo se asigna al emitir)
    num_lineas: int = 0
