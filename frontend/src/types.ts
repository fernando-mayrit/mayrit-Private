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
export interface BinderSeccion {
  id?: number;
  ramo: string | null;
  risk_codes: string[];
  limite_primas: number | null;
  notificacion: number | null;
  comision: number | null;
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
  secciones: {
    ramo: string | null;
    risk_codes: string[];
    limite_primas: number | null;
    notificacion: number | null;
    comision: number | null;
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
    secciones: { ramo: string | null; limite_primas: number | null; comision: number | null }[];
    [k: string]: unknown;
  };
}

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

export interface CuentaBancaria {
  id: number;
  nombre: string;
  banco: string | null;
  titular: string | null;
  iban: string | null;
  swift_bic: string | null;
  moneda: string | null;
  notas: string | null;
  sp_old_id: number | null;
  created_at: string;
  updated_at: string;
}
export interface CuentaBancariaWrite {
  nombre: string;
  banco?: string | null;
  titular?: string | null;
  iban?: string | null;
  swift_bic?: string | null;
  moneda?: string | null;
  notas?: string | null;
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
