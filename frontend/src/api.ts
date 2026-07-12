// Cliente mínimo de la API de Mayrit (backend FastAPI).
// - En desarrollo: backend local (127.0.0.1:8000). Usamos 127.0.0.1 y NO "localhost" a propósito:
//   "localhost" resuelve antes a IPv6 (::1) y, como uvicorn escucha en IPv4, cada petición se
//   colgaba ~2 s esperando el timeout antes de reintentar por IPv4.
// - En producción (build): mismo origen → rutas relativas (el backend sirve también el frontend).
// Se puede forzar con VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

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

// Subida multipart (FormData): NO se pone Content-Type (el navegador añade el boundary).
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* sin cuerpo JSON */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Exporta a Excel (.xlsx) un conjunto de cabeceras + filas (lo genera el backend con estilo).
export async function exportarXlsx(payload: {
  nombre: string;
  hoja: string;
  headers: string[];
  filas: (string | number | null)[][];
}): Promise<Blob> {
  const res = await fetch(`${BASE}/export/xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Error al exportar (${res.status})`);
  return res.blob();
}

// ── Siniestros (Claims BDX por binder) ──
export type RatiosBase = { gwp_our_line: number; com_coverholder: number; brokerage: number; net_uw: number; n_polizas: number };
export const siniestrosApi = {
  listarTodos: () => request<import("./types").Siniestro[]>(`/siniestros`),
  ratios: () => request<{ total: RatiosBase; por_programa: Record<string, RatiosBase> }>(`/siniestros/ratios`),
  listar: (binderId: number) => request<import("./types").Siniestro[]>(`/binders/${binderId}/siniestros`),
  preview: (binderId: number) =>
    request<{ list_title: string; total: number; suma_total_indemnity: number; suma_total_fees: number; suma_reservas: number }>(
      `/binders/${binderId}/siniestros/sharepoint-preview`
    ),
  importar: (binderId: number) =>
    request<{ leidos: number; nuevos: number; actualizados: number; total_binder: number }>(
      `/binders/${binderId}/siniestros/import`,
      { method: "POST" }
    ),
  actualizar: (id: number, datos: Partial<import("./types").Siniestro>) =>
    request<import("./types").Siniestro>(`/siniestros/${id}`, {
      method: "PUT",
      body: JSON.stringify(datos),
    }),
  crear: (binderId: number, datos: Partial<import("./types").Siniestro>) =>
    request<import("./types").Siniestro>(`/binders/${binderId}/siniestros`, {
      method: "POST",
      body: JSON.stringify(datos),
    }),
  nextUcr: (binderId: number) =>
    request<{ ucr: string; sufijo: string; umr: string }>(`/binders/${binderId}/siniestros/next-ucr`),
  // Compara un Claims BDX subido con los siniestros de la app; devuelve un Excel (diferencias en azul).
  compararClaimsBdx: async (binderId: number, file: File): Promise<Blob> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/binders/${binderId}/claims-bdx/comparar`, { method: "POST", body: form });
    if (!res.ok) {
      let msg = `Error al comparar el Claims BDX (${res.status})`;
      try { msg = (await res.json()).detail ?? msg; } catch { /* ignora */ }
      throw new Error(msg);
    }
    return res.blob();
  },
};

// ── LPAN / FDO (notas de pago a Lloyd's por risk code) ──
export interface FdoRegistro {
  id: number;
  section: number;
  risk_code: string;
  signing_number: string | null;
  work_package: string | null;
  fecha_proceso: string | null;
  work_package_status: string | null;
  fecha_generado: string | null;
  fecha_signing: string | null;
  notas: string | null;
}
export interface LpanRegistro {
  id: number;
  tipo: string;
  periodo: string;
  num_lineas: number;
  gross_premium: number | string | null;
  brokerage: number | string | null;
  tax: number | string | null;
  net_premium: number | string | null;
  broker_ref2: string | null;
  work_package: string | null;
  signing_number: string | null;
  fecha: string | null;
  sdd: string | null;
  liberado: string | null;
  pagado: string | null;
  estado: string;
}
export interface RiskCodeFdo {
  section: number;
  ramo: string | null;
  risk_code: string;
  broker_reference: string;
  fdo: FdoRegistro | null;
}
export interface RcEnSeccion {
  risk_code: string;
  nombre_lpan: string;   // nombre/Broker Ref 2 que tiene (o tendrá) el LPAN de este grupo
  comision_pct: number | string;
  signing_number: string | null;
  num_lineas: number;
  gross_premium: number | string;
  brokerage: number | string;
  tax: number | string;
  net_premium: number | string;
  cobrado: boolean;
  liquidado: boolean;
  exento_lpan: boolean;
  exencion_motivo: string | null;
  cubierto_historico: boolean;
  lpan: LpanRegistro | null;
}
export interface SeccionLpan {
  section: number;
  risk_codes: RcEnSeccion[];
}
export interface PeriodoLpan {
  periodo: string;
  periodo_label: string;
  secciones: SeccionLpan[];
}
export interface VistaLpan {
  es_lloyds: boolean;   // binder con mercado Lloyd's → FDO+signing obligatorio; si no, LPAN sin FDO
  fdos: RiskCodeFdo[];
  periodos: PeriodoLpan[];
}
export interface LpanGlobal {
  id: number;
  tipo: string;
  periodo: string;
  binder_umr: string | null;
  poliza_numero: string | null;
  binder_poliza: string | null;   // UMR del binder o nº de póliza (columna unificada)
  programa: string | null;
  section: number;
  risk_code: string;
  broker_ref1: string | null;
  broker_ref2: string | null;
  signing_number: string | null;
  work_package: string | null;
  gross_premium: number | string | null;
  brokerage: number | string | null;
  tax: number | string | null;
  net_premium: number | string | null;
  fecha: string | null;
  sdd: string | null;
  liberado: string | null;
  pagado: string | null;
  estado: string;
}
export const lpanApi = {
  vista: (binderId: number) => request<VistaLpan>(`/binders/${binderId}/lpan`),
  listarTodos: () => request<LpanGlobal[]>(`/lpans`),
  crearFdo: (binderId: number, section: number, risk_code: string) =>
    request<FdoRegistro>(`/binders/${binderId}/fdo`, { method: "POST", body: JSON.stringify({ section, risk_code }) }),
  actualizarFdo: (fdoId: number, datos: { signing_number?: string | null; work_package?: string | null; fecha_proceso?: string | null; work_package_status?: string | null; fecha_signing?: string | null; notas?: string | null }) =>
    request<FdoRegistro>(`/fdo/${fdoId}`, { method: "PUT", body: JSON.stringify(datos) }),
  borrarFdo: (fdoId: number) => request(`/fdo/${fdoId}`, { method: "DELETE" }),
  // Descarga el Word del FDO (regenerado desde su registro). Devuelve el blob y el nombre propuesto.
  fdoWord: async (fdoId: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/fdo/${fdoId}/word`);
    if (!res.ok) {
      let msg = `Error al generar el Word del FDO (${res.status})`;
      try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const filename = m ? decodeURIComponent(m[1]) : `FDO_${fdoId}.docx`;
    return { blob: await res.blob(), filename };
  },
  generarLpan: (binderId: number, data: { risk_code: string; section: number; periodo: string; comision_pct: number | string; tipo?: string }) =>
    request<LpanRegistro>(`/binders/${binderId}/lpan`, { method: "POST", body: JSON.stringify(data) }),
  // Descarga el Word del LPAN (regenerado desde su registro). Devuelve el blob y el nombre propuesto.
  lpanWord: async (lpanId: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/lpans/${lpanId}/word`);
    if (!res.ok) {
      let msg = `Error al generar el Word del LPAN (${res.status})`;
      try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const filename = m ? decodeURIComponent(m[1]) : `LPAN_${lpanId}.docx`;
    return { blob: await res.blob(), filename };
  },
  marcarExencion: (binderId: number, data: { periodo: string; section: number; risk_code: string; comision_pct: number | string; motivo?: string | null }) =>
    request(`/binders/${binderId}/lpan/exencion`, { method: "POST", body: JSON.stringify(data) }),
  quitarExencion: (binderId: number, periodo: string, section: number, risk_code: string, comision_pct: number | string) =>
    request(`/binders/${binderId}/lpan/exencion?periodo=${encodeURIComponent(periodo)}&section=${section}&risk_code=${encodeURIComponent(risk_code)}&comision_pct=${comision_pct}`, { method: "DELETE" }),
  actualizarLpan: (lpanId: number, datos: { work_package?: string | null; fecha?: string | null; sdd?: string | null; estado?: string | null; liberado?: string | null; pagado?: string | null; signing_number?: string | null }) =>
    request<LpanRegistro>(`/lpan/${lpanId}`, { method: "PUT", body: JSON.stringify(datos) }),
  borrarLpan: (lpanId: number) => request(`/lpan/${lpanId}`, { method: "DELETE" }),
  // LPAN al que pertenece una línea del Risk (o null). Para ver/corregir el LPAN desde el modal de la línea.
  deLinea: (lineId: number) => request<LpanRegistro | null>(`/bdx-lineas/${lineId}/lpan`),
  // Descarga el Excel BDX de un periodo (blob + nombre propuesto), para guardarlo eligiendo carpeta.
  // agrupar=true → LPAN Bdx (agrupado por Risk Code); agrupar=false → Premium Bdx (plano).
  bdxExcel: async (binderId: number, periodo: string, agrupar = true): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/binders/${binderId}/lpan/bdx-excel?periodo=${encodeURIComponent(periodo)}&agrupar=${agrupar}`);
    if (!res.ok) {
      let msg = `Error al generar el Excel BDX (${res.status})`;
      try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const mUtf = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const mPlain = /filename="?([^";]+)"?/i.exec(cd);
    const filename = mUtf ? decodeURIComponent(mUtf[1]) : mPlain ? mPlain[1] : `BDX ${periodo}.xlsx`;
    return { blob: await res.blob(), filename };
  },
};

