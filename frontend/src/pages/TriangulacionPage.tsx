import { useEffect, useMemo, useState } from "react";
import { crud, triangulacionApi, type TriangulacionPrograma, type MetricaTriangulo } from "../api";
import { fmtMiles } from "../format";
import PageHeader from "../components/PageHeader";

const apiProgramas = crud<{ id: number; nombre: string }, unknown>("/programas");
const imp = (v: number | null | undefined) => fmtMiles(v) || "—";

// Triángulo por PROGRAMA: compara todos los binders/YOA de la cadena. Las columnas son la
// ANTIGÜEDAD (meses desde el inicio de cada binder), así los años maduros y los jóvenes se ven
// a la misma edad y los factores de desarrollo (que proyectan el IBNR) salen de todo el programa.
export default function TriangulacionPage() {
  const [programas, setProgramas] = useState<{ id: number; nombre: string }[]>([]);
  const [progId, setProgId] = useState<number | null>(null);
  const [data, setData] = useState<TriangulacionPrograma | null>(null);
  const [metrica, setMetrica] = useState<MetricaTriangulo>("incurrido");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const ps = (await apiProgramas.list(undefined, 5000)) as { id: number; nombre: string }[];
        ps.sort((a, b) => a.nombre.localeCompare(b.nombre));
        setProgramas(ps);
        if (ps.length) setProgId(ps[0].id);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    if (progId == null) return;
    setLoading(true);
    triangulacionApi
      .dePrograma(progId)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [progId]);

  const esNum = metrica === "num";
  const ratioIbnr = data && data.premium_total ? (data.ibnr_total / data.premium_total) * 100 : null;
  const ratioSin = data && data.net_uw_total ? (data.incurrido_total / data.net_uw_total) * 100 : null;
  // Total por columna de antigüedad (suma de los binders con dato a esa edad).
  const totalCol = useMemo(() => {
    if (!data) return [];
    const m = data.triangulos[metrica];
    return Array.from({ length: data.max_edad + 1 }, (_, d) =>
      m.reduce((a, fila) => a + (fila[d] ?? 0), 0)
    );
  }, [data, metrica]);

  return (
    <div className="container lista-page">
      <PageHeader emoji="🔺" title="Triangulación por programa" />
      <div className="toolbar" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <select className="filtro" value={progId ?? ""} onChange={(e) => setProgId(Number(e.target.value))}>
          {programas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select className="filtro" value={metrica} onChange={(e) => setMetrica(e.target.value as MetricaTriangulo)}>
          <option value="incurrido">Incurrido (pagado + reservas)</option>
          <option value="pagado">Pagado</option>
          <option value="num">Nº de siniestros</option>
        </select>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !data ? (
        <div className="empty">Cargando…</div>
      ) : !data || data.binders.length === 0 ? (
        <div className="empty">Este programa no tiene binders con datos para triangular.</div>
      ) : (
        <div className="lista-scroll">
          {/* Resumen por año: GWP, siniestralidad actual, ultimate e IBNR (con factores del programa). */}
          <h3 style={{ margin: "4px 0 6px" }}>Resumen por año</h3>
          <table className="compacto bdx-tabla tri-tabla" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>YOA</th><th>Binder</th>
                <th className="num">GWP Our Line</th><th className="num">Net to UWs</th>
                <th className="num">Incurrido</th><th className="num">Ultimate</th>
                <th className="num">IBNR</th><th className="num">IBNR % s/GWP</th>
                <th className="num">Siniestralidad %</th>
              </tr>
            </thead>
            <tbody>
              {data.binders.map((b, i) => {
                const ibnrPct = data.premium_binder[i] ? (data.ibnr_binder[i] / data.premium_binder[i]) * 100 : null;
                const sinPct = data.net_uw_binder[i] ? (data.incurrido_binder[i] / data.net_uw_binder[i]) * 100 : null;
                return (
                  <tr key={b.id}>
                    <th>{b.yoa ?? "—"}</th>
                    <td>{b.umr}</td>
                    <td className="num">{imp(data.premium_binder[i])}</td>
                    <td className="num">{imp(data.net_uw_binder[i])}</td>
                    <td className="num">{imp(data.incurrido_binder[i])}</td>
                    <td className="num">{imp(data.ultimate_binder[i])}</td>
                    <td className="num tri-actual">{imp(data.ibnr_binder[i])}</td>
                    <td className="num">{ibnrPct == null ? "—" : `${fmtMiles(ibnrPct)} %`}</td>
                    <td className="num">{sinPct == null ? "—" : `${fmtMiles(sinPct)} %`}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="tri-total">
                <th>Total</th><td></td>
                <td className="num">{imp(data.premium_total)}</td>
                <td className="num">{imp(data.net_uw_total)}</td>
                <td className="num">{imp(data.incurrido_total)}</td>
                <td className="num">{imp(data.ultimate_total)}</td>
                <td className="num tri-actual">{imp(data.ibnr_total)}</td>
                <td className="num">{ratioIbnr == null ? "—" : `${fmtMiles(ratioIbnr)} %`}</td>
                <td className="num">{ratioSin == null ? "—" : `${fmtMiles(ratioSin)} %`}</td>
              </tr>
            </tfoot>
          </table>

          {/* Triángulo de desarrollo: filas = YOA, columnas = antigüedad (meses desde el inicio). */}
          <h3 style={{ margin: "4px 0 6px" }}>Desarrollo por antigüedad ({metrica === "num" ? "nº" : metrica})</h3>
          <div className="bdx-scroll">
            <table className="compacto bdx-tabla tri-tabla">
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0 }}>YOA</th>
                  {Array.from({ length: data.max_edad + 1 }, (_, d) => <th key={d} className="num">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.binders.map((b, i) => (
                  <tr key={b.id}>
                    <th style={{ position: "sticky", left: 0 }}>{b.yoa ?? b.umr}</th>
                    {Array.from({ length: data.max_edad + 1 }, (_, d) => {
                      const v = data.triangulos[metrica][i][d];
                      return <td key={d} className="num">{v == null ? "" : esNum ? v : fmtMiles(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="tri-total">
                  <th style={{ position: "sticky", left: 0 }}>Total</th>
                  {totalCol.map((t, d) => <td key={d} className="num">{esNum ? t : fmtMiles(t)}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
