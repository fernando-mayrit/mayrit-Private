import { useCallback, useEffect, useMemo, useState } from "react";
import { contabilidadApi, type MovimientoBancario, type MovimientosListados, type OpcionesConta, type ContaFiltros, type ContaCategoria } from "../api";
import { fmtMiles } from "../format";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import AltaMovimiento from "../components/AltaMovimiento";

// Contabilidad — libro de banco categorizado (espejo de las listas 'Contabilidad - *' de SharePoint).
// Regla clave: SIEMPRE se ve UNA sola cuenta a la vez (nunca se mezclan). 'Movimiento Fondos'
// (traspasos internos entre cuentas) va aparte.
const eur = (v: number | string | null | undefined) => `${fmtMiles(v)} €`;
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const FONDOS = "Movimiento Fondos";
// Orden fijo de las pestañas de cuenta (las no listadas van al final, alfabéticas).
const ORDEN_CUENTAS = [
  "Sabadell General", "Sabadell Clientes", "Bankinter Clientes",
  "Mediolanum Clientes", "Mediolanum General",
  "Revolut General EUR", "Revolut General USD", "Revolut General GBP",
];

const COLS: Col<MovimientoBancario>[] = [
  { key: "identificador", label: "Id", tipo: "text", width: 80 },
  { key: "fecha", label: "Fecha", tipo: "date" },
  { key: "devengo", label: "Devengo", tipo: "date" },
  { key: "tipo", label: "Tipo", tipo: "text",
    render: (m) => m.tipo
      ? <span className={`pill ${m.tipo === "Ingreso" ? "pill-cobrado" : "pill-pendiente"}`}>{m.tipo}</span>
      : <span className="hint">—</span> },
  { key: "grupo", label: "Grupo", tipo: "text", width: 150 },
  { key: "concepto", label: "Concepto", tipo: "text", width: 170 },
  { key: "gasto", label: "Gasto", tipo: "num", render: (m) => n(m.gasto) ? <span style={{ color: "#b00" }}>{fmtMiles(m.gasto)}</span> : "—" },
  { key: "ingreso", label: "Ingreso", tipo: "num", render: (m) => n(m.ingreso) ? <span style={{ color: "#0a0" }}>{fmtMiles(m.ingreso)}</span> : "—" },
  { key: "saldo", label: "Saldo", tipo: "num" },
  { key: "factura", label: "Justificante", tipo: "bool" },
  { key: "descripcion", label: "Descripción", tipo: "text", width: 260 },
  { key: "codigo", label: "Código", tipo: "text" },
];
const DEFAULT_KEYS = ["identificador", "fecha", "devengo", "tipo", "grupo", "concepto", "gasto", "ingreso", "saldo", "factura", "descripcion"];

