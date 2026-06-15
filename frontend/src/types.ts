// Tipos que reflejan los esquemas del backend (maestras, Fase 1).

export interface Mercado {
  id: number;
  nombre: string;
  codigo: string | null;
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
  codigo?: string | null;
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

// ── Binders (Negocio) ── estructura: Binder → Secciones → (Mercado + participación)
export interface SeccionMercadoLinea {
  mercado_id: number;
  participacion: number | null;
  mercado_nombre?: string | null;
}
export interface BinderSeccion {
  id?: number;
  ramo: string | null;
  mercados: SeccionMercadoLinea[];
}
export interface Binder {
  id: number;
  referencia: string;
  umr: string | null;
  agreement_number: string | null;
  productor_id: number | null;
  coverholder_nombre: string | null;
  fecha_efecto: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  moneda: string | null;
  comision: number | null;
  limite_primas: number | null;
  yoa: string | null;
  notas: string | null;
  secciones: BinderSeccion[];
  created_at: string;
  updated_at: string;
}
export interface BinderWrite {
  referencia: string;
  umr?: string | null;
  agreement_number?: string | null;
  productor_id?: number | null;
  fecha_efecto?: string | null;
  fecha_vencimiento?: string | null;
  estado?: string | null;
  moneda?: string | null;
  comision?: number | null;
  limite_primas?: number | null;
  yoa?: string | null;
  notas?: string | null;
  secciones: { ramo: string | null; mercados: { mercado_id: number; participacion: number | null }[] }[];
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
