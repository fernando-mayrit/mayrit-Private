import { useEffect, useMemo, useState } from "react";
import { lpanApi, exportarXlsx, type LpanGlobal } from "../api";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import TablaDatos, { type Col } from "../components/TablaDatos";
import { fmtMiles, fmtFechaES } from "../format";

const STORAGE_KEY = "mayrit.lpans.global.tabla.v1";
const n = (v: unknown) => Number(v) || 0;

const COLS: Col<LpanGlobal>[] = [
  { key: "tipo", label: "Tipo", tipo: "text" },
  { key: "periodo", label: "Periodo", tipo: "text" },
  { key: "binder_umr", label: "Binder", tipo: "text", width: 150 },
  { key: "poliza_numero", label: "Póliza", tipo: "text", width: 150 },
  { key: "programa", label: "Programa", tipo: "text", width: 160 },
  { key: "section", label: "Secc.", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "signing_number", label: "Signing", tipo: "text", width: 130 },
  { key: "work_package", label: "Work Package", tipo: "text" },
  { key: "broker_ref1", label: "Broker Ref 1", tipo: "text", width: 130 },
  { key: "broker_ref2", label: "Broker Ref 2", tipo: "text", width: 180 },
  { key: "gross_premium", label: "Gross", tipo: "num" },
  { key: "brokerage", label: "Brokerage", tipo: "num" },
  { key: "tax", label: "Tax", tipo: "num" },
  { key: "net_premium", label: "Neto a UW", tipo: "num" },
  { key: "fecha", label: "Procesado", tipo: "date" },
  { key: "sdd", label: "SDD", tipo: "date" },
  { key: "liberado", label: "Liberado", tipo: "date" },
  { key: "pagado", label: "Pagado", tipo: "date" },
  { key: "estado", label: "Status", tipo: "text" },
];
const DEFAULT_KEYS = [
  "tipo", "periodo", "binder_umr", "poliza_numero", "section", "risk_code",
  "signing_number", "work_package", "gross_premium", "tax", "net_premium", "fecha", "estado",
];

export default function LpanPage() {
  const [items, setItems] = useState<LpanGlobal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fPrograma, setFPrograma] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [exportando, setExportando] = useState(false);
  const [expCols, setExpCols] = useState<Set<string>>(new Set());
  const [expSaving, setExpSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setItems(await lpanApi.listarTodos());
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron cargar los LPANs.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const programas = useMemo(
    () => [...new Set(items.map((l) => l.programa).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const tipos = useMemo(
    () => [...new Set(items.map((l) => l.tipo).filter(Boolean))].sort(),
    [items],
  );
  const filtrados = useMemo(
    () => items
      .filter((l) => !fPrograma || l.programa === fPrograma)
      .filter((l) => !fTipo || l.tipo === fTipo),
    [items, fPrograma, fTipo],
  );

  // Filas que la tabla muestra de verdad (tras sus filtros por columna). Hasta que la tabla
  // informa por primera vez, caemos a `filtrados`. Los totales y el export usan esto.
  const [visibles, setVisibles] = useState<LpanGlobal[] | null>(null);
  const base = visibles ?? filtrados;

  const tot = useMemo(() => ({
    nLpan: base.length,
    gross: base.reduce((a, l) => a + n(l.gross_premium), 0),
    tax: base.reduce((a, l) => a + n(l.tax), 0),
    net: base.reduce((a, l) => a + n(l.net_premium), 0),
  }), [base]);

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
  function valorExport(l: LpanGlobal, col: Col<LpanGlobal>): string | number | null {
    const raw = (l as unknown as Record<string, unknown>)[col.key];
    if (raw == null || raw === "") return null;
    if (col.tipo === "num" || col.tipo === "int") return Number(raw) || 0;
    if (col.tipo === "date") return fmtFechaES(raw);
    return String(raw);
  }
  async function descargarExcel() {
    const cols = COLS.filter((c) => expCols.has(c.key));
    if (!cols.length) return setError("Selecciona al menos una columna.");
    setExpSaving(true);
    setError(null);
    try {
      const suf = fPrograma ? `_${fPrograma.replace(/[^\w]+/g, "_")}` : "";
      const blob = await exportarXlsx({
        nombre: `lpans${suf}`,
        hoja: "LPANs",
        headers: cols.map((c) => c.label),
        filas: base.map((l) => cols.map((c) => valorExport(l, c))),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lpans${suf}.xlsx`;
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
      <PageHeader emoji="📐" title="LPAN" />
      {loading ? (
        <div className="loading">Cargando…</div>
      ) : error && items.length === 0 ? (
        <div className="error">{error}</div>
      ) : items.length === 0 ? (
        <div className="empty">Aún no hay LPANs.</div>
      ) : (
        <>
          <div className="bdx-topbar" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="hint" style={{ marginBottom: 8 }}>Todos los LPANs (de binders y pólizas).</div>
              <div className="toolbar">
                <select className="filtro" value={fPrograma} onChange={(e) => setFPrograma(e.target.value)} title="Filtrar por Programa">
                  <option value="">Programa: todos</option>
                  {programas.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="filtro" value={fTipo} onChange={(e) => setFTipo(e.target.value)} title="Filtrar por Tipo">
                  <option value="">Tipo: todos</option>
                  {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} title="Exportar el listado a Excel" onClick={abrirExport}>
                ⬇️ Excel
              </button>
            </div>
            <div className="bdx-totales">
              <div className="tot-col">
                <div className="tot-row"><span>Nº LPANs</span><b>{fmtMiles(tot.nLpan, 0)}</b></div>
                <div className="tot-row"><span>Gross</span><b>{fmtMiles(tot.gross)}</b></div>
                <div className="tot-row"><span>Tax</span><b>{fmtMiles(tot.tax)}</b></div>
                <div className="tot-row tot-pdte"><span>Neto a UW</span><b>{fmtMiles(tot.net)}</b></div>
              </div>
            </div>
          </div>
          <TablaDatos
            filas={filtrados}
            columnas={COLS}
            defaultKeys={DEFAULT_KEYS}
            storageKey={STORAGE_KEY}
            defaultSort={{ key: "periodo", dir: -1 }}
            onFiltrar={setVisibles}
          />
        </>
      )}

      {exportando && (
        <FormPanel
          title="Exportar a Excel"
          dirty={false}
          saving={expSaving}
          saveLabel={`Descargar (${base.length} filas)`}
          error={error}
          onSave={descargarExcel}
          onClose={() => setExportando(false)}
        >
          <p className="hint" style={{ marginBottom: 10 }}>Marca las columnas a exportar. Se exporta el listado tal y como está filtrado.</p>
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
                  onChange={() => setExpCols((s) => { const nx = new Set(s); if (nx.has(c.key)) nx.delete(c.key); else nx.add(c.key); return nx; })}
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