// ── Claims BDX (bordereau de siniestros por binder) ──
export interface ClaimsBdxVista {
  periodo: string;
  meses: string[];            // periodos ya presentados (para ver)
  meses_pendientes: string[]; // meses sin presentar (para presentar)
  presentado: boolean;
  bloqueado: boolean;
  headers: string[];
  filas: Record<string, unknown>[];
}
export const claimsBdxApi = {
  vista: (binderId: number, periodo?: string) =>
    request<ClaimsBdxVista>(`/binders/${binderId}/claims-bdx${periodo ? `?periodo=${periodo}` : ""}`),
  periodos: (binderId: number) =>
    request<{ periodo: string; n: number; fecha: string | null }[]>(`/binders/${binderId}/claims-bdx/periodos`),
  presentar: (binderId: number, periodo: string, usuario?: string) =>
    request(`/binders/${binderId}/claims-bdx/presentar`, { method: "POST", body: JSON.stringify({ periodo, usuario }) }),
  excel: async (binderId: number, periodo: string, modo: "vivo" | "presentado" = "vivo"): Promise<Blob> => {
    const res = await fetch(`${BASE}/binders/${binderId}/claims-bdx/excel?periodo=${periodo}&modo=${modo}`);
    if (!res.ok) throw new Error(`Error al generar el Claims BDX (${res.status})`);
    return res.blob();
  },
};

