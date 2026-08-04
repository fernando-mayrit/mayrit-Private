import { useCallback, useEffect, useMemo, useState } from "react";
import { tareasApi, type TareaAgendaItem, type Cuadricula, type CuadriculaColumna } from "../api";
import PageHeader from "../components/PageHeader";
import TareasBinder from "../components/TareasBinder";
import { fmtFechaES } from "../format";

// Página global de Tareas. Vista RESUMEN (nueva, por defecto): una fila por binder con su estado del
// mes de un vistazo (semáforo + pendientes/hechas), desplegable a lo que falta. Vista DETALLE: la de
// antes (todas las tareas de todos los binders, para gestionar). Los datos salen de /tareas/agenda.

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function mesActual(): string {
  const d = new Date();
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
  const [vista, setVista] = useState<"resumen" | "cuadricula" | "detalle">("cuadricula");
  const [agenda, setAgenda] = useState<TareaAgendaItem[]>([]);
  const [mes, setMes] = useState(mesActual());
  const [soloPend, setSoloPend] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cuad, setCuad] = useState<Cuadricula | null>(null);
  const [cargandoCuad, setCargandoCuad] = useState(false);

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

  // Marcar/desmarcar una pastilla MANUAL (optimista).
  const marcar = async (binder_id: number, columna_id: number, hecho: boolean) => {
    setCuad((c) => c && ({ ...c, filas: c.filas.map((f) => f.binder_id === binder_id
      ? { ...f, celdas: { ...f.celdas, [columna_id]: hecho ? "ok" : "pend" } } : f) }));
    try { await tareasApi.marcarManual({ binder_id, periodo: cuad?.periodo ?? mes, columna_id, hecho }); }
    catch { cargarCuad(); }
  };

  const grupos = useMemo(() => {
    // Se muestra lo del mes elegido + TODAS las vencidas (aunque sean de meses anteriores, para que
    // nada atrasado se esconda al cambiar de mes).
    const shown = agenda.filter((a) => a.fecha.slice(0, 7) === mes || a.estado === "vencida");
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
          <button className={"btn-toggle" + (vista === "detalle" ? " active" : "")} onClick={() => setVista("detalle")}>Detalle</button>
        </div>
        {vista !== "detalle" && (
          <input type="month" className="filtro" value={mes} onChange={(e) => setMes(e.target.value || mesActual())} title="Mes a revisar" />
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
        <CuadriculaVista cuad={cuad} cargando={cargandoCuad} mesLabel={labelMes(mes)} onMarcar={marcar} />
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
                            <span className="tr-item-est">{a.estado === "vencida" ? "🔴" : "🟠"}</span>
                            <span className="tr-item-tit">{a.titulo} <span className="hint">· {a.categoria}</span></span>
                            {a.n_pasos > 0 && <span className="hint">checklist {a.n_pasos_hechos}/{a.n_pasos}</span>}
                            <span className={"hint" + (a.estado === "vencida" ? " tr-venc" : "")}>
                              {a.estado === "vencida" ? "venció" : "vence"} {fmtFechaES(a.fecha)}
                            </span>
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
// (verde=hecho · rojo=pendiente · gris=no aplica). Las columnas "manuales" (Enviado) se marcan con clic.
function CuadriculaVista({ cuad, cargando, mesLabel, onMarcar }: {
  cuad: Cuadricula | null;
  cargando: boolean;
  mesLabel: string;
  onMarcar: (binder_id: number, columna_id: number, hecho: boolean) => void;
}) {
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

  return (
    <>
      <div className="hint" style={{ marginBottom: 8 }}>
        {mesLabel} · pipeline por binder — <span className={cls("ok")}>Sí</span> hecho · <span className={cls("pend")}>Pendiente</span> · <span className={cls("na")}>No aplica</span>.
        Las de <b>Enviado</b> (✎) se marcan con un clic.
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
                <th key={c.id} className="cuad-col" title={c.tipo === "manual" ? "Manual (clic para marcar)" : "Automático (del dato)"}>
                  {c.nombre}{c.tipo === "manual" ? " ✎" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cuad.filas.map((f) => (
              <tr key={f.binder_id}>
                <th className="cuad-bind"><b>{f.umr}</b></th>
                {cuad.columnas.map((c) => {
                  const est = f.celdas[c.id] ?? "na";
                  const editable = c.tipo === "manual" && est !== "na";
                  return (
                    <td key={c.id} className="cuad-celda">
                      {editable ? (
                        <button className={cls(est) + " clic"}
                          title={est === "ok" ? "Hecho (clic para desmarcar)" : "Pendiente (clic para marcar hecho)"}
                          onClick={() => onMarcar(f.binder_id, c.id, est !== "ok")}>{lab(est)}</button>
                      ) : (
                        <span className={cls(est)}>{lab(est)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
