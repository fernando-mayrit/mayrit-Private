import { useEffect, useState } from "react";
import { bdxApi, type RiskExcelPreview, type RiskExcelImportResult, type BdxCampo, type BdxAlias } from "../api";
import { fmtMiles, mesAnyo } from "../format";
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
  const [campos, setCampos] = useState<BdxCampo[]>([]);   // campos a los que asignar una columna
  const [asignando, setAsignando] = useState<string | null>(null);   // columna en curso
  const [aliases, setAliases] = useState<BdxAlias[]>([]);   // mapeo guardado del programa
  const etiquetaCampo = (campo: string) => campos.find((c) => c.campo === campo)?.label ?? campo;

  async function cargar(hoja?: string) {
    setBusy(true); setError(null);
    try { setPrev(await bdxApi.riskExcelPreview(binderId, file, hoja)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const cargarAliases = () => bdxApi.bdxAliasList(binderId, "risk").then(setAliases).catch(() => {});

  useEffect(() => {
    cargar();
    bdxApi.bdxCampos("risk").then(setCampos).catch(() => {});
    cargarAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asigna una columna sin mapear a un campo (guardado por programa) y recarga el preview → ya cae en su campo.
  async function asignar(columna: string, campo: string) {
    if (!campo) return;
    setAsignando(columna); setError(null);
    try {
      await bdxApi.bdxAliasCrear(binderId, { tipo: "risk", campo, alias_columna: columna });
      await cargar(prev?.hoja);
      await cargarAliases();
    } catch (e) { setError((e as Error).message); }
    finally { setAsignando(null); }
  }
  // Quita un alias guardado: la columna vuelve a «Extra» si el mapeo base no la reconoce.
  async function quitar(alias: BdxAlias) {
    setAsignando(alias.alias_columna); setError(null);
    try {
      await bdxApi.bdxAliasBorrar(alias.id);
      await cargar(prev?.hoja);
      await cargarAliases();
    } catch (e) { setError((e as Error).message); }
    finally { setAsignando(null); }
  }

  async function importar() {
    if (!prev) return;
    setBusy(true); setError(null);
    try { setRes(await bdxApi.riskExcelImport(binderId, file, prev.hoja)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <FormPanel
      title={`Subir Risk · ${file.name}`}
      dirty={false} saving={busy}
      saveLabel={res ? "Cerrar" : `Importar ${prev ? `(${prev.n_lineas})` : ""}`}
      saveDisabled={!res && !!prev?.bloqueado}
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
                <tr><td>Omitidas (mes ya cargado: {res.periodos_omitidos.map(mesAnyo).join(", ")})</td><td className="num">{res.omitidas_periodo}</td></tr>
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
          <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 10 }}>
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
              <input type="text" value={prev.periodos.map(mesAnyo).join(", ") || "—"} readOnly />
            </div>
          </div>

          {/* Panel de PROBLEMAS: crítico (rojo, bloquea) + avisos (ámbar). El BDX es el núcleo del
              negocio: si algo no cuadra, NO se importa a medias y se dice claramente por qué. */}
          {prev.bloqueado && (
            <div className="import-bloqueo">
              <b>🚫 No se puede importar este BDX.</b> Hay datos críticos que no se reconocen o no cuadran,
              así que <b>no se importará nada</b> hasta resolverlo:
              <ul>
                {prev.problemas.filter((p) => p.nivel === "bloqueante").map((p, i) => <li key={i}>{p.texto}</li>)}
              </ul>
              <span className="hint">Suele ser un desajuste de nombres de columna en este fichero. Avísame y añado el alias que falte.</span>
            </div>
          )}
          {prev.problemas.some((p) => p.nivel === "aviso") && (
            <div className="import-aviso">
              <b>⚠️ Avisos</b> (no impiden importar, pero revísalos):
              <ul>
                {prev.problemas.filter((p) => p.nivel === "aviso").map((p, i) => <li key={i}>{p.texto}</li>)}
              </ul>
            </div>
          )}
          {!prev.bloqueado && prev.problemas.length === 0 && (
            <div className="hint" style={{ marginBottom: 10 }}>
              ✅ Columnas clave reconocidas. Revisa igualmente que las cifras cuadran antes de importar.
            </div>
          )}

          <table className="compacto" style={{ marginBottom: 12 }}>
            <tbody>
              <tr><td>Líneas a añadir</td><td className="num"><b>{prev.n_lineas}</b></td></tr>
              <tr><td>Σ GWP (our line)</td><td className="num">{fmtMiles(prev.total_gwp_our_line)} €</td></tr>
              <tr><td>Σ Prima a Traspasar (comisión)</td><td className="num">{fmtMiles(prev.total_prima_traspasar)} €</td></tr>
              <tr><td>Σ a Liquidar (neto al UW)</td><td className="num">{fmtMiles(prev.total_liquidar)} €</td></tr>
              <tr>
                <td>Reparto por sección</td>
                <td className="num">
                  {Object.keys(prev.por_seccion).length
                    ? Object.entries(prev.por_seccion).sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, n]) => `S${s}: ${n}`).join(" · ")
                    : "—"}
                  {prev.sin_seccion > 0 && <span style={{ color: "#b45309" }}> · ⚠️ sin sección: {prev.sin_seccion}</span>}
                </td>
              </tr>
              <tr><td>Columnas no reconocidas (se guardan en «Extra»)</td><td className="num">{prev.sin_mapear.length}</td></tr>
            </tbody>
          </table>

          <div className="tabla-scroll" style={{ maxHeight: "38vh", overflowY: "auto" }}>
            <table className="compacto tabla-risk-preview">
              <thead>
                <tr>
                  <th>Certificado</th><th>Asegurado</th><th>Secc.</th><th>RC</th><th>Reporting</th>
                  <th className="num">GWP our</th><th className="num">Com. %</th>
                  <th className="num">Prima a Traspasar</th><th className="num">a Liquidar</th>
                </tr>
              </thead>
              <tbody>
                {prev.muestra.map((m, i) => (
                  <tr key={i} className={m.reporting ? undefined : "fila-sin-periodo"}>
                    <td>{m.certificado ?? "—"}</td>
                    <td>{m.asegurado ?? "—"}</td>
                    <td>{m.section_no ?? "—"}</td>
                    <td>{m.risk_code ?? "—"}</td>
                    <td>{m.reporting ?? "⛔"}</td>
                    <td className="num">{m.gwp_our_line != null ? fmtMiles(m.gwp_our_line) : "—"}</td>
                    <td className="num">{m.comision_pct.toFixed(2)}%</td>
                    <td className="num">{m.prima_traspasar != null ? fmtMiles(m.prima_traspasar) : "—"}</td>
                    <td className="num">{m.liquidar != null ? fmtMiles(m.liquidar) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fila-total-risk">
                  <td colSpan={5}><b>TOTAL ({prev.n_lineas} líneas)</b></td>
                  <td className="num"><b>{fmtMiles(prev.total_gwp_our_line)}</b></td>
                  <td />
                  <td className="num"><b>{fmtMiles(prev.total_prima_traspasar)}</b></td>
                  <td className="num"><b>{fmtMiles(prev.total_liquidar)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {prev.sin_mapear.length > 0 && (
            <div className="import-aviso" style={{ marginTop: 8 }}>
              <b>Columnas no reconocidas</b> — se guardan íntegras en «Extra» (no se pierde nada). Si alguna es
              un dato que quieres en su campo, <b>asígnala</b> aquí: se recuerda para <b>todos los binders de
              este programa</b> y las próximas subidas la reconocerán sola.
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {prev.sin_mapear.map((col) => (
                  <div key={col} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" }}>{col}</span>
                    <span aria-hidden>→</span>
                    <select defaultValue="" disabled={asignando === col || busy}
                            onChange={(e) => asignar(col, e.target.value)}
                            style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <option value="">{asignando === col ? "Guardando…" : "Dejar en «Extra»"}</option>
                      {campos.map((c) => <option key={c.campo} value={c.campo}>{c.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {aliases.length > 0 && (
            <div className="hint" style={{ marginTop: 8 }}>
              <b>Mapeo guardado de este programa</b> — se aplica a todos sus binders. Quita (✕) el que ya no
              quieras (la columna volverá a «Extra» si el mapeo base no la reconoce).
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {aliases.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 200px", minWidth: 0, wordBreak: "break-word" }}>{a.alias_columna}</span>
                    <span aria-hidden>→</span>
                    <span style={{ flex: "1 1 180px", minWidth: 0 }}>
                      <b>{etiquetaCampo(a.campo)}</b>{a.es_global && <span className="hint"> · global</span>}
                    </span>
                    {!a.es_global && (
                      <button type="button" className="btn-link btn-sm" title="Quitar (vuelve a «Extra»)"
                              disabled={busy || asignando === a.alias_columna} onClick={() => quitar(a)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </FormPanel>
  );
}
