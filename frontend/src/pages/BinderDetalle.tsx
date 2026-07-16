import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { bdxApi, recibosApi, siniestrosApi, claimsBdxApi, triangulacionApi, lpanApi, ucrApi, resumenBinder, evolucionPrograma, type BdxDetalle, type BdxPreview, type BdxImportResult, type PremiumGrupo, type ClaimsBdxVista, type Triangulacion, type MetricaTriangulo, type VistaLpan, type ResumenBinder, type ResumenItem, type EvolucionPrograma, type EvolucionSerie, type UcrRegistro } from "../api";
import type { Binder, Bdx, BdxLinea, Recibo, Siniestro } from "../types";
import BdxLineaPanel from "../components/BdxLineaPanel";
import CancelacionesSugeridas from "../components/CancelacionesSugeridas";
import BdxTabla from "../components/BdxTabla";
import TablaDatos, { type Col } from "../components/TablaDatos";
import NumberInput from "../components/NumberInput";
import ReciboModal from "../components/ReciboModal";
import SiniestroModal, { type PolizaBinder } from "../components/SiniestroModal";
import UcrModal from "../components/UcrModal";
import LpanFdoRow from "../components/LpanFdoRow";
import LpanRow from "../components/LpanRow";
import { pedirDestino, guardarEn } from "../download";
import PremiumMatch from "../components/PremiumMatch";
import RiskExcelImport from "../components/RiskExcelImport";
import TareasBinder from "../components/TareasBinder";
import ConfirmDialog from "../components/ConfirmDialog";
import FormPanel from "../components/FormPanel";
import type { ReactNode } from "react";
import type { ReciboPreview, ReciboUpdate } from "../types";
import { fmtMiles, fmtFechaES, estadoCobro, estadoSiniestroPill } from "../format";

function n(v: unknown): number {
  const x = Number(String(v ?? "").replace(",", "."));
  return isNaN(x) ? 0 : x;
}

