import { useEffect, useState } from "react";
import { crud, triangulacionApi, type TriangulacionPrograma } from "../api";
import { fmtMiles } from "../format";
import PageHeader from "../components/PageHeader";

const apiProgramas = crud<{ id: number; nombre: string }, unknown>("/programas");
const imp = (v: number | null | undefined) => fmtMiles(v) || "—";
const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Triángulo por PROGRAMA: compara todos los binders/YOA de la cadena.
//  · Resumen por año (GWP, incurrido, ultimate, IBNR).
//  · Comparación: filas = antigüedad (Año/Mes desde el inicio del programa), columnas = cada
//    binder con Nº siniestros · Siniestralidad (incurrido) · Ratio (siniestralidad / prima acum.).
//    Selector de Risk Code (TOTAL o una categoría).
export default function TriangulacionPage() {
  const [programas, setProgramas] = useState<{ id: number; nombre: string }[]>([]);
  const [progId, setProgId] = useState<number | null>(null);
  const [riskCode, setRiskCode] = useState<string>(""); // "" = TOTAL
  const [data, setData] = useState<TriangulacionPrograma | null>(null);
  const [comparativa, setComparativa] = useState(false); // false = Resumen, true = Comparativa
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
      .dePrograma(progId, riskCode || undefined)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [progId, riskCode]);

  // Al cambiar de programa, si el risk code elegido ya no existe, vuelve a TOTAL.
  useEffect(() => {
    if (data && riskCode && !data.risk_codes.includes(riskCode)) setRiskCode("");
  }, [data, riskCode]);

  const ratioIbnr = data && data.premium_total ? (data.ibnr_total / data.premium_total) * 100 : null;
  const ratioSin = data && data.net_uw_total ? (data.incurrido_total / data.net_uw_total) * 100 : null;
  const ratioUlt = data && data.net_uw_total ? (data.ultimate_total / data.net_uw_total) * 100 : null;

  // Etiqueta Año/Mes de una antigüedad d (meses desde el inicio del programa).
  const etiqueta = (mesInicio: number, d: number) => {
    const off = mesInicio - 1 + d;
    return { anio: 1 + Math.floor(off / 12), mes: MESES_ES[off % 12], inicioAnio: off % 12 === 0 || d === 0 };
  };

  return (
    <div className="container lista-page">
      <PageHeader emoji="🔺" title="Triangulación por programa" />
      <div className="toolbar" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <select className="filtro" value={progId ?? ""} onChange={(e) => setProgId(Number(e.target.value))}>
          {programas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {comparativa && (
          <select className="filtro" value={riskCode} onChange={(e) => setRiskCode(e.target.value)}>
            <option value="">TOTAL (todos los risk codes)</option>
            {(data?.risk_codes ?? []).map((rc) => <option key={rc} value={rc}>{rc}</option>)}
          </select>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={comparativa}
          className={"switch switch-sm" + (comparativa ? " on" : "")}
          onClick={() => setComparativa((v) => !v)}
          title="Alterna entre el Resumen por año y la Comparación por antigüedad"
          style={{ marginLeft: "auto" }}
        >
          <span className="switch-track"><span className="switch-knob" /></span>
          <span className="switch-label" style={{ fontSize: 12 }}>
            Vista: {comparativa ? "Comparativa" : "Resumen"}
          </span>
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !data ? (
        <div className="empty">Cargando…</div>
      ) : !data || data.binders.length === 0 ? (
        <div className="empty">Este programa no tiene binders con datos para triangular.</div>
      ) : (
        <div className="lista-scroll">
          {!comparativa && <>
          {/* Resumen por año: GWP, siniestralidad actual, ultimate e IBNR (con factores del programa). */}
          <h3 style={{ margin: "4px 0 6px" }}>Resumen por año</h3>
          <table className="compacto bdx-tabla tri-tabla" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>YOA</th><th>Binder</th>
                <th className="num">GWP Our Line</th><th className="num">Net to UWs</th>
                <th className="num">Incurrido</th>
                <th className="num">Siniestralidad %</th>
                <th className="num">IBNR</th>
                <th className="num tri-amarillo">IBNR % s/GWP</th>
                <th className="num">Ultimate</th>
                <th className="num">Siniestralidad % Ult.</th>
              </tr>
            </thead>
            <tbody>
              {data.binders.map((b, i) => {
                const ibnrPct = data.premium_binder[i] ? (data.ibnr_binder[i] / data.premium_binder[i]) * 100 : null;
                const sinPct = data.net_uw_binder[i] ? (data.incurrido_binder[i] / data.net_uw_binder[i]) * 100 : null;
                const ultPct = data.net_uw_binder[i] ? (data.ultimate_binder[i] / data.net_uw_binder[i]) * 100 : null;
                return (
                  <tr key={b.id}>
                    <th>{b.yoa ?? "—"}</th>
                    <td>{b.umr}</td>
                    <td className="num">{imp(data.premium_binder[i])}</td>
                    <td className="num">{imp(data.net_uw_binder[i])}</td>
                    <td className="num">{imp(data.incurrido_binder[i])}</td>
                    <td className="num">{sinPct == null ? "—" : `${fmtMiles(sinPct)} %`}</td>
                    <td className="num">{imp(data.ibnr_binder[i])}</td>
                    <td className="num tri-amarillo">{ibnrPct == null ? "—" : `${fmtMiles(ibnrPct)} %`}</td>
                    <td className="num">{imp(data.ultimate_binder[i])}</td>
                    <td className="num">{ultPct == null ? "—" : `${fmtMiles(ultPct)} %`}</td>
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
                <td className="num">{ratioSin == null ? "—" : `${fmtMiles(ratioSin)} %`}</td>
                <td className="num">{imp(data.ibnr_total)}</td>
                <td className="num tri-amarillo">{ratioIbnr == null ? "—" : `${fmtMiles(ratioIbnr)} %`}</td>
                <td className="num">{imp(data.ultimate_total)}</td>
                <td className="num">{ratioUlt == null ? "—" : `${fmtMiles(ratioUlt)} %`}</td>
              </tr>
            </tfoot>
          </table>
          </>}

          {comparativa && <>
          {/* Comparación: filas = antigüedad (Año/Mes), columnas = cada binder × {Nº · Siniestralidad · Ratio}. */}
          <h3 style={{ margin: "4px 0 6px" }}>
            Comparación de siniestralidad {riskCode ? `· Risk code ${riskCode}` : "· TOTAL"}
          </h3>
          <div className="bdx-scroll">
            <table className="compacto bdx-tabla tri-comp">
              <thead>
                <tr>
                  <th rowSpan={2} style={{ position: "sticky", left: 0 }}>Año</th>
                  <th rowSpan={2}>Mes</th>
                  {data.binders.map((b) => (
                    <th key={b.id} colSpan={3} className="num tri-comp-bloque" style={{ textAlign: "center" }}>
                      {b.yoa ?? ""} · {b.umr}
                    </th>
                  ))}
                </tr>
                <tr>
                  {data.binders.map((b) => [
                    <th key={`${b.id}-n`} className="num tri-comp-bloque">Nº</th>,
                    <th key={`${b.id}-s`} className="num">Siniestralidad</th>,
                    <th key={`${b.id}-r`} className="num">Ratio</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: data.max_edad + 1 }, (_, d) => {
                  const e = etiqueta(data.mes_inicio, d);
                  return (
                    <tr key={d}>
                      <th style={{ position: "sticky", left: 0 }}>{e.inicioAnio ? `Año ${e.anio}` : ""}</th>
                      <td>{e.mes}</td>
                      {data.binders.map((b, i) => {
                        const num = data.triangulos.num[i][d];
                        const inc = data.triangulos.incurrido[i][d];
                        const pa = data.prima_acum_binder[i][d];
                        const ratio = inc != null && pa ? (inc / pa) * 100 : null;
                        const vacio = num == null;
                        return [
                          <td key={`${b.id}-n`} className="num tri-comp-bloque">{vacio ? "" : num}</td>,
                          <td key={`${b.id}-s`} className="num">{vacio ? "" : fmtMiles(inc)}</td>,
                          <td key={`${b.id}-r`} className="num">{ratio == null ? "" : `${fmtMiles(ratio)} %`}</td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>}
        </div>
      )}
    </div>
  );
}