// ── Triangulación de siniestralidad ──
export type MetricaTriangulo = "incurrido" | "pagado" | "num" | "pct";
export interface TriAmbito { seccion?: number; risk_code?: string }
function _ambitoQS(a?: TriAmbito): string {
  const p = new URLSearchParams();
  if (a?.seccion != null) p.set("seccion", String(a.seccion));
  if (a?.risk_code) p.set("risk_code", a.risk_code);
  const s = p.toString();
  return s ? `?${s}` : "";
}
export interface Triangulacion {
  meses: string[];                    // eje de meses (filas = origen, columnas = valuación)
  net_premium_mes: number[];          // Net to UWs por mes (alineado con meses)
  triangulos: Record<"incurrido" | "pagado" | "num", (number | null)[][]>; // [origen][valuación]
  gwp_our_line: number;               // GWP our line bruto (Σ líneas Risk del ámbito)
  net_uw: number;                     // GWP our line − com. coverholder − brokerage
  incurrido_actual: number;
  ibnr_sugerido: number;
  ultimate_sugerido: number;
  secciones: number[];                // ámbitos disponibles
  risk_codes: string[];
  ambito: string;                     // etiqueta del ámbito actual
}
export interface TriangulacionPrograma {
  programa: string;
  binders: { id: number; umr: string; agreement: string; yoa: string | null }[];
  max_edad: number;
  mes_inicio: number;                 // mes (1-12) de inicio del programa, para etiquetar Año/Mes
  risk_codes: string[];               // risk codes disponibles (para el selector de categoría)
  risk_code: string | null;           // risk code aplicado (null = TOTAL)
  triangulos: Record<MetricaTriangulo, (number | null)[][]>; // filas = binders, cols = antigüedad
  prima_acum_binder: (number | null)[][]; // prima Net to UWs acumulada por antigüedad (para el ratio)
  premium_binder: number[];
  net_uw_binder: number[];
  incurrido_binder: number[];
  ultimate_binder: number[];
  ibnr_binder: number[];
  incurrido_total: number;
  ultimate_total: number;
  ibnr_total: number;
  premium_total: number;
  net_uw_total: number;
}
export const triangulacionApi = {
  deBinder: (binderId: number, ambito?: TriAmbito) =>
    request<Triangulacion>(`/binders/${binderId}/triangulacion${_ambitoQS(ambito)}`),
  dePrograma: (programaId: number, riskCode?: string | null) =>
    request<TriangulacionPrograma>(
      `/programas/${programaId}/triangulacion${riskCode ? `?risk_code=${encodeURIComponent(riskCode)}` : ""}`
    ),
  excelBinder: async (binderId: number, metrica: MetricaTriangulo, ambito?: TriAmbito): Promise<Blob> => {
    const p = new URLSearchParams({ metrica });
    if (ambito?.seccion != null) p.set("seccion", String(ambito.seccion));
    if (ambito?.risk_code) p.set("risk_code", ambito.risk_code);
    const res = await fetch(`${BASE}/binders/${binderId}/triangulacion/excel?${p.toString()}`);
    if (!res.ok) throw new Error(`Error al generar el Excel (${res.status})`);
    return res.blob();
  },
};

