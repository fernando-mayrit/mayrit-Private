import { useEffect, useMemo, useState } from "react";
import { siniestrosApi, exportarXlsx, type RatiosBase } from "../api";
import type { Siniestro } from "../types";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import TablaDatos, { type Col } from "../components/TablaDatos";
import { fmtMiles, fmtFechaES, estadoSiniestroClase } from "../format";

const STORAGE_KEY = "mayrit.siniestros.global.tabla.v3";

const n = (v: unknown) => Number(v) || 0;

// Columnas del listado global. Igual que la pestaña de siniestros del binder, pero con la
// columna del Binder (UMR) al principio para identificar de cuál es cada siniestro.
const COLS: Col<Siniestro>[] = [
  { key: "binder_umr", label: "Binder", tipo: "text", width: 150 },
  { key: "binder_programa", label: "Programa", tipo: "text", width: 170 },
  { key: "certificate", label: "Certificate", tipo: "text" },
  { key: "reference", label: "Reference", tipo: "text" },
  { key: "insured", label: "Asegurado", tipo: "text", width: 180 },
  { key: "section", label: "Secc.", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "currency", label: "Moneda", tipo: "text" },
  { key: "status", label: "Estado", tipo: "text",
    render: (s) => s.status ? <span className={`pill pill-sin-${estadoSiniestroClase(s.status)}`}>{s.status}</span> : <span className="hint">—</span> },
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
  { key: "total_indemnity", label: "Total ind.", tipo: "num" },
  { key: "total_fees", label: "Total fees", tipo: "num" },
  { key: "total", label: "Total", tipo: "num", calc: (s) => n(s.total_indemnity) + n(s.total_fees) },
  { key: "ucr", label: "UCR", tipo: "text" },
  { key: "abogado", label: "Abogado", tipo: "text" },
  { key: "description", label: "Descripción", tipo: "text", width: 220 },
  { key: "refer", label: "Refer", tipo: "text" },
  { key: "denial", label: "Denial", tipo: "text" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
];
const DEFAULT_KEYS = [
  "binder_umr", "binder_programa", "reference", "certificate", "insured", "risk_code", "claim_first_advised", "date_opened",
  "paid_fees", "paid_indemnity", "reserves_fees", "reserves_indemnity",
  "total_fees", "total_indemnity", "total", "date_closed", "status",
];

export default function SiniestrosPage() {
  const [items, setItems] = useState<Siniestro[]>([]);
  const [ratios, setRatios] = useState<{ total: RatiosBase; por_programa: Record<string, RatiosBase> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fPrograma, setFPrograma] = useState("");
  const [exportando, setExportando] = useState(false);
  const [expCols, setExpCols] = useState<Set<string>>(new Set());
  const [expSaving, setExpSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sin, rat] = await Promise.all([siniestrosApi.listarTodos(), siniestrosApi.ratios()]);
        setItems(sin);
        setRatios(rat);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron cargar los siniestros.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Programas disponibles (de los siniestros cargados) para el desplegable de filtro.
  const programas = useMemo(
    () => [...new Set(items.map((s) => s.binder_programa).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const filtrados = useMemo(
    () => (fPrograma ? items.filter((s) => s.binder_programa === fPrograma) : items),
    [items, fPrograma]
  );

  const tot = useMemo(() => {
    const abiertos = filtrados.filter((s) => !s.date_closed).length;
    return {
      nSin: filtrados.length,
      abiertos,
      cerrados: filtrados.length - abiertos,
      reclamado: filtrados.reduce((a, s) => a + n(s.amount_claimed), 0),
      reservaFees: filtrados.reduce((a, s) => a + n(s.reserves_fees), 0),
      pagosFees: filtrados.reduce((a, s) => a + n(s.paid_fees), 0),
      totalFees: filtrados.reduce((a, s) => a + n(s.total_fees), 0),
      reservaIndem: filtrados.reduce((a, s) => a + n(s.reserves_indemnity), 0),
      pagosIndem: filtrados.reduce((a, s) => a + n(s.paid_indemnity), 0),
      totalIndem: filtrados.reduce((a, s) => a + n(s.total_indemnity), 0),
    };
  }, [filtrados]);
  const totalGen = tot.totalFees + tot.totalIndem;
  const pct = (x: number) => (totalGen > 0 ? `${fmtMiles((x / totalGen) * 100)} %` : "—");
  // Base de producción (GWP/pólizas) para los ratios: del programa filtrado o el total.
  const base = ratios ? (fPrograma ? ratios.por_programa[fPrograma] : ratios.total) : null;
  const ratioFrec = base && base.n_polizas > 0 ? `${fmtMiles((tot.nSin / base.n_polizas) * 100)} %` : "—";
  const ratioSin = base && base.net_uw > 0 ? `${fmtMiles((totalGen / base.net_uw) * 100)} %` : "—";

  // ── Exportar a Excel (selector de columnas, como en Recibos) ──
  function abrirExport() {
    let visibles: string[] = DEFAULT_KEYS;
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}.cols`);
      if (raw) {
        const arr = (JSON.parse(raw) as string[]).filter((k) => COLS.some((c) => c.key === k));
        if (arr.length) visibles = arr;
      }
    } catch { /* ignora */ }
    setExpCols(new Set(visibles));
    setExportando(true);
  }
  function valorExport(s: Siniestro, col: Col<Siniestro>): string | number | null {
    const raw = col.calc ? col.calc(s) : (s as unknown as Record<string, unknown>)[col.key];
    if (raw == null || raw === "") return null;
    if (col.tipo === "num" || col.tipo === "pct" || col.tipo === "int") return Number(raw) || 0;
    if (col.tipo === "date") return fmtFechaES(raw);
    return String(raw);
  }
  async function descargarExcel() {
    const cols = COLS.filter((c) => expCols.has(c.key)); // en el orden del catálogo
    if (!cols.length) return setError("Selecciona al menos una columna.");
    setExpSaving(true);
    setError(null);
    try {
      const suf = fPrograma ? `_${fPrograma.replace(/[^\w]+/g, "_")}` : "";
      const blob = await exportarXlsx({
        nombre: `siniestros${suf}`,
        hoja: "Siniestros",
        headers: cols.map((c) => c.label),
        filas: filtrados.map((s) => cols.map((c) => valorExport(s, c))),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `siniestros${suf}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportando(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpSaving(false);
    }
  }

  return (
    <div className="container lista-page">
      <PageHeader emoji="🚨" title="Siniestros" />
      {loading ? (
        <div className="loading">Cargando…</div>
      ) : error && items.length === 0 ? (
        <div className="error">{error}</div>
      ) : items.length === 0 ? (
        <>
          <div className="hint" style={{ margin: "0 0 12px" }}>Todos los siniestros (Claims BDX) de todos los binders.</div>
          <div className="empty">Aún no hay siniestros importados.</div>
        </>
      ) : (
        <>
          <div className="bdx-topbar" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="hint" style={{ marginBottom: 8 }}>Todos los siniestros (Claims BDX) de todos los binders.</div>
              <div className="toolbar">
                <select className="filtro" value={fPrograma} onChange={(e) => setFPrograma(e.target.value)} title="Filtrar por Programa">
                  <option value="">Programa: todos</option>
                  {programas.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {/* Excel: debajo del buscador, a la izquierda del cuadro contador */}
              <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} title="Exportar el listado a Excel" onClick={abrirExport}>
                ⬇️ Excel
              </button>
            </div>
            <div className="bdx-totales">
              <div className="tot-col">
                <div className="tot-row"><span>Nº Siniestros</span><b>{fmtMiles(tot.nSin, 0)}</b></div>
                <div className="tot-row"><span>Abiertos</span><b>{fmtMiles(tot.abiertos, 0)}</b></div>
                <div className="tot-row"><span>Cerrados</span><b>{fmtMiles(tot.cerrados, 0)}</b></div>
                <div className="tot-row"><span>Cantidad Reclamada</span><b>{fmtMiles(tot.reclamado)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row"><span>% Fees</span><b>{pct(tot.totalFees)}</b></div>
                <div className="tot-row"><span>Reserva Fees</span><b>{fmtMiles(tot.reservaFees)}</b></div>
                <div className="tot-row"><span>Pagos Fees</span><b>{fmtMiles(tot.pagosFees)}</b></div>
                <div className="tot-row tot-pdte"><span>Total Fees</span><b>{fmtMiles(tot.totalFees)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row"><span>% Indem.</span><b>{pct(tot.totalIndem)}</b></div>
                <div className="tot-row"><span>Reserva Indem.</span><b>{fmtMiles(tot.reservaIndem)}</b></div>
                <div className="tot-row"><span>Pagos Indem.</span><b>{fmtMiles(tot.pagosIndem)}</b></div>
                <div className="tot-row tot-pdte"><span>Total Indem.</span><b>{fmtMiles(tot.totalIndem)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row" style={{ visibility: "hidden" }}><span>·</span><b>·</b></div>
                <div className="tot-row"><span>Reserva Total</span><b>{fmtMiles(tot.reservaFees + tot.reservaIndem)}</b></div>
                <div className="tot-row"><span>Pagos Total</span><b>{fmtMiles(tot.pagosFees + tot.pagosIndem)}</b></div>
                <div className="tot-row tot-pdte"><span>Total</span><b>{fmtMiles(totalGen)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row"><span title="GWP our line − comisión coverholder − brokerage">Prima Neta</span><b>{base ? fmtMiles(base.net_uw) : "—"}</b></div>
                <div className="tot-ratios">
                  <div className="tot-row tot-ratio"><span title="Nº siniestros / Nº pólizas">Ratio Frecuencia</span><b>{ratioFrec}</b></div>
                  <div className="tot-row tot-ratio"><span title="Siniestralidad / (GWP our line − com. coverholder − brokerage)">Ratio Siniestralidad</span><b>{ratioSin}</b></div>
                </div>
              </div>
            </div>
          </div>
          <TablaDatos
            filas={filtrados}
            columnas={COLS}
            defaultKeys={DEFAULT_KEYS}
            storageKey={STORAGE_KEY}
          />
        </>
      )}

      {exportando && (
        <FormPanel
          title="Exportar a Excel"
          dirty={false}
          saving={expSaving}
          saveLabel={`Descargar (${filtrados.length} filas)`}
          error={error}
          onSave={descargarExcel}
          onClose={() => setExportando(false)}
        >
          <p className="hint" style={{ marginBottom: 10 }}>
            Marca las columnas a exportar. Se exporta el listado tal y como está filtrado.
          </p>
          <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
            <button className="btn-link" onClick={() => setExpCols(new Set(COLS.map((c) => c.key)))}>Todas</button>
            <button className="btn-link" onClick={() => setExpCols(new Set())}>Ninguna</button>
            <button className="btn-link" onClick={() => setExpCols(new Set(DEFAULT_KEYS))}>Por defecto</button>
          </div>
          <div className="export-cols">
            {COLS.map((c) => (
              <label key={c.key} className="col-menu-item">
                <input
                  type="checkbox"
                  checked={expCols.has(c.key)}
                  onChange={() =>
                    setExpCols((s) => {
                      const nx = new Set(s);
                      if (nx.has(c.key)) nx.delete(c.key);
                      else nx.add(c.key);
                      return nx;
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </FormPanel>
      )}
    </div>
  );
}
