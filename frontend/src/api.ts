// Cliente mínimo de la API de Mayrit (backend FastAPI).
// La URL se puede sobreescribir con VITE_API_URL; por defecto, el backend local.
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Consulta de un código postal (datos compartidos con Alea): localidades + provincia.
export interface CpResultado {
  localidad: string;
  provincia: string;
}
export function buscarCp(cp: string) {
  return request<{ codigo_postal: string; resultados: CpResultado[] }>(
    `/codigos-postales/${encodeURIComponent(cp)}`
  );
}

// Suplementos (versiones) de un binder.
import type { Suplemento, BinderWrite } from "./types";
export function listarSuplementos(binderId: number) {
  return request<Suplemento[]>(`/binders/${binderId}/suplementos`);
}
export function crearSuplemento(
  binderId: number,
  payload: BinderWrite & { suplemento_fecha_efecto: string | null; motivo: string | null }
) {
  return request(`/binders/${binderId}/suplementos`, { method: "POST", body: JSON.stringify(payload) });
}

// ── BDX (bordereaux de un binder) ──
import type { Bdx, BdxWrite, BdxLinea, BdxLineaWrite } from "./types";

export interface BdxDetalle extends Bdx {
  lineas: BdxLinea[];
}
export const bdxApi = {
  listar: (binderId: number, tipo?: string) =>
    request<Bdx[]>(`/binders/${binderId}/bdx${tipo ? `?tipo=${encodeURIComponent(tipo)}` : ""}`),
  crear: (binderId: number, data: BdxWrite) =>
    request<Bdx>(`/binders/${binderId}/bdx`, { method: "POST", body: JSON.stringify(data) }),
  detalle: (bdxId: number) => request<BdxDetalle>(`/bdx/${bdxId}`),
  editar: (bdxId: number, data: Partial<BdxWrite>) =>
    request<Bdx>(`/bdx/${bdxId}`, { method: "PUT", body: JSON.stringify(data) }),
  borrar: (bdxId: number) => request<void>(`/bdx/${bdxId}`, { method: "DELETE" }),
  crearLinea: (bdxId: number, data: BdxLineaWrite) =>
    request<BdxLinea>(`/bdx/${bdxId}/lineas`, { method: "POST", body: JSON.stringify(data) }),
  editarLinea: (lineaId: number, data: Partial<BdxLineaWrite>) =>
    request<BdxLinea>(`/bdx/lineas/${lineaId}`, { method: "PUT", body: JSON.stringify(data) }),
  borrarLinea: (lineaId: number) =>
    request<void>(`/bdx/lineas/${lineaId}`, { method: "DELETE" }),
  // Bloqueo de periodos (presentado/cerrado): tipo = 'risk' | 'premium' | 'claims', periodo = 'YYYY-MM'.
  listarBloqueos: (binderId: number) =>
    request<{ tipo: string; periodo: string }[]>(`/binders/${binderId}/bloqueos`),
  bloquear: (binderId: number, tipo: string, periodo: string) =>
    request<{ tipo: string; periodo: string }>(`/binders/${binderId}/bloqueos`, {
      method: "POST",
      body: JSON.stringify({ tipo, periodo }),
    }),
  desbloquear: (binderId: number, tipo: string, periodo: string) =>
    request<void>(
      `/binders/${binderId}/bloqueos?tipo=${encodeURIComponent(tipo)}&periodo=${encodeURIComponent(periodo)}`,
      { method: "DELETE" }
    ),
  // Macheo Risk ↔ Premium: incluir/quitar líneas de un Premium (periodo null = quitar).
  incluirPremium: (lineaIds: number[], periodo: string | null) =>
    request<{ actualizadas: number }>(`/bdx/lineas/premium`, {
      method: "POST",
      body: JSON.stringify({ linea_ids: lineaIds, periodo }),
    }),
  // Importación desde SharePoint (solo lectura el preview; el import escribe).
  sharepointPreview: (binderId: number) =>
    request<BdxPreview>(`/binders/${binderId}/bdx/sharepoint-preview`),
  importarSharepoint: (binderId: number) =>
    request<BdxImportResult>(`/binders/${binderId}/bdx/import`, { method: "POST" }),
  excelDir: (sub = "") =>
    request<ExcelDir>(`/bdx/excel-dir${sub ? `?sub=${encodeURIComponent(sub)}` : ""}`),
};

