import { useCallback, useEffect, useMemo, useState } from "react";
import { tareasApi, type BinderCuadricula, type CuadriculaColumna } from "../api";
import { mesAnyo } from "../format";

// La fila del pipeline de ESTE binder, MES A MES: las mismas fases y la misma lógica de estado que la
// cuadrícula global (pantalla Tareas), para que coincidan exactamente. Las de "Enviado" (manual) se
// marcan con un clic. Meses del efecto al vencimiento, el más reciente arriba.
export default function CuadriculaBinder({ binderId }: { binderId: number }) {
  const [data, setData] = useState<BinderCuadricula | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    tareasApi.binderCuadricula(binderId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setCargando(false));
  }, [binderId]);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = useMemo(() => {
    const g: { grupo: string; cols: CuadriculaColumna[] }[] = [];
    for (const c of data?.columnas ?? []) {
      let x = g.find((y) => y.grupo === c.grupo);
      if (!x) { x = { grupo: c.grupo, cols: [] }; g.push(x); }
      x.cols.push(c);
    }
    return g;
  }, [data]);

  const cls = (est: string) => "pastilla " + (est === "ok" ? "ok" : est === "pend" ? "pend" : "na");
  const lab = (est: string) => (est === "ok" ? "Sí" : est === "pend" ? "Pendiente" : "No aplica");

  async function marcar(periodo: string, columnaId: number, hecho: boolean) {
    setData((d) => d && {
      ...d,
      meses: d.meses.map((m) =>
        m.periodo === periodo ? { ...m, celdas: { ...m.celdas, [columnaId]: hecho ? "ok" : "pend" } } : m),
    });
    try { await tareasApi.marcarManual({ binder_id: binderId, periodo, columna_id: columnaId, hecho }); }
    catch { cargar(); }
  }

  if (cargando && !data) return <div className="loading">Cargando…</div>;
  if (!data || data.meses.length === 0) return null;   // binder sin pipeline → no se muestra nada

  return (
    <div className="binder-cuad">
      <div className="hint" style={{ marginBottom: 8 }}>
        Pipeline de este binder, mes a mes (igual que la cuadrícula de Tareas): <span className={cls("ok")}>Sí</span> hecho ·{" "}
        <span className={cls("pend")}>Pendiente</span> · <span className={cls("na")}>No aplica</span>. Las de <b>Enviado</b> (✎) se marcan con un clic.
      </div>
      <div className="cuad-scroll">
        <table className="cuad-tabla">
          <thead>
            <tr>
              <th className="cuad-esq" rowSpan={2}>Mes</th>
              {grupos.map((g) => <th key={g.grupo} colSpan={g.cols.length} className="cuad-grupo">{g.grupo}</th>)}
            </tr>
            <tr>
              {data.columnas.map((c) => (
                <th key={c.id} className="cuad-col" title={c.tipo === "manual" ? "Manual (clic para marcar)" : "Automático (del dato)"}>
                  {c.nombre}{c.tipo === "manual" ? " ✎" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.meses.map((m) => (
              <tr key={m.periodo}>
                <th className="cuad-bind"><b>{mesAnyo(m.periodo)}</b></th>
                {data.columnas.map((c) => {
                  const est = m.celdas[c.id] ?? "na";
                  const enlazada = (data.enlazadas ?? []).includes(c.id);
                  const editable = c.tipo === "manual" && est !== "na" && !enlazada;
                  return (
                    <td key={c.id} className="cuad-celda">
                      {editable ? (
                        <button className={cls(est) + " clic"}
                          title={est === "ok" ? "Hecho (clic para desmarcar)" : "Pendiente (clic para marcar hecho)"}
                          onClick={() => marcar(m.periodo, c.id, est !== "ok")}>{lab(est)}</button>
                      ) : (
                        <span className={cls(est)}
                          title={enlazada ? "Enlazada a un paso del checklist: se marca ahí" : undefined}>{lab(est)}{enlazada ? " 🔗" : ""}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