// ── Consultoría (honorarios) ──
export interface ConsultoriaContrato {
  id: number;
  productor_id: number;
  productor_nombre?: string | null;
  concepto?: string | null;
  fecha_inicio: string;
  duracion_meses?: number | null;
  frecuencia: string;
  importe: number | string;
  sujeto_impuestos: boolean;
  impuestos_porc: number | string;
  moneda: string;
  cuenta_bancaria_id?: number | null;
  cuenta_bancaria_nombre?: string | null;
  dia_facturacion?: number | null;
  aviso_dias_antes: number;
  estado: string;
  notas?: string | null;
  n_cobros: number;
  n_generados: number;
  proximo_cobro?: string | null;
}
export interface ConsultoriaCobro {
  periodo: string;
  fecha: string;
  base: number;
  iva: number;
  total: number;
  recibo_id: number | null;
  recibo_numero: string | null;
  recibo_cobrado?: boolean;
}
export const consultoriaApi = {
  list: () => request<ConsultoriaContrato[]>("/consultoria"),
  crear: (d: unknown) => request<ConsultoriaContrato>("/consultoria", { method: "POST", body: JSON.stringify(d) }),
  editar: (id: number, d: unknown) => request<ConsultoriaContrato>(`/consultoria/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  borrar: (id: number) => request(`/consultoria/${id}`, { method: "DELETE" }),
  cobros: (id: number) => request<{ contrato_id: number; moneda: string; cobros: ConsultoriaCobro[] }>(`/consultoria/${id}/cobros`),
  generarCobro: (id: number, periodo: string) =>
    request(`/consultoria/${id}/cobros/generar`, { method: "POST", body: JSON.stringify({ periodo }) }),
  generarFactura: (id: number, periodo: string) =>
    request<{ recibo_id: number; numero: string; periodo: string }>(
      `/consultoria/${id}/cobros/generar-factura`, { method: "POST", body: JSON.stringify({ periodo }) }),
};

// ── Comisiones (liquidación mensual; fuente Iberian) ──
export interface MesComision {
  periodo: string;
  base_prima?: number | string;       // Σ GWP (our line) del mes (base del 10%)
  comision_premium: number | string;
  liq_id?: number | null;
  estado?: string | null;             // Preparado | Ratificado
  comision?: number | string | null;
  cedida?: number | string | null;
  retenida?: number | string | null;
  pago1_nombre?: string | null;
  pago1_importe?: number | string | null;
  pago2_nombre?: string | null;
  pago2_importe?: number | string | null;
  recibo_numero?: string | null;
  recibos?: string[];
}
export const comisionesApi = {
  iberian: () => request<MesComision[]>("/comisiones/iberian"),
  preparar: (periodo: string) => request<MesComision>(`/comisiones/iberian/${periodo}/preparar`, { method: "POST" }),
  reparto: (periodo: string, d: { pago1_importe?: number | null; pago2_importe?: number | null; comision_definitiva?: number | null }) =>
    request<MesComision>(`/comisiones/iberian/${periodo}/reparto`, { method: "PUT", body: JSON.stringify(d) }),
  borrar: (liqId: number) => request(`/comisiones/${liqId}`, { method: "DELETE" }),
};

// ── Transferencias (ledger de movimientos de dinero) ──
export interface Transferencia {
  id: number;
  origen: string;
  tipo: string;
  subtipo: string;
  sentido: string;                  // entrada | salida | interno
  fecha?: string | null;
  anio?: number | null;
  periodo?: string | null;
  importe: number | string;
  numero_poliza?: string | null;
  recibo_id?: number | null;
  recibo_num?: string | null;
  binder_id?: number | null;
  siniestro_id?: number | null;
  mercado?: string | null;
  cuenta_origen?: string | null;
  cuenta_destino?: string | null;
  notas?: string | null;
  manual: boolean;
}
export interface TransferenciaListada {
  items: Transferencia[];
  total_entradas: number | string;
  total_salidas: number | string;
  total_traspasos: number | string;
  neto: number | string;
  n_total: number;
  primas_cobros: number | string;
  primas_liquidaciones: number | string;
  comisiones_liquidacion: number | string;
  comisiones_traspaso: number | string;
  primas_total: number | string;
  siniestros_cobros: number | string;
  siniestros_liquidaciones: number | string;
  siniestros_total: number | string;
}
export interface TransferenciasOpciones {
  origenes: string[];
  tipos: string[];
  subtipos: string[];
  anios: number[];
  cuentas: string[];
  cuentas_activas: string[];              // cuentas bancarias activas (desplegables del alta)
  umr_mercado: Record<string, string>;   // UMR / nº póliza → mercado(s), para autocompletar
}
export interface TransferenciaFiltros {
  anio?: number | null;
  origen?: string | null;
  tipo?: string | null;
  subtipo?: string | null;
  sentido?: string | null;
  cuenta?: string | null;
  q?: string | null;
  limit?: number;
}
export const transferenciasApi = {
  listar: (f: TransferenciaFiltros = {}) => {
    const qs = new URLSearchParams();
    if (f.anio) qs.set("anio", String(f.anio));
    if (f.origen) qs.set("origen", f.origen);
    if (f.tipo) qs.set("tipo", f.tipo);
    if (f.subtipo) qs.set("subtipo", f.subtipo);
    if (f.sentido) qs.set("sentido", f.sentido);
    if (f.cuenta) qs.set("cuenta", f.cuenta);
    if (f.q) qs.set("q", f.q);
    if (f.limit) qs.set("limit", String(f.limit));
    const s = qs.toString();
    return request<TransferenciaListada>(`/transferencias${s ? `?${s}` : ""}`);
  },
  opciones: () => request<TransferenciasOpciones>("/transferencias/opciones"),
  crear: (d: Partial<Transferencia>) => request<Transferencia>("/transferencias", { method: "POST", body: JSON.stringify(d) }),
  editar: (id: number, d: Partial<Transferencia>) => request<Transferencia>(`/transferencias/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  borrar: (id: number) => request(`/transferencias/${id}`, { method: "DELETE" }),
};

// ── Contabilidad (libro de banco categorizado) ──
export interface MovimientoBancario {
  id: number;
  cuenta: string;
  iden?: number | null;
  identificador?: string | null;
  fecha?: string | null;
  devengo?: string | null;
  anio?: number | null;
  concepto?: string | null;
  grupo?: string | null;
  tipo?: string | null;              // Gasto | Ingreso
  gasto: number | string;
  ingreso: number | string;
  saldo?: number | string | null;
  descripcion?: string | null;
  codigo?: string | null;
  movimiento_bancario?: boolean;
  tarjeta: boolean;
  factura: boolean;
  conciliado: boolean;
  transferencia_ids?: number[] | null;
  ajustes_justif?: AjusteJustif[] | null;
}
export interface ContaCategoria { concepto: string; grupo: string | null; tipo: string | null; cuenta_contable: string | null }
// Fila POR RECIBO del justificante. Varias filas pueden compartir transferencia_id (un cobro que
// paga varios recibos); el cuadre con el apunte se hace por transferencia (importe_transferencia).
export interface ReciboJustif {
  transferencia_id: number;
  importe_transferencia: number | string;
  fecha: string | null;
  premium_bdx: string | null;          // periodo del Premium (para el justificante)
  importe: number | string;            // importe individual de ESTE recibo
  referencia: string | null;
  recibo: string | null;
  cliente: string | null;
  mercado: string | null;
}
export interface AjusteJustif { texto: string; importe: number }
export interface BaseAlta { ultimo_saldo: number | string | null; next_iden: number }
export interface MovimientoCrear {
  cuenta: string; fecha: string; devengo?: string | null; tipo: string;
  grupo?: string | null; concepto?: string | null; importe: number;
  saldo?: number | null; descripcion?: string | null;
  movimiento_bancario?: boolean; factura?: boolean; tarjeta?: boolean;
  transferencia_ids?: number[] | null;
  ajustes_justif?: AjusteJustif[] | null;
}
export interface MovimientosListados {
  items: MovimientoBancario[];
  total_gasto: number | string;
  total_ingreso: number | string;
  neto: number | string;
  saldo_cuenta: number | string | null;
  n_total: number;
}
export interface OpcionesConta {
  cuentas: string[];
  grupos: string[];
  tipos: string[];
  conceptos: string[];
  anios: number[];
}
export interface ContaFiltros {
  cuenta?: string | null;
  anio?: number | null;
  grupo?: string | null;
  tipo?: string | null;
  concepto?: string | null;
  q?: string | null;
  limit?: number;
}
export const contabilidadApi = {
  listar: (f: ContaFiltros = {}) => {
    const qs = new URLSearchParams();
    if (f.cuenta) qs.set("cuenta", f.cuenta);
    if (f.anio) qs.set("anio", String(f.anio));
    if (f.grupo) qs.set("grupo", f.grupo);
    if (f.tipo) qs.set("tipo", f.tipo);
    if (f.concepto) qs.set("concepto", f.concepto);
    if (f.q) qs.set("q", f.q);
    if (f.limit) qs.set("limit", String(f.limit));
    const s = qs.toString();
    return request<MovimientosListados>(`/contabilidad${s ? `?${s}` : ""}`);
  },
  opciones: () => request<OpcionesConta>("/contabilidad/opciones"),
  categorias: () => request<ContaCategoria[]>("/contabilidad/categorias"),
  base: (cuenta: string, anio: number) => request<BaseAlta>(`/contabilidad/base?cuenta=${encodeURIComponent(cuenta)}&anio=${anio}`),
  crear: (d: MovimientoCrear) => request<MovimientoBancario>("/contabilidad", { method: "POST", body: JSON.stringify(d) }),
  actualizar: (id: number, d: Partial<{ fecha: string; devengo: string | null; tipo: string; grupo: string | null; concepto: string | null; importe: number; saldo: number | null; descripcion: string | null; factura: boolean; tarjeta: boolean; movimiento_bancario: boolean; transferencia_ids: number[] | null; ajustes_justif: AjusteJustif[] | null }>) =>
    request<MovimientoBancario>(`/contabilidad/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  // Transferencias candidatas para el justificante (clase: cobro | liquidacion | traspaso), filtradas
  // por la fecha del movimiento (±dias de ventana) y ocultando las ya usadas en otro apunte.
  transferenciasJustificante: (clase: string, opts: { fecha?: string; ambito?: string; excluirMid?: number; dias?: number } = {}) => {
    const qs = new URLSearchParams({ clase });
    if (opts.fecha) qs.set("fecha", opts.fecha);
    if (opts.ambito) qs.set("ambito", opts.ambito);
    if (opts.excluirMid != null) qs.set("excluir_mid", String(opts.excluirMid));
    if (opts.dias != null) qs.set("dias", String(opts.dias));
    return request<ReciboJustif[]>(`/contabilidad/transferencias-justificante?${qs.toString()}`);
  },
  // Descarga el PDF del justificante de un apunte (con los recibos ya asociados).
  justificantePdf: async (mid: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/contabilidad/${mid}/justificante.pdf`);
    if (!res.ok) {
      let msg = `Error al generar el justificante (${res.status})`;
      try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* sin cuerpo */ }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : `justificante_${mid}.pdf` };
  },
  // Importar extracto Norma 43: preview (parsea + propone categoría + dedup) y alta en bloque.
  importarPreview: (file: File, cuenta?: string) => {
    const fd = new FormData(); fd.append("file", file);
    if (cuenta) fd.append("cuenta", cuenta);
    return requestForm<ImportPreview>("/contabilidad/importar/preview", fd);
  },
  importarAplicar: (payload: ImportAplicar) =>
    request<{ creados: number; saltados: number }>("/contabilidad/importar/aplicar", { method: "POST", body: JSON.stringify(payload) }),
  // Conciliación (Fase B): propone las transferencias que cuadran cada apunte de seguros; aplica lo confirmado.
  conciliarPreview: (cuenta: string, dias = 7, desde?: string) => {
    const qs = new URLSearchParams({ cuenta, dias: String(dias) });
    if (desde) qs.set("desde", desde);
    return request<ConcPreview>(`/contabilidad/conciliar/preview?${qs.toString()}`);
  },
  conciliarAplicar: (items: { mid: number; transferencia_ids: number[] }[]) =>
    request<{ conciliados: number; conflictos: number[] }>("/contabilidad/conciliar/aplicar", { method: "POST", body: JSON.stringify({ items }) }),
};

