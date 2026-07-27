import { useCallback, useEffect, useState } from "react";
import { lpanApi, type FilaLpanOM, type VistaLpanOM } from "../api";
import { fmtMiles } from "../format";
import { pedirDestino, guardarEn } from "../download";

const WP_STATUS = ["Work in Progress", "Queried", "Completed", "Rejected"];

// Sección LPAN de una póliza Open Market (OM), dentro de la ficha. Los LPAN se parten por RISK CODE
// (el reparto se teclea en la ficha): una fila = un (periodo × risk code) = un LPAN. Importes: gross
// al 100% del risk code; impuestos/neto a nuestra participación (line = capacidad). En OM no hay FDO;
// el signing (si Lloyd's) se rellena en el propio LPAN. Se genera solo con el recibo del mes cobrado.
export default function PolizaLpanSection({ polizaId }: { polizaId: number }) {
  const [vista, setVista] = useState<VistaLpanOM | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setVista(await lpanApi.vistaOm(polizaId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [polizaId]);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) return <div className="loading" style={{ marginTop: 16 }}>Cargando LPAN…</div>;
  if (error) return <div className="error" style={{ marginTop: 16 }}>⚠ {error}</div>;
  if (!vista) return null;

  const lloyds = vista.es_lloyds;
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 8 }}>
        LPAN{" "}
        <span className={`pill ${lloyds ? "pill-cobrado" : "pill-anulado"}`} title={vista.tipo_mercado ?? ""}>
          {lloyds ? "Lloyd's" : (vista.tipo_mercado || "No Lloyd's")}
        </span>
        {vista.mercado && <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>{vista.mercado}</span>}
        {vista.capacidad_pct != null && (
          <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
            · Participación {fmtMiles(vista.capacidad_pct, 2, false)}%
          </span>
        )}
      </h3>

      {vista.aviso && <div className="hint" style={{ color: "var(--rojo)", marginBottom: 8 }}>⚠ {vista.aviso}</div>}

      {vista.filas.length === 0 ? (
        <div className="hint">Sin datos: esta póliza no tiene recibos con periodo, o falta el reparto por risk code.</div>
      ) : (
        <div className="emision-preview">
          <table className="compacto">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Risk Code</th>
                <th className="num">%</th>
                <th className="num">Gross 100%</th>
                <th className="num">Impuestos</th>
                <th className="num">Neto UW</th>
                <th>Cobro</th>
                <th>LPAN</th>
                <th>Signing</th>
                <th>WP</th>
                <th>Procesado</th>
                <th>SDD</th>
                <th>Status</th>
                <th>Liberado</th>
                <th>Liquidado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vista.filas.map((f) => (
                <FilaRow key={`${f.periodo}|${f.risk_code}`} f={f} vista={vista} polizaId={polizaId} onChanged={cargar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Fila de un (periodo × risk code): importes calculados + el LPAN (generar o seguimiento).
function FilaRow({
  f,
  vista,
  polizaId,
  onChanged,
}: {
  f: FilaLpanOM;
  vista: VistaLpanOM;
  polizaId: number;
  onChanged: () => void | Promise<void>;
}) {
  const lp = f.lpan;
  const lloyds = vista.es_lloyds;
  const [signing, setSigning] = useState(lp?.signing_number ?? "");
  const [wp, setWp] = useState(lp?.work_package ?? "");
  const [fproc, setFproc] = useState((lp?.fecha ?? "").slice(0, 10));
  const [sdd, setSdd] = useState((lp?.sdd ?? "").slice(0, 10));
  const [estado, setEstado] = useState(lp?.estado ?? "Work in Progress");
  const [liberado, setLiberado] = useState((lp?.liberado ?? "").slice(0, 10));
  const [pagado, setPagado] = useState((lp?.pagado ?? "").slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSigning(lp?.signing_number ?? "");
    setWp(lp?.work_package ?? "");
    setFproc((lp?.fecha ?? "").slice(0, 10));
    setSdd((lp?.sdd ?? "").slice(0, 10));
    setEstado(lp?.estado ?? "Work in Progress");
    setLiberado((lp?.liberado ?? "").slice(0, 10));
    setPagado((lp?.pagado ?? "").slice(0, 10));
  }, [lp?.signing_number, lp?.work_package, lp?.fecha, lp?.sdd, lp?.estado, lp?.liberado, lp?.pagado]);

  const dirty = !!lp && (
    signing !== (lp.signing_number ?? "") ||
    wp !== (lp.work_package ?? "") ||
    fproc !== (lp.fecha ?? "").slice(0, 10) ||
    sdd !== (lp.sdd ?? "").slice(0, 10) ||
    estado !== (lp.estado ?? "") ||
    liberado !== (lp.liberado ?? "").slice(0, 10) ||
    pagado !== (lp.pagado ?? "").slice(0, 10)
  );

  // Generar el LPAN de este (periodo × risk code). Lloyd's: crea + Word (eligiendo carpeta).
  async function generar() {
    if (!lloyds) {
      setSaving(true);
      try {
        await lpanApi.generarLpanOm(polizaId, { periodo: f.periodo, risk_code: f.risk_code });
        await onChanged();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }
    const { handle, cancelado } = await pedirDestino(`LPAN ${f.risk_code} ${f.periodo}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const nlp = await lpanApi.generarLpanOm(polizaId, { periodo: f.periodo, risk_code: f.risk_code });
      const { blob, filename } = await lpanApi.lpanWord(nlp.id);
      await guardarEn(handle, blob, filename);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function descargarWord() {
    if (!lp) return;
    const { handle, cancelado } = await pedirDestino(`${lp.broker_ref2 || `LPAN_${lp.id}`}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const { blob, filename } = await lpanApi.lpanWord(lp.id);
      await guardarEn(handle, blob, filename);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function guardar() {
    if (!lp) return;
    setSaving(true);
    try {
      await lpanApi.actualizarLpan(lp.id, {
        signing_number: signing.trim() || null,
        work_package: wp.trim() || null,
        fecha: fproc || null,
        sdd: sdd || null,
        estado: estado.trim() || null,
        liberado: liberado || null,
        pagado: pagado || null,
      });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function borrar() {
    if (!lp) return;
    if (!confirm(`¿Borrar el LPAN de ${f.risk_code} · ${f.periodo_label}?`)) return;
    setSaving(true);
    try {
      await lpanApi.borrarLpan(lp.id);
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  const statusOpts = WP_STATUS.includes(estado) || !estado ? WP_STATUS : [estado, ...WP_STATUS];
  const bloqueado = estado === "Completed";

  return (
    <tr>
      <th>{f.periodo_label}</th>
      <th>{f.risk_code}</th>
      <td className="num">{fmtMiles(f.pct, 2, false)}%</td>
      <td className="num">{fmtMiles(f.gross_100)}</td>
      <td className="num">{fmtMiles(f.tax)}</td>
      <td className="num">{fmtMiles(f.net_premium)}</td>
      <td>{f.cobrado
        ? <span className="pill pill-cobrado">Cobrado</span>
        : <span className="pill pill-pendiente">Pendiente</span>}</td>
      <td>
        {lp ? (
          <span className="pill pill-cobrado" title={lp.tipo}>{lp.broker_ref2 || lp.tipo}</span>
        ) : Number(f.gross_100) === 0 ? (
          <span className="pill pill-pendiente" title="Prima 0 €: no requiere LPAN">Sin prima</span>
        ) : (
          <button className="btn-secondary btn-sm"
            disabled={saving || !f.cobrado}
            title={!f.cobrado ? "El mes no está cobrado del todo" : "Generar el LPAN de este risk code"}
            onClick={generar}>
            Generar LPAN
          </button>
        )}
      </td>
      {lp ? (
        <>
          <td>{lloyds
            ? <input type="text" value={signing} disabled={bloqueado} style={{ width: 130 }}
                title={bloqueado ? "Bloqueado al estar Completed" : "Signing number de Xchanging"}
                onChange={(e) => setSigning(e.target.value)} />
            : <span className="hint">—</span>}</td>
          <td><input type="text" value={wp} disabled={bloqueado}
            title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setWp(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={fproc} disabled={bloqueado}
            title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setFproc(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={sdd} disabled={bloqueado}
            title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setSdd(e.target.value)} /></td>
          <td>
            <select value={estado} onChange={(e) => setEstado(e.target.value)}>
              {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
          <td><input type="date" className="inp-fecha" value={liberado} disabled={!bloqueado}
            title={!bloqueado ? "Editable cuando el LPAN está Completed" : "Fecha de liberado (corregible)"}
            onChange={(e) => setLiberado(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={pagado} disabled={!lp.liberado}
            title={!lp.liberado ? "Editable cuando hay fecha de Liberado" : "Fecha de liquidación (corregible)"}
            onChange={(e) => setPagado(e.target.value)} /></td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="btn-icono" title="Guardar" aria-label="Guardar" disabled={saving || !dirty} onClick={guardar}>💾</button>{" "}
            {lloyds && (
              <button className="btn-icono" title="Descargar el Word del LPAN" aria-label="Descargar Word" disabled={saving} onClick={descargarWord}>⬇️</button>
            )}{" "}
            <button className="btn-link" disabled={saving} onClick={borrar}>Borrar</button>
          </td>
        </>
      ) : (
        <>
          <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td></td>
        </>
      )}
    </tr>
  );
}