export default function ContabilidadPage() {
  const [data, setData] = useState<MovimientosListados | null>(null);
  const [opciones, setOpciones] = useState<OpcionesConta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [cuenta, setCuenta] = useState<string>("");   // cuenta activa (SIEMPRE una)
  const [cats, setCats] = useState<ContaCategoria[]>([]);
  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<MovimientoBancario | null>(null);
  const [anio, setAnio] = useState<number | "">(new Date().getFullYear());   // por defecto, año en curso
  const [grupo, setGrupo] = useState("");
  const [tipo, setTipo] = useState("");
  const [concepto, setConcepto] = useState("");
  const [q, setQ] = useState("");
  const [resetSignal, setResetSignal] = useState(0);

  // Cuentas de banco (sin 'Movimiento Fondos', que va aparte).
  const cuentas = useMemo(() => {
    const lista = (opciones?.cuentas ?? []).filter((c) => c !== FONDOS);
    const idx = (c: string) => { const i = ORDEN_CUENTAS.indexOf(c); return i === -1 ? 999 : i; };
    return [...lista].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
  }, [opciones]);
  const hayFondos = useMemo(() => (opciones?.cuentas ?? []).includes(FONDOS), [opciones]);

  // Al cargar las opciones, selecciona la primera cuenta (nunca arranca "sin cuenta" / mezclando).
  useEffect(() => {
    if (!cuenta && cuentas.length) setCuenta(cuentas[0]);
  }, [cuentas, cuenta]);

  const filtros: ContaFiltros = useMemo(
    () => ({ cuenta: cuenta || null, anio: anio || null, grupo: grupo || null, tipo: tipo || null, concepto: concepto || null, q: q.trim() || null }),
    [cuenta, anio, grupo, tipo, concepto, q],
  );

  async function cargar() {
    if (!cuenta) return;   // no se carga nada hasta tener una cuenta elegida
    setCargando(true);
    try {
      setData(await contabilidadApi.listar(filtros));
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtros]);
  useEffect(() => { contabilidadApi.opciones().then(setOpciones).catch(() => {}); }, []);
  useEffect(() => { contabilidadApi.categorias().then(setCats).catch(() => {}); }, []);

  // Al cambiar de cuenta, limpia los filtros secundarios (cada cuenta es un mundo).
  function elegirCuenta(c: string) {
    setCuenta(c);
    setAnio(new Date().getFullYear()); setGrupo(""); setTipo(""); setConcepto(""); setQ("");
    setResetSignal((n) => n + 1);
  }
  // Botón 🧹: limpia todos los filtros (deja el año en curso, como el estado por defecto de la página)
  // y también los filtros por columna de la tabla.
  function limpiarFiltros() {
    setAnio(new Date().getFullYear()); setGrupo(""); setTipo(""); setConcepto(""); setQ("");
    setResetSignal((n) => n + 1);
  }

  // Justificante editable desde el listado (clic en la casilla). Optimista + revierte si falla.
  const toggleJustif = useCallback(async (m: MovimientoBancario) => {
    const nuevo = !m.factura;
    setData((d) => d ? { ...d, items: d.items.map((x) => x.id === m.id ? { ...x, factura: nuevo } : x) } : d);
    try {
      await contabilidadApi.actualizar(m.id, { factura: nuevo });
    } catch (e) {
      setError((e as Error).message);
      setData((d) => d ? { ...d, items: d.items.map((x) => x.id === m.id ? { ...x, factura: !nuevo } : x) } : d);
    }
  }, []);
  const columnas = useMemo<Col<MovimientoBancario>[]>(() => COLS.map((c) => c.key === "factura"
    ? { ...c, render: (m: MovimientoBancario) => (
        <input type="checkbox" checked={!!m.factura} style={{ cursor: "pointer" }}
          onClick={(e) => e.stopPropagation()} onChange={() => toggleJustif(m)} />
      ) }
    : c), [toggleJustif]);

  return (
    <div className="container lista-page">
      <PageHeader emoji="📒" title="Contabilidad" />

      {/* Selector de cuenta: SIEMPRE una activa. 'Movimiento Fondos' separado a la derecha. */}
      <div className="conta-ctas">
        {cuentas.map((c) => (
          <button key={c} className={"conta-cta" + (cuenta === c ? " active" : "")} onClick={() => elegirCuenta(c)}>{c}</button>
        ))}
        {hayFondos && (
          <button className={"conta-cta conta-cta-fondos" + (cuenta === FONDOS ? " active" : "")} onClick={() => elegirCuenta(FONDOS)} title="Traspasos internos entre cuentas (aparte)">
            🔄 {FONDOS}
          </button>
        )}
      </div>

      {data && (
        <div className="bdx-topbar tr-cab" style={{ alignItems: "flex-start", marginTop: 4 }}>
          <div className="tr-filtros">
            <div className="toolbar tr-filtros-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              <button className="btn-secondary" title="Limpiar todos los filtros" onClick={limpiarFiltros}>🧹</button>
              <select className="filtro" value={anio} onChange={(e) => setAnio(e.target.value ? Number(e.target.value) : "")} title="Filtrar por año">
                <option value="">Año: todos</option>
                {(opciones?.anios ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="filtro" value={tipo} onChange={(e) => setTipo(e.target.value)} title="Filtrar por tipo">
                <option value="">Tipo: todos</option>
                {(opciones?.tipos ?? ["Gasto", "Ingreso"]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="filtro" value={grupo} onChange={(e) => setGrupo(e.target.value)} title="Filtrar por grupo">
                <option value="">Grupo: todos</option>
                {(opciones?.grupos ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select className="filtro" value={concepto} onChange={(e) => setConcepto(e.target.value)} title="Filtrar por concepto">
                <option value="">Concepto: todos</option>
                {(opciones?.conceptos ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="search" placeholder="Buscar concepto, descripción, código…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 200px", minWidth: 170 }} />
            </div>
            <button className="btn-primary btn-sm" onClick={() => setAlta(true)} disabled={!cuenta}>＋ Alta de movimiento</button>
          </div>
          <div className="bdx-totales">
            <div className="tot-col">
              <div className="tot-row tot-cab"><span>{cuenta}{anio ? ` ${anio}` : ""}</span><b /></div>
              <div className="tot-row"><span>Ingresos</span><b>{eur(data.total_ingreso)}</b></div>
              <div className="tot-row"><span>Gastos</span><b>{eur(data.total_gasto)}</b></div>
              <div className="tot-row tot-pdte"><span>Neto</span><b>{eur(data.neto)}</b></div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {data && data.items.length === 0 && !cargando ? (
        <div className="empty">Sin movimientos en {cuenta} con esos filtros.</div>
      ) : (
        <TablaDatos
          filas={data?.items ?? []}
          columnas={columnas}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.contabilidad.tabla.v2"
          defaultSort={{ key: "fecha", dir: -1 }}
          resetSignal={resetSignal}
          rowClass={(m) => (m.factura ? undefined : "fila-sin-justificante")}
          rowAction={(m) => <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => setEditando(m)}>✏️</button>}
        />
      )}
      {data && data.n_total > data.items.length && (
        <p className="hint" style={{ marginTop: 6 }}>Mostrando los {data.items.length} más recientes de {data.n_total} de {cuenta}. Afina con los filtros para ver el resto.</p>
      )}

      {(alta || editando) && (
        <AltaMovimiento
          cuenta={editando?.cuenta ?? cuenta}
          cats={cats}
          movimiento={editando}
          onClose={() => { setAlta(false); setEditando(null); }}
          onSaved={() => { setAlta(false); setEditando(null); cargar(); contabilidadApi.opciones().then(setOpciones).catch(() => {}); }}
        />
      )}
    </div>
  );
}
