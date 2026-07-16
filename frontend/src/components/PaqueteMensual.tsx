import { useEffect, useState } from "react";
import { contabilidadApi, type ExtractoMensual } from "../api";
import FormPanel from "./FormPanel";

// Paquete mensual para la gestoría: por cada mes, sube el extracto real del banco (por cuenta) y
// descarga el ZIP con los tickets renombrados con su código + el extracto, separados por banco.
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function PaqueteMensual({ cuenta, onClose }: { cuenta: string; onClose: () => void }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);   // 1-12
  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
  const [extractos, setExtractos] = useState<ExtractoMensual[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function cargar() {
    try { setExtractos(await contabilidadApi.listarExtractos(undefined, periodo)); } catch { /* ignore */ }
  }
  useEffect(() => { cargar(); setAviso(null); setError(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [periodo]);
  const extractoCuenta = extractos.find((e) => e.cuenta === cuenta);

  async function subirExtracto(f: File) {
    setBusy(true); setError(null); setAviso(null);
    try { await contabilidadApi.subirExtracto(cuenta, periodo, f); await cargar(); setAviso(`Extracto de ${cuenta} subido.`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function descargar() {
    setBusy(true); setError(null); setAviso(null);
    try {
      const { blob, filename } = await contabilidadApi.descargarPaquete(periodo, cuenta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const anios: number[] = [];
  for (let y = hoy.getFullYear() + 1; y >= 2020; y--) anios.push(y);

  return (
    <FormPanel title="📤 Paquete mensual para la gestoría" dirty={false} saving={busy}
      saveLabel="Cerrar" onSave={onClose} onClose={onClose} error={error}>
      <div className="paq-mes">
        <div className="field"><label>Mes</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="field"><label>Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {aviso && <div className="hint" style={{ color: "#0a0", marginBottom: 8 }}>✓ {aviso}</div>}

      {/* Extracto del banco (real) de la cuenta activa para ese mes */}
      <div className="justif-sec" style={{ marginTop: 4 }}>
        <div className="justif-head">
          <b>Extracto de {cuenta}</b>
          <span className="hint">el PDF real descargado del banco, para {MESES[mes - 1]} {anio}</span>
        </div>
        {extractoCuenta ? (
          <div className="adj-item">
            <span aria-hidden>📄</span>
            <a href={contabilidadApi.urlExtracto(extractoCuenta.id)} target="_blank" rel="noopener noreferrer" className="adj-nombre">{extractoCuenta.nombre_original}</a>
            <button type="button" className="btn-link btn-sm" title="Reemplazar (sube otro abajo)" onClick={async () => { await contabilidadApi.borrarExtracto(extractoCuenta.id); cargar(); }}>✕</button>
          </div>
        ) : <span className="hint">aún no subido</span>}
        <div style={{ marginTop: 8 }}>
          <label className="btn-primary btn-sm adj-subir">
            {busy ? "…" : (extractoCuenta ? "Reemplazar extracto" : "⬆️ Subir extracto del banco")}
            <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirExtracto(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {/* Descargas */}
      <div className="justif-sec" style={{ marginTop: 12 }}>
        <div className="justif-head"><b>Descargar el paquete (ZIP)</b>
          <span className="hint">tickets renombrados con su código + extracto, separados por banco</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-primary btn-sm" disabled={busy} onClick={() => descargar()}>📥 Descargar paquete de {cuenta}</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          El ZIP incluye los movimientos de {cuenta} en {MESES[mes - 1]} {anio} que tengan ticket adjunto. Si falta alguno, adjúntalo en su movimiento antes de descargar. Las cuentas se envían siempre por separado.
        </div>
      </div>
    </FormPanel>
  );
}
