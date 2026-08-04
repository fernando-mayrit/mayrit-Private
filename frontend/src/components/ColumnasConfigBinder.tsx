import { useEffect, useMemo, useState } from "react";
import { tareasApi, type ColumnaBinderCfg } from "../api";

// Config POR BINDER de las columnas de la cuadrícula de Tareas: qué fases aplican a este binder y hasta
// qué mes. Si no se toca nada, la fase queda en "Automático" (la app la decide por el dato). Marcar
// "No aplica" la deja siempre en gris; poner un mes en "hasta" la apaga a partir del mes siguiente.
export default function ColumnasConfigBinder({ binderId }: { binderId: number }) {
  const [cfgs, setCfgs] = useState<ColumnaBinderCfg[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState<number | null>(null);

  useEffect(() => { tareasApi.columnasConfig(binderId).then(setCfgs).catch(() => setCfgs([])); }, [binderId]);

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

  async function guardar(col: ColumnaBinderCfg, cambio: Partial<ColumnaBinderCfg>) {
    const nuevo = { ...col, ...cambio, auto: false };
    setCfgs((cs) => cs.map((c) => c.columna_id === col.columna_id ? nuevo : c));
    setGuardando(col.columna_id);
    try {
      const r = await tareasApi.setColumnaConfig(binderId, col.columna_id, {
        aplica: nuevo.aplica, desde: nuevo.desde, hasta: nuevo.hasta,
      });
      setCfgs((cs) => cs.map((c) => c.columna_id === col.columna_id ? r : c));
    } catch {
      tareasApi.columnasConfig(binderId).then(setCfgs).catch(() => {});
    } finally { setGuardando(null); }
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
            Por defecto cada fase es <b>Automática</b> (la app la decide por el dato, y el binder solo aparece desde su
            fecha de efecto). Marca <b>No aplica</b> si este binder no hace esa fase, o acota con <b>desde</b>/<b>hasta</b>
            los meses en que aplica (run-off).
          </p>
          {grupos.map((g) => (
            <div key={g.grupo} className="fases-grupo">
              <div className="fases-grupo-tit">{g.grupo}</div>
              {g.cols.map((c) => (
                <div key={c.columna_id} className="fases-fila">
                  <span className="fases-nom">{c.nombre}{c.tipo === "manual" ? " ✎" : ""}</span>
                  <label className="fases-chk">
                    <input type="checkbox" checked={!c.aplica}
                      onChange={(e) => guardar(c, { aplica: !e.target.checked, ...(e.target.checked ? { hasta: null, desde: null } : {}) })} />
                    No aplica
                  </label>
                  <label className={"fases-hasta" + (c.aplica ? "" : " off")}>
                    desde
                    <input type="month" value={c.desde ?? ""} disabled={!c.aplica}
                      onChange={(e) => guardar(c, { desde: e.target.value || null })} />
                  </label>
                  <label className={"fases-hasta" + (c.aplica ? "" : " off")}>
                    hasta
                    <input type="month" value={c.hasta ?? ""} disabled={!c.aplica}
                      onChange={(e) => guardar(c, { hasta: e.target.value || null })} />
                  </label>
                  <span className="fases-estado hint">
                    {guardando === c.columna_id ? "guardando…"
                      : !c.aplica ? "No aplica"
                      : (c.desde || c.hasta) ? `Aplica${c.desde ? ` desde ${c.desde}` : ""}${c.hasta ? ` hasta ${c.hasta}` : ""}`
                      : "Automático"}
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
