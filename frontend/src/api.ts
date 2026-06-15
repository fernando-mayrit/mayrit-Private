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
