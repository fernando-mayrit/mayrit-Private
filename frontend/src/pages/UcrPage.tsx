import { useEffect, useMemo, useState } from "react";
import { ucrApi, type UcrRegistro, type UcrListado, type UcrOpciones, type UcrFiltros } from "../api";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";

// UCR (Unique Claims Reference): tabla traída de SharePoint (Mayrit - TUCR). Listado GLOBAL de solo
// lectura con filtros. El alta/edición se hace en la pestaña UCR de cada binder.

const COLS: Col<UcrRegistro>[] = [
  { key: "ucr", label: "UCR", tipo: "text", width: 175 },
  { key: "umr", label: "UMR", tipo: "text", width: 150 },
  { key: "coverholder", label: "Coverholder", tipo: "text", width: 150 },
  { key: "section", label: "Secc.", tipo: "text", width: 55 },
  { key: "risk_code", label: "Risk Code", tipo: "text", width: 80 },
  { key: "signing", label: "Signing", tipo: "text", width: 140 },
  { key: "tpa", label: "TPA", tipo: "text", width: 130 },
  {
    key: "estado", label: "Estado", tipo: "text", width: 90,
    render: (u) => u.estado
      ? <span className={`pill ${/cerrad/i.test(u.estado) ? "pill-pendiente" : "pill-cobrado"}`}>{u.estado}</span>
      : <span className="hint">—</span>,
  },
  { key: "notas", label: "Notas", tipo: "text", width: 220 },
];
const DEFAULT_KEYS = COLS.map((c) => c.key);
const ESTADOS = ["Abierto", "Cerrado"];

export default function UcrPage() {
  const [data, setData] = useState<UcrListado | null>(null);
  const [opciones, setOpciones] = useState<UcrOpciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [umr, setUmr] = useState("");
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");

  const filtros: UcrFiltros = useMemo(
    () => ({ umr: umr || null, estado: estado || null, q: q.trim() || null }),
    [umr, estado, q],
  );

  async function cargar() {
    setCargando(true);
    try { setData(await ucrApi.listar(filtros)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtros]);
  useEffect(() => { ucrApi.opciones().then(setOpciones).catch(() => {}); }, []);

  return (
    <div className="container lista-page">
      <PageHeader emoji="🔖" title="UCR" />

      <div className="bdx-topbar tr-cab" style={{ alignItems: "flex-start", marginTop: 4 }}>
        <div className="tr-filtros">
          <div className="toolbar tr-filtros-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            <input type="search" placeholder="Buscar UCR, UMR, coverholder, signing, TPA…" value={q}
              onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px", minWidth: 180 }} />
            <select className="filtro" value={umr} onChange={(e) => setUmr(e.target.value)} title="Filtrar por UMR">
              <option value="">UMR: todos</option>
              {(opciones?.umrs ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select className="filtro" value={estado} onChange={(e) => setEstado(e.target.value)} title="Filtrar por estado">
              <option value="">Estado: todos</option>
              {(opciones?.estados ?? ESTADOS).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p className="hint">Listado de solo lectura. El alta y la edición de UCR se hacen en la pestaña <b>UCR</b> de cada binder.</p>
        </div>
        {data && (
          <div className="bdx-totales tr-totales">
            <div className="tot-col">
              <div className="tot-row tot-cab"><span>UCR</span><b /></div>
              <div className="tot-row tot-pdte"><span>Total</span><b>{data.n_total}</b></div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {data && data.items.length === 0 && !cargando ? (
        <div className="empty">No hay UCR con esos filtros.</div>
      ) : (
        <TablaDatos
          filas={data?.items ?? []}
          columnas={COLS}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.ucr.tabla.v1"
          defaultSort={{ key: "ucr", dir: 1 }}
        />
      )}
      {data && data.n_total > data.items.length && (
        <p className="hint" style={{ marginTop: 6 }}>Mostrando {data.items.length} de {data.n_total}. Afina con los filtros.</p>
      )}
    </div>
  );
}
