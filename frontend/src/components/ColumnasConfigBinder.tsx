import { useCallback, useEffect, useMemo, useState } from "react";
import { tareasApi, type ColumnaBinderCfg } from "../api";

// Config POR BINDER de las columnas de la cuadrícula de Tareas: qué fases aplican a este binder y en qué
// meses. Desde SIEMPRE lleva fecha (por defecto el efecto). Hasta puede quedar EN BLANCO = vivo (sigue
// apareciendo indefinidamente); solo al ponerle fecha el binder deja de aparecer a partir de ese mes.
// Sin tocar nada, la fase la decide la app por el dato dentro del periodo efecto → vencimiento.
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
  // Desde: SIEMPRE una fecha (default = efecto). Hasta: en blanco = vivo (indefinido); solo con override se ve literal.
  const dDesde = (c: ColumnaBinderCfg) => (c.auto ? efecto : (c.desde ?? efecto)) ?? "";
  const dHasta = (c: ColumnaBinderCfg) => (c.auto ? venc : c.hasta) ?? "";

  async function guardar(col: ColumnaBinderCfg, cambio: { aplica?: boolean; desde?: string | null; hasta?: string | null }) {
    const aplica = cambio.aplica !== undefined ? cambio.aplica : col.aplica;
    // Desde SIEMPRE con fecha (si lo borran, vuelve al efecto). Hasta puede ser null = vivo (indefinido).
    let desde: string | null = "desde" in cambio ? (cambio.desde || efecto || null) : (col.desde ?? efecto ?? null);
    let hasta: string | null = "hasta" in cambio ? (cambio.hasta || null)
      : col.auto ? (venc ?? null)          // era automático: conserva el corte por vencimiento
      : (col.hasta ?? null);               // ya tenía override: mantiene su Hasta (null = vivo)
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
            Por defecto, periodo del binder ({efecto ?? "—"} → {venc ?? "—"}). El <b>Desde</b> siempre lleva fecha;
            el <b>Hasta</b> puedes dejarlo <b>en blanco = vivo</b> (sigue apareciendo). Ponle fecha cuando quieras que
            deje de aparecer a partir de ese mes, o marca <b>No aplica</b> si el binder no hace esa fase.
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
                      onChange={(e) => guardar(c, { desde: e.target.value })} />
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
                      : `${dDesde(c)} → ${dHasta(c) || "vivo (sin fin)"}`}
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
