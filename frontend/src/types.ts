// Tipos que reflejan los esquemas del backend (maestras, Fase 1).

export interface Mercado {
  id: number;
  nombre: string;
  alias: string | null;
  id_tipo: number | null;
  tipo_mercado: string | null;
  toba: boolean;
  fecha: string | null; // ISO date
  notas: string | null;
  sp_old_id: number | null;
  created_at: string;
  updated_at: string;
}

// Campos editables al crear/editar un mercado.
export interface MercadoWrite {
  nombre: string;
  alias?: string | null;
  tipo_mercado?: string | null;
  toba?: boolean;
  fecha?: string | null;
  notas?: string | null;
}

export interface Productor {
  id: number;
  nombre: string;
  alias: string | null;
  tipo: string | null;
  persona: string | null;
  cif: string | null;
  domicilio: string | null;
  codigo_postal: string | null;
  localidad: string | null;
  provincia: string | null;
  pais: string | null;
  notas: string | null;
  sp_old_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RiskCode {
  id?: number;
  codigo: string;
  descripcion: string | null;
}
export interface Ramo {
  id: number;
  nombre: string;
  risk_codes: RiskCode[];
}
export interface RamoWrite {
  nombre: string;
  risk_codes: { codigo: string; descripcion: string | null }[];
}

// ── Binders (Negocio) ── estructura: Binder → Secciones → (Mercado + participación)
export interface SeccionMercadoLinea {
  mercado_id: number;
  participacion: number | null;
  mercado_nombre?: string | null;
}
// Grupo de Límite de Primas: un par (límite + % notificación) que cubre 1..N secciones.
export interface BinderLimite {
  limite_primas: number | null;
  notificacion: number | null;
  fecha_notificacion?: string | null; // fecha en que se notificó el exceso de este límite
  estado?: "verde" | "ambar" | "rojo" | null; // consumo de este límite (solo lectura)
  consumo_pct?: number | null; // % de consumo de este límite (solo lectura)
}
export interface RiskCodeSeccion {
  codigo: string;
  comision_mayrit: number | null;
}
export interface BinderSeccion {
  id?: number;
  ramo: string | null;
  risk_codes: RiskCodeSeccion[];
  limite_grupo: number | null; // índice en Binder.limites
  limite_primas: number | null; // derivado del grupo (solo lectura)
  notificacion: number | null; // derivado del grupo (solo lectura)
  comision: number | null;
  comision_mayrit: number | null; // override de la comisión Mayrit del binder
  sujeto_pc: boolean;
  mercados: SeccionMercadoLinea[];
}
// Datos comunes del binder (no por sección).
export interface BinderComun {
  profit_commission: boolean;
  pc_porcentaje: number | null;
  pc_gastos: number | null;
  risk_bdx_intervalo: string | null;
  risk_bdx_plazo: number | null;
  premium_bdx_intervalo: string | null;
  premium_bdx_plazo: number | null;
  claims_bdx_intervalo: string | null;
  claims_bdx_plazo: number | null;
  comision_mayrit: number | null;
  cuenta_bancaria_id: number | null;
}
export interface Binder extends BinderComun {
  id: number;
  umr: string | null;
  agreement_number: string | null;
  productor_id: number | null;
  coverholder_nombre: string | null;
  coverholder_alias: string | null;
  cuenta_bancaria_nombre: string | null;
  fecha_efecto: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  moneda: string | null;
  yoa: string | null;
  notas: string | null;
  gwp_our_line: number | null; // Σ total_gwp_our_line del Risk BDX (calculado)
  notif_estado: "verde" | "ambar" | "rojo" | null; // semáforo del límite más crítico
  notif_consumo_pct: number | null; // % de consumo del límite más crítico
  limites: BinderLimite[];
  secciones: BinderSeccion[];
  created_at: string;
  updated_at: string;
}
export interface BinderWrite extends BinderComun {
  agreement_number: string;
  umr?: string | null;
  productor_id?: number | null;
  fecha_efecto?: string | null;
  fecha_vencimiento?: string | null;
  estado?: string | null;
  moneda?: string | null;
  yoa?: string | null;
  notas?: string | null;
  limites: BinderLimite[];
  secciones: {
    ramo: string | null;
    risk_codes: { codigo: string; comision_mayrit: number | null }[];
    limite_grupo: number | null;
    comision: number | null;
    comision_mayrit: number | null;
    sujeto_pc: boolean;
    mercados: { mercado_id: number; participacion: number | null }[];
  }[];
}

// Suplemento = una versión del binder (snapshot de los términos en una fecha de efecto).
export interface Suplemento {
  id: number | null;
  numero: number;
  fecha_efecto: string | null;
  motivo: string | null;
  created_at: string;
  snapshot: {
    comision_mayrit: number | null;
    limites?: { limite_primas: number | null; notificacion: number | null }[];
    secciones: { ramo: string | null; limite_grupo?: number | null; limite_primas: number | null; comision: number | null }[];
    [k: string]: unknown;
  };
}

// ── BDX (bordereaux Risk/Premium) ──
export interface Bdx {
  id: number;
  binder_id: number;
  tipo: string; // 'Risk' | 'Premium'
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  estado: string | null;
  notas: string | null;
  num_lineas: number;
  created_at: string;
  updated_at: string;
}
export interface BdxWrite {
  tipo: string;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  estado?: string | null;
  notas?: string | null;
}

// Recibo (núcleo facturación/contabilidad). Modelado sobre SharePoint 'Mayrit - TRecibos'.
// Los importes/porcentajes (Numeric) viajan como string; las fechas como ISO 'YYYY-MM-DD'.
export interface ReciboCampos {
  estado?: string | null;
  // Contexto
  referencia?: string | null;
  nombre_mercado?: string | null;
  mercado?: string | null;
  numero_poliza?: string | null;
  asegurado?: string | null;
  corredor?: string | null;
  ramo?: string | null;
  tipo_poliza?: string | null;
  produccion?: string | null;
  fecha_efecto?: string | null;
  fecha_vencimiento?: string | null;
  yoa?: number | null;
  pago?: string | null;
  moneda?: string | null;
  prima_neta_poliza?: string | null;
  participacion?: string | null;
  recibo_num?: number | null;
  recibos_totales?: string | null;
  // Importe + impuestos
  fecha_efecto_recibo?: string | null;
  fecha_vcto_recibo?: string | null;
  prima_neta_recibo?: string | null;
  impuestos_porc?: string | null;
  impuestos_sobre_recibo?: boolean | null;
  impuestos_sobre_total_porc?: string | null;
  impuestos_sobre_recibo_porc?: string | null;
  otros_impuestos?: string | null;
  impuestos_recibo?: string | null;
  prima_bruta_recibo?: string | null;
  deduccion_total_porc?: string | null;
  deduccion_total?: string | null;
  honorarios?: string | null;
  // Comisiones
  comision_cedida_porc?: string | null;
  comision_cedida?: string | null;
  comision_retenida_porc?: string | null;
  comision_retenida?: string | null;
  pagador?: string | null;
  // Cobro
  prima_adeudada?: string | null;
  prima_cobrada?: string | null;
  prima_fecha_cobro?: string | null;
  comision_retenida_cobrada?: string | null;
  comision_retenida_traspasada?: string | null;
  comision_fecha_traspaso?: string | null;
  // Liquidación
  liquidar?: string | null;
  liquidar_cobrado?: string | null;
  liquidar_liquidado?: string | null;
  liquidar_fecha_liquidacion?: string | null;
  // Comisión cedida — pago
  comision_cedida_a_pagar?: string | null;
  comision_cedida_pagada?: string | null;
  comision_cedida_fecha_pago?: string | null;
  // Contable
  notas?: string | null;
  cuenta?: string | null;
  fecha_contable?: string | null;
}

export interface Recibo extends ReciboCampos {
  id: number;
  binder_id: number;
  periodo: string;         // 'YYYY-MM' del Risk BDX
  anio: number;
  numero: string;          // 'AÑO-NNNN'
  // Pendientes (recalculados por el backend):
  comision_pendiente_cobro: string;
  liquidar_pendiente_cobro: string;
  created_at: string;
  updated_at: string;
  binder_umr?: string | null;
  num_lineas?: number;
}

export type ReciboUpdate = ReciboCampos;

export interface ReciboPreview extends ReciboCampos {
  binder_id: number;
  binder_umr: string | null;
  periodo: string;
  anio: number;
  numero: string;          // nº provisional
  num_lineas: number;
}

// Línea de un BDX. Campos del estándar (8–77) + control interno (80–90).
// Todos opcionales: en import/manual pueden venir vacíos.
export interface BdxLinea {
  id: number;
  bdx_id: number;
  sp_old_id?: number | null;
  // Periodo de reporte (por línea)
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  // Identificación
  section_no?: number | null;
  class_of_business?: string | null;
  risk_code?: string | null;
  type_of_insurance?: string | null;
  certificate_ref?: string | null;
  // Asegurado
  insured_name?: string | null;
  insured_id?: string | null;
  insured_address?: string | null;
  insured_province?: string | null;
  insured_postcode?: string | null;
  insured_country?: string | null;
  // Riesgo
  risk_inception_date?: string | null;
  risk_expiry_date?: string | null;
  location_risk_province?: string | null;
  location_risk_country?: string | null;
  risk_transaction_type?: string | null;
  transaction_type?: string | null;
  effective_date_transaction?: string | null;
  expiry_date_transaction?: string | null;
  // Prima
  original_currency?: string | null; // moneda de la prima (p. ej. EUR)
  gross_written_premium?: string | number | null;
  written_line_pct?: string | number | null;
  total_gwp_our_line?: string | number | null;
  fees?: string | number | null;
  commission_coverholder_pct?: string | number | null;
  commission_coverholder_amount?: string | number | null;
  total_taxes_levies?: string | number | null;
  total_gwp_including_tax?: string | number | null;
  net_premium_to_broker?: string | number | null;
  // Suma asegurada / deducible
  sum_insured_total?: string | number | null; // suma asegurada 100 %
  sum_insured_our_line?: string | number | null;
  deductible_amount?: string | number | null;
  deductible_basis?: string | null;
  // Impuestos 1–4
  tax1_jurisdiction?: string | null;
  tax1_type?: string | null;
  tax1_taxable_premium?: string | number | null;
  tax1_pct?: string | number | null;
  tax1_amount?: string | number | null;
  tax1_administered_by?: string | null;
  tax1_payable_by?: string | null;
  tax2_jurisdiction?: string | null;
  tax2_type?: string | null;
  tax2_taxable_premium?: string | number | null;
  tax2_pct?: string | number | null;
  tax2_amount?: string | number | null;
  tax2_administered_by?: string | null;
  tax2_payable_by?: string | null;
  tax3_jurisdiction?: string | null;
  tax3_type?: string | null;
  tax3_taxable_premium?: string | number | null;
  tax3_pct?: string | number | null;
  tax3_amount?: string | number | null;
  tax3_administered_by?: string | null;
  tax3_payable_by?: string | null;
  tax4_jurisdiction?: string | null;
  tax4_type?: string | null;
  tax4_taxable_premium?: string | number | null;
  tax4_pct?: string | number | null;
  tax4_amount?: string | number | null;
  tax4_administered_by?: string | null;
  tax4_payable_by?: string | null;
  // Plazos / Lloyd's / brokerage
  instalment_number?: number | null;
  number_of_instalments?: number | null;
  referred_to_london?: string | null;
  pct_for_lloyds?: string | number | null;
  policy_issuance_date?: string | null;
  policy_number_reinsured?: string | null;
  brokerage_pct?: string | number | null;
  brokerage_amount?: string | number | null;
  final_net_premium_uw?: string | number | null;
  // Premium (subconjunto)
  incluido_en_premium?: boolean;
  premium_bdx?: string | null;
  // Control interno
  prima_cobrada?: boolean;
  ingresado?: string | number | null;
  premium_payment_date?: string | null;
  traspaso?: boolean;
  traspasado?: string | number | null;
  fecha_traspaso?: string | null;
  liquidado?: boolean;
  liquidado_uw?: string | number | null;
  fecha_liquidacion?: string | null;
  recibo?: string | null;
  notas?: string | null;
}
export type BdxLineaWrite = Omit<BdxLinea, "id" | "bdx_id" | "sp_old_id">;

export interface Tomador {
  id: number;
  nombre: string;
  tipo: string | null;
  cif: string | null;
  domicilio: string | null;
  codigo_postal: string | null;
  localidad: string | null;
  provincia: string | null;
  pais: string | null;
  notas: string | null;
  sp_old_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface TomadorWrite {
  nombre: string;
  tipo?: string | null;
  cif?: string | null;
  domicilio?: string | null;
  codigo_postal?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  notas?: string | null;
}

// Póliza de Open Market (OM).
export interface Poliza {
  id: number;
  sp_old_id: number | null;
  numero_poliza: string | null;
  referencia: string | null;
  asegurado: string | null;
  corredor: string | null;
  ramo: string | null;
  mercado: string | null;
  produccion: string | null;
  tipo_documento: string | null;
  estado: string | null;
  seguro: string | null; // "1"=Seguro Directo / "2"=Reaseguro
  pago: string | null;
  moneda: string | null;
  fecha_efecto: string | null;
  fecha_vencimiento: string | null;
  yoa: number | null;
  renovacion_automatica: boolean;
  coaseguro: boolean;
  limite: string | number | null;
  franquicia: string | number | null;
  capacidad: string | number | null;
  prima_neta: string | number | null;
  impuestos_porc: string | number | null;
  impuestos: string | number | null;
  recargos: string | number | null;
  prima_total: string | number | null;
  comision_porc: string | number | null;
  comision_total: string | number | null;
  prima_participacion: string | number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export type PolizaWrite = Partial<Omit<Poliza, "id" | "sp_old_id" | "created_at" | "updated_at">>;

export interface CuentaBancaria {
  id: number;
  nombre: string;
  categoria: string | null;
  banco: string | null;
  titular: string | null;
  iban: string | null;
  swift_bic: string | null;
  moneda: string | null;
  notas: string | null;
  activa: boolean;
  sp_old_id: number | null;
  created_at: string;
  updated_at: string;
}
export interface CuentaBancariaWrite {
  nombre: string;
  categoria?: string | null;
  banco?: string | null;
  titular?: string | null;
  iban?: string | null;
  swift_bic?: string | null;
  moneda?: string | null;
  notas?: string | null;
  activa?: boolean;
}

// Campos editables al crear/editar un productor.
export interface ProductorWrite {
  nombre: string;
  alias?: string | null;
  tipo?: string | null;
  persona?: string | null;
  cif?: string | null;
  domicilio?: string | null;
  codigo_postal?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  notas?: string | null;
}