export interface ConcApunte {
  mid: number;
  fecha: string | null;
  importe: number | string;
  concepto: string | null;
  cuenta: string;
  clase: string;
  ambito: string | null;
  filas: ReciboJustif[];
  preseleccion: number[];
  suma_pre: number | string;
  residual: number | string;
  confianza: "exacta" | "revisar" | "sin_candidatas";
}
export interface ConcPreview {
  cuenta: string | null;
  dias: number;
  n_exactas: number;
  n_revisar: number;
  n_sin: number;
  apuntes: ConcApunte[];
}

export interface MovImportado {
  fecha: string | null;
  fecha_valor: string | null;
  importe: number;
  tipo: string;
  descripcion: string;
  concepto: string | null;
  grupo: string | null;
  tarjeta: boolean;
  saldo: number | null;
  huella: string;
  estado: "nuevo" | "importado" | "posible";
  dup_id: number | null;
}
export interface ImportPreview {
  cuenta_sugerida: string | null;
  cuentas: string[];
  banco: string;
  cuenta_banco: string;
  nombre_banco: string;
  periodo_ini: string | null;
  periodo_fin: string | null;
  saldo_ini: number | null;
  saldo_fin: number | null;
  cuadra: boolean;
  n_nuevos: number;
  n_importados: number;
  n_posibles: number;
  movimientos: MovImportado[];
}
export interface MovAAlta {
  fecha: string;
  devengo?: string | null;
  tipo: string;
  grupo?: string | null;
  concepto?: string | null;
  importe: number;
  saldo?: number | null;
  descripcion?: string | null;
  tarjeta?: boolean;
  huella?: string | null;
}
export interface ImportAplicar { cuenta: string; movimientos: MovAAlta[] }

