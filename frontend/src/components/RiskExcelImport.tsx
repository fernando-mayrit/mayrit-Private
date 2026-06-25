import { useEffect, useState } from "react";
import { bdxApi, type RiskExcelPreview, type RiskExcelImportResult } from "../api";
import { fmtMiles } from "../format";
import FormPanel from "./FormPanel";

// Subir un Risk BDX desde un Excel del navegador: preview (no escribe) → Importar.
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

  useEffect(() => {
    (async () => {
      setBusy(true); setError(null);
      try { setPrev(await bdxApi.riskExcelPreview(binderId, file)); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importar() {
    setBusy(true); setError(null);
    try { setRes(await bdxApi.riskExcelImport(binderId, file)); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

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
              <tr><td>Líneas insertadas</td><td className="num"><b>{res.insertadas}</b></td></tr>
              <tr><td>Duplicadas (ya estaban, omitidas)</td><td className="num">{res.duplicadas}</td></tr>
              <tr><td>Sección asignada por risk code</td><td className="num">{res.auto_seccion}</td></tr>
              <tr><td>Total líneas del BDX ahora</td><td className="num">{res.total_lineas}</td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 10 }}>
            Revisa que las cifras cuadran antes de importar. Si la <b>comisión</b> sale 0% o faltan periodos,
            el mapeo de columnas no es correcto para este fichero (avísame y añadimos el alias).
          </div>
          <table className="compacto" style={{ marginBottom: 12 }}>
            <tbody>
              <tr><td>Líneas a importar</td><td className="num"><b>{prev.n_lineas}</b></td></tr>
              <tr><td>Periodos</td><td>{prev.periodos.join(", ") || "—"}</td></tr>
              <tr><td>Σ GWP (our line)</td><td className="num">{fmtMiles(prev.total_gwp_our_line)} €</td></tr>
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
