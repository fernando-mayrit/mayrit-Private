import { useCallback, useEffect, useState } from "react";
import { lpanApi, type PeriodoLpanOM, type VistaLpanOM } from "../api";
import { fmtMiles } from "../format";
import { pedirDestino, guardarEn } from "../download";

const WP_STATUS = ["Work in Progress", "Queried", "Completed", "Rejected"];

// Sección LPAN de una póliza Open Market (OM), dentro de la ficha de la póliza. Los importes salen de
// los RECIBOS de la póliza agrupados por mes (no hay BDX). Si el mercado es Lloyd's, hay FDO+signing y
// Word a Xchanging; si no, el LPAN es solo control de pago. Calca la mecánica de la pestaña del binder.
export default function PolizaLpanSection({
  polizaId,
  numeroPoliza,
}: {
  polizaId: number;
  numeroPoliza: string | null;
}) {
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
      </h3>

      {lloyds && <FdoPanel vista={vista} polizaId={polizaId} numeroPoliza={numeroPoliza} onChanged={cargar} />}

      {vista.periodos.length === 0 ? (
        <div className="hint">Esta póliza no tiene recibos con periodo: no hay meses que liquidar por LPAN.</div>
      ) : (
        <div className="emision-preview">
          <table className="compacto">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Recibos</th>
                <th className="num">Gross</th>
                <th className="num">Brokerage</th>
                <th className="num">Tax</th>
                <th className="num">Neto UW</th>
                <th>Cobro</th>
                <th>LPAN</th>
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
              {vista.periodos.map((p) => (
                <PeriodoRow key={p.periodo} p={p} vista={vista} polizaId={polizaId} onChanged={cargar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Panel del FDO de la póliza (solo Lloyd's): crear (con risk code), editar signing/WP/estado y Word.
function FdoPanel({
  vista,
  polizaId,
  numeroPoliza,
  onChanged,
}: {
  vista: VistaLpanOM;
  polizaId: number;
  numeroPoliza: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const f = vista.fdo;
  const [rc, setRc] = useState(vista.risk_code ?? "");
  const [signing, setSigning] = useState(f?.signing_number ?? "");
  const [wp, setWp] = useState(f?.work_package ?? "");
  const [fproc, setFproc] = useState((f?.fecha_proceso ?? "").slice(0, 10));
  const [wpStatus, setWpStatus] = useState(f?.work_package_status ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSigning(f?.signing_number ?? "");
    setWp(f?.work_package ?? "");
    setFproc((f?.fecha_proceso ?? "").slice(0, 10));
    setWpStatus(f?.work_package_status ?? "");
  }, [f?.signing_number, f?.work_package, f?.fecha_proceso, f?.work_package_status]);

  const completado = !!f && (f.work_package_status ?? "") === "Completed";
  const dirty = !!f && !completado && (
    signing !== (f.signing_number ?? "") ||
    wp !== (f.work_package ?? "") ||
    fproc !== (f.fecha_proceso ?? "").slice(0, 10) ||
    wpStatus !== (f.work_package_status ?? "")
  );

  async function generarFdo() {
    if (!rc.trim()) { alert("Indica el risk code del FDO."); return; }
    const ref = `${numeroPoliza || "OM"} FDO-${rc.trim()}`;
    const { handle, cancelado } = await pedirDestino(`${ref}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const nf = await lpanApi.crearFdoOm(polizaId, rc.trim());
      const { blob, filename } = await lpanApi.fdoWord(nf.id);
      await guardarEn(handle, blob, filename);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function descargarWord() {
    if (!f) return;
    const { handle, cancelado } = await pedirDestino(`${numeroPoliza || "FDO"}_${f.id}.docx`);
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

  async function guardar() {
    if (!f) return;
    setSaving(true);
    try {
      await lpanApi.actualizarFdo(f.id, {
        signing_number: signing.trim() || null,
        work_package: wp.trim() || null,
        fecha_proceso: fproc || null,
        work_package_status: wpStatus.trim() || null,
      });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: 10, marginBottom: 12 }}>
      <h4 style={{ margin: "0 0 8px" }}>FDO (Declaración a Xchanging)</h4>
      {!f ? (
        <div className="field-row" style={{ alignItems: "flex-end", gap: 8 }}>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Risk Code <span className="required">*</span></label>
            <input type="text" value={rc} onChange={(e) => setRc(e.target.value.toUpperCase())} placeholder="p.ej. PC" />
          </div>
          <button className="btn-gris btn-sm" disabled={saving} onClick={generarFdo} style={{ marginBottom: 4 }}>
            Generar FDO
          </button>
        </div>
      ) : (
        <div className="field-row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <div className="field" style={{ maxWidth: 80 }}><label>Risk Code</label><div className="calc-box">{f.risk_code}</div></div>
          <div className="field" style={{ minWidth: 160 }}><label>Signing</label>
            <input type="text" value={signing} disabled={completado} onChange={(e) => setSigning(e.target.value)} /></div>
          <div className="field" style={{ maxWidth: 120 }}><label>Work Package</label>
            <input type="text" value={wp} disabled={completado} onChange={(e) => setWp(e.target.value)} /></div>
          <div className="field" style={{ maxWidth: 150 }}><label>Procesado</label>
            <input type="date" className="inp-fecha" value={fproc} disabled={completado} onChange={(e) => setFproc(e.target.value)} /></div>
          <div className="field" style={{ maxWidth: 170 }}><label>Status</label>
            <select value={wpStatus} disabled={completado} onChange={(e) => setWpStatus(e.target.value)}>
              <option value="">—</option>
              {WP_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {!completado && (
            <button className="btn-icono" title="Guardar el FDO" aria-label="Guardar" disabled={saving || !dirty} onClick={guardar} style={{ marginBottom: 4 }}>💾</button>
          )}
          <button className="btn-icono" title="Descargar el Word del FDO" aria-label="Descargar Word" disabled={saving} onClick={descargarWord} style={{ marginBottom: 4 }}>⬇️</button>
          {completado && <span className="pill pill-cobrado" style={{ marginBottom: 6 }}>Completed 🔒</span>}
        </div>
      )}
      {f && !f.signing_number && (
        <div className="hint" style={{ marginTop: 6 }}>Para generar los LPAN de los meses hace falta el <b>signing number</b> del FDO.</div>
      )}
    </div>
  );
}

// Fila de un mes: importes del mes (de sus recibos) y el LPAN (generar o seguimiento liberado/liquidado).
function PeriodoRow({
  p,
  vista,
  polizaId,
  onChanged,
}: {
  p: PeriodoLpanOM;
  vista: VistaLpanOM;
  polizaId: number;
  onChanged: () => void | Promise<void>;
}) {
  const lp = p.lpan;
  const lloyds = vista.es_lloyds;
  const [wp, setWp] = useState(lp?.work_package ?? "");
  const [fproc, setFproc] = useState((lp?.fecha ?? "").slice(0, 10));
  const [sdd, setSdd] = useState((lp?.sdd ?? "").slice(0, 10));
  const [estado, setEstado] = useState(lp?.estado ?? "Work in Progress");
  const [liberado, setLiberado] = useState((lp?.liberado ?? "").slice(0, 10));
  const [pagado, setPagado] = useState((lp?.pagado ?? "").slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWp(lp?.work_package ?? "");
    setFproc((lp?.fecha ?? "").slice(0, 10));
    setSdd((lp?.sdd ?? "").slice(0, 10));
    setEstado(lp?.estado ?? "Work in Progress");
    setLiberado((lp?.liberado ?? "").slice(0, 10));
    setPagado((lp?.pagado ?? "").slice(0, 10));
  }, [lp?.work_package, lp?.fecha, lp?.sdd, lp?.estado, lp?.liberado, lp?.pagado]);

  const dirty = !!lp && (
    wp !== (lp.work_package ?? "") ||
    fproc !== (lp.fecha ?? "").slice(0, 10) ||
    sdd !== (lp.sdd ?? "").slice(0, 10) ||
    estado !== (lp.estado ?? "") ||
    liberado !== (lp.liberado ?? "").slice(0, 10) ||
    pagado !== (lp.pagado ?? "").slice(0, 10)
  );

  const brokeragePct = Number(p.gross_premium)
    ? `${fmtMiles((Number(p.brokerage) / Number(p.gross_premium)) * 100)} %` : "—";
  const signingFalta = lloyds && !vista.fdo?.signing_number;

  // Generar el LPAN del mes. Lloyd's: crea + Word (eligiendo carpeta). No-Lloyd's: solo el registro.
  async function generar() {
    if (!lloyds) {
      setSaving(true);
      try {
        await lpanApi.generarLpanOm(polizaId, { periodo: p.periodo });
        await onChanged();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }
    const { handle, cancelado } = await pedirDestino(`LPAN ${p.periodo}.docx`);
    if (cancelado) return;
    setSaving(true);
    try {
      const nlp = await lpanApi.generarLpanOm(polizaId, { periodo: p.periodo });
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
    if (!confirm(`¿Borrar el LPAN de ${p.periodo_label}?`)) return;
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
      <th>{p.periodo_label}</th>
      <td className="num">{p.num_recibos}</td>
      <td className="num">{fmtMiles(p.gross_premium)}</td>
      <td className="num">{brokeragePct}</td>
      <td className="num">{fmtMiles(p.tax)}</td>
      <td className="num">{fmtMiles(p.net_premium)}</td>
      <td>{p.cobrado
        ? <span className="pill pill-cobrado">Cobrado</span>
        : <span className="pill pill-pendiente">Pendiente</span>}</td>
      <td>
        {lp ? (
          <span className="pill pill-cobrado" title={lp.tipo}>{lp.broker_ref2 || lp.tipo}</span>
        ) : Number(p.gross_premium) === 0 ? (
          <span className="pill pill-pendiente" title="Prima neta 0 €: no requiere LPAN">Sin prima</span>
        ) : (
          <button className="btn-secondary btn-sm"
            disabled={saving || !p.cobrado || signingFalta}
            title={signingFalta ? "Falta el signing number del FDO de la póliza"
              : !p.cobrado ? "El mes no está cobrado del todo" : "Generar el LPAN de este mes"}
            onClick={generar}>
            Generar LPAN
          </button>
        )}
      </td>
      {lp ? (
        <>
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
          <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td></td>
        </>
      )}
    </tr>
  );
}
