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