// ── Tareas recurrentes manuales por binder ──
export interface Tarea {
  id: number;
  binder_id: number;
  titulo: string;
  descripcion?: string | null;
  categoria: string;
  origen: string;
  frecuencia: string;
  intervalo_meses?: number | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  aviso_dias_antes: number;
  estado: string;
  secuencial: boolean;          // pasos secuenciales (cada uno se desbloquea al completar el anterior)
  binder_umr?: string | null;
  agencia?: string | null;
  programa?: string | null;
  n_ocurrencias: number;
  n_hechas: number;
  n_pasos: number;
  proxima?: string | null;
}
export interface TareaPaso {
  id: number;
  tarea_id: number;
  orden: number;
  titulo: string;
  regla_auto?: string | null;   // risk | premium | lpan | claims | null (manual)
}
export interface TareaPasoEstado {
  paso_id: number;
  titulo: string;
  orden: number;
  regla_auto?: string | null;
  auto: boolean;                // marcado por la regla (dato presente), no a mano
  periodo?: string | null;      // periodo YYYY-MM que comprueba la regla en esta entrega
  hecho: boolean;
  fecha_hecha?: string | null;
  bloqueado?: boolean;          // tarea secuencial: hay un paso anterior sin completar (no marcable aún)
}
export interface TareaOcurrencia {
  fecha: string;
  hecha: boolean;
  fecha_hecha?: string | null;
  notas?: string | null;
  estado: string;   // hecha | vencida | pendiente | futura
  pasos: TareaPasoEstado[];   // checklist de esta ocurrencia (vacío si la tarea no tiene pasos)
}
export const tareasApi = {
  listAll: () => request<Tarea[]>("/tareas"),
  list: (binderId: number) => request<Tarea[]>(`/binders/${binderId}/tareas`),
  crear: (binderId: number, d: unknown) => request<Tarea>(`/binders/${binderId}/tareas`, { method: "POST", body: JSON.stringify(d) }),
  editar: (id: number, d: unknown) => request<Tarea>(`/tareas/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  borrar: (id: number) => request(`/tareas/${id}`, { method: "DELETE" }),
  ocurrencias: (id: number, incluirFuturas = false) =>
    request<{ tarea_id: number; titulo: string; ocurrencias: TareaOcurrencia[] }>(
      `/tareas/${id}/ocurrencias${incluirFuturas ? "?incluir_futuras=true" : ""}`),
  marcarHecha: (id: number, body: { fecha_ocurrencia: string; fecha_hecha?: string | null; notas?: string | null; deshacer?: boolean }) =>
    request(`/tareas/${id}/hecha`, { method: "POST", body: JSON.stringify(body) }),
  // ── Pasos (checklist) ──
  pasos: (id: number) => request<TareaPaso[]>(`/tareas/${id}/pasos`),
  crearPaso: (id: number, body: { titulo: string; orden?: number; regla_auto?: string | null }) =>
    request<TareaPaso>(`/tareas/${id}/pasos`, { method: "POST", body: JSON.stringify(body) }),
  editarPaso: (pasoId: number, body: { titulo?: string; orden?: number; regla_auto?: string | null }) =>
    request<TareaPaso>(`/pasos/${pasoId}`, { method: "PUT", body: JSON.stringify(body) }),
  borrarPaso: (pasoId: number) => request(`/pasos/${pasoId}`, { method: "DELETE" }),
  marcarPaso: (pasoId: number, body: { fecha_ocurrencia: string; deshacer?: boolean }) =>
    request(`/pasos/${pasoId}/hecho`, { method: "POST", body: JSON.stringify(body) }),
  sincronizarTodas: () => request<{ binders: number; creadas: number; actualizadas: number }>("/tareas/sincronizar-auto", { method: "POST" }),
  sincronizarBinder: (binderId: number) => request<{ creadas: number; actualizadas: number }>(`/binders/${binderId}/tareas/sincronizar-auto`, { method: "POST" }),
  // Info del binder anterior del mismo programa (para ofrecer copiar su esquema de tareas).
  tareasAnterior: (binderId: number) => request<{ binder_id: number | null; binder_umr: string | null; n_tareas: number }>(`/binders/${binderId}/tareas/anterior`),
  copiarAnterior: (binderId: number) => request<{ tareas: number; pasos: number; desde_binder_id: number; desde_binder_umr: string | null }>(`/binders/${binderId}/tareas/copiar-anterior`, { method: "POST" }),
  agenda: (p?: { binderId?: number; soloPendientes?: boolean }) => {
    const q = new URLSearchParams();
    if (p?.binderId != null) q.set("binder_id", String(p.binderId));
    if (p?.soloPendientes) q.set("solo_pendientes", "true");
    const qs = q.toString();
    return request<TareaAgendaItem[]>(`/tareas/agenda${qs ? `?${qs}` : ""}`);
  },
};
export interface TareaAgendaItem {
  tarea_id: number;
  titulo: string;
  categoria: string;
  origen: string;
  binder_id: number;
  binder_umr?: string | null;
  agencia?: string | null;
  programa?: string | null;
  fecha: string;
  estado: string;
  fecha_hecha?: string | null;
  pasos: TareaPasoEstado[];
  n_pasos: number;
  n_pasos_hechos: number;
}

// ── Cierre contable mensual ──
export interface CierreMes {
  mes: number;
  nombre: string;
  recibos: number;
  acumulado: number;
  cerrado: boolean;
  fecha: string | null; // fecha de envío a contabilidad
}
export const cierresApi = {
  resumen: (anio: number) =>
    request<{ anio: number; meses: CierreMes[]; anio_cerrado: boolean; puede_cerrar_anio: boolean; anio_fecha: string | null }>(
      `/cierres/resumen?anio=${anio}`
    ),
  cerrar: (anio: number, mes: number, fecha: string, usuario?: string) =>
    request(`/cierres`, { method: "POST", body: JSON.stringify({ anio, mes, fecha, usuario }) }),
  reabrir: (anio: number, mes: number) => request<void>(`/cierres/${anio}/${mes}`, { method: "DELETE" }),
  cerrarAnio: (anio: number, fecha: string, usuario?: string) =>
    request(`/cierres/${anio}/cerrar-anio`, { method: "POST", body: JSON.stringify({ fecha, usuario }) }),
  reabrirAnio: (anio: number) => request<void>(`/cierres/${anio}/anio`, { method: "DELETE" }),
  excel: async (anio: number, mes: number): Promise<Blob> => {
    const res = await fetch(`${BASE}/cierres/${anio}/${mes}/excel`);
    if (!res.ok) throw new Error(`Error al generar el Excel (${res.status})`);
    return res.blob();
  },
};

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
import type { Suplemento, BinderWrite, Binder } from "./types";
export function listarSuplementos(binderId: number) {
  return request<Suplemento[]>(`/binders/${binderId}/suplementos`);
}
// Binders que pertenecen a un programa (cadena de la triangulación).
export function bindersDePrograma(programaId: number) {
  return request<Binder[]>(`/binders?programa_id=${programaId}`);
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
  // Subir Risk BDX desde un Excel del navegador (multipart): preview (no escribe) → import.
  riskExcelPreview: (binderId: number, file: File, hoja?: string) => {
    const fd = new FormData(); fd.append("file", file);
    if (hoja) fd.append("hoja", hoja);
    return requestForm<RiskExcelPreview>(`/binders/${binderId}/bdx/risk-excel-preview`, fd);
  },
  riskExcelImport: (binderId: number, file: File, hoja?: string) => {
    const fd = new FormData(); fd.append("file", file);
    if (hoja) fd.append("hoja", hoja);
    return requestForm<RiskExcelImportResult>(`/binders/${binderId}/bdx/risk-excel-import`, fd);
  },
  // Mapeo editable de columnas (alias por programa)
  bdxCampos: (tipo = "risk") => request<BdxCampo[]>(`/bdx/campos?tipo=${tipo}`),
  bdxAliasList: (binderId: number, tipo = "risk") => request<BdxAlias[]>(`/binders/${binderId}/bdx/alias?tipo=${tipo}`),
  bdxAliasCrear: (binderId: number, body: { tipo?: string; campo: string; alias_columna: string }) =>
    request<BdxAlias>(`/binders/${binderId}/bdx/alias`, { method: "POST", body: JSON.stringify(body) }),
  bdxAliasBorrar: (aliasId: number) => request<void>(`/bdx/alias/${aliasId}`, { method: "DELETE" }),
};

export interface BdxCampo { campo: string; label: string }
export interface BdxAlias { id: number; campo: string; alias_columna: string; programa_id: number | null; es_global: boolean }

export interface RiskExcelPreview {
  hojas: string[];
  hoja: string;
  por_seccion: Record<string, number>;
  auto_seccion: number;
  sin_seccion: number;
  periodos_ya_cargados: string[];
  n_lineas: number;
  periodos: string[];
  total_gwp_our_line: number;
  total_gwp_100: number;
  total_prima_traspasar: number;
  total_liquidar: number;
  mapeadas: Record<string, string>;
  sin_mapear: string[];
  sin_periodo: number;
  problemas: { nivel: "bloqueante" | "aviso"; texto: string }[];
  bloqueado: boolean;
  muestra: { certificado: string | null; asegurado: string | null; section_no: number | null; risk_code: string | null; reporting: string | null; gwp_our_line: number | null; comision_pct: number; prima_traspasar: number | null; liquidar: number | null }[];
}
export interface RiskExcelImportResult {
  bdx_id: number;
  insertadas: number;
  omitidas_periodo: number;
  periodos_omitidos: string[];
  auto_seccion: number;
  sin_seccion: number;
  total_lineas: number;
  periodos: string[];
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
  // Gestión íntegra de un recibo OM/Fees/Comisiones: cobrar | liquidar | traspasar | pagar (+ deshacer).
  gestion: (
    id: number,
    accion: "cobrar" | "liquidar" | "traspasar" | "pagar",
    opts?: { fecha?: string; deshacer?: boolean; cuenta_id?: number | null; cuenta_destino_id?: number | null }
  ) =>
    request<Recibo>(`/recibos/${id}/gestion`, {
      method: "POST",
      body: JSON.stringify({ accion, deshacer: false, ...opts }),
    }),
  // Documento Word del recibo (una plantilla por tipo; de momento solo Consultoría). Descarga el
  // .docx y devuelve también el nombre de archivo que propone el servidor.
  word: async (id: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/recibos/${id}/word`);
    if (!res.ok) {
      let msg = `Error al generar el Word (${res.status})`;
      try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const filename = m ? decodeURIComponent(m[1]) : `recibo_${id}.docx`;
    return { blob: await res.blob(), filename };
  },
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
  guardarNotaPremium: (binderId: number, periodo: string, nota: string | null) =>
    request<{ periodo: string; nota: string | null }>(`/binders/${binderId}/premium/nota`, { method: "PUT", body: JSON.stringify({ periodo, nota }) }),
  // Sube el fichero SOLO si no hay token (el backend lo cachea y devuelve token para reusarlo).
  excelPreview: (binderId: number, file: File | null, hoja?: string, token?: string) => {
    const fd = new FormData();
    if (token) fd.append("token", token); else if (file) fd.append("file", file);
    if (hoja) fd.append("hoja", hoja);
    return requestForm<ExcelPreview>(`/binders/${binderId}/premium/excel-preview`, fd);
  },
  matchExcel: (binderId: number, file: File | null, data: { hoja: string; certificado: string; importe: string | null; periodo: string }, token?: string) => {
    const fd = new FormData();
    if (token) fd.append("token", token); else if (file) fd.append("file", file);
    fd.append("hoja", data.hoja); fd.append("certificado", data.certificado);
    if (data.importe) fd.append("importe", data.importe); fd.append("periodo", data.periodo);
    return requestForm<MatchResult>(`/binders/${binderId}/premium/match-excel`, fd);
  },
};

