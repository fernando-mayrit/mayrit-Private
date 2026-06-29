import { useEffect, useState } from "react";
import { bdxApi, type RiskExcelPreview, type RiskExcelImportResult } from "../api";
import { fmtMiles } from "../format";
import FormPanel from "./FormPanel";

// Subir un Risk BDX desde un Excel del navegador: elegir hoja → preview (no escribe, mapea contra el
// Risk existente: sección por risk code y aviso de meses ya cargados) → Importar (añade las líneas).
export default function RiskExcelImport({
  binderId,
  file,
  onClose,
  onImported,
}: {
  binderId: number;
  file: File;
  onClose: () => void;
  onImported: () => void;
}) {
  const [prev, setPrev] = useState<RiskExcelPreview | null>(null);
  const [res, setRes] = useState<RiskExcelImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar(hoja?: string) {
    setBusy(true); setError(null);
    try { setPrev(await bdxApi.riskExcelPreview(binderId, file, hoja)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importar() {
    if (!prev) return;
    setBusy(true); setError(null);
    try { setRes(await bdxApi.riskExcelImport(binderId, file, prev.hoja)); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const todoCargado = !!prev && prev.periodos.length > 0 && prev.periodos_ya_cargados.length === prev.periodos.length;

  return (
    <FormPanel
      title={`Subir Risk · ${file.name}`}
      dirty={false} saving={busy}
      saveLabel={res ? "Cerrar" : `Importar ${prev ? `(${prev.n_lineas})` : ""}`}
      error={error}
      onSave={res ? () => { onImported(); } : importar}
      onClose={onClose}
      wide
    >
      {!prev ? (
        <div className="loading">Leyendo Excel…</div>
      ) : res ? (
        <div>
          <div className="hint" style={{ marginBottom: 8 }}>✅ Importación completada.</div>
          <table className="compacto">
            <tbody>
              <tr><td>Líneas añadidas</td><td className="num"><b>{res.insertadas}</b></td></tr>
              {res.omitidas_periodo > 0 && (
                <tr><td>Omitidas (mes ya cargado: {res.periodos_omitidos.join(", ")})</td><td className="num">{res.omitidas_periodo}</td></tr>
              )}
              <tr><td>Sección asignada por risk code</td><td className="num">{res.auto_seccion}</td></tr>
              {res.sin_seccion > 0 && (
                <tr><td>⚠️ Sin sección (revisar risk code)</td><td className="num">{res.sin_seccion}</td></tr>
              )}
              <tr><td>Total líneas del Risk ahora</td><td className="num">{res.total_lineas}</td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 10 }}>
            <div className="field">
              <label>Hoja</label>
              <select value={prev.hoja} onChange={(e) => cargar(e.target.value)} disabled={busy}>
                {prev.hojas.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Periodos detectados</label>
              <input value={prev.periodos.join(", ") || "—"} readOnly />
            </div>
          </div>

          {todoCargado ? (
            <div className="hint" style={{ marginBottom: 10, color: "#b45309" }}>
              ⚠️ {prev.periodos_ya_cargados.length === 1 ? "Este mes ya está" : "Estos meses ya están"} cargado(s)
              en el Risk ({prev.periodos_ya_cargados.join(", ")}). Al importar no se añadirá nada (no se recarga).
            </div>
          ) : prev.periodos_ya_cargados.length > 0 ? (
            <div className="hint" style={{ marginBottom: 10, color: "#b45309" }}>
              ⚠️ Ya cargado(s): {prev.periodos_ya_cargados.join(", ")} — esos meses se omitirán; el resto se añade.
            </div>
          ) : (
            <div className="hint" style={{ marginBottom: 10 }}>
              Revisa que las cifras cuadran antes de importar. Si la <b>comisión</b> sale 0% o faltan periodos,
              el mapeo de columnas no es correcto para este fichero (avísame y añadimos el alias).
            </div>
          )}

          <table className="compacto" style={{ marginBottom: 12 }}>
            <tbody>
              <tr><td>Líneas a añadir</td><td className="num"><b>{prev.n_lineas}</b></td></tr>
              <tr><td>Σ GWP (our line)</td><td className="num">{fmtMiles(prev.total_gwp_our_line)} €</td></tr>
              <tr>
                <td>Reparto por sección</td>
                <td className="num">
                  {Object.keys(prev.por_seccion).length
                    ? Object.entries(prev.por_seccion).sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, n]) => `S${s}: ${n}`).join(" · ")
                    : "—"}
                  {prev.sin_seccion > 0 && <span style={{ color: "#b45309" }}> · ⚠️ sin sección: {prev.sin_seccion}</span>}
                </td>
              </tr>
              <tr><td>Columnas sin mapear</td><td className="num">{prev.sin_mapear.length}</td></tr>
            </tbody>
          </table>

          <div className="tabla-scroll" style={{ maxHeight: "38vh" }}>
            <table className="compacto">
              <thead>
                <tr><th>Certificado</th><th>Asegurado</th><th>Secc.</th><th>RC</th><th>Reporting</th><th className="num">GWP our</th><th className="num">Com. %</th></tr>
              </thead>
              <tbody>
                {prev.muestra.map((m, i) => (
                  <tr key={i}>
                    <td>{m.certificado ?? "—"}</td>
                    <td>{m.asegurado ?? "—"}</td>
                    <td>{m.section_no ?? "—"}</td>
                    <td>{m.risk_code ?? "—"}</td>
                    <td>{m.reporting ?? "—"}</td>
                    <td className="num">{m.gwp_our_line != null ? fmtMiles(m.gwp_our_line) : "—"}</td>
                    <td className="num">{m.comision_pct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prev.sin_mapear.length > 0 && (
            <div className="hint" style={{ marginTop: 8 }}>
              Sin mapear: {prev.sin_mapear.slice(0, 12).join(", ")}{prev.sin_mapear.length > 12 ? "…" : ""}
            </div>
          )}
        </>
      )}
    </FormPanel>
  );
}
