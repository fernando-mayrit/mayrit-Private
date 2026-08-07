import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tareasApi, type TareaAgendaItem, type Cuadricula, type CuadriculaColumna, type CuadriculaFila, type PendMesResp, type PendMesFila } from "../api";
import PageHeader from "../components/PageHeader";
import TareasBinder from "../components/TareasBinder";
import { fmtFechaES } from "../format";

// Página global de Tareas. Vista RESUMEN (nueva, por defecto): una fila por binder con su estado del
// mes de un vistazo (semáforo + pendientes/hechas), desplegable a lo que falta. Vista DETALLE: la de
// antes (todas las tareas de todos los binders, para gestionar). Los datos salen de /tareas/agenda.

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

type Grupo = {
  binder_id: number;
  umr: string;
  agencia: string;
  programa: string;
  hechas: number;
  pendientes: number;   // debida y no hecha, aún no vencida
  vencidas: number;     // pasada de fecha y no hecha
  faltan: TareaAgendaItem[];   // vencidas + pendientes, para el desplegable
};

export default function TareasPage() {
  const [vista, setVista] = useState<"resumen" | "cuadricula" | "detalle" | "pendmes">("cuadricula");
  const [agenda, setAgenda] = useState<TareaAgendaItem[]>([]);
  const [mes, setMes] = useState(mesTope());
  const [soloPend, setSoloPend] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    tareasApi.agenda()
      .then(setAgenda)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las tareas."))
      .finally(() => setCargando(false));
  }, []);

  const cargarCuad = useCallback(() => {
    setCargandoCuad(true);
    tareasApi.cuadricula(mes).then(setCuad).catch(() => setCuad(null)).finally(() => setCargandoCuad(false));
  }, [mes]);
  useEffect(() => { if (vista === "cuadricula") cargarCuad(); }, [vista, cargarCuad]);

  const grupos = useMemo(() => {
    // Se muestra lo del mes elegido + TODAS las vencidas (aunque sean de meses anteriores, para que
    // nada atrasado se esconda al cambiar de mes).
    const shown = agenda.filter((a) => a.fecha.slice(0, 7) === mes || a.estado === "pendiente");
    const por = new Map<number, Grupo>();
    for (const a of shown) {
      let g = por.get(a.binder_id);
      if (!g) {
        g = { binder_id: a.binder_id, umr: a.binder_umr ?? `#${a.binder_id}`, agencia: a.agencia ?? "",
          programa: a.programa ?? "", hechas: 0, pendientes: 0, vencidas: 0, faltan: [] };
        por.set(a.binder_id, g);
      }
      if (a.estado === "hecha") g.hechas++;
      else if (a.estado === "vencida") { g.vencidas++; g.faltan.push(a); }
      else if (a.estado === "pendiente") { g.pendientes++; g.faltan.push(a); }
    }
    let arr = [...por.values()];
    if (soloPend) arr = arr.filter((g) => g.vencidas + g.pendientes > 0);
    arr.forEach((g) => g.faltan.sort((x, y) => x.fecha.localeCompare(y.fecha)));
    // Orden por urgencia: primero los que tienen vencidas, luego más pendientes, luego por UMR.
    arr.sort((a, b) => (b.vencidas - a.vencidas) || (b.pendientes - a.pendientes) || a.umr.localeCompare(b.umr));
    return arr;
  }, [agenda, mes, soloPend]);

  const tot = useMemo(() => grupos.reduce((t, g) => ({
    venc: t.venc + g.vencidas, pend: t.pend + g.pendientes, binders: t.binders + 1,
  }), { venc: 0, pend: 0, binders: 0 }), [grupos]);

  const toggle = (id: number) => setAbiertos((p) => {
    const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const semaforo = (g: Grupo) => g.vencidas > 0 ? "🔴" : g.pendientes > 0 ? "🟠" : "🟢";

  return (
    <div className="container lista-page">
      <PageHeader emoji="✅" title="Tareas" />

      <div className="toolbar" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="btn-toggle-group">
          <button className={"btn-toggle" + (vista === "cuadricula" ? " active" : "")} onClick={() => setVista("cuadricula")}>Cuadrícula</button>
          <button className={"btn-toggle" + (vista === "resumen" ? " active" : "")} onClick={() => setVista("resumen")}>Resumen</button>
          <button className={"btn-toggle" + (vista === "pendmes" ? " active" : "")} onClick={() => setVista("pendmes")}>Pendientes/mes</button>
          <button className={"btn-toggle" + (vista === "detalle" ? " active" : "")} onClick={() => setVista("detalle")}>Detalle</button>
        </div>
        {(vista === "cuadricula" || vista === "resumen") && (
          <input type="month" className="filtro" value={mes} max={mesTope()}
            onChange={(e) => { const v = e.target.value || mesTope(); setMes(v > mesTope() ? mesTope() : v); }}
            title="Mes a revisar (hasta el mes anterior al actual)" />
        )}
        {vista === "resumen" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={soloPend} onChange={(e) => setSoloPend(e.target.checked)} /> Solo con pendientes
          </label>
        )}
      </div>

      {vista === "detalle" ? (
        <TareasBinder />
      ) : vista === "cuadricula" ? (
        <CuadriculaVista cuad={cuad} cargando={cargandoCuad} mesLabel={labelMes(mes)} />
      ) : vista === "pendmes" ? (
        <PendientesMesVista data={pendMes} cargando={cargandoPM} />
      ) : cargando ? (
        <div className="loading">Cargando…</div>
      ) : error ? (
        <div className="error">⚠ {error}</div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 8 }}>
            {labelMes(mes)} · {tot.binders} binder(s)
            {tot.venc > 0 && <> · <b style={{ color: "var(--rojo)" }}>{tot.venc} vencida(s)</b></>}
            {tot.pend > 0 && <> · {tot.pend} pendiente(s)</>}
            {tot.venc + tot.pend === 0 && <> · <b style={{ color: "#1a7f37" }}>todo al día 🎉</b></>}
          </div>
          {grupos.length === 0 ? (
            <div className="empty">{soloPend ? "No hay binders con tareas pendientes. 🎉" : "Sin tareas este mes."}</div>
          ) : (
            <div className="tareas-resumen">
              {grupos.map((g) => {
                const abierto = abiertos.has(g.binder_id);
                const faltan = g.vencidas + g.pendientes;
                return (
                  <div key={g.binder_id} className={"tr-fila" + (abierto ? " abierta" : "")}>
                    <button className="tr-cab" onClick={() => toggle(g.binder_id)}>
                      <span className="tr-sem">{semaforo(g)}</span>
                      <span className="tr-umr"><b>{g.umr}</b>{g.agencia && <span className="hint"> · {g.agencia}</span>}{g.programa && <span className="hint"> · {g.programa}</span>}</span>
                      <span className="tr-cuenta">
                        {faltan > 0
                          ? <><b style={{ color: g.vencidas > 0 ? "var(--rojo)" : "inherit" }}>{faltan} pendiente{faltan !== 1 ? "s" : ""}</b> · {g.hechas} hecha{g.hechas !== 1 ? "s" : ""}</>
                          : <span style={{ color: "#1a7f37" }}>✓ al día ({g.hechas} hecha{g.hechas !== 1 ? "s" : ""})</span>}
                      </span>
                      <span className="tr-flecha">{abierto ? "▾" : "▸"}</span>
                    </button>
                    {abierto && (
                      <div className="tr-detalle">
                        {g.faltan.length === 0 ? (
                          <div className="hint" style={{ padding: "6px 12px" }}>Nada pendiente este mes.</div>
                        ) : g.faltan.map((a, i) => (
                          <div key={`${a.tarea_id}-${a.fecha}-${i}`} className="tr-item">
                            <span className="tr-item-est">🟠</span>
                            <span className="tr-item-tit">{a.titulo} <span className="hint">· {a.categoria}</span></span>
                            {a.n_pasos > 0 && <span className="hint">checklist {a.n_pasos_hechos}/{a.n_pasos}</span>}
                            <span className="hint">{a.periodo ? labelMes(a.periodo) : fmtFechaES(a.fecha)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
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
