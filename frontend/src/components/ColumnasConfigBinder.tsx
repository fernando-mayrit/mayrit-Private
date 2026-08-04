import { useCallback, useEffect, useMemo, useState } from "react";
import { tareasApi, type ColumnaBinderCfg } from "../api";

// Config POR BINDER de las columnas de la cuadrícula de Tareas: qué fases aplican a este binder y en qué
// meses. Por defecto Desde/Hasta traen el periodo del binder (efecto → vencimiento); se puede acotar
// (run-off) o marcar "No aplica". Sin tocar nada, la fase la decide la app por el dato dentro del periodo.
export default function ColumnasConfigBinder({ binderId }: { binderId: number }) {
  const [cfgs, setCfgs] = useState<ColumnaBinderCfg[]>([]);
  const [efecto, setEfecto] = useState<string | null>(null);
  const [venc, setVenc] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState<number | null>(null);

  const cargar = useCallback(() => {
    tareasApi.columnasConfig(binderId).then((r) => {
      setCfgs(r.columnas); setEfecto(r.efecto); setVenc(r.vencimiento);
    }).catch(() => setCfgs([]));
  }, [binderId]);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = useMemo(() => {
    const g: { grupo: string; cols: ColumnaBinderCfg[] }[] = [];
    for (const c of cfgs) {
      let x = g.find((y) => y.grupo === c.grupo);
      if (!x) { x = { grupo: c.grupo, cols: [] }; g.push(x); }
      x.cols.push(c);
    }
    return g;
  }, [cfgs]);

  const nAplican = cfgs.filter((c) => !c.aplica).length;
  const dDesde = (c: ColumnaBinderCfg) => c.desde ?? efecto ?? "";     // valor mostrado (default = efecto)
  const dHasta = (c: ColumnaBinderCfg) => c.hasta ?? venc ?? "";       // valor mostrado (default = vencimiento)

  async function guardar(col: ColumnaBinderCfg, cambio: { aplica?: boolean; desde?: string | null; hasta?: string | null }) {
    const aplica = cambio.aplica !== undefined ? cambio.aplica : col.aplica;
    let desde = "desde" in cambio ? (cambio.desde || null) : (col.desde ?? efecto);
    let hasta = "hasta" in cambio ? (cambio.hasta || null) : (col.hasta ?? venc);
    if (!aplica) { desde = null; hasta = null; }
    const nuevo = { ...col, aplica, desde, hasta, auto: false };
    setCfgs((cs) => cs.map((c) => c.columna_id === col.columna_id ? nuevo : c));
    setGuardando(col.columna_id);
    try {
      const r = await tareasApi.setColumnaConfig(binderId, col.columna_id, { aplica, desde, hasta });
      setCfgs((cs) => cs.map((c) => c.columna_id === col.columna_id ? r : c));
    } catch { cargar(); }
    finally { setGuardando(null); }
  }

  return (
    <div className="fases-cfg">
      <button className="fases-cab" onClick={() => setAbierto((a) => !a)}>
        <span>⚙️ Fases de la cuadrícula <span className="hint">— qué aplica a este binder{nAplican ? ` (${nAplican} marcadas «no aplica»)` : ""}</span></span>
        <span className="hint">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <div className="fases-cuerpo">
          <p className="hint" style={{ margin: "0 0 10px" }}>
            <b>Desde</b> y <b>Hasta</b> traen por defecto el periodo del binder ({efecto ?? "—"} → {venc ?? "—"}).
            Ajústalos por fase si hace falta (p. ej. Claims en run-off), o marca <b>No aplica</b> si el binder no hace esa fase.
          </p>
          {grupos.map((g) => (
            <div key={g.grupo} className="fases-grupo">
              <div className="fases-grupo-tit">{g.grupo}</div>
              {g.cols.map((c) => (
                <div key={c.columna_id} className="fases-fila">
                  <span className="fases-nom">{c.nombre}{c.tipo === "manual" ? " ✎" : ""}</span>
                  <label className="fases-chk">
                    <input type="checkbox" checked={!c.aplica}
                      onChange={(e) => guardar(c, { aplica: !e.target.checked })} />
                    No aplica
                  </label>
                  <label className={"fases-hasta" + (c.aplica ? "" : " off")}>
                    desde
                    <input type="month" value={dDesde(c)} disabled={!c.aplica}
                      onChange={(e) => guardar(c, { desde: e.target.value || null })} />
                  </label>
                  <label className={"fases-hasta" + (c.aplica ? "" : " off")}>
                    hasta
                    <input type="month" value={dHasta(c)} disabled={!c.aplica}
                      onChange={(e) => guardar(c, { hasta: e.target.value || null })} />
                  </label>
                  <span className="fases-estado hint">
                    {guardando === c.columna_id ? "guardando…"
                      : !c.aplica ? "No aplica"
                      : c.auto ? "Automático"
                      : `${dDesde(c) || "…"} → ${dHasta(c) || "…"}`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
