// Formato numérico ÚNICO de Mayrit: miles con punto y decimales con coma.
// Manual (no usa Intl) porque el locale es-ES NO agrupa los números de 4 cifras
// (1234 → "1234") y aquí queremos agruparlos siempre (1234 → "1.234").
export function fmtMiles(v: unknown, decimals = 2, thousands = true): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  const [ent, dec] = Math.abs(n).toFixed(decimals).split(".");
  const grp = thousands ? ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ent;
  return (n < 0 ? "-" : "") + grp + (dec ? "," + dec : "");
}

// Fecha ISO (aaaa-mm-dd…) → dd/mm/aaaa (formato único en toda la app).
export function fmtFechaES(v: unknown): string {
  if (!v) return "";
  const [y, m, d] = String(v).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(v);
}

// Periodo 'aaaa-mm' → "Mes Año" (formato único de la app: "Marzo 2026").
const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export function mesAnyo(periodo: unknown): string {
  if (!periodo) return "";
  const [y, mo] = String(periodo).slice(0, 7).split("-");
  return mo && y ? `${MESES_ES[Number(mo) - 1] ?? mo} ${y}` : String(periodo);
}

// Estado de COBRO derivado de un recibo. El cobro llega con los Premium BDX (rara vez
// coinciden con el Risk BDX) → puede quedar parcialmente cobrado.
export type EstadoCobro = { label: string; clase: string };
export function estadoCobro(importe: unknown, cobrado: unknown, estado?: string | null): EstadoCobro {
  if (estado === "Anulado") return { label: "Anulado", clase: "anulado" };
  // Se compara EN MAGNITUD (valor absoluto) para que los recibos en negativo (extornos) se
  // comporten igual que los positivos: pendientes hasta la devolución y "cobrados" al devolverse.
  const imp = Math.abs(Number(importe) || 0);
  const cob = Math.abs(Number(cobrado) || 0);
  // Importe 0 = no hay nada que cobrar → el recibo está saldado, no "pendiente".
  if (imp <= 0.005) return { label: "Cobrado", clase: "cobrado" };
  // Tolerancia de 5 céntimos: las diferencias de redondeo de la migración cuentan como completo.
  if (cob <= 0.005) return { label: "Pendiente", clase: "pendiente" };
  if (cob < imp - 0.05) return { label: "Parcial", clase: "parcial" };
  return { label: "Cobrado", clase: "cobrado" };
}

// Signing de un FDO → formato UCR (convención Xchanging, al revés). El FDO viene como
// `XXXXX*DD/MM/YYYY` (nº, asterisco, fecha); en los UCR el criterio es la fecha delante:
// `YYYY/MM/DD*XXXXX`. Devuelve "" si el signing es nulo o no casa el patrón (FDO sin signing).
export function signingUcrDesdeFdo(s: string | null | undefined): string {
  const m = /^\s*(\d+)\s*\*\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s ?? "");
  if (!m) return "";
  const [, num, d, mo, y] = m;
  return `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}*${num}`;
}

// Clase de color para el ESTADO de un siniestro (Open/Closed/Reopened/Denied…). Devuelve el
// sufijo de la clase CSS `pill-sin-<x>`: abierto (rojo), cerrado (verde), revision (ámbar),
// otro (gris). Tolerante a inglés/español y variantes.
export function estadoSiniestroClase(estado?: string | null): string {
  const s = (estado ?? "").toLowerCase();
  if (!s) return "otro";
  if (s.includes("closed") || s.includes("cerrad")) return "cerrado";
  if (s.includes("reopen") || s.includes("reabier") || s.includes("review") || s.includes("revis")) return "revision";
  if (s.includes("open") || s.includes("abiert")) return "abierto";
  return "otro"; // Denied / Declined / Withdrawn / Nil / desconocido
}
