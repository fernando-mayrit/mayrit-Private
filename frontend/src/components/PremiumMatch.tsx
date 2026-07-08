import { useEffect, useState } from "react";
import { recibosApi, bdxApi, type ExcelPreview, type MatchResult } from "../api";
import { fmtMiles } from "../format";
import FormPanel from "./FormPanel";

// Macheo automático de un Premium (Excel) con las líneas Risk del binder.
// Flujo: preview de columnas → mapear Certificado/Importe + mes → Machear → revisar → Aplicar.

const eur = (v: unknown) => (v == null || v === "" ? "—" : `${fmtMiles(v)} €`);

// Nombre de mes (español, completo o abreviado) → nº de mes.
const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};
// Deduce el 'AAAA-MM' del nombre del fichero (p. ej. "Premium Bordereaux abril 2026…" → "2026-04").
// Ignora acentos/mayúsculas. Coge el año pegado al nombre del mes (evita el YOA de otra parte).
function periodoDeNombre(nombre: string): string {
  const s = nombre.toLowerCase();   // los meses en español no llevan tilde
  const m = s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\b[.\s]*(\d{4})/);
  return m ? `${m[2]}-${String(MESES[m[1]]).padStart(2, "0")}` : "";
}

export default function PremiumMatch({
  binderId,
  file,
  nombre,
  onClose,
  onApplied,
}: {
  binderId: number;
  file: File;
  nombre: string;
  onClose: () => void;
  onApplied: (periodo: string) => void;
}) {
  const [prev, setPrev] = useState<ExcelPreview | null>(null);
  const [hoja, setHoja] = useState<string>("");
  const [certificado, setCertificado] = useState<string>("");
  const [importe, setImporte] = useState<string>("");
  const [periodo, setPeriodo] = useState<string>(() => periodoDeNombre(nombre)); // 'YYYY-MM' (deducido del nombre)
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargarPreview(h?: string) {
    setBusy(true);
    setError(null);
    try {
      const p = await recibosApi.excelPreview(binderId, file, h);
      setPrev(p);
      setHoja(p.hoja);
      setCertificado(p.mapeo.certificado ?? "");
      setImporte(p.mapeo.importe ?? "");
      setMatch(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    cargarPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function machear() {
    if (!certificado) return setError("Elige la columna del Certificado.");
    if (!/^\d{4}-\d{2}$/.test(periodo)) return setError("Indica el mes del Premium (AAAA-MM).");
    setBusy(true);
    setError(null);
    try {
      setMatch(await recibosApi.matchExcel(binderId, file, { hoja, certificado, importe: importe || null, periodo }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function aplicar() {
    if (!match || match.matched_ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await bdxApi.incluirPremium(match.matched_ids, periodo);
      onApplied(periodo);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const pill = (e: string) =>
    e === "match" ? "pill-cobrado" : e === "importe_distinto" ? "pill-parcial" : "pill-pendiente";
  const txt = (e: string) =>
    e === "match" ? "OK" : e === "importe_distinto" ? "Importe ≠" : "No encontrada";

  return (
    <FormPanel
      title={`Machear Premium · ${nombre}`}
      dirty={false}
      saving={busy}
      saveLabel={match ? `Aplicar (${match.matched_ids.length})` : "Machear"}
      error={error}
      onSave={match ? aplicar : machear}
      onClose={onClose}
      wide
    >
      {!prev ? (
        <div className="loading">Leyendo Excel…</div>
      ) : (
        <>
          <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Hoja</label>
              <select value={hoja} onChange={(e) => cargarPreview(e.target.value)}>
                {prev.hojas.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Mes del Premium</label>
              <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
            </div>
            <div className="field">
              <label>Columna Certificado</label>
              <select value={certificado} onChange={(e) => { setCertificado(e.target.value); setMatch(null); }}>
                <option value="">— elegir —</option>
                {prev.columnas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Columna Importe (comprobación)</label>
              <select value={importe} onChange={(e) => { setImporte(e.target.value); setMatch(null); }}>
                <option value="">— ninguna —</option>
                {prev.columnas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {!match ? (
            <div className="hint" style={{ marginTop: 8 }}>
              {prev.columnas.length} columnas y <b>{prev.n_filas}</b> líneas detectadas en «{prev.hoja}».
              Pulsa <b>Machear</b> para casar por Certificado (el importe es una comprobación; si no cuadra, se marca para revisar).
            </div>
          ) : (
            <>
              <div className="hint" style={{ margin: "10px 0" }}>
                <b>{match.resumen.match}</b> macheadas ·{" "}
                <b>{match.resumen.importe_distinto}</b> con importe distinto ·{" "}
                <b>{match.resumen.no_encontrada}</b> no encontradas (de {match.resumen.total}).
                Al aplicar se incluyen en el Premium <b>{match.periodo}</b> las <b>{match.matched_ids.length}</b> OK.
              </div>
              <div className="tabla-scroll" style={{ maxHeight: "42vh" }}>
                <table className="compacto">
                  <thead>
                    <tr><th>Certificado</th><th className="num">Importe Excel</th><th className="num">Importe Risk</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {match.filas.map((f, i) => (
                      <tr key={i}>
                        <td>{f.certificate_ref}</td>
                        <td className="num">{eur(f.importe_excel)}</td>
                        <td className="num">{eur(f.importe_risk)}</td>
                        <td><span className={`pill ${pill(f.estado)}`}>{txt(f.estado)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="match-total">
                      <td><b>Total ({match.filas.length})</b></td>
                      <td className="num"><b>{eur(match.filas.reduce((a, f) => a + (Number(f.importe_excel) || 0), 0))}</b></td>
                      <td className="num"><b>{eur(match.filas.reduce((a, f) => a + (Number(f.importe_risk) || 0), 0))}</b></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Sumatorio del Premium que se está subiendo (líneas macheadas), con la economía del binder. */}
              <div className="match-premium">
                <span>Premium {match.periodo} ({match.matched_ids.length} líneas)</span>
                <span>A Cobrar <b>{eur(match.premium.cobrar)}</b></span>
                <span>A Traspasar <b>{eur(match.premium.traspasar)}</b></span>
                <span>A Liquidar <b>{eur(match.premium.liquidar)}</b></span>
              </div>
            </>
          )}
        </>
      )}
    </FormPanel>
  );
}