// Cuadro del Resumen: cada línea con un check; el Total suma solo las líneas marcadas
// (todas marcadas por defecto). Permite ver el sumatorio de una selección de secciones/mercados/risk codes.
function ResumenCuadro({ titulo, col, datos, imp }: {
  titulo: string; col: string; datos: ResumenItem[]; imp: (v: string | number | null | undefined) => string;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(datos.map((d) => d.clave)));
  const toggle = (clave: string) =>
    setSel((prev) => { const s = new Set(prev); s.has(clave) ? s.delete(clave) : s.add(clave); return s; });
  const total = datos.reduce((a, it) => a + (sel.has(it.clave) ? Number(it.gwp) : 0), 0);
  return (
    <div style={{ flex: "1 1 280px", minWidth: 260 }}>
      <h4 style={{ margin: "0 0 6px" }}>{titulo}</h4>
      <table className="compacto" style={{ width: "100%" }}>
        <thead><tr><th style={{ width: 28 }}></th><th>{col}</th><th className="num">GWP our line</th></tr></thead>
        <tbody>
          {datos.map((it) => (
            <tr key={it.clave} style={{ opacity: sel.has(it.clave) ? 1 : 0.45 }}>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={sel.has(it.clave)} onChange={() => toggle(it.clave)} />
              </td>
              <td>{it.clave}</td>
              <td className="num">{imp(it.gwp)}</td>
            </tr>
          ))}
          <tr>
            <td></td>
            <td><b>Total</b></td>
            <td className="num"><b>{imp(total)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Gráfico de líneas (SVG) de la evolución comparativa año a año del programa: una línea por binder,
// X = mes de cobertura (alineado al efecto), Y = prima (GWP our line) acumulada. Resalta el binder actual.
const MESES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function EvolucionProgramaChart({ series, actualId, storageKey }: { series: EvolucionSerie[]; actualId: number; storageKey: string }) {
  // Años ocultos, persistidos por programa: al salir y volver se mantiene lo seleccionado.
  const [ocultas, setOcultas] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify([...ocultas])); } catch { /* ignore */ }
  }, [ocultas, storageKey]);
  const [hoverMes, setHoverMes] = useState<number | null>(null);   // mes (1..maxMes) bajo el cursor
  const visibles = series.filter((s) => !ocultas.has(s.id));
  const maxMes = Math.max(12, ...visibles.map((s) => s.puntos.length));
  const maxY = Math.max(1, ...visibles.flatMap((s) => s.puntos.map((p) => p.acumulado)));

  // Etiqueta de mes del eje X: M1 = mes de efecto del binder actual (todas las anualidades del
  // programa renuevan en el mismo mes), así se leen como may, jun, jul… en vez de M1, M2…
  const efectoMes = (() => {
    const a = series.find((s) => s.id === actualId) ?? series[series.length - 1];
    return a?.fecha_efecto ? Number(a.fecha_efecto.slice(5, 7)) : null;   // 1..12
  })();
  const etiquetaMes = (i: number) =>          // i base 0
    efectoMes ? MESES_ABR[(efectoMes - 1 + i) % 12] : `M${i + 1}`;

  // Paleta estable por año (índice en la lista ordenada), con el actual en naranja marca Mayrit.
  const COLORES = ["#2563eb", "#16a34a", "#9333ea", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669", "#db2777", "#65a30d", "#0d9488", "#7c3aed"];
  const colorDe = (s: EvolucionSerie, i: number) => (s.id === actualId ? "#ea6a1e" : COLORES[i % COLORES.length]);

  const W = 720, H = 320, ML = 64, MR = 16, MT = 16, MB = 34;
  const iw = W - ML - MR, ih = H - MT - MB;
  const x = (mes: number) => ML + (maxMes <= 1 ? 0 : ((mes - 1) / (maxMes - 1)) * iw);
  const y = (v: number) => MT + ih - (v / maxY) * ih;

  const yTicks = 4;
  const anio = (s: EvolucionSerie) => s.yoa ?? (s.fecha_efecto ? s.fecha_efecto.slice(0, 4) : s.etiqueta);
  const toggle = (id: number) =>
    setOcultas((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Valor acumulado de una serie en un mes de cobertura dado (los puntos ya son acumulados).
  const valorEnMes = (s: EvolucionSerie, mes: number) => {
    let v = 0;
    for (const p of s.puntos) { if (p.mes <= mes) v = p.acumulado; else break; }
    return v;
  };
  // % de crecimiento del último mes de una serie frente al año anterior EN EL MISMO mes de cobertura.
  const crecimiento = (s: EvolucionSerie): number | null => {
    const idx = series.indexOf(s);
    if (idx <= 0) return null;                       // no hay año anterior
    const ultimo = s.puntos[s.puntos.length - 1];
    if (!ultimo) return null;
    const prevV = valorEnMes(series[idx - 1], ultimo.mes);
    if (prevV <= 0) return null;
    return ((ultimo.acumulado - prevV) / prevV) * 100;
  };

  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ margin: "0 0 8px" }}>Evolución del programa por año (prima acumulada, GWP our line)</h4>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto", flex: "1 1 480px" }}
             onMouseLeave={() => setHoverMes(null)}>
          {/* rejilla + eje Y */}
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (maxY / yTicks) * i;
            return (
              <g key={i}>
                <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
                <text x={ML - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b7280">{fmtMiles(v)}</text>
              </g>
            );
          })}
          {/* eje X: meses de cobertura (abreviatura, desde el mes de efecto) */}
          {Array.from({ length: maxMes }, (_, i) => (
            <text key={i} x={x(i + 1)} y={H - 12} textAnchor="middle" fontSize={11} fill="#6b7280">{etiquetaMes(i)}</text>
          ))}
          {/* líneas */}
          {visibles.map((s) => {
            const i = series.indexOf(s);
            const c = colorDe(s, i);
            const d = s.puntos.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.mes)},${y(p.acumulado)}`).join(" ");
            const esA = s.id === actualId;
            const ult = s.puntos[s.puntos.length - 1];
            const pct = crecimiento(s);
            return (
              <g key={s.id}>
                <path d={d} fill="none" stroke={c} strokeWidth={esA ? 3 : 1.6} opacity={esA ? 1 : 0.85} />
                {s.puntos.map((p) => <circle key={p.mes} cx={x(p.mes)} cy={y(p.acumulado)} r={esA ? 3.5 : 2.4} fill={c} />)}
                {ult && pct !== null && (
                  <text x={x(ult.mes)} y={y(ult.acumulado) - 7} textAnchor="middle"
                        fontSize={esA ? 12 : 10.5} fontWeight={esA ? 700 : 600}
                        fill={pct >= 0 ? "#16a34a" : "#dc2626"}>
                    {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
          {/* bandas invisibles por mes: fijan el mes bajo el cursor */}
          {Array.from({ length: maxMes }, (_, i) => {
            const mes = i + 1;
            const band = maxMes <= 1 ? iw : iw / (maxMes - 1);
            return (
              <rect key={i} x={x(mes) - band / 2} y={MT} width={band} height={ih}
                fill="transparent" pointerEvents="all" onMouseEnter={() => setHoverMes(mes)} />
            );
          })}
          {/* tooltip del mes: guía vertical + cifra de cada año visible en ese mes */}
          {hoverMes != null && visibles.length > 0 && (() => {
            const filas = visibles.map((s) => ({ s, i: series.indexOf(s), v: valorEnMes(s, hoverMes) }));
            const lh = 16, headerH = 18, padX = 8, bw = 148;
            const bh = headerH + filas.length * lh + 6;
            const px = x(hoverMes);
            const boxX = px > ML + iw / 2 ? px - bw - 10 : px + 10;   // al lado opuesto para no salirse
            const boxY = MT + 2;
            return (
              <g pointerEvents="none">
                <line x1={px} y1={MT} x2={px} y2={MT + ih} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
                {filas.map(({ s, i, v }) => (
                  <circle key={s.id} cx={px} cy={y(v)} r={3.6} fill="#fff" stroke={colorDe(s, i)} strokeWidth={2} />
                ))}
                <rect x={boxX} y={boxY} width={bw} height={bh} rx={5} fill="#ffffff" stroke="#e5e7eb" strokeWidth={1} />
                <text x={boxX + padX} y={boxY + 13} fontSize={11} fontWeight={700} fill="#374151">
                  {etiquetaMes(hoverMes - 1)}
                </text>
                {filas.map(({ s, i, v }, k) => {
                  const ty = boxY + headerH + k * lh + 8;
                  return (
                    <g key={s.id}>
                      <rect x={boxX + padX} y={ty - 8} width={8} height={8} rx={2} fill={colorDe(s, i)} />
                      <text x={boxX + padX + 13} y={ty} fontSize={11} fill="#374151"
                            fontWeight={s.id === actualId ? 700 : 400}>{anio(s)}</text>
                      <text x={boxX + bw - padX} y={ty} fontSize={11} textAnchor="end" fontWeight={600} fill="#111827">{fmtMiles(v)}</text>
                    </g>
                  );
                })}
              </g>
            );
          })()}
        </svg>
        {/* selector de años: casilla por anualidad + Todos/Ninguno */}
        <div style={{ minWidth: 150, fontSize: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12 }}>
            <button className="btn-mini" onClick={() => setOcultas(new Set())}>Todos</button>
            <button className="btn-mini" onClick={() => setOcultas(new Set(series.map((s) => s.id)))}>Ninguno</button>
          </div>
          {series.map((s, i) => {
            const visible = !ocultas.has(s.id);
            const c = colorDe(s, i);
            return (
              <label key={s.id} title="Mostrar/ocultar"
                   style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0", cursor: "pointer", opacity: visible ? 1 : 0.5 }}>
                <input type="checkbox" checked={visible} onChange={() => toggle(s.id)} style={{ width: 12, height: 12 }} />
                <span style={{ width: 12, height: 3, background: c, display: "inline-block", borderRadius: 2 }} />
                <span style={{ fontWeight: s.id === actualId ? 700 : 400 }}>{anio(s)}</span>
                <span className="num" style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>{fmtMiles(s.total)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
// Clase de color del Estado del binder para la etiqueta del encabezado.
function estadoBadgeClase(estado: string | null | undefined): string {
  switch (estado) {
    case "En Vigor": return "eb-vigor";
    case "Renovado": return "eb-renovado";
    case "No Renovado": return "eb-norenovado";
    case "Cancelado": return "eb-cancelado";
    case "Cerrado Producción": return "eb-cerrado-prod";
    case "Cerrado": return "eb-cerrado";
    default: return "eb-otro";
  }
}
function mesLargo(k: string): string {
  const [y, mo] = k.split("-");
  return `${MESES_ES[Number(mo) - 1] ?? mo} ${y}`;
}
// Meses (aaaa-mm) distintos de un campo de fecha en las líneas.
function mesesDe(lineas: BdxLinea[], campo: keyof BdxLinea, filtro?: (l: BdxLinea) => boolean): string[] {
  const s = new Set<string>();
  for (const l of lineas) {
    if (filtro && !filtro(l)) continue;
    const k = String(l[campo] ?? "").slice(0, 7);
    if (k) s.add(k);
  }
  return [...s].sort().reverse();
}

function fmtFecha(s: string | null | undefined): string {
  return fmtFechaES(s) || "—";
}
function imp(v: string | number | null | undefined): string {
  return fmtMiles(v) || "—";
}

// Catálogo de columnas del listado de Siniestros (clic derecho en la cabecera para elegir/mover).
const SIN_COLS: Col<Siniestro>[] = [
  { key: "certificate", label: "Certificate", tipo: "text" },
  { key: "reference", label: "Reference", tipo: "text" },
  { key: "insured", label: "Asegurado", tipo: "text", width: 180 },
  { key: "section", label: "Secc.", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "currency", label: "Moneda", tipo: "text" },
  { key: "status", label: "Estado", tipo: "text",
    render: (s) => { if (!s.status) return <span className="hint">—</span>; const e = estadoSiniestroPill(s.status); return <span className={`pill ${e.clase}`}>{e.label}</span>; } },
  { key: "claimant", label: "Reclamante", tipo: "text", width: 160 },
  { key: "reporting_period", label: "Periodo", tipo: "text" },
  { key: "risk_inception", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry", label: "Fin riesgo", tipo: "date" },
  { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
  { key: "date_opened", label: "Abierto", tipo: "date" },
  { key: "date_closed", label: "Cerrado", tipo: "date" },
  { key: "amount_claimed", label: "Reclamado", tipo: "num" },
  { key: "to_pay_indemnity", label: "A pagar ind.", tipo: "num" },
  { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
  { key: "paid_indemnity", label: "Pagado ind.", tipo: "num" },
  { key: "paid_fees", label: "Pagado fees", tipo: "num" },
  { key: "reserves_indemnity", label: "Reservas ind.", tipo: "num" },
  { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
  // Incurrido = pagado + reservas (NO usamos total_indemnity/total_fees del maestro: incluyen el
  // "a pagar este mes", que ya está en el pagado acumulado → inflaría el dato).
  { key: "total_indemnity", label: "Total ind.", tipo: "num", calc: (s) => n(s.paid_indemnity) + n(s.reserves_indemnity) },
  { key: "total_fees", label: "Total fees", tipo: "num", calc: (s) => n(s.paid_fees) + n(s.reserves_fees) },
  { key: "total", label: "Total", tipo: "num", calc: (s) => n(s.paid_indemnity) + n(s.reserves_indemnity) + n(s.paid_fees) + n(s.reserves_fees) },
  { key: "ucr", label: "UCR", tipo: "text" },
  { key: "abogado", label: "Abogado", tipo: "text" },
  { key: "description", label: "Descripción", tipo: "text", width: 220 },
  { key: "refer", label: "Refer", tipo: "text" },
  { key: "denial", label: "Denial", tipo: "text" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
];
const SIN_DEFAULT = [
  "reference", "certificate", "insured", "risk_code", "claim_first_advised", "date_opened",
  "paid_fees", "paid_indemnity", "reserves_fees", "reserves_indemnity",
  "total_fees", "total_indemnity", "total", "date_closed", "status",
];

// Columnas de la pestaña UCR del binder (sin UMR: es el del propio binder).
const UCR_COLS: Col<UcrRegistro>[] = [
  { key: "ucr", label: "UCR", tipo: "text", width: 175 },
  { key: "section", label: "Secc.", tipo: "text", width: 55 },
  { key: "risk_code", label: "Risk Code", tipo: "text", width: 85 },
  { key: "signing", label: "Signing", tipo: "text", width: 150 },
  { key: "tpa", label: "TPA", tipo: "text", width: 140 },
  {
    key: "estado", label: "Estado", tipo: "text", width: 95,
    render: (u) => u.estado
      ? <span className={`pill ${/cerrad/i.test(u.estado) ? "pill-pendiente" : "pill-cobrado"}`}>{u.estado}</span>
      : <span className="hint">—</span>,
  },
  { key: "notas", label: "Notas", tipo: "text", width: 240 },
];

export default function BinderDetalle({ binder }: { binder: Binder }) {
  const [tab, setTab] = useState<"resumen" | "datos" | "bloqueo" | "bdx" | "lpan" | "premium" | "calculos" | "recibos" | "siniestros" | "ucr" | "claimsbdx" | "triangulacion" | "tareas">("resumen");
  const [resumen, setResumen] = useState<ResumenBinder | null>(null);
  const [evolucion, setEvolucion] = useState<EvolucionPrograma | null>(null);

  // ── BDX (uno por binder) ──
  const [bdxs, setBdxs] = useState<Bdx[]>([]);
  const [sel, setSel] = useState<BdxDetalle | null>(null); // el BDX del binder, con líneas
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linea, setLinea] = useState<BdxLinea | "nueva" | null>(null);

  // ── UCR del binder (por UMR) ──
  const [ucrs, setUcrs] = useState<UcrRegistro[]>([]);
  const [ucrCargado, setUcrCargado] = useState(false);
  const [ucrModal, setUcrModal] = useState<{ ucr: UcrRegistro | null } | null>(null);
  async function cargarUcr() {
    try { setUcrs((await ucrApi.listar({ umr: binder.umr ?? undefined, limit: 5000 })).items); }
    catch { /* ignore */ } finally { setUcrCargado(true); }
  }

  // ── Siniestros (Claims BDX del binder) ──
  const [siniestros, setSiniestros] = useState<Siniestro[]>([]);
  // Filas visibles de la tabla tras los filtros por columna (para que el cuadro de totales cuadre
  // con lo filtrado); undefined hasta que la tabla informa por primera vez.
  const [sinVisibles, setSinVisibles] = useState<Siniestro[] | undefined>(undefined);
  const [sinCargado, setSinCargado] = useState(false);
  const [editSin, setEditSin] = useState<Siniestro | null>(null);
  const [nuevoSin, setNuevoSin] = useState(false);
  const [subiendoClaims, setSubiendoClaims] = useState(false);
  const claimsBdxRef = useRef<HTMLInputElement>(null);

  async function subirClaimsBdx(file: File) {
    setSubiendoClaims(true);
    setError(null);
    try {
      const blob = await siniestrosApi.compararClaimsBdx(binder.id, file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Comparacion Claims ${binder.umr ?? binder.id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setSubiendoClaims(false); }
  }

  // Pólizas del Risk BDX para el alta manual de siniestros: una entrada por combinación distinta de
  // (asegurado · certificate · sección · risk code), para que un certificate con varias secciones o
  // risk codes ofrezca todas. Fechas tomadas de la primera línea de esa combinación.
  const polizasSiniestro = useMemo<PolizaBinder[]>(() => {
    const por: Map<string, PolizaBinder> = new Map();
    for (const l of sel?.lineas ?? []) {
      const cert = (l.certificate_ref ?? "").trim();
      const insured = (l.insured_name ?? "").trim();
      if (!cert && !insured) continue;
      const section = l.section_no ?? null;
      const risk = (l.risk_code ?? "").trim() || null;
      const clave = `${cert}|${section ?? ""}|${risk ?? ""}`;
      if (por.has(clave)) continue;
      por.set(clave, {
        clave,
        insured: insured || "(sin asegurado)",
        certificate: cert,
        section,
        risk_code: risk,
        risk_inception: l.risk_inception_date ?? null,
        risk_expiry: l.risk_expiry_date ?? null,
      });
    }
    return [...por.values()].sort(
      (a, b) =>
        a.insured.localeCompare(b.insured, "es") ||
        a.certificate.localeCompare(b.certificate) ||
        (a.section ?? 0) - (b.section ?? 0) ||
        (a.risk_code ?? "").localeCompare(b.risk_code ?? ""),
    );
  }, [sel]);

  // Totales del cuadro de Siniestros (incurrido = pagado + reservas). Se calculan sobre las filas
  // realmente visibles tras los filtros de la tabla (`sinVisibles`); hasta que la tabla informa por
  // primera vez se usa la lista completa.
  const sinTot = useMemo(() => {
    const base = sinVisibles ?? siniestros;
    const nSin = base.length;
    const abiertos = base.filter((s) => !s.date_closed).length;
    const reclamado = base.reduce((a, s) => a + n(s.amount_claimed), 0);
    const reservaFees = base.reduce((a, s) => a + n(s.reserves_fees), 0);
    const pagosFees = base.reduce((a, s) => a + n(s.paid_fees), 0);
    const reservaIndem = base.reduce((a, s) => a + n(s.reserves_indemnity), 0);
    const pagosIndem = base.reduce((a, s) => a + n(s.paid_indemnity), 0);
    const totalFees = reservaFees + pagosFees;
    const totalIndem = reservaIndem + pagosIndem;
    const lin = sel?.lineas ?? [];
    const gwpOL = lin.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
    const comCover = lin.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
    const brokerage = lin.reduce((a, l) => a + n(l.brokerage_amount), 0);
    return {
      nSin, abiertos, reclamado, reservaFees, pagosFees, reservaIndem, pagosIndem,
      totalFees, totalIndem, total: totalFees + totalIndem, netUW: gwpOL - comCover - brokerage,
    };
  }, [siniestros, sinVisibles, sel]);

  async function cargarSiniestros() {
    try {
      setSiniestros(await siniestrosApi.listar(binder.id));
      setSinCargado(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    // Los Claims se usan en la pestaña Siniestros y en la siniestralidad del PC.
    // Se recarga al abrir la pestaña (refleja correcciones sin re-importar de SharePoint).
    if (tab === "siniestros" || tab === "calculos") cargarSiniestros();
    if (tab === "ucr") { cargarUcr(); cargarLpan(); }   // cargarLpan → FDO disponibles para vincular el UCR
    if (tab === "lpan") cargarLpan();
    if (tab === "resumen") {
      resumenBinder(binder.id).then(setResumen).catch(() => {});
      evolucionPrograma(binder.id).then(setEvolucion).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── LPAN / FDO (notas de pago a Lloyd's por risk code) ──
  const [lpanData, setLpanData] = useState<VistaLpan | null>(null);
  const [lpanBusy, setLpanBusy] = useState(false);
  const [fdoAbierto, setFdoAbierto] = useState<boolean | null>(null); // null = automático (según completos)
  // Override manual de despliegue por periodo; por defecto: pendientes abiertos, completos plegados.
  const [periodoOverride, setPeriodoOverride] = useState<Record<string, boolean>>({});
  const [lpanABorrar, setLpanABorrar] = useState<{ id: number; etiqueta: string } | null>(null);
  async function cargarLpan() {
    try {
      setLpanData(await lpanApi.vista(binder.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Descargar el Excel del bordereau de un periodo eligiendo carpeta (mismo flujo que LPAN/FDO, con
  // memoria de carpeta compartida). agrupar=true → LPAN Bdx (agrupado); false → Premium Bdx (plano).
  async function descargarBdxExcel(periodo: string, agrupar = true, pais?: string) {
    const tipo = agrupar ? "LPAN Bdx" : "Premium Bdx";
    const suf = pais ? ` ${pais}` : "";
    const { handle, cancelado } = await pedirDestino(`${tipo} ${binder.umr ?? binder.id} ${periodo}${suf}.xlsx`);
    if (cancelado) return;
    setLpanBusy(true);
    setError(null);
    try {
      const { blob, filename } = await lpanApi.bdxExcel(binder.id, periodo, agrupar, pais);
      await guardarEn(handle, blob, filename);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLpanBusy(false);
    }
  }
  async function accionLpan(fn: () => Promise<unknown>) {
    setLpanBusy(true);
    setError(null);
    try {
      await fn();
      await cargarLpan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLpanBusy(false);
    }
  }

  // ── Claims BDX (bordereau mensual acumulativo) ──
  const [cbVista, setCbVista] = useState<ClaimsBdxVista | null>(null);
  const [cbPeriodos, setCbPeriodos] = useState<{ periodo: string; n: number; fecha: string | null }[]>([]);
  const [cbBusy, setCbBusy] = useState(false);
  const [cbMsg, setCbMsg] = useState<string | null>(null);
  const [cbPresentarMes, setCbPresentarMes] = useState<string | null>(null); // mes elegido a presentar

  // ── Triangulación de siniestralidad ──
  const [tri, setTri] = useState<Triangulacion | null>(null);
  const [triMetrica, setTriMetrica] = useState<MetricaTriangulo>("incurrido");
  const [triVista, setTriVista] = useState<"cal" | "edad">("cal"); // calendario o por antigüedad
  const [triScope, setTriScope] = useState<{ seccion?: number; risk_code?: string }>({});
  const [triBusy, setTriBusy] = useState(false);
  async function cargarTriangulacion(scope: { seccion?: number; risk_code?: string }) {
    setTriBusy(true);
    try {
      setTri(await triangulacionApi.deBinder(binder.id, scope));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTriBusy(false);
    }
  }
  async function exportarTriangulo() {
    try {
      const blob = await triangulacionApi.excelBinder(binder.id, triMetrica, triScope);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Triangulacion ${binder.umr} ${triMetrica} ${tri?.ambito ?? ""}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (tab === "triangulacion") cargarTriangulacion(triScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, triScope]);

  async function cargarClaimsBdx(periodo?: string) {
    try {
      const [v, ps] = await Promise.all([claimsBdxApi.vista(binder.id, periodo), claimsBdxApi.periodos(binder.id)]);
      setCbVista(v);
      setCbPeriodos(ps);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cargarClaimsPeriodos() {
    try {
      setCbPeriodos(await claimsBdxApi.periodos(binder.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function descargarSnapshot(periodo: string) {
    setError(null);
    try {
      const blob = await claimsBdxApi.excel(binder.id, periodo, "presentado");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claims BDX ${binder.umr ?? binder.id} ${periodo} (presentado).xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (tab === "claimsbdx") cargarClaimsBdx(cbVista?.periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    // La pestaña Bloqueo refleja presentaciones de Claims (su columna = periodos presentados).
    if (tab === "bloqueo") { refrescarBloqueos(); cargarClaimsPeriodos(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function descargarClaimsBdx(modo: "vivo" | "presentado", periodo?: string) {
    const per = periodo ?? cbVista?.periodo;
    if (!per) return;
    setError(null);
    try {
      const blob = await claimsBdxApi.excel(binder.id, per, modo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claims BDX ${binder.umr ?? binder.id} ${per}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function presentarClaimsBdx(mes: string) {
    setCbBusy(true);
    setCbMsg(null);
    setError(null);
    try {
      const r = (await claimsBdxApi.presentar(binder.id, mes, localStorage.getItem("mayrit.usuario") ?? undefined)) as { presentados: number };
      setCbMsg(`Presentado ${mes}: ${r.presentados} siniestro(s). Mes bloqueado.`);
      setCbPresentarMes(null);
      await cargarClaimsBdx(mes);        // pasa a ver el mes recién presentado
      await refrescarBloqueos();         // refleja el bloqueo en la pestaña Bloqueo
      await descargarClaimsBdx("vivo", mes); // descarga el bordereau presentado
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCbBusy(false);
    }
  }

  // ── Subir Risk/Premium desde un Excel del navegador (multipart) ──
  const fileRef = useRef<HTMLInputElement>(null);
  const plantillaRef = useRef<HTMLInputElement>(null);
  const [subirFile, setSubirFile] = useState<File | null>(null);
  // PC: IBNR manual (% s/ GWP). La siniestralidad sale de los Claims importados (no simulada).
  const [ibnrPct, setIbnrPct] = useState("0");
  // Selección de meses/periodos en la tabla de Datos.
  const [selMeses, setSelMeses] = useState<Set<string>>(new Set());
  // Bloqueo de periodos por tipo de BDX (local de momento; falta persistencia/lógica de presentar).
  const [bloqueos, setBloqueos] = useState<Set<string>>(new Set());
  // Recibos de comisión del binder (1 por Risk BDX). Mapa periodo 'YYYY-MM' → recibo.
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [generando, setGenerando] = useState<string | null>(null); // periodo cuyo preview se está pidiendo
  const [borrador, setBorrador] = useState<ReciboPreview | null>(null); // recibo precalculado a emitir
  const [emitiendo, setEmitiendo] = useState(false);
  const [excelModo, setExcelModo] = useState<"risk" | "premium">("risk");
  // Premiums del binder (grupos por mes) y fecha de pago por periodo (para el cobro)
  const [premiums, setPremiums] = useState<PremiumGrupo[]>([]);
  // Nota libre por mes de Premium (editor inline)
  const [notaEdit, setNotaEdit] = useState<string | null>(null);   // periodo en edición
  const [notaText, setNotaText] = useState("");
  const [notaSaving, setNotaSaving] = useState(false);
  const [fechasPago, setFechasPago] = useState<Record<string, string>>({});
  // Diálogo de confirmación contundente para acciones sensibles
  const [confirmar, setConfirmar] = useState<
    { titulo: string; mensaje: ReactNode; importe?: ReactNode; detalle?: ReactNode; confirmLabel?: string; doble?: boolean; accion: () => void } | null
  >(null);

  // ── Importación desde SharePoint ──
  const [importAbierto, setImportAbierto] = useState(false);
  const [preview, setPreview] = useState<BdxPreview | null>(null);
  const [importRes, setImportRes] = useState<BdxImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const importado = bdxs.length > 0;

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const lista = await bdxApi.listar(binder.id);
      setBdxs(lista);
      // El resto de cargas son independientes entre sí → en paralelo (antes eran 4 awaits en serie).
      const [detalle, bl, recs, prems] = await Promise.all([
        lista.length > 0 ? bdxApi.detalle(lista[0].id) : Promise.resolve(null),
        bdxApi.listarBloqueos(binder.id),
        recibosApi.deBinder(binder.id),
        recibosApi.listarPremium(binder.id),
      ]);
      setSel(detalle);
      setBloqueos(new Set(bl.map((b) => `${b.tipo}:${b.periodo}`)));
      setRecibos(recs);
      setPremiums(prems);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refrescarSel() {
    if (sel) setSel(await bdxApi.detalle(sel.id));
  }
  function abrirNota(p: PremiumGrupo) {
    setNotaEdit(p.periodo); setNotaText(p.nota ?? "");
  }
  async function guardarNota() {
    if (notaEdit == null) return;
    setNotaSaving(true);
    try {
      await recibosApi.guardarNotaPremium(binder.id, notaEdit, notaText.trim() || null);
      setPremiums(await recibosApi.listarPremium(binder.id));
      setNotaEdit(null);
    } catch (e) { setError((e as Error).message); } finally { setNotaSaving(false); }
  }
  async function refrescarBloqueos() {
    const bl = await bdxApi.listarBloqueos(binder.id);
    setBloqueos(new Set(bl.map((b) => `${b.tipo}:${b.periodo}`)));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binder.id]);

  async function abrirImport() {
    setImportAbierto(true);
    setPreview(null);
    setImportRes(null);
    setImportError(null);
    setImportBusy(true);
    try {
      setPreview(await bdxApi.sharepointPreview(binder.id));
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  async function hacerImport() {
    setImportBusy(true);
    setImportError(null);
    try {
      setImportRes(await bdxApi.importarSharepoint(binder.id));
      await cargar();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  function cerrarImport() {
    setImportAbierto(false);
    setPreview(null);
    setImportRes(null);
    setImportError(null);
  }

  // Abre el selector de fichero del navegador para subir el Excel de Risk o Premium.
  function elegirExcel(modo: "risk" | "premium" = "risk") {
    setExcelModo(modo);
    setSubirFile(null);
    if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); }
  }

  // Capturar el FORMATO del Risk Excel (columnas + orden) como plantilla del binder, para descargar el
  // Premium/LPAN con ese mismo modelo. Solo lee cabeceras: no importa líneas ni toca datos.
  async function capturarPlantilla(file: File) {
    try {
      const r = await bdxApi.capturarPlantillaRisk(binder.id, file);
      alert(`✅ Plantilla del Risk capturada (hoja «${r.hoja ?? "—"}»): ${r.n_columnas} columnas — ${r.mapeadas} con campo interno, ${r.sin_mapear} propias del coverholder.\n\nLas descargas de Premium/LPAN de este binder ya usarán este formato.`);
    } catch (e) {
      alert("No se pudo capturar la plantilla: " + (e as Error).message);
    }
  }

  // Cifras por mes (Reporting Start): GWP (our line), Net Premium to Broker, comisión (brokerage).
  // Memoizado por `sel`: las líneas pueden ser miles; no recalcular en cada render.
  const { porMes, totGwp, totNet } = useMemo(() => {
    const m = new Map<string, { gwp: number; net: number; brk: number; recibos: Set<string> }>();
    for (const l of sel?.lineas ?? []) {
      const k = String(l.reporting_period_start ?? "").slice(0, 7); // aaaa-mm
      if (!k) continue;
      const cur = m.get(k) ?? { gwp: 0, net: 0, brk: 0, recibos: new Set<string>() };
      cur.gwp += n(l.total_gwp_our_line);
      cur.net += n(l.net_premium_to_broker);
      cur.brk += n(l.brokerage_amount);
      if (l.recibo) cur.recibos.add(String(l.recibo));
      m.set(k, cur);
    }
    const pm = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { porMes: pm, totGwp: pm.reduce((a, [, v]) => a + v.gwp, 0), totNet: pm.reduce((a, [, v]) => a + v.net, 0) };
  }, [sel]);

  // Recibo ya generado de cada periodo (1 por Risk BDX).
  const reciboDe = useMemo(() => new Map(recibos.map((r) => [r.periodo, r])), [recibos]);

  // Estado de cierre del binder: "Cerrado Producción" → no más Risk/Premium; "Cerrado" → además
  // cierra Siniestros.
  const produccionCerrada = (binder.estado || "").startsWith("Cerrado");
  const cerradoTotal = binder.estado === "Cerrado";

  // Totales del Premium (lo macheado) vs totales del Risk (todas las líneas). Cuando todo está
  // macheado, deben coincidir. Prima = our line + impuestos − comisión cedida; Comisión = brokerage.
  // Totales del Risk (todas las líneas) + nº de pólizas. Memoizado por `sel`.
  const { riskLineas, riskComision, riskLloyds, nPolizas } = useMemo(() => {
    const lineasRisk = sel?.lineas ?? [];
    // Nº de pólizas (mismo criterio que el contador del BDX): únicas por (asegurado + fechas),
    // une splits por risk code, ignora suplementos y excluye anuladas (prima neta our line ≤ 0).
    const acc = new Map<string, number>();
    for (const l of lineasRisk) {
      const aseg = String(l.insured_id || l.insured_name || "").trim();
      const key = `${aseg}|${l.risk_inception_date ?? ""}|${l.risk_expiry_date ?? ""}`;
      acc.set(key, (acc.get(key) ?? 0) + n(l.total_gwp_our_line));
    }
    let np = 0;
    for (const v of acc.values()) if (v > 0.005) np++;
    return {
      riskLineas: lineasRisk.length,
      riskComision: lineasRisk.reduce((a, l) => a + n(l.brokerage_amount), 0),
      riskLloyds: lineasRisk.reduce((a, l) => a + n(l.net_premium_to_broker), 0),
      nPolizas: np,
    };
  }, [sel]);
  // Líneas que se muestran en la tabla del BDX (filtradas por los meses seleccionados). Memoizado
  // para no crear un array nuevo en cada render (que invalidaría el memo de BdxTabla).
  const lineasVista = useMemo(() => {
    const ls = sel?.lineas ?? [];
    return selMeses.size > 0
      ? ls.filter((l) => selMeses.has(String(l.reporting_period_start ?? "").slice(0, 7)))
      : ls;
  }, [sel, selMeses]);

  const premLineas = premiums.reduce((a, p) => a + p.num_lineas, 0);
  const premComision = premiums.reduce((a, p) => a + n(p.comision), 0);
  const premLloyds = premiums.reduce((a, p) => a + n(p.prima_lloyds), 0);

  // Fecha por (periodo, etapa) para las acciones del ciclo de cobro (cobro/traspaso/liquidación).
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const fechaDe = (periodo: string, etapa: string) => fechasPago[`${periodo}:${etapa}`] ?? hoyISO();
  const setFecha = (periodo: string, etapa: string, v: string) =>
    setFechasPago((s) => ({ ...s, [`${periodo}:${etapa}`]: v }));

  // Ejecuta una acción del ciclo (cobrar/traspasar/liquidar) sobre un Premium y recarga.
  function pedirAccionPremium(
    periodo: string,
    etapa: "cobro" | "traspaso" | "liquidacion",
    cfg: { titulo: string; verbo: ReactNode; detalle: string; confirmLabel: string; api: (b: number, p: string, f: string) => Promise<unknown> }
  ) {
    const fecha = fechaDe(periodo, etapa);
    // Importe de la acción (lo que se va a dar por cobrado / traspasado / liquidado), según la etapa.
    const grupo = premiums.find((x) => x.periodo === periodo);
    const importeInfo =
      etapa === "cobro"
        ? { label: "Importe a cobrar", valor: grupo?.prima_lloyds }
        : etapa === "traspaso"
        ? { label: "Importe a traspasar", valor: grupo?.comision }
        : { label: "Importe a liquidar", valor: grupo?.a_liquidar };
    setConfirmar({
      titulo: cfg.titulo,
      mensaje: (
        <>
          {cfg.verbo} el Premium <b>{mesLargo(periodo)}</b> con fecha <b>{fmtFechaES(fecha)}</b>.
        </>
      ),
      importe: grupo ? (
        <>
          <div className="ci-lbl">{importeInfo.label}</div>
          <div className="ci-val">{imp(importeInfo.valor)} €</div>
        </>
      ) : undefined,
      detalle: cfg.detalle,
      confirmLabel: cfg.confirmLabel,
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await cfg.api(binder.id, periodo, fecha);
          await cargar();
        } catch (e) {
          const msg = (e as Error).message;
          setError(msg);
          // Aviso imposible de no ver: el error del banner queda arriba y puede caer fuera de vista
          // si la pestaña Premium está scrolleada (p. ej. "no se puede liquidar: LPAN sin liberar").
          alert(msg);
        }
      },
    });
  }
  const pedirCobrarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "cobro", {
      titulo: "💰 Marcar Premium como COBRADO",
      verbo: <>Vas a dar por <b>cobrado</b></>,
      detalle: "Se marcan las líneas como cobradas y se actualiza Cantidad Cobrada / Pdte. Cobro en los recibos.",
      confirmLabel: "💰 Sí, cobrar",
      api: recibosApi.cobrarPremium,
    });
  const pedirTraspasarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "traspaso", {
      titulo: "🔁 Traspasar la comisión",
      verbo: <>Vas a <b>traspasar nuestra comisión</b> (de la cuenta de primas a la de gastos) de</>,
      detalle: "Marca la comisión como traspasada y actualiza Traspasada / Pdte. Traspaso en los recibos.",
      confirmLabel: "🔁 Sí, traspasar",
      api: recibosApi.traspasarPremium,
    });
  const pedirLiquidarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "liquidacion", {
      titulo: "🏦 Liquidar a la compañía",
      verbo: <>Vas a <b>liquidar a la compañía / Lloyd's</b> el importe a liquidar de</>,
      detalle: "Requiere que los LPAN de este mes tengan fecha de Liberado. Marca como liquidado, sella la fecha de pago en esos LPAN y actualiza los recibos.",
      confirmLabel: "🏦 Sí, liquidar",
      api: recibosApi.liquidarPremium,
    });
  // Tras machear/subir un Premium, ofrecer bloquearlo (cerrar ese Premium).
  function pedirBloquearPremium(periodo: string) {
    setConfirmar({
      titulo: "¿Bloquear este Premium?",
      mensaje: (
        <>
          Premium <b>{mesLargo(periodo)}</b> macheado. ¿Quieres <b>bloquearlo</b> ahora?
        </>
      ),
      detalle: "Un Premium bloqueado no admite más cambios ni se puede deshacer su cobro. Podrás desbloquearlo en la pestaña Bloqueo.",
      confirmLabel: "Sí, bloquear",
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await bdxApi.bloquear(binder.id, "premium", periodo);
          await cargar();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }
  function pedirDescobrarPremium(periodo: string) {
    setConfirmar({
      titulo: "DESHACER el cobro del Premium",
      mensaje: (
        <>
          Vas a <b>deshacer el cobro</b> del Premium <b>{mesLargo(periodo)}</b>.
        </>
      ),
      detalle: "Sus líneas volverán a PENDIENTE y se revertirá el cobro en los recibos afectados (prima, comisión y liquidación cobradas).",
      confirmLabel: "Continuar",
      doble: true,
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await recibosApi.descobrarPremium(binder.id, periodo, new Date().toISOString().slice(0, 10));
          await cargar();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  // Celda de una etapa del ciclo (cobro/traspaso/liquidación) en el listado de Premium.
  function celdaEtapa(p: PremiumGrupo, etapa: "cobro" | "traspaso" | "liquidacion", bloq: boolean): ReactNode {
    const done = etapa === "cobro" ? p.cobrado : etapa === "traspaso" ? p.traspasado : p.liquidado;
    const fecha = etapa === "cobro" ? p.fecha_pago : etapa === "traspaso" ? p.fecha_traspaso : p.fecha_liquidacion;
    if (etapa !== "cobro" && !p.cobrado) return <span className="hint">—</span>;
    if (done) {
      const puedeDeshacer = etapa === "cobro" && !bloq && !p.traspasado && !p.liquidado;
      return (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className="pill pill-cobrado">✓ {fecha ? fmtFechaES(fecha) : ""}</span>
          {puedeDeshacer && (
            <button className="btn-link" onClick={() => pedirDescobrarPremium(p.periodo)}>Deshacer</button>
          )}
        </span>
      );
    }
    if (bloq) return <span className="hint">🔒</span>;
    // No se puede cobrar/traspasar/liquidar una prima sin Recibo generado.
    if (!p.tiene_recibo) return <span className="hint" title="Genera primero el Recibo de este periodo">Falta recibo</span>;
    const cfg =
      etapa === "cobro"
        ? { emoji: "💰", label: "Cobrar", pedir: pedirCobrarPremium }
        : etapa === "traspaso"
        ? { emoji: "🔁", label: "Traspasar", pedir: pedirTraspasarPremium }
        : { emoji: "🏦", label: "Liquidar", pedir: pedirLiquidarPremium };
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input
          type="date"
          className="inp-fecha"
          value={fechaDe(p.periodo, etapa)}
          onChange={(e) => setFecha(p.periodo, etapa, e.target.value)}
        />
        <button className="btn-primary btn-sm" onClick={() => cfg.pedir(p.periodo)}>
          {cfg.emoji} {cfg.label}
        </button>
      </span>
    );
  }

  // Paso 1: NO crea el recibo; calcula el borrador (preview) y abre el formulario de emisión.
  async function generarRecibo(periodo: string) {
    setGenerando(periodo);
    setError(null);
    try {
      setBorrador(await recibosApi.preview(binder.id, periodo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando(null);
    }
  }

  // Paso 2: emite (crea) el recibo con los campos del formulario.
  async function emitirRecibo(payload: ReciboUpdate) {
    if (!borrador) return;
    setEmitiendo(true);
    setError(null);
    try {
      await recibosApi.generar(binder.id, borrador.periodo, payload);
      setBorrador(null);
      await cargar(); // refresca recibos y líneas (ya con su nº de recibo)
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEmitiendo(false);
    }
  }

  // Una línea está bloqueada si su periodo Risk (reporting start) o, si entra en Premium,
  // su mes de premium_bdx están bloqueados en la pestaña Bloqueo.
  function lineaBloqueada(l: BdxLinea): boolean {
    const rs = String(l.reporting_period_start ?? "").slice(0, 7);
    if (rs && bloqueos.has(`risk:${rs}`)) return true;
    const pm = String(l.premium_bdx ?? "").slice(0, 7);
    if (l.incluido_en_premium && pm && bloqueos.has(`premium:${pm}`)) return true;
    return false;
  }

  return (
    <div className="container detalle-binder">
      <div className="detalle-top">
        <h1 className="page-title" style={{ margin: "8px 0 4px" }}>
          <span className="page-title-emoji">📑</span>
          {binder.umr ?? binder.agreement_number ?? `Binder ${binder.id}`}
        </h1>
        <div className="detalle-sub">
          {binder.coverholder_nombre ?? "—"} · {fmtFecha(binder.fecha_efecto)} → {fmtFecha(binder.fecha_vencimiento)} ·{" "}
          <span className={"estado-badge " + estadoBadgeClase(binder.estado)}>{binder.estado ?? "—"}</span>
        </div>
      </div>

      <div className="tabs detalle-tabs">
        <button className={"tab" + (tab === "resumen" ? " active" : "")} onClick={() => setTab("resumen")}>
          Resumen
        </button>
        <button className={"tab" + (tab === "bdx" ? " active" : "")} onClick={() => setTab("bdx")}>
          BDX
        </button>
        <button className={"tab" + (tab === "bloqueo" ? " active" : "")} onClick={() => setTab("bloqueo")}>
          Bloqueo
        </button>
        <button className={"tab" + (tab === "datos" ? " active" : "")} onClick={() => setTab("datos")}>
          Risk
        </button>
        <button className={"tab" + (tab === "premium" ? " active" : "")} onClick={() => setTab("premium")}>
          Premium
        </button>
        <button className={"tab" + (tab === "lpan" ? " active" : "")} onClick={() => setTab("lpan")}>
          LPAN
        </button>
        <button className={"tab" + (tab === "calculos" ? " active" : "")} onClick={() => setTab("calculos")}>
          PC
        </button>
        <button className={"tab" + (tab === "recibos" ? " active" : "")} onClick={() => setTab("recibos")}>
          Recibos
        </button>
        <button className={"tab" + (tab === "siniestros" ? " active" : "")} onClick={() => setTab("siniestros")}>
          Siniestros
        </button>
        <button className={"tab" + (tab === "ucr" ? " active" : "")} onClick={() => setTab("ucr")}>
          UCR
        </button>
        <button className={"tab" + (tab === "claimsbdx" ? " active" : "")} onClick={() => setTab("claimsbdx")}>
          Claims BDX
        </button>
        <button className={"tab" + (tab === "triangulacion" ? " active" : "")} onClick={() => setTab("triangulacion")}>
          Triangulación
        </button>
        <button className={"tab" + (tab === "tareas" ? " active" : "")} onClick={() => setTab("tareas")}>
          Tareas
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {tab === "resumen" && (
        <div className="resumen-binder">
          {!resumen ? (
            <div className="loading">Cargando…</div>
          ) : (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <ResumenCuadro titulo="Por Sección" col="Sección" datos={resumen.por_seccion} imp={imp} />
              <ResumenCuadro titulo="Por Mercado" col="Mercado" datos={resumen.por_mercado} imp={imp} />
              <ResumenCuadro titulo="Por Risk Code" col="Risk Code" datos={resumen.por_risk_code} imp={imp} />
            </div>
          )}
          {evolucion && evolucion.series.length > 1 && (
            <EvolucionProgramaChart series={evolucion.series} actualId={evolucion.binder_actual}
              storageKey={`evol-prog:${evolucion.programa ?? binder.programa_id ?? binder.id}`} />
          )}
        </div>
      )}

      {tab === "datos" && (
        <>
          <h3 style={{ margin: "4px 0 8px" }}>Cifras por mes (Reporting Start)</h3>
          {loading ? (
            <div className="loading">Cargando…</div>
          ) : porMes.length === 0 ? (
            <div className="empty">Aún no hay BDX importado. Ve a la pestaña BDX para importarlo.</div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto risk-mes" style={{ maxWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={selMeses.size > 0 && selMeses.size === porMes.length}
                      onChange={(e) =>
                        setSelMeses(e.target.checked ? new Set(porMes.map(([m]) => m)) : new Set())
                      }
                    />
                  </th>
                  <th>Mes Risk</th>
                  <th className="num">GWP</th>
                  <th className="num">Net Premium to Broker</th>
                  <th className="num">Comisión</th>
                  <th>Recibo</th>
                </tr>
              </thead>
              <tbody>
                {porMes.map(([mes, v]) => {
                  const recibo = reciboDe.get(mes);
                  return (
                    <tr key={mes}>
                      <td className="celda-centro">
                        <input
                          type="checkbox"
                          checked={selMeses.has(mes)}
                          onChange={() =>
                            setSelMeses((s) => {
                              const ns = new Set(s);
                              if (ns.has(mes)) ns.delete(mes);
                              else ns.add(mes);
                              return ns;
                            })
                          }
                        />
                      </td>
                      <td>{mesLargo(mes)}</td>
                      <td className="num">{imp(v.gwp)}</td>
                      <td className="num">{imp(v.net)}</td>
                      <td className="num">{imp(v.brk)}</td>
                      <td>
                        {recibo ? (
                          <span title={`Comisión ${imp(n(recibo.comision_retenida))} · ${recibo.estado}`}>🧾 {recibo.numero}</span>
                        ) : (
                          <button
                            className="btn-link"
                            disabled={generando === mes || v.brk === 0}
                            title={v.brk === 0 ? "Sin comisión (brokerage) en este periodo" : "Preparar el recibo de comisión de este Risk BDX"}
                            onClick={() => generarRecibo(mes)}
                          >
                            {generando === mes ? "Abriendo…" : "＋ Generar recibo"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td></td>
                  <td>Total</td>
                  <td className="num">{imp(totGwp)}</td>
                  <td className="num">{imp(totNet)}</td>
                  <td className="num">{imp(porMes.reduce((a, [, v]) => a + v.brk, 0))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      {tab === "bloqueo" && (
        (() => {
          const ls = sel?.lineas ?? [];
          const cols: { titulo: string; tipo: string; emoji: string; meses: string[] }[] = [
            { titulo: "Risk BDX", tipo: "risk", emoji: "📊", meses: mesesDe(ls, "reporting_period_start") },
            { titulo: "Premium BDX", tipo: "premium", emoji: "💷", meses: mesesDe(ls, "premium_bdx", (l) => !!l.incluido_en_premium) },
            // Claims: solo los periodos YA presentados (los que existen en nuestro Claims BDX).
            { titulo: "Claims BDX", tipo: "claims", emoji: "⚖️", meses: cbPeriodos.map((p) => p.periodo) },
          ];
          // Persistente: el bloqueo se guarda en el backend (impide editar líneas del periodo).
          const toggle = async (tipo: string, m: string) => {
            const key = `${tipo}:${m}`;
            try {
              if (bloqueos.has(key)) {
                await bdxApi.desbloquear(binder.id, tipo, m);
                setBloqueos((s) => { const ns = new Set(s); ns.delete(key); return ns; });
              } else if (tipo === "claims") {
                // En Claims, bloquear = PRESENTAR el bordereau de ese mes (congela snapshot + bloquea).
                if (!window.confirm(`¿Presentar el Claims BDX de ${mesLargo(m)}? Se congelará el snapshot y se bloqueará el mes.`)) return;
                await claimsBdxApi.presentar(binder.id, m, localStorage.getItem("mayrit.usuario") ?? undefined);
                setBloqueos((s) => new Set(s).add(key));
                setCbVista(null); // fuerza recarga de la pestaña Claims BDX
              } else {
                await bdxApi.bloquear(binder.id, tipo, m);
                setBloqueos((s) => new Set(s).add(key));
              }
            } catch (e) {
              alert((e as Error).message);
            }
          };
          // Congelado por cierre del binder: Risk/Premium si producción cerrada; Claims si Cerrado total.
          const congelada = (tipo: string) =>
            tipo === "claims" ? cerradoTotal : produccionCerrada;
          return (
            <div className="bloqueo-cols">
              {cols.map((c) => {
                const frozen = congelada(c.tipo);
                return (
                <div className="bloqueo-col" key={c.titulo}>
                  <h3>
                    <span className="page-title-emoji" style={{ fontSize: 20 }}>{c.emoji}</span> {c.titulo}
                    {frozen && <span className="hint" style={{ marginLeft: 8 }}>🔒 cerrado</span>}
                  </h3>
                  {c.meses.length === 0 ? (
                    <div className="hint">— sin periodos —</div>
                  ) : (
                    c.meses.map((m) => {
                      const key = `${c.tipo}:${m}`;
                      const bloq = bloqueos.has(key);
                      return (
                        <div
                          className={"bloqueo-fila" + (bloq ? " bloqueada" : "")}
                          key={m}
                          onClick={frozen ? undefined : () => toggle(c.tipo, m)}
                          style={{ cursor: frozen ? "default" : "pointer", opacity: frozen ? 0.85 : 1 }}
                          title={frozen ? "Binder cerrado: los bloqueos no se pueden modificar" : bloq ? "Bloqueado (clic para desbloquear)" : "Clic para bloquear este periodo"}
                        >
                          <input type="checkbox" checked={bloq} readOnly tabIndex={-1} />
                          <button type="button" className="lock-btn" tabIndex={-1} disabled={frozen}>
                            {bloq ? "🔒" : "🔓"}
                          </button>
                          <span>{mesLargo(m)}</span>
                          <span
                            className="ayuda"
                            onClick={(e) => e.stopPropagation()}
                            title="Bloquear este periodo impide presentarlo / modificarlo."
                          >
                            ?
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                );
              })}
            </div>
          );
        })()
      )}

      {/* Input de fichero oculto para Subir Risk/Premium (lo dispara el botón). */}
      <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setSubirFile(f); }} />
      <input ref={plantillaRef} type="file" accept=".xlsx" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) capturarPlantilla(f); }} />
      {subirFile && excelModo === "risk" && (
        <RiskExcelImport binderId={binder.id} file={subirFile}
          onClose={() => setSubirFile(null)}
          onImported={() => { setSubirFile(null); cargar(); }} />
      )}
      {subirFile && excelModo === "premium" && (
        <PremiumMatch binderId={binder.id} file={subirFile} nombre={subirFile.name}
          onClose={() => setSubirFile(null)}
          onApplied={async (periodo) => { setSubirFile(null); await cargar(); pedirBloquearPremium(periodo); }} />
      )}

      {tab === "bdx" && (
        <>

          {loading ? (
            <div className="loading">Cargando…</div>
          ) : !sel || sel.lineas.length === 0 ? (
            <>
              {produccionCerrada ? (
                <div className="hint" style={{ marginBottom: 10 }}>🔒 Producción cerrada: no se pueden subir más Risk ni Premium.</div>
              ) : (
                <div className="toolbar">
                  <button className="btn-primary" onClick={() => elegirExcel("risk")}>
                    📤 Subir Risk
                  </button>
                  <button className="btn-primary" onClick={() => elegirExcel("premium")}>
                    💷 Subir Premium
                  </button>
                  {!importado && (
                    <button className="btn-primary" onClick={abrirImport}>
                      ⤓ Importar de SharePoint
                    </button>
                  )}
                  <button className="btn-primary" title="Captura el formato (columnas y orden) del Risk Excel del coverholder para reproducirlo en las descargas de Premium/LPAN. Solo lee cabeceras: no importa líneas." onClick={() => plantillaRef.current?.click()}>
                    📐 Capturar plantilla del Risk
                  </button>
                </div>
              )}
              <div className="empty">
                {!sel
                  ? "Este binder no tiene BDX todavía. Impórtalo de SharePoint o sube el Excel."
                  : "El BDX no tiene líneas."}
              </div>
            </>
          ) : (
            <>
            {!produccionCerrada && <CancelacionesSugeridas binderId={binder.id} onMarcado={refrescarSel} />}
            <BdxTabla
              lineas={lineasVista}
              onRowClick={(l) => setLinea(l)}
              bloqueada={lineaBloqueada}
              hayFiltroExterno={selMeses.size > 0}
              onQuitarFiltros={() => setSelMeses(new Set())}
              acciones={
                <>
                  {produccionCerrada ? (
                    <span className="hint">🔒 Producción cerrada</span>
                  ) : (
                    <>
                      <button className="btn-primary btn-sm" onClick={() => elegirExcel("risk")}>
                        📤 Subir Risk
                      </button>
                      <button className="btn-primary btn-sm" onClick={() => elegirExcel("premium")}>
                        💷 Subir Premium
                      </button>
                    </>
                  )}
                  <button className="btn-primary btn-sm" title="Captura el formato (columnas y orden) del Risk Excel del coverholder para reproducirlo en las descargas de Premium/LPAN. Solo lee cabeceras: no importa líneas." onClick={() => plantillaRef.current?.click()}>
                    📐 Plantilla del Risk
                  </button>
                  {selMeses.size > 0 && (
                    <span className="hint">
                      Filtrado por Datos:{" "}
                      {[...selMeses].sort().map((m) => { const [y, mo] = m.split("-"); return `${mo}/${y}`; }).join(", ")}
                    </span>
                  )}
                </>
              }
            />
            </>
          )}
        </>
      )}

      {tab === "premium" && (
        <>
          <h3 style={{ margin: "4px 0 8px" }}>Premium BDX (cobro)</h3>
          {premiums.length === 0 ? (
            <div className="empty">
              Aún no hay líneas incluidas en ningún Premium. En la pestaña <b>BDX</b> pulsa
              <b> «Subir Premium»</b> para machear un Premium con el Risk.
            </div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto premium-cobro" style={{ maxWidth: 1120 }}>
              <thead>
                <tr>
                  <th>Mes Premium</th>
                  <th className="num">Líneas</th>
                  <th className="num">A Cobrar</th>
                  <th className="num">A Traspasar</th>
                  <th className="num">A Liquidar</th>
                  <th>💰 Cobro</th>
                  <th>🔁 Traspaso</th>
                  <th>🏦 Liquidación</th>
                  <th>📝 Nota</th>
                  <th>⬇️ Premium Bdx</th>
                </tr>
              </thead>
              <tbody>
                {premiums.map((p) => {
                  const bloq = bloqueos.has(`premium:${p.periodo}`);
                  const editando = notaEdit === p.periodo;
                  return (
                    <Fragment key={p.periodo}>
                    <tr>
                      <td>{mesLargo(p.periodo)}</td>
                      <td className="num">{p.num_lineas}</td>
                      <td className="num">{imp(n(p.prima_lloyds))}</td>
                      <td className="num">{imp(n(p.comision))}</td>
                      <td className="num">{imp(n(p.a_liquidar))}</td>
                      <td>{celdaEtapa(p, "cobro", bloq)}</td>
                      <td>{celdaEtapa(p, "traspaso", bloq)}</td>
                      <td>{celdaEtapa(p, "liquidacion", bloq)}</td>
                      <td style={{ maxWidth: 220 }}>
                        <button className="btn-link" title={p.nota || "Añadir nota"} onClick={() => abrirNota(p)}
                          style={{ whiteSpace: "nowrap" }}>
                          {p.nota ? "📝 " : "＋ "}
                          {p.nota && <span className="hint" style={{ color: "inherit" }}>{p.nota.length > 28 ? p.nota.slice(0, 28) + "…" : p.nota}</span>}
                        </button>
                      </td>
                      <td>
                        <button className="btn-link" disabled={lpanBusy} style={{ whiteSpace: "nowrap" }}
                          title="Descargar el Premium Bdx de este mes (Excel plano, sin agrupar)"
                          onClick={() => descargarBdxExcel(p.periodo, false)}>⬇️ Excel</button>
                      </td>
                    </tr>
                    {editando && (
                      <tr>
                        <td colSpan={10} style={{ background: "var(--fondo-suave, #f7f8fa)" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 4px" }}>
                            <textarea rows={2} style={{ flex: 1 }} value={notaText} autoFocus
                              placeholder="Nota del mes de Premium (p. ej. riesgos no liquidados al mercado)"
                              onChange={(e) => setNotaText(e.target.value)} />
                            <button className="btn-primary btn-sm" disabled={notaSaving} onClick={guardarNota}>{notaSaving ? "…" : "Guardar"}</button>
                            <button className="btn-secondary btn-sm" disabled={notaSaving} onClick={() => setNotaEdit(null)}>Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td>Total Premium</td>
                  <td className="num">{premLineas}</td>
                  <td className="num">{imp(premLloyds)}</td>
                  <td className="num">{imp(premComision)}</td>
                  <td colSpan={6}></td>
                </tr>
                <tr className="hint">
                  <td>Total Risk</td>
                  <td className="num">{riskLineas}</td>
                  <td className="num">{imp(riskLloyds)}</td>
                  <td className="num">{imp(riskComision)}</td>
                  <td colSpan={6}>
                    {premLineas === riskLineas
                      ? "✓ todo el Risk macheado"
                      : `faltan ${riskLineas - premLineas} línea(s) por machear`}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            💰 Cobrar (la agencia nos paga) · 🔁 Traspasar (nuestra comisión, de primas a gastos) ·
            🏦 Liquidar (pagar a la compañía/Lloyd's). Cada acción pide fecha y actualiza los recibos.
          </div>
        </>
      )}

      {tab === "calculos" && (
        (() => {
          if (!binder.profit_commission)
            return <div className="empty">Este binder no tiene Profit Commission.</div>;
          // Secciones (1-based) sujetas a PC y primas (GWP) de sus líneas en el BDX.
          const seccionesPC = new Set(
            binder.secciones.map((s, i) => (s.sujeto_pc ? i + 1 : 0)).filter((x) => x > 0)
          );
          const nombresPC = binder.secciones
            .map((s, i) => (s.sujeto_pc ? `Sección ${i + 1}${s.ramo ? ` (${s.ramo})` : ""}` : null))
            .filter(Boolean)
            .join(", ");
          const lineas = (sel?.lineas ?? []).filter((l) => seccionesPC.has(l.section_no ?? 0));
          // GWP = our line (es lo que usa el cálculo de PC), no el GWP al 100%.
          const gwp = lineas.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
          // Comisiones = importes REALES de los BDX (media ponderada; pueden variar por operación).
          const comCoverAmt = lineas.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
          const comCoverPct = gwp > 0 ? (comCoverAmt / gwp) * 100 : 0;
          const comMayritAmt = lineas.reduce((a, l) => a + n(l.brokerage_amount), 0);
          const comMayritPct = gwp > 0 ? (comMayritAmt / gwp) * 100 : 0;
          const comTotal = comCoverAmt + comMayritAmt;
          const netToUws = gwp - comTotal;
          // Siniestralidad REAL desde los Claims importados (secciones sujetas a PC).
          const sinPC = siniestros.filter((s) => seccionesPC.has(s.section ?? 0));
          const indemPaidR = sinPC.reduce((a, s) => a + n(s.paid_indemnity), 0);
          const indemResR = sinPC.reduce((a, s) => a + n(s.reserves_indemnity), 0);
          const feesPaidR = sinPC.reduce((a, s) => a + n(s.paid_fees), 0);
          const feesResR = sinPC.reduce((a, s) => a + n(s.reserves_fees), 0);
          const claims = indemPaidR + indemResR + feesPaidR + feesResR;
          // IBNR: % manual sobre la GWP (our line).
          const ibnr = (gwp * n(ibnrPct)) / 100;
          const uwPct = n(binder.pc_gastos);
          const uwAmt = (gwp * uwPct) / 100;
          const totalOutcome = comTotal + claims + ibnr + uwAmt;
          const lossRatio = netToUws > 0 ? (claims / netToUws) * 100 : 0;
          const resultado = gwp - totalOutcome;
          const pcPct = n(binder.pc_porcentaje);
          const pc = (resultado * pcPct) / 100;
          const Money = ({ v }: { v: number }) => <td className="num">{imp(v)}</td>;
          return (
            <>
              <h3 style={{ margin: "4px 0 8px" }}>Profit Commission</h3>
              <div className="hint" style={{ marginBottom: 10 }}>
                PC {fmtMiles(pcPct)} % · UW Expenses {fmtMiles(uwPct)} % · Sujetas a PC: {nombresPC || "—"}.
                La siniestralidad proviene de los Claims importados de este binder (secciones sujetas a PC).
              </div>
              <table className="compacto pc-tabla" style={{ maxWidth: 560 }}>
                <tbody>
                  <tr className="pc-fuerte"><td>GWP (our line)</td><Money v={gwp} /></tr>

                  <tr className="pc-seccion"><td colSpan={2}>Comisiones</td></tr>
                  <tr><td>Coverholder ({fmtMiles(comCoverPct)} %)</td><Money v={comCoverAmt} /></tr>
                  <tr><td>Mayrit ({fmtMiles(comMayritPct)} %)</td><Money v={comMayritAmt} /></tr>
                  <tr className="pc-subtotal"><td>Total comisiones</td><Money v={comTotal} /></tr>
                  <tr className="pc-fuerte"><td>Net to UWs</td><Money v={netToUws} /></tr>

                  <tr className="pc-seccion"><td colSpan={2}>Siniestralidad</td></tr>
                  <tr><td>Indemnización — Pagado</td><Money v={indemPaidR} /></tr>
                  <tr><td>Indemnización — Reservas</td><Money v={indemResR} /></tr>
                  <tr><td>Fees — Pagado</td><Money v={feesPaidR} /></tr>
                  <tr><td>Fees — Reservas</td><Money v={feesResR} /></tr>
                  <tr className="pc-subtotal"><td>Total siniestralidad</td><Money v={claims} /></tr>
                  <tr>
                    <td>IBNR (<span style={{ display: "inline-block", width: 70 }}><NumberInput value={ibnrPct} onChange={setIbnrPct} suffix="%" thousands={false} className="input-completar" /></span> s/ GWP)</td>
                    <Money v={ibnr} />
                  </tr>

                  <tr><td>UW Expenses ({fmtMiles(uwPct)} % s/ GWP)</td><Money v={uwAmt} /></tr>
                  <tr className="pc-subtotal"><td>Total Outcome</td><Money v={totalOutcome} /></tr>
                  <tr><td className="hint">Siniestralidad / Net to UWs</td><td className="num hint">{fmtMiles(lossRatio)} %</td></tr>

                  <tr className="pc-fuerte" style={{ borderTop: "2px solid var(--borde)" }}><td>Resultado (GWP − Outcome)</td><Money v={resultado} /></tr>
                  <tr className="pc-fuerte"><td>Profit Commission ({fmtMiles(pcPct)} %)</td><td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(pc)}</td></tr>
                </tbody>
              </table>
              {pc <= 0 && (
                <div className="hint" style={{ marginTop: 8 }}>Resultado ≤ 0 → no se genera Profit Commission (importe negativo informativo).</div>
              )}
            </>
          );
        })()
      )}

      {tab === "tareas" && <TareasBinder binderId={binder.id} />}

      {tab === "recibos" && (
        <>
          <h3 style={{ margin: "4px 0 4px" }}>Recibos de este binder ({binder.umr ?? binder.agreement_number ?? binder.id})</h3>
          <div className="hint" style={{ marginBottom: 8 }}>
            Vista filtrada por este binder. La gestión completa está en el módulo <b>Facturación → Recibos</b>.
          </div>
          {recibos.length === 0 ? (
            <div className="empty">
              Aún no hay recibos. Genera uno desde la pestaña <b>Datos</b> («＋ Generar recibo» de un Risk BDX).
            </div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto recibos-binder" style={{ maxWidth: 960 }}>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Risk BDX</th>
                  <th>Contraparte</th>
                  <th className="num">Comisión</th>
                  <th className="num">Cobrado</th>
                  <th className="num">Pendiente</th>
                  <th>Cobro</th>
                  <th>Emisión</th>
                </tr>
              </thead>
              <tbody>
                {recibos.map((r) => {
                  const ec = estadoCobro(r.comision_retenida, r.comision_retenida_cobrada, r.estado);
                  return (
                  <tr key={r.id}>
                    <td><b>🧾 {r.numero}</b></td>
                    <td>{mesLargo(r.periodo)}</td>
                    <td>{r.nombre_mercado ?? "—"}</td>
                    <td className="num">{imp(n(r.comision_retenida))}</td>
                    <td className="num">{imp(n(r.comision_retenida_cobrada))}</td>
                    <td className="num">{imp(n(r.comision_pendiente_cobro))}</td>
                    <td><span className={`pill pill-${ec.clase}`}>{ec.label}</span></td>
                    <td>{fmtFechaES(r.fecha_contable)}</td>
                  </tr>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td colSpan={3}>Total ({recibos.length})</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_retenida), 0))}</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_retenida_cobrada), 0))}</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_pendiente_cobro), 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      {tab === "siniestros" && (
        <>
          <div className="bdx-topbar" style={{ alignItems: "flex-start", marginBottom: 10 }}>
            <div className="bdx-acciones" style={{ position: "relative" }}>
              <button
                className="btn-primary btn-sm"
                onClick={() => setNuevoSin(true)}
                disabled={polizasSiniestro.length === 0}
                title={polizasSiniestro.length === 0
                  ? "No hay pólizas: carga primero el Risk BDX del binder para poder dar de alta un siniestro."
                  : "Alta manual de un siniestro a partir de una póliza del binder"}
              >
                🚨 Nuevo siniestro
              </button>
              <button
                className="btn-primary btn-sm"
                onClick={() => claimsBdxRef.current?.click()}
                disabled={subiendoClaims}
                title="Sube un Claims BDX (Excel) y descarga un Excel con las celdas que difieren de los siniestros de la app (en azul)"
              >
                {subiendoClaims ? "Comparando…" : "📤 Subir Claims Bdx"}
              </button>
              <input
                ref={claimsBdxRef}
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) subirClaimsBdx(f); }}
              />
              {polizasSiniestro.length === 0 && (
                <span className="hint">Sin pólizas en el Risk BDX: no se pueden dar de alta siniestros.</span>
              )}
            </div>
            {siniestros.length > 0 && (() => {
              const t = sinTot;
              const pct = (x: number) => (t.total > 0 ? `${fmtMiles((x / t.total) * 100)} %` : "—");
              const ratioStr = t.netUW > 0 ? `${fmtMiles((t.total / t.netUW) * 100)} %` : "—";
              return (
                <div className="bdx-totales">
                  <div className="tot-col">
                    <div className="tot-row"><span>Nº Siniestros</span><b>{fmtMiles(t.nSin, 0)}</b></div>
                    <div className="tot-row"><span>Abiertos</span><b>{fmtMiles(t.abiertos, 0)}</b></div>
                    <div className="tot-row"><span>Cerrados</span><b>{fmtMiles(t.nSin - t.abiertos, 0)}</b></div>
                    <div className="tot-row"><span>Cantidad Reclamada</span><b>{fmtMiles(t.reclamado)}</b></div>
                  </div>
                  <div className="tot-col">
                    <div className="tot-row"><span>% Fees</span><b>{pct(t.totalFees)}</b></div>
                    <div className="tot-row"><span>Reserva Fees</span><b>{fmtMiles(t.reservaFees)}</b></div>
                    <div className="tot-row"><span>Pagos Fees</span><b>{fmtMiles(t.pagosFees)}</b></div>
                    <div className="tot-row tot-pdte"><span>Total Fees</span><b>{fmtMiles(t.totalFees)}</b></div>
                  </div>
                  <div className="tot-col">
                    <div className="tot-row"><span>% Indem.</span><b>{pct(t.totalIndem)}</b></div>
                    <div className="tot-row"><span>Reserva Indem.</span><b>{fmtMiles(t.reservaIndem)}</b></div>
                    <div className="tot-row"><span>Pagos Indem.</span><b>{fmtMiles(t.pagosIndem)}</b></div>
                    <div className="tot-row tot-pdte"><span>Total Indem.</span><b>{fmtMiles(t.totalIndem)}</b></div>
                  </div>
                  <div className="tot-col">
                    <div className="tot-row" style={{ visibility: "hidden" }}><span>·</span><b>·</b></div>
                    <div className="tot-row"><span>Reserva Total</span><b>{fmtMiles(t.reservaFees + t.reservaIndem)}</b></div>
                    <div className="tot-row"><span>Pagos Total</span><b>{fmtMiles(t.pagosFees + t.pagosIndem)}</b></div>
                    <div className="tot-row tot-pdte"><span>Total</span><b>{fmtMiles(t.total)}</b></div>
                  </div>
                  <div className="tot-col">
                    <div className="tot-row"><span title="GWP our line − comisión coverholder − brokerage">Prima Neta</span><b>{fmtMiles(t.netUW)}</b></div>
                    <div className="tot-ratios">
                      <div className="tot-row tot-ratio"><span title="Nº siniestros / Nº pólizas">Ratio Frecuencia</span><b>{nPolizas > 0 ? `${fmtMiles((t.nSin / nPolizas) * 100)} %` : "—"}</b></div>
                      <div className="tot-row tot-ratio"><span title="Siniestralidad / (GWP our line − com. coverholder − brokerage)">Ratio Siniestralidad</span><b>{ratioStr}</b></div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
          {!sinCargado ? (
            <div className="loading">Cargando…</div>
          ) : siniestros.length === 0 ? (
            <div className="empty">
              {cerradoTotal
                ? "🔒 Binder cerrado sin siniestros: no tuvo ningún claim durante su vigencia."
                : "Sin siniestros migrados todavía."}
            </div>
          ) : (
            <TablaDatos
              filas={siniestros}
              columnas={SIN_COLS}
              defaultKeys={SIN_DEFAULT}
              storageKey="mayrit.siniestros.tabla.v2"
              onFiltrar={setSinVisibles}
              rowAction={(s) => (
                <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => setEditSin(s)}>✏️</button>
              )}
            />
          )}
          {(editSin || nuevoSin) && (
            <SiniestroModal
              siniestro={editSin}
              binderId={binder.id}
              binderUmr={binder.umr ?? undefined}
              polizas={polizasSiniestro}
              onClose={() => { setEditSin(null); setNuevoSin(false); }}
              onSaved={(s) => {
                setSiniestros((arr) =>
                  arr.some((x) => x.id === s.id)
                    ? arr.map((x) => (x.id === s.id ? { ...x, ...s } : x))
                    : [...arr, s],
                );
                setEditSin(null);
                setNuevoSin(false);
              }}
              onDeleted={(id) => {
                setSiniestros((arr) => arr.filter((x) => x.id !== id));
                setEditSin(null);
                setNuevoSin(false);
              }}
            />
          )}
        </>
      )}

      {tab === "ucr" && (() => {
        const fdosAlta = lpanData?.fdos.filter((f) => f.fdo) ?? [];   // FDO dados de alta (generados)
        const sinFdo = fdosAlta.length === 0;
        return (
        <div style={{ marginTop: 12 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button className="btn-primary btn-sm" disabled={sinFdo} onClick={() => setUcrModal({ ucr: null })}>🔖 Nuevo UCR</button>
            <span className="hint" style={{ marginLeft: 8 }}>
              {sinFdo ? "Necesitas al menos un FDO dado de alta para crear UCRs." : `UCR de este binder (UMR ${binder.umr ?? "—"}).`}
            </span>
          </div>
          {!ucrCargado ? (
            <div className="loading">Cargando…</div>
          ) : ucrs.length === 0 ? (
            <div className="empty">Este binder no tiene UCR asignados. Pulsa «🔖 Nuevo UCR» para añadir uno.</div>
          ) : (
            <TablaDatos
              filas={ucrs}
              columnas={UCR_COLS}
              defaultKeys={UCR_COLS.map((c) => c.key)}
              storageKey="mayrit.binder.ucr.tabla.v1"
              defaultSort={{ key: "ucr", dir: 1 }}
              rowAction={(u) => <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => setUcrModal({ ucr: u })}>✏️</button>}
            />
          )}
          {ucrModal && (
            <UcrModal
              ucr={ucrModal.ucr}
              umrDefault={binder.umr}
              fdos={fdosAlta}
              coverholder={binder.coverholder_nombre}
              ucrsExistentes={ucrs.map((u) => u.ucr ?? "")}
              onClose={() => setUcrModal(null)}
              onSaved={() => { setUcrModal(null); cargarUcr(); }}
            />
          )}
        </div>
        );
      })()}

      {tab === "claimsbdx" && (
        !cbVista ? (
          <div className="loading">Cargando…</div>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <button
                className="btn-primary btn-sm"
                title={cerradoTotal ? "Binder Cerrado: no se pueden cargar más claims." : "Elige un mes no presentado: congela el snapshot, bloquea el mes y descarga el bordereau (Excel)."}
                disabled={cbBusy || cerradoTotal || cbVista.meses_pendientes.length === 0}
                onClick={() => {
                  const ult = cbVista.meses[0] ?? "";
                  const sig = cbVista.meses_pendientes.find((m) => m > ult) ?? cbVista.meses_pendientes[0];
                  setCbPresentarMes(sig);
                }}
              >
                📤 Presentar mes…
              </button>
              {cerradoTotal && <span className="hint">🔒 Binder Cerrado: solo consulta.</span>}
              {cbMsg && <span className="hint">{cbMsg}</span>}
            </div>
            <div className="claims-box">
              <h3 style={{ margin: "2px 0 10px" }}>📚 Presentaciones realizadas</h3>
              {cbPeriodos.length === 0 ? (
                <div className="empty">Aún no hay presentaciones. Pulsa «Presentar mes…».</div>
              ) : (
                <div className="bdx-scroll">
                <table className="compacto claims-pres" style={{ maxWidth: 520 }}>
                  <thead>
                    <tr><th>Periodo</th><th className="num">Siniestros</th><th>Presentado el</th><th></th></tr>
                  </thead>
                  <tbody>
                    {cbPeriodos.map((p) => (
                      <tr key={p.periodo}>
                        <td>{p.periodo}</td>
                        <td className="num">{p.n}</td>
                        <td>{fmtFecha(p.fecha)}</td>
                        <td className="acciones">
                          <button className="btn-link" title="Descargar el bordereau presentado (snapshot)" onClick={() => descargarSnapshot(p.periodo)}>
                            ⬇️ Descargar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {tab === "lpan" && (
        !lpanData ? (
          <div className="loading">Cargando…</div>
        ) : (
          <div className="lpan-tab">
            <p className="hint" style={{ marginBottom: 10 }}>
              Primero el <b>FDO y signing number</b> por risk code (transversal; se hace <b>antes de tener
              Premium</b> — es donde se comunica a Xchanging dónde enviar cada bloque de primas). Después, por
              periodo → sección → risk code, genera el LPAN de cada bloque cobrado.
            </p>

            {/* ── Panel FDO por sección y risk code (solo binders Lloyd's; en Compañía no hay FDO) ── */}
            {lpanData.es_lloyds && (() => {
              const fdosCompletos = lpanData.fdos.length > 0 && lpanData.fdos.every((rc) =>
                rc.fdo && rc.fdo.signing_number && rc.fdo.work_package && rc.fdo.fecha_proceso && rc.fdo.work_package_status);
              const fdoOpen = fdoAbierto ?? !fdosCompletos; // al completarse todos, se repliega solo
              return (
                <div className="recibo-box" style={{ marginBottom: 16 }}>
                  <h4 className="lpan-colap" onClick={() => setFdoAbierto(!fdoOpen)}>
                    <span className="nav-chevron">{fdoOpen ? "▾" : "▸"}</span>
                    FDO por Sección y Risk Code{fdosCompletos ? " ✓" : ""}
                  </h4>
                  {fdoOpen && <>
                    <p className="hint" style={{ marginTop: 0 }}>Según lo declarado en el binder (secciones y risk codes).</p>
                    <div className="tabla-scroll">
                      <table className="compacto bdx-tabla">
                        <thead>
                          <tr>
                            <th>Secc.</th><th>Ramo</th><th>Risk Code</th><th>Broker Reference</th>
                            <th>Signing number</th><th>Work Package</th><th>Fecha proceso</th><th>WP Status</th><th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lpanData.fdos.map((rc) => (
                            <LpanFdoRow key={`${rc.section}-${rc.risk_code}-${rc.fdo?.id ?? "no"}`}
                              rc={rc} binderId={binder.id} onChanged={cargarLpan} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>}
                </div>
              );
            })()}

            {/* ── Periodo → Sección → Risk Code ── */}
            {lpanData.periodos.length === 0 && (
              <div className="empty" style={{ marginTop: 4 }}>
                Aún no hay Premium (líneas incluidas en premium) para generar LPAN.
                {lpanData.es_lloyds ? <> Los <b>FDO</b> ya se pueden preparar arriba.</> : null}
              </div>
            )}
            {lpanData.periodos.length > 0 && (() => {
              // Mes "completo" = todos los WP Status en Completed (los risk codes con prima 0 € no necesitan LPAN).
              const esCompleto = (p: typeof lpanData.periodos[number]) =>
                p.secciones.length > 0 && p.secciones.every((s) =>
                  s.risk_codes.every((r) => r.lpan?.estado === "Completed" || Number(r.gross_premium) === 0 || r.exento_lpan || r.cubierto_historico));
              const abiertoDe = (p: typeof lpanData.periodos[number]) => periodoOverride[p.periodo] ?? !esCompleto(p);
              const todosAbiertos = lpanData.periodos.every(abiertoDe);
              return (
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <button className="btn-secondary btn-sm" onClick={() => setPeriodoOverride(
                    Object.fromEntries(lpanData.periodos.map((p) => [p.periodo, !todosAbiertos])))}>
                    {todosAbiertos ? "▸ Replegar todos" : "▾ Desplegar todos"}
                  </button>
                </div>
              );
            })()}
            <div className="lpan-bloques-scroll">
            {lpanData.periodos.map((p) => {
              // El tic ✓ del mes salta cuando TODOS los WP Status están en Completed.
              // (un bloque con prima 0 € no necesita LPAN, no bloquea el tic.)
              const completo = p.secciones.length > 0 && p.secciones.every((s) =>
                s.risk_codes.every((r) => r.lpan?.estado === "Completed" || Number(r.gross_premium) === 0 || r.exento_lpan || r.cubierto_historico));
              // LPAN "preparados": todo risk code con prima tiene ya su LPAN generado (o está exento/histórico).
              const lpanPreparado = p.secciones.length > 0 && p.secciones.every((s) =>
                s.risk_codes.every((r) => r.lpan != null || Number(r.gross_premium) === 0 || r.exento_lpan || r.cubierto_historico));
              const abierto = periodoOverride[p.periodo] ?? !completo; // pendiente -> abierto por defecto
              return (
              <div key={p.periodo} className="recibo-box" style={{ marginBottom: 14 }}>
                <div className="lpan-periodo-cab">
                  <h4 className="lpan-colap" onClick={() => setPeriodoOverride((o) => ({ ...o, [p.periodo]: !abierto }))}>
                    <span className="nav-chevron">{abierto ? "▾" : "▸"}</span>
                    {p.periodo_label}{completo ? " ✓" : ""}
                  </h4>
                  {lpanPreparado && (
                    <button className="btn-primary btn-sm" disabled={lpanBusy}
                       title="Descargar el LPAN Bdx de este mes (agrupado por Risk Code; España y Portugal separados en la misma hoja; elige carpeta)"
                       onClick={() => descargarBdxExcel(p.periodo)}>
                      ⬇️ LPAN Bdx (Excel)
                    </button>
                  )}
                </div>
                {abierto && p.secciones.map((s) => (
                  <div key={s.section} style={{ marginBottom: 8 }}>
                    <div className="lpan-seccion-tit">Sección {s.section}</div>
                    <table className="compacto bdx-tabla lpan-periodo-tabla">
                      <colgroup>
                        <col style={{ width: 80 }} /><col style={{ width: 60 }} />
                        <col style={{ width: 110 }} /><col style={{ width: 85 }} />
                        <col style={{ width: 95 }} /><col style={{ width: 110 }} />
                        <col style={{ width: 90 }} /><col style={{ width: 150 }} />
                        <col style={{ width: 100 }} /><col style={{ width: 118 }} />
                        <col style={{ width: 118 }} /><col style={{ width: 110 }} />
                        <col style={{ width: 118 }} /><col style={{ width: 118 }} />
                        <col style={{ width: 80 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Risk Code</th><th className="num">Nº líneas</th>
                          <th className="num">GWP Our Line</th><th className="num">Brokerage %</th>
                          <th className="num">IPT</th><th className="num">Net to UW</th>
                          <th>Cobrado</th><th>LPAN</th>
                          <th>WP</th><th>Procesado</th><th>SDD</th><th>WP Status</th>
                          <th>Liberado</th><th>Liquidado</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.risk_codes.map((r) => (
                          <LpanRow
                            key={`${r.risk_code}-${r.comision_pct}`}
                            r={r}
                            section={s.section}
                            periodo={p.periodo}
                            binderId={binder.id}
                            busy={lpanBusy}
                            esLloyds={lpanData.es_lloyds}
                            onChanged={cargarLpan}
                            onBorrar={setLpanABorrar}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              );
            })}
            </div>
          </div>
        )
      )}

      {lpanABorrar && (
        <ConfirmDialog
          titulo="Borrar LPAN"
          mensaje={<>Vas a borrar el LPAN <strong>{lpanABorrar.etiqueta}</strong>.</>}
          detalle="Se borrará solo este LPAN. Esta acción no se puede deshacer."
          confirmLabel="Borrar LPAN"
          onConfirm={() => {
            const id = lpanABorrar.id;
            setLpanABorrar(null);
            accionLpan(() => lpanApi.borrarLpan(id));
          }}
          onClose={() => setLpanABorrar(null)}
        />
      )}

      {tab === "triangulacion" && (
        triBusy && !tri ? (
          <div className="empty">Cargando triangulación…</div>
        ) : !tri ? (
          <div className="empty">No hay snapshots de Claims para triangular.</div>
        ) : (() => {
          const esPct = triMetrica === "pct";
          const esNum = triMetrica === "num";
          const matriz = tri.triangulos[esPct ? "incurrido" : triMetrica];
          const meses = tri.meses;
          const n = meses.length;
          const ratio = tri.net_uw ? (tri.incurrido_actual / tri.net_uw) * 100 : null;
          const ibnrPct = tri.net_uw ? (tri.ibnr_sugerido / tri.net_uw) * 100 : null;
          const ultPct = tri.net_uw ? (tri.ultimate_sugerido / tri.net_uw) * 100 : null;
          // En "%", cada celda = incurrido valuado / Net to UWs (siniestralidad hasta ese mes).
          const celda = (v: number | null) =>
            v == null ? "" : esPct ? (tri.net_uw ? `${fmtMiles((v / tri.net_uw) * 100)} %` : "—") : esNum ? v : fmtMiles(v);
          // Columnas según la vista:
          //  - "cal": meses de valuación, del MÁS RECIENTE (izquierda) al más antiguo (derecha).
          //  - "edad": antigüedad 0,1,2… (meses desde la apertura); celda = valor a origen+d.
          type ColDef = { label: string; get: (i: number) => number | null };
          const colDefs: ColDef[] =
            triVista === "cal"
              ? Array.from({ length: n }, (_, k) => n - 1 - k).map((j) => ({
                  label: meses[j], get: (i: number) => matriz[i][j],
                }))
              : Array.from({ length: n }, (_, d) => ({
                  label: String(d), get: (i: number) => (i + d < n ? matriz[i][i + d] : null),
                }));
          const totalCol = colDefs.map((c) => matriz.reduce((a, _f, i) => a + (c.get(i) ?? 0), 0));
          return (
            <>
              <div style={{ marginBottom: 8 }}>
                <div className="bdx-topbar" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                  <div className="toolbar" style={{ flexWrap: "wrap", marginBottom: 0 }}>
                    <select className="filtro" value={triMetrica} onChange={(e) => setTriMetrica(e.target.value as MetricaTriangulo)}>
                      <option value="incurrido">Incurrido (pagado + reservas)</option>
                      <option value="pagado">Pagado</option>
                      <option value="num">Nº de siniestros</option>
                      <option value="pct">% Siniestralidad (s/ Net to UWs)</option>
                    </select>
                    <select
                      className="filtro"
                      value={triScope.risk_code ? `rc:${triScope.risk_code}` : triScope.seccion != null ? `sec:${triScope.seccion}` : "total"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTriScope(v === "total" ? {} : v.startsWith("rc:") ? { risk_code: v.slice(3) } : { seccion: Number(v.slice(4)) });
                      }}
                    >
                      <option value="total">Ámbito: Total</option>
                      {tri.risk_codes.map((rc) => <option key={`rc:${rc}`} value={`rc:${rc}`}>Código {rc}</option>)}
                      {tri.secciones.map((s) => <option key={`sec:${s}`} value={`sec:${s}`}>Sección {s}</option>)}
                    </select>
                    <button
                      className={"btn-toggle" + (triVista === "edad" ? " on" : "")}
                      onClick={() => setTriVista((v) => (v === "cal" ? "edad" : "cal"))}
                      title="Cambia entre vista Calendario y Por antigüedad"
                    >
                      Vista: {triVista === "cal" ? "Calendario" : "Por antigüedad"}
                    </button>
                    <button className="btn-primary" onClick={exportarTriangulo} title="Exportar a Excel la métrica y el ámbito seleccionados">📊 Excel</button>
                  </div>
                  <div className="bdx-totales">
                    <div className="tot-col">
                      <div className="tot-row"><span>GWP Our Line</span><b>{imp(tri.gwp_our_line)}</b></div>
                      <div className="tot-row"><span>Net to UWs</span><b>{imp(tri.net_uw)}</b></div>
                    </div>
                    <div className="tot-col">
                      <div className="tot-row"><span>Incurrido actual</span><b>{imp(tri.incurrido_actual)}</b></div>
                      <div className="tot-row"><span>Siniestralidad</span><b>{ratio == null ? "—" : `${fmtMiles(ratio)} %`}</b></div>
                    </div>
                    <div className="tot-col">
                      <div className="tot-row" title="% sobre Net to UWs"><span>IBNR sugerido</span><b>{imp(tri.ibnr_sugerido)}{ibnrPct == null ? "" : ` (${fmtMiles(ibnrPct)} %)`}</b></div>
                      <div className="tot-row" title="% sobre Net to UWs"><span>Ultimate</span><b>{imp(tri.ultimate_sugerido)}{ultPct == null ? "" : ` (${fmtMiles(ultPct)} %)`}</b></div>
                    </div>
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 4, display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Filas = mes de apertura · columnas = {triVista === "cal" ? "mes de valuación (reciente → antiguo)" : "meses desde la apertura"}.</span>
                  <span>IBNR calculado usando el Método Bornhuetter-Ferguson.</span>
                </div>
              </div>
              {meses.length === 0 ? (
                <div className="empty">No hay siniestros en este ámbito.</div>
              ) : (
                <div className="tabla-scroll bdx-scroll">
                  <table className="compacto bdx-tabla tri-tabla">
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", left: 0 }}>Mes</th>
                        <th className="num tri-actual" title="Net to UWs del mes (GWP our line − comisiones)">Net to UWs</th>
                        {colDefs.map((c, k) => <th key={k} className="num">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {meses.map((m, i) => (
                        <tr key={m}>
                          <th style={{ position: "sticky", left: 0 }}>{m}</th>
                          <td className="num tri-actual">{fmtMiles(tri.net_premium_mes[i])}</td>
                          {colDefs.map((c, k) => <td key={k} className="num">{celda(c.get(i))}</td>)}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="tri-total">
                        <th style={{ position: "sticky", left: 0 }}>Total</th>
                        <td className="num tri-actual">{fmtMiles(tri.net_uw)}</td>
                        {totalCol.map((t, k) => <td key={k} className="num">{celda(t)}</td>)}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          );
        })()
      )}

      {cbPresentarMes && cbVista && (
        <FormPanel
          title="Presentar Claims BDX"
          dirty={false}
          saving={cbBusy}
          saveLabel="Presentar y descargar"
          onSave={() => presentarClaimsBdx(cbPresentarMes)}
          onClose={() => setCbPresentarMes(null)}
        >
          <p className="hint" style={{ marginBottom: 12 }}>
            Elige el mes a presentar (solo aparecen los meses <b>no presentados</b>). Se congelará el snapshot, se bloqueará el mes y se descargará el Excel del bordereau.
          </p>
          <div className="field">
            <label>Mes a presentar</label>
            <select value={cbPresentarMes} onChange={(e) => setCbPresentarMes(e.target.value)}>
              {cbVista.meses_pendientes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </FormPanel>
      )}

      {/* Ficha de línea */}
      {sel && linea && (
        <BdxLineaPanel
          bdxId={sel.id}
          linea={linea === "nueva" ? null : linea}
          readOnly={linea !== "nueva" && lineaBloqueada(linea)}
          onSaved={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onDeleted={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onClose={() => setLinea(null)}
        />
      )}

      {/* Emisión de recibo: modal precalculado (estilo Access); se crea al pulsar "Emitir recibo". */}
      {borrador && (
        <ReciboModal
          titulo={`Emitir recibo · Risk BDX ${mesLargo(borrador.periodo)}`}
          saveLabel="Emitir recibo"
          recibo={borrador}
          numeroProvisional
          soloLectura
          saving={emitiendo}
          error={error}
          onSave={emitirRecibo}
          onClose={() => setBorrador(null)}
        />
      )}

      {/* Confirmación contundente para acciones sensibles */}
      {confirmar && (
        <ConfirmDialog
          titulo={confirmar.titulo}
          mensaje={confirmar.mensaje}
          importe={confirmar.importe}
          detalle={confirmar.detalle}
          confirmLabel={confirmar.confirmLabel}
          doble={confirmar.doble}
          onConfirm={confirmar.accion}
          onClose={() => setConfirmar(null)}
        />
      )}


      {/* Importar BDX desde SharePoint: preview → importar → conciliación */}
      {importAbierto && (
        <div className="overlay">
          <div className="panel" role="dialog" aria-modal="true" aria-label="Importar BDX de SharePoint">
            <div className="panel-head">
              <h2>Importar BDX de SharePoint</h2>
              <button className="panel-close" onClick={cerrarImport} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="panel-body">
              {importError && <div className="error">⚠ {importError}</div>}
              {importBusy && !preview && <div className="loading">Leyendo SharePoint…</div>}

              {preview && !importRes && (
                <>
                  <div className="hint" style={{ marginBottom: 12 }}>
                    Lista de origen: <strong>{preview.list_title}</strong>
                  </div>
                  <div className="datos-grid">
                    <Dato label="Líneas en SharePoint" valor={preview.total_lineas} />
                    <Dato label="Periodos" valor={preview.periodos.length} />
                    <Dato label="Suma GWP" valor={imp(preview.suma_gwp)} />
                    <Dato label="Incluidas en Premium" valor={preview.incluidas_en_premium} />
                  </div>
                  <div className="hint" style={{ margin: "10px 0" }}>Periodos: {preview.periodos.join(" · ") || "—"}</div>
                  <div className="hint" style={{ marginTop: 8 }}>
                    Al importar se vuelca al BDX único del binder. Es <strong>idempotente</strong>: si ya
                    estaban, se actualizan (no se duplican).
                  </div>
                </>
              )}

              {importRes && (
                <>
                  <div className="hint" style={{ marginBottom: 12 }}>
                    Importación de <strong>{importRes.list_title}</strong> completada.
                  </div>
                  <div className="datos-grid">
                    <Dato label="Insertadas" valor={importRes.insertadas} />
                    <Dato label="Actualizadas" valor={importRes.actualizadas} />
                    <Dato label="Sin _OldID" valor={importRes.sin_old_id} />
                    <Dato label="Periodos" valor={importRes.periodos.length} />
                  </div>
                  <h3 style={{ marginTop: 16, marginBottom: 8 }}>Conciliación SharePoint ↔ base</h3>
                  <div className="datos-grid">
                    <Dato
                      label="Líneas (SP / base)"
                      valor={`${importRes.conciliacion.lineas_sharepoint} / ${importRes.conciliacion.lineas_postgres}`}
                    />
                    <Dato
                      label="GWP (SP / base)"
                      valor={`${imp(importRes.conciliacion.gwp_sharepoint)} / ${imp(importRes.conciliacion.gwp_postgres)}`}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      color: importRes.conciliacion.lineas_ok && importRes.conciliacion.gwp_ok ? "#15803d" : "var(--rojo)",
                      fontWeight: 600,
                    }}
                  >
                    {importRes.conciliacion.lineas_ok && importRes.conciliacion.gwp_ok
                      ? "✓ Todo cuadra (líneas y GWP)."
                      : "✗ Hay descuadre — revísalo antes de continuar."}
                  </div>
                </>
              )}
            </div>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={cerrarImport}>
                Cerrar
              </button>
              {preview && !importRes && (
                <button className="btn-primary" onClick={hacerImport} disabled={importBusy}>
                  {importBusy ? "Importando…" : `Importar ${preview.total_lineas} líneas`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | number | null | undefined }) {
  return (
    <div className="dato">
      <span className="dato-label">{label}</span>
      <span className="dato-valor">{valor == null || valor === "" ? "—" : String(valor)}</span>
    </div>
  );
}
