import { useCallback, useEffect, useMemo, useState } from "react";
import { tareasApi, type BinderCuadricula, type CuadriculaColumna } from "../api";
import { mesAnyo } from "../format";

// La fila del pipeline de ESTE binder, MES A MES: las mismas fases y la misma lógica de estado que la
// cuadrícula global (pantalla Tareas), para que coincidan exactamente. Las de "Enviado" (manual) se
// marcan con un clic. Meses del efecto al vencimiento, el más reciente arriba.
export default function CuadriculaBinder({ binderId, refreshKey }: { binderId: number; refreshKey?: number }) {
  const [data, setData] = useState<BinderCuadricula | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    tareasApi.binderCuadricula(binderId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setCargando(false));
  }, [binderId]);
  useEffect(() => { cargar(); }, [cargar, refreshKey]);

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

  if (cargando && !data) return <div className="loading">Cargando…</div>;
  if (!data || data.meses.length === 0) return null;   // binder sin pipeline → no se muestra nada

  return (
    <div className="binder-cuad">
      <div className="hint" style={{ marginBottom: 8 }}>
        Pipeline de este binder, mes a mes. Cada fila es el <b>mes del dato</b> (el BDX de un mes se recibe/procesa el
        mes siguiente), así que el último es el mes anterior al actual. <span className={cls("ok")}>Sí</span> hecho ·{" "}
        <span className={cls("pend")}>Pendiente</span> · <span className={cls("na")}>No aplica</span>. Solo informativa: las fases se marcan en el <b>detalle</b> de cada tarea.
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
                <th key={c.id} className="cuad-col" title={c.tipo === "manual" ? "Fase manual (se marca en el detalle de la tarea)" : "Automático (del dato)"}>
                  {c.nombre}
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
                  return (
                    <td key={c.id} className="cuad-celda">
                      <span className={cls(est)}
                        title={est === "na" ? undefined : c.tipo === "manual" ? "Se marca en el detalle de la tarea" : "Automático (del dato)"}>{lab(est)}</span>
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
