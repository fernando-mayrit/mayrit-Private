import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { tareasApi, type Cuadricula, type CuadriculaColumna, type CuadriculaFila, type PendMesResp, type PendMesFila } from "../api";
import PageHeader from "../components/PageHeader";
import TareasBinder from "../components/TareasBinder";

// Página global de Tareas. Vistas: CUADRÍCULA (pipeline por binder del mes elegido), PENDIENTES/MES
// (nº de subtareas pendientes por binder × mes × categoría) y DETALLE (todas las tareas, para gestionar).

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Último mes elegible: el ANTERIOR al actual. El BDX del mes en curso aún no vence (se trabaja el mes
// siguiente), así que no tiene sentido elegir meses hacia delante — saldría todo Pendiente.
function mesTope(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function labelMes(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m)] ?? m} ${y}`;
}

export default function TareasPage() {
  const [vista, setVista] = useState<"cuadricula" | "detalle" | "pendmes">("cuadricula");
  const [mes, setMes] = useState(mesTope());
  const [cuad, setCuad] = useState<Cuadricula | null>(null);
  const [cargandoCuad, setCargandoCuad] = useState(false);
  const [pendMes, setPendMes] = useState<PendMesResp | null>(null);
  const [cargandoPM, setCargandoPM] = useState(false);

  useEffect(() => {
    if (vista === "pendmes" && !pendMes) {
      setCargandoPM(true);
      tareasApi.pendientesMes().then(setPendMes).catch(() => setPendMes(null)).finally(() => setCargandoPM(false));
    }
  }, [vista, pendMes]);

  const cargarCuad = useCallback(() => {
    setCargandoCuad(true);
    tareasApi.cuadricula(mes).then(setCuad).catch(() => setCuad(null)).finally(() => setCargandoCuad(false));
  }, [mes]);
  useEffect(() => { if (vista === "cuadricula") cargarCuad(); }, [vista, cargarCuad]);

  return (
    <div className="container lista-page">
      <PageHeader emoji="✅" title="Tareas" />

      <div className="toolbar" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="btn-toggle-group">
          <button className={"btn-toggle" + (vista === "cuadricula" ? " active" : "")} onClick={() => setVista("cuadricula")}>Cuadrícula</button>
          <button className={"btn-toggle" + (vista === "pendmes" ? " active" : "")} onClick={() => setVista("pendmes")}>Pendientes/mes</button>
          <button className={"btn-toggle" + (vista === "detalle" ? " active" : "")} onClick={() => setVista("detalle")}>Detalle</button>
        </div>
        {vista === "cuadricula" && (
          <input type="month" className="filtro" value={mes} max={mesTope()}
            onChange={(e) => { const v = e.target.value || mesTope(); setMes(v > mesTope() ? mesTope() : v); }}
            title="Mes a revisar (hasta el mes anterior al actual)" />
        )}
      </div>

      {vista === "detalle" ? (
        <TareasBinder />
      ) : vista === "pendmes" ? (
        <PendientesMesVista data={pendMes} cargando={cargandoPM} />
      ) : (
        <CuadriculaVista cuad={cuad} cargando={cargandoCuad} mesLabel={labelMes(mes)} />
      )}
    </div>
  );
}

// Vista CUADRÍCULA: matriz binders (filas) × fases del pipeline (columnas), con pastillas de estado
// (verde=hecho · rojo=pendiente · gris=no aplica). SOLO INFORMATIVA: las fases se marcan en el detalle.
function CuadriculaVista({ cuad, cargando, mesLabel }: {
  cuad: Cuadricula | null;
  cargando: boolean;
  mesLabel: string;
}) {
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const toggleAg = (ag: string) => setColapsadas((s) => { const n = new Set(s); n.has(ag) ? n.delete(ag) : n.add(ag); return n; });

  if (cargando && !cuad) return <div className="loading">Cargando…</div>;
  if (!cuad || cuad.filas.length === 0) return <div className="empty">Sin binders con pipeline este mes.</div>;

  const grupos: { grupo: string; cols: CuadriculaColumna[] }[] = [];
  for (const c of cuad.columnas) {
    let g = grupos.find((x) => x.grupo === c.grupo);
    if (!g) { g = { grupo: c.grupo, cols: [] }; grupos.push(g); }
    g.cols.push(c);
  }
  const cls = (est: string) => "pastilla " + (est === "ok" ? "ok" : est === "pend" ? "pend" : "na");
  const lab = (est: string) => est === "ok" ? "Sí" : est === "pend" ? "Pendiente" : "No aplica";

  // Agrupar los binders por AGENCIA (cabecera desplegable).
  const porAg: { agencia: string; filas: CuadriculaFila[] }[] = [];
  for (const f of cuad.filas) {
    const ag = f.agencia || "(Sin agencia)";
    let g = porAg.find((x) => x.agencia === ag);
    if (!g) { g = { agencia: ag, filas: [] }; porAg.push(g); }
    g.filas.push(f);
  }
  porAg.sort((a, b) => a.agencia.localeCompare(b.agencia, "es"));
  const ncols = 1 + cuad.columnas.length;

  const filaBinder = (f: CuadriculaFila) => (
    <tr key={f.binder_id}>
      <th className="cuad-bind"><b>{f.umr}</b></th>
      {cuad.columnas.map((c) => {
        const est = f.celdas[c.id] ?? "na";
        return (
          <td key={c.id} className="cuad-celda">
            <span className={cls(est)}
              title={est === "na" ? undefined : c.tipo === "manual" ? "Se marca en el detalle de la tarea" : "Automático (del dato)"}>{lab(est)}</span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <div className="hint" style={{ marginBottom: 8 }}>
        {mesLabel} · pipeline por binder — <span className={cls("ok")}>Sí</span> hecho · <span className={cls("pend")}>Pendiente</span> · <span className={cls("na")}>No aplica</span>.
        Solo informativa: las fases se marcan en el <b>detalle</b> de cada tarea.
      </div>
      <div className="cuad-scroll">
        <table className="cuad-tabla">
          <thead>
            <tr>
              <th className="cuad-esq" rowSpan={2}>Binder</th>
              {grupos.map((g) => <th key={g.grupo} colSpan={g.cols.length} className="cuad-grupo">{g.grupo}</th>)}
            </tr>
            <tr>
              {cuad.columnas.map((c) => (
                <th key={c.id} className="cuad-col" title={c.tipo === "manual" ? "Fase manual (se marca en el detalle de la tarea)" : "Automático (del dato)"}>
                  {c.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porAg.map((g) => {
              const abierta = !colapsadas.has(g.agencia);
              const pend = g.filas.reduce((s, f) => s + f.n_pend, 0);
              return (
                <Fragment key={g.agencia}>
                  <tr className="cuad-agencia" onClick={() => toggleAg(g.agencia)}>
                    <th colSpan={ncols}>
                      <span className="cuad-ag-flecha">{abierta ? "▾" : "▸"}</span>
                      <b>{g.agencia}</b>
                      <span className="hint"> · {g.filas.length} binder{g.filas.length !== 1 ? "s" : ""}{pend ? ` · ${pend} pendiente${pend !== 1 ? "s" : ""}` : ""}</span>
                    </th>
                  </tr>
                  {abierta && g.filas.map(filaBinder)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Vista PENDIENTES/MES: binders (filas, por agencia) × mes del BDX × categoría, con el nº de subtareas
// pendientes en cada celda. Scroll horizontal con flechas cuando no caben los meses.
function PendientesMesVista({ data, cargando }: { data: PendMesResp | null; cargando: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  if (cargando && !data) return <div className="loading">Cargando…</div>;
  if (!data || data.filas.length === 0) return <div className="empty">Sin binders con tareas.</div>;
  const CATS = ["Risk", "Premium", "Claims"];
  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const mesCorto = (ym: string) => `${MES[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
  const porAg: { agencia: string; filas: PendMesFila[] }[] = [];
  for (const f of data.filas) {
    const ag = f.agencia || "(Sin agencia)";
    let g = porAg.find((x) => x.agencia === ag);
    if (!g) { g = { agencia: ag, filas: [] }; porAg.push(g); }
    g.filas.push(f);
  }
  // Pastilla secuencial (1 tinta naranja, claro→oscuro por nº de pendientes; validada). Más = más color.
  const PILL: [string, string][] = [
    ["#f59331", "#3a1a00"],  // 1
    ["#e2771d", "#3a1a00"],  // 2
    ["#c95e12", "#ffffff"],  // 3
    ["#ab490c", "#ffffff"],  // 4
    ["#8c3907", "#ffffff"],  // 5+
  ];
  const cell = (v: number | null | undefined) => {
    if (v == null) return <span style={{ color: "#c8c8c8" }}>·</span>;
    if (v === 0) return <span style={{ color: "#1a7f37", fontVariantNumeric: "tabular-nums" }}>0</span>;
    const [bg, fg] = PILL[Math.min(v, 5) - 1];
    return <span style={{ display: "inline-block", minWidth: 20, padding: "1px 6px", borderRadius: 10,
      background: bg, color: fg, fontWeight: 700, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{v}</span>;
  };
  const ncols = 1 + data.meses.length * 3;
  return (
    <>
      <div className="hint" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        Subtareas pendientes por <b>mes del BDX</b> y categoría (R=Risk · P=Premium · C=Claims).{" "}
        <span style={{ display: "inline-block", minWidth: 20, padding: "1px 6px", borderRadius: 10, background: "#f59331", color: "#3a1a00", fontWeight: 700, fontSize: 12 }}>n</span> pendientes (más oscuro = más) · <span style={{ color: "#1a7f37" }}>0</span> hecho · <span style={{ color: "#c8c8c8" }}>·</span> no aplica.
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <button className="btn-toggle" onClick={() => scroll(-1)} title="Desplazar a la izquierda">◀</button>
          <button className="btn-toggle" onClick={() => scroll(1)} title="Desplazar a la derecha">▶</button>
        </span>
      </div>
      <div className="cuad-scroll" ref={scrollRef}>
        <table className="cuad-tabla">
          <thead>
            <tr>
              <th className="cuad-esq" rowSpan={2}>Binder</th>
              {data.meses.map((mes) => <th key={mes} colSpan={3} className="cuad-grupo">{mesCorto(mes)}</th>)}
            </tr>
            <tr>
              {data.meses.map((mes) => CATS.map((cat) => (
                <th key={mes + cat} className="cuad-col" title={cat} style={{ minWidth: 26 }}>{cat[0]}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {porAg.map((g) => (
              <Fragment key={g.agencia}>
                <tr className="cuad-agencia"><th colSpan={ncols}><b>{g.agencia}</b> <span className="hint">· {g.filas.length} binder{g.filas.length !== 1 ? "s" : ""}</span></th></tr>
                {g.filas.map((f) => (
                  <tr key={f.binder_id}>
                    <th className="cuad-bind"><b>{f.umr}</b></th>
                    {data.meses.map((mes) => CATS.map((cat) => (
                      <td key={mes + cat} className="cuad-celda" style={{ textAlign: "center" }}>{cell(f.celdas[mes]?.[cat])}</td>
                    )))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
