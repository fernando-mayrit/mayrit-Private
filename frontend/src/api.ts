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
};

// CRUD genérico para una colección (p. ej. "/mercados").
export function crud<TRead, TWrite>(collection: string) {
  return {
    list: (q?: string) =>
      request<TRead[]>(`${collection}${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    get: (id: number) => request<TRead>(`${collection}/${id}`),
    create: (data: TWrite) =>
      request<TRead>(collection, { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<TWrite>) =>
      request<TRead>(`${collection}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`${collection}/${id}`, { method: "DELETE" }),
  };
}
