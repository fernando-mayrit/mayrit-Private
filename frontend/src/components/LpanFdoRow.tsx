import { useEffect, useState } from "react";
import { lpanApi, type RiskCodeFdo } from "../api";
import { pedirDestino, guardarEn } from "../download";

// Fila del cuadro de FDO (una por sección+risk code declarado en el binder). Permite generar el
// FDO y editar signing number, work package, fecha de proceso y work package status.
export default function LpanFdoRow({
  rc,
  binderId,
  onChanged,
}: {
  rc: RiskCodeFdo;
  binderId: number;
  onChanged: () => void | Promise<void>;
}) {
  const f = rc.fdo;
  const [signing, setSigning] = useState(f?.signing_number ?? "");
  const [wp, setWp] = useState(f?.work_package ?? "");
  const [fproc, setFproc] = useState((f?.fecha_proceso ?? "").slice(0, 10));
  const [wpStatus, setWpStatus] = useState(f?.work_package_status ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sincroniza los borradores cuando cambian los datos del FDO (tras recargar).
  useEffect(() => {
    setSigning(f?.signing_number ?? "");
    setWp(f?.work_package ?? "");
    setFproc((f?.fecha_proceso ?? "").slice(0, 10));
    setWpStatus(f?.work_package_status ?? "");
  }, [f?.signing_number, f?.work_package, f?.fecha_proceso, f?.work_package_status]);

  // Un FDO en estado "Completed" queda bloqueado: no se puede modificar.
  const completado = !!f && (f.work_package_status ?? "") === "Completed";
  const dirty = !!f && !completado && (
    signing !== (f.signing_number ?? "") ||
    wp !== (f.work_package ?? "") ||
    fproc !== (f.fecha_proceso ?? "").slice(0, 10) ||
    wpStatus !== (f.work_package_status ?? "")
  );

  async function accion(fn: () => Promise<unknown>) {
    setSaving(true);
    try {
      await fn();
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  // Generar FDO: crea el registro, regenera el Word y deja elegir dónde guardarlo (diálogo nativo
  // del navegador). Funciona igual en local y en la app desplegada (no depende del escritorio).
  async function generarFdo() {
    // Pedir destino DENTRO del gesto del clic (antes de las llamadas de red); evita que el selector
    // de carpeta caduque en entornos con latencia (Azure).
    const { handle, cancelado } = await pedirDestino(`${rc.broker_reference || `FDO S${rc.section}-${rc.risk_code}`}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const nf = await lpanApi.crearFdo(binderId, rc.section, rc.risk_code);
      const { blob, filename } = await lpanApi.fdoWord(nf.id);
      await guardarEn(handle, blob, filename);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Re-descargar el Word de un FDO ya generado (por si se canceló el guardado o se quiere otra copia).
  async function descargarWord() {
    if (!f) return;
    const { handle, cancelado } = await pedirDestino(`${rc.broker_reference || `FDO_${f.id}`}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const { blob, filename } = await lpanApi.fdoWord(f.id);
      await guardarEn(handle, blob, filename);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <th>{rc.section}</th>
      <td>{rc.ramo ?? "—"}</td>
      <th>{rc.risk_code}</th>
      <td>{rc.broker_reference}</td>
      {!f ? (
        <td colSpan={5}>
          <button className="btn-gris btn-sm" disabled={saving} onClick={generarFdo}>
            Generar FDO
          </button>
        </td>
      ) : completado ? (
        // FDO Completed: bloqueado (solo lectura).
        <>
          <td>{signing || "—"}</td>
          <td>{wp || "—"}</td>
          <td>{fproc || "—"}</td>
          <td><span className="pill pill-cobrado">Completed 🔒</span></td>
          <td><button className="btn-link btn-sm" disabled={saving} title="Descargar el Word del FDO" onClick={descargarWord}>⬇ Word</button></td>
        </>
      ) : (
        <>
          <td><input type="text" value={signing} placeholder="21285*18/06/2026" style={{ width: 150 }}
            onChange={(e) => setSigning(e.target.value)} /></td>
          <td><input type="text" value={wp} placeholder="BNIXQUR" style={{ width: 110 }}
            onChange={(e) => setWp(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={fproc}
            onChange={(e) => setFproc(e.target.value)} /></td>
          <td>
            <select value={wpStatus} onChange={(e) => setWpStatus(e.target.value)}>
              <option value="">—</option>
              <option value="Work in Progress">Work in Progress</option>
              <option value="Queried">Queried</option>
              <option value="Completed">Completed</option>
              <option value="Rejected">Rejected</option>
            </select>
          </td>
          <td>
            <button className="btn-primary btn-sm" disabled={saving || !dirty}
              onClick={() => accion(() => lpanApi.actualizarFdo(f.id, {
                signing_number: signing.trim() || null,
                work_package: wp.trim() || null,
                fecha_proceso: fproc || null,
                work_package_status: wpStatus.trim() || null,
              }))}>
              Guardar
            </button>{" "}
            <button className="btn-link btn-sm" disabled={saving} title="Descargar el Word del FDO" onClick={descargarWord}>⬇ Word</button>
          </td>
        </>
      )}
    </tr>
  );
}
