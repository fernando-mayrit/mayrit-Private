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

// Signing de un FDO → formato UCR (convención Xchanging, al revés). En los UCR el criterio es la
// fecha delante: `YYYY/MM/DD*XXXXX`. El signing guardado viene en DOS formatos (los dos reales en
// la BD, ~17% son del segundo): `XXXXX*DD/MM/YYYY` (nº, asterisco, fecha) y **solo dígitos**
// `XXXXXDDMMYYYY` (los 8 últimos son la fecha; lo de delante, el número). Se aceptan ambos.
// Devuelve "" si el signing es nulo o no casa ninguno de los dos (FDO sin signing).
export function signingUcrDesdeFdo(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const sep = /^(\d+)\s*\*\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (sep) {
    const [, num, d, mo, y] = sep;
    return `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}*${num}`;
  }
  const dig = /^(\d+)(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (dig) {
    const [, num, d, mo, y] = dig;
    // Comprobar que los 8 últimos dígitos son de verdad una fecha DDMMYYYY (si no, no es un signing).
    const fecha = new Date(Number(y), Number(mo) - 1, Number(d));
    const ok = fecha.getFullYear() === Number(y) && fecha.getMonth() === Number(mo) - 1 && fecha.getDate() === Number(d);
    if (ok && num) return `${y}/${mo}/${d}*${num}`;
  }
  return "";
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

// Pastilla de estado de un siniestro: MISMO criterio de color que los UCR (verde Abierto, rojo
// Cerrado) y etiqueta en español. Ámbar para revisión y gris para el resto (legado: Denied, etc.).
export function estadoSiniestroPill(estado?: string | null): { label: string; clase: string } {
  const c = estadoSiniestroClase(estado);
  if (c === "abierto") return { label: "Abierto", clase: "pill-cobrado" };
  if (c === "cerrado") return { label: "Cerrado", clase: "pill-pendiente" };
  if (c === "revision") return { label: (estado ?? "").trim() || "Reabierto", clase: "pill-parcial" };
  return { label: (estado ?? "").trim() || "—", clase: "pill-anulado" };
}
