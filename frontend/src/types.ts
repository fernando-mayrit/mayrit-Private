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

export interface Tomador {
  id: number;
  nombre: string;
  alias: string | null;
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
  alias?: string | null;
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