export interface PremiumGrupo {
  periodo: string;
  num_lineas: number;
  prima: string;
  comision: string;
  a_liquidar: string;
  prima_lloyds: string;
  cobrado: boolean;
  traspasado: boolean;
  liquidado: boolean;
  tiene_recibo: boolean;
  fecha_pago: string | null;
  fecha_traspaso: string | null;
  fecha_liquidacion: string | null;
  nota: string | null;
}
export interface ExcelPreview {
  hojas: string[];
  hoja: string;
  token: string;
  columnas: string[];
  n_filas: number;
  muestra: Record<string, string>[];
  mapeo: { certificado: string | null; importe: string | null };
}
export interface MatchRow {
  certificate_ref: string;
  importe_excel: string | null;
  estado: "match" | "importe_distinto" | "no_encontrada";
  linea_id: number | null;
  importe_risk: string | null;
  risk_bdx: string | null;   // periodo(s) 'YYYY-MM' del Risk ('a / b' si son varias líneas)
  risk_lineas: number;       // nº de líneas del Risk que representa esta fila (>1 = macheo por suma)
}
export interface MatchResult {
  periodo: string;
  filas: MatchRow[];
  matched_ids: number[];
  resumen: { total: number; match: number; importe_distinto: number; no_encontrada: number };
  premium: { cobrar: number | string; traspasar: number | string; liquidar: number | string };
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

// Resumen del binder: Σ GWP (our line) por Sección, Mercado y Risk Code.
export interface ResumenItem { clave: string; gwp: number | string }
export interface ResumenBinder {
  total: number | string;
  por_seccion: ResumenItem[];
  por_mercado: ResumenItem[];
  por_risk_code: ResumenItem[];
}
export function resumenBinder(id: number) {
  return request<ResumenBinder>(`/binders/${id}/resumen`);
}

// Evolución comparativa año a año del programa: prima (GWP our line) acumulada por mes de
// cobertura de cada binder del mismo programa, alineada al mes de efecto.
export interface EvolucionPunto { mes: number; acumulado: number }
export interface EvolucionSerie {
  id: number; etiqueta: string; yoa: string | null; fecha_efecto: string | null;
  total: number; es_actual: boolean; puntos: EvolucionPunto[];
}
export interface EvolucionPrograma {
  programa: string | null; binder_actual: number; series: EvolucionSerie[];
}
export function evolucionPrograma(id: number) {
  return request<EvolucionPrograma>(`/binders/${id}/evolucion-programa`);
}

// ── KPIs (cuadro de mando) ──
export interface Kpis {
  anio: number;
  produccion: {
    prima_anio: number; prima_anterior: number;
    comis_ret_anio: number; comis_ret_anterior: number;
    facturacion_anio: number; facturacion_anterior: number;
    proyeccion: number | null;
    comis_ret_anterior_full: number;
    corte_mes: number;
    binders_en_vigor: number; polizas_en_vigor: number;
    comis_ret_serie: { anio: number; valor: number }[];
    comis_neta_mensual: { anio: number; valores: number[] }[];
  };
  financiero: {
    pendiente_cobro: number; pendiente_liquidacion: number;
    pendiente_traspaso: number; pendiente_pago: number;
  };
  operativo: {
    alertas: number; avisos_dia: number;
    recibos_por_generar: number; tareas_pendientes: number; lpan_pendientes: number;
  };
}
export function getKpis(anio?: number) {
  return request<Kpis>(`/kpis${anio ? `?anio=${anio}` : ""}`);
}

// ── DGSFP: módulo de Agencias de Suscripción (registro público + ficha manual) ──
export interface DgsfpResumen {
  actualizado: string | null;
  n_agencias: number; n_agencias_activas: number;
  n_aseguradoras: number; n_vinculos: number; n_sin_licencia: number;
}
export interface DgsfpVinculo {
  id: number;
  aseguradora_clave: string; aseguradora_nombre: string; aseguradora_nif: string | null;
  aseguradora_situacion: string | null; aseguradora_licencia_activa: boolean;
  agencia_clave: string; agencia_nombre: string;
  activo: boolean; en_dgsfp: boolean;
}
export interface AgenciaLista {
  clave: string; nombre: string; cif: string | null;
  localidad: string | null; provincia: string | null;
  activo: boolean; dudoso: boolean; revisado: boolean;
  n_vinculos: number; n_vinculos_activos: number;
}
export interface AgenciaFicha {
  clave: string; nombre: string; cif: string | null; fecha_constitucion: string | null;
  direccion: string | null; cp: string | null; localidad: string | null; provincia: string | null;
  pais: string | null; contacto: string | null; telefono: string | null; web: string | null;
  productos: string | null; notas: string | null;
  activo: boolean; dudoso: boolean; revisado: boolean;
  vinculos: DgsfpVinculo[];
}
export type AgenciaUpdate = Partial<Omit<AgenciaFicha, "clave" | "vinculos">>;

export function getDgsfpResumen() { return request<DgsfpResumen>("/dgsfp/resumen"); }
export function getDgsfpVinculos() { return request<DgsfpVinculo[]>("/dgsfp/vinculos"); }
export function getDgsfpAgencias() { return request<AgenciaLista[]>("/dgsfp/agencias"); }
export function getDgsfpAgencia(clave: string) { return request<AgenciaFicha>(`/dgsfp/agencias/${clave}`); }
export function updateDgsfpAgencia(clave: string, data: AgenciaUpdate) {
  return request<AgenciaFicha>(`/dgsfp/agencias/${clave}`, { method: "PUT", body: JSON.stringify(data) });
}
export function updateDgsfpVinculo(id: number, data: { activo?: boolean }) {
  return request<DgsfpVinculo>(`/dgsfp/vinculos/${id}`, { method: "PUT", body: JSON.stringify(data) });
}
// Informe de cambios (existe mientras haya cambios sin revisar).
export interface DgsfpInforme { fecha: string; ruta: string; contenido: string }
export function getDgsfpInforme() { return request<DgsfpInforme | null>("/dgsfp/informe"); }
export function abrirDgsfpInforme() { return request<{ ok: boolean }>("/dgsfp/informe/abrir", { method: "POST" }); }
export function eliminarDgsfpInforme() { return request<{ eliminados: number }>("/dgsfp/informe", { method: "DELETE" }); }

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

// ── Avisos / tareas pendientes (calculados al vuelo en el backend) ──
export interface Aviso {
  tipo: string;
  severidad: string;
  nivel: string;            // alto | medio | bajo (semáforo)
  categoria: string;        // alerta (gordos) | dia (rutina/tareas)
  titulo: string;
  detalle: string;
  binder_id: number | null;
  limite_id?: number | null;
  contrato_id?: number | null;
  periodo?: string | null;
  umr: string | null;
  periodos: string[];
  pagina: string | null;
}
export interface AvisoNivel {
  tipo: string;
  etiqueta: string;
  nivel: string;
  categoria: string;        // alerta | dia
}
export const avisosApi = {
  listar: () => request<Aviso[]>(`/avisos`),
  niveles: () => request<AvisoNivel[]>(`/avisos/niveles`),
  fijarNivel: (tipo: string, nivel: string) =>
    request<AvisoNivel>(`/avisos/niveles/${tipo}`, { method: "PUT", body: JSON.stringify({ nivel }) }),
  fijarCategoria: (tipo: string, categoria: string) =>
    request<AvisoNivel>(`/avisos/niveles/${tipo}/categoria`, { method: "PUT", body: JSON.stringify({ categoria }) }),
};

// ── Manual de uso (secciones editables) ──
export const manualApi = {
  listar: () => request<import("./types").ManualSeccion[]>(`/manual`),
  crear: (datos: import("./types").ManualSeccionWrite) =>
    request<import("./types").ManualSeccion>(`/manual`, { method: "POST", body: JSON.stringify(datos) }),
  actualizar: (id: number, datos: import("./types").ManualSeccionWrite) =>
    request<import("./types").ManualSeccion>(`/manual/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  borrar: (id: number) => request<void>(`/manual/${id}`, { method: "DELETE" }),
  reordenar: (ids: number[]) =>
    request<import("./types").ManualSeccion[]>(`/manual/reordenar`, { method: "PUT", body: JSON.stringify({ ids }) }),
};