export interface ExcelDir {
  base: string;
  sub: string;
  dirs: string[];
  files: { name: string; size: number; mtime: number }[];
}

export interface BdxPreview {
  list_title: string;
  total_lineas: number;
  periodos: string[];
  suma_gwp: number;
  suma_gwp_our_line: number;
  incluidas_en_premium: number;
  muestra: Record<string, unknown>[];
}
export interface BdxImportResult {
  bdx_id: number;
  list_title: string;
  insertadas: number;
  actualizadas: number;
  sin_old_id: number;
  periodos: string[];
  conciliacion: {
    lineas_sharepoint: number;
    lineas_postgres: number;
    lineas_ok: boolean;
    gwp_sharepoint: number;
    gwp_postgres: number;
    gwp_ok: boolean;
  };
}

// ── Recibos (comisión de Mayrit por Risk BDX) ──
import type { Recibo, ReciboUpdate, ReciboPreview } from "./types";

export const recibosApi = {
  listar: (params?: { anio?: number; binder_id?: number; poliza_id?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.anio != null) qs.set("anio", String(params.anio));
    if (params?.binder_id != null) qs.set("binder_id", String(params.binder_id));
    if (params?.poliza_id != null) qs.set("poliza_id", String(params.poliza_id));
    if (params?.q) qs.set("q", params.q);
    const s = qs.toString();
    return request<Recibo[]>(`/recibos${s ? `?${s}` : ""}`);
  },
  deBinder: (binderId: number) => request<Recibo[]>(`/binders/${binderId}/recibos`),
  obtener: (id: number) => request<Recibo>(`/recibos/${id}`),
  // Calcula el recibo sin guardarlo (para precumplimentar el formulario de emisión).
  preview: (binderId: number, periodo: string) =>
    request<ReciboPreview>(`/binders/${binderId}/recibos/preview?periodo=${encodeURIComponent(periodo)}`),
  // Emite (crea) el recibo con los campos (posiblemente editados) del formulario.
  generar: (binderId: number, periodo: string, data?: ReciboUpdate) =>
    request<Recibo>(`/binders/${binderId}/recibos/generar`, {
      method: "POST",
      body: JSON.stringify({ periodo, ...(data ?? {}) }),
    }),
  editar: (id: number, data: ReciboUpdate) =>
    request<Recibo>(`/recibos/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  borrar: (id: number) => request<void>(`/recibos/${id}`, { method: "DELETE" }),
  // Envía a contabilidad (bloquea) / reabre para corregir.
  contabilizar: (id: number) => request<Recibo>(`/recibos/${id}/contabilizar`, { method: "POST" }),
  descontabilizar: (id: number) => request<Recibo>(`/recibos/${id}/descontabilizar`, { method: "POST" }),
  // ── Premium: grupos, cobro y macheo desde Excel ──
  listarPremium: (binderId: number) => request<PremiumGrupo[]>(`/binders/${binderId}/premium`),
  cobrarPremium: (binderId: number, periodo: string, fecha: string) =>
    request(`/binders/${binderId}/premium/cobrar`, { method: "POST", body: JSON.stringify({ periodo, fecha }) }),
  descobrarPremium: (binderId: number, periodo: string, fecha: string) =>
    request(`/binders/${binderId}/premium/descobrar`, { method: "POST", body: JSON.stringify({ periodo, fecha }) }),
  traspasarPremium: (binderId: number, periodo: string, fecha: string) =>
    request(`/binders/${binderId}/premium/traspasar`, { method: "POST", body: JSON.stringify({ periodo, fecha }) }),
  liquidarPremium: (binderId: number, periodo: string, fecha: string) =>
    request(`/binders/${binderId}/premium/liquidar`, { method: "POST", body: JSON.stringify({ periodo, fecha }) }),
  excelPreview: (binderId: number, ruta: string, hoja?: string) =>
    request<ExcelPreview>(`/binders/${binderId}/premium/excel-preview`, { method: "POST", body: JSON.stringify({ ruta, hoja: hoja ?? null }) }),
  matchExcel: (binderId: number, data: { ruta: string; hoja: string; certificado: string; importe: string | null; periodo: string }) =>
    request<MatchResult>(`/binders/${binderId}/premium/match-excel`, { method: "POST", body: JSON.stringify(data) }),
};

export interface PremiumGrupo {
  periodo: string;
  num_lineas: number;
  prima: string;
  comision: string;
  a_liquidar: string;
  cobrado: boolean;
  traspasado: boolean;
  liquidado: boolean;
  fecha_pago: string | null;
  fecha_traspaso: string | null;
  fecha_liquidacion: string | null;
}
export interface ExcelPreview {
  hojas: string[];
  hoja: string;
  columnas: string[];
  muestra: Record<string, string>[];
  mapeo: { certificado: string | null; importe: string | null };
}
export interface MatchRow {
  certificate_ref: string;
  importe_excel: string | null;
  estado: "match" | "importe_distinto" | "no_encontrada";
  linea_id: number | null;
  importe_risk: string | null;
}
export interface MatchResult {
  periodo: string;
  filas: MatchRow[];
  matched_ids: number[];
  resumen: { total: number; match: number; importe_distinto: number; no_encontrada: number };
}

// Pólizas (Open Market). Límite alto para traerlas todas (son ~115).
import type { Poliza, PolizaWrite, PolizaEmitir, EmisionPreview } from "./types";
export const polizasApi = {
  listar: (q?: string) =>
    request<Poliza[]>(`/polizas?limit=2000${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  get: (id: number) => request<Poliza>(`/polizas/${id}`),
  crear: (data: PolizaWrite) => request<Poliza>("/polizas", { method: "POST", body: JSON.stringify(data) }),
  editar: (id: number, data: PolizaWrite) =>
    request<Poliza>(`/polizas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  borrar: (id: number) => request<void>(`/polizas/${id}`, { method: "DELETE" }),
  // Emisión: calcula la póliza y sus recibos sin guardar (para previsualizar).
  emitirPreview: (data: PolizaEmitir) =>
    request<EmisionPreview>("/polizas/emitir/preview", { method: "POST", body: JSON.stringify(data) }),
  // Emisión: crea la póliza Y genera sus recibos en una operación.
  emitir: (data: PolizaEmitir) =>
    request<Poliza>("/polizas/emitir", { method: "POST", body: JSON.stringify(data) }),
  // Próximo nº de póliza automático (B1634 + AA + correlativo) para un año (de la fecha de efecto).
  siguienteNumero: (anio: number) =>
    request<{ numero_poliza: string }>(`/polizas/siguiente-numero?anio=${anio}`),
  // Genera los recibos de una póliza ya existente que aún no los tiene.
  emitirRecibos: (id: number) =>
    request<Poliza>(`/polizas/${id}/emitir-recibos`, { method: "POST" }),
};

// Usuarios de la app (identificación) + autologin por equipo.
import type { Usuario, UsuarioWrite } from "./types";
export const usuariosApi = crud<Usuario, UsuarioWrite>("/usuarios");
export function usuarioEquipo() {
  return request<{ nombre: string | null }>("/usuario-equipo");
}

// CRUD genérico para una colección (p. ej. "/mercados").
export function crud<TRead, TWrite>(collection: string) {
  return {
    list: (q?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (limit != null) qs.set("limit", String(limit));
      const s = qs.toString();
      return request<TRead[]>(`${collection}${s ? `?${s}` : ""}`);
    },
    get: (id: number) => request<TRead>(`${collection}/${id}`),
    create: (data: TWrite) =>
      request<TRead>(collection, { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<TWrite>) =>
      request<TRead>(`${collection}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`${collection}/${id}`, { method: "DELETE" }),
  };
}
