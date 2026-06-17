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

// Estado de COBRO derivado de un recibo. El cobro llega con los Premium BDX (rara vez
// coinciden con el Risk BDX) → puede quedar parcialmente cobrado.
export type EstadoCobro = { label: string; clase: string };
export function estadoCobro(importe: unknown, cobrado: unknown, estado?: string | null): EstadoCobro {
  if (estado === "Anulado") return { label: "Anulado", clase: "anulado" };
  const imp = Number(importe) || 0;
  const cob = Number(cobrado) || 0;
  if (cob <= 0.005) return { label: "Pendiente", clase: "pendiente" };
  if (cob < imp - 0.005) return { label: "Parcial", clase: "parcial" };
  return { label: "Cobrado", clase: "cobrado" };
}
