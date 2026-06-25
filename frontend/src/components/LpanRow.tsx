import { useEffect, useState } from "react";
import { lpanApi, type RcEnSeccion } from "../api";
import { fmtMiles, fmtFechaES } from "../format";

const WP_STATUS = ["Work in Progress", "Queried", "Completed", "Rejected"];

// Fila de un risk code dentro de un periodo del cuadro LPAN. Permite generar el LPAN (elige carpeta
// y genera el documento) y, una vez generado, editar WP, Procesado, SDD y WP Status.
export default function LpanRow({
  r,
  section,
  periodo,
  binderId,
  busy,
  onChanged,
  onBorrar,
}: {
  r: RcEnSeccion;
  section: number;
  periodo: string;
  binderId: number;
  busy: boolean;
  onChanged: () => void | Promise<void>;
  onBorrar: (l: { id: number; etiqueta: string }) => void;
}) {
  const lp = r.lpan;
  const [wp, setWp] = useState(lp?.work_package ?? "");
  const [fproc, setFproc] = useState((lp?.fecha ?? "").slice(0, 10));
  const [sdd, setSdd] = useState((lp?.sdd ?? "").slice(0, 10));
  const [estado, setEstado] = useState(lp?.estado ?? "Work in Progress");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWp(lp?.work_package ?? "");
    setFproc((lp?.fecha ?? "").slice(0, 10));
    setSdd((lp?.sdd ?? "").slice(0, 10));
    setEstado(lp?.estado ?? "Work in Progress");
  }, [lp?.work_package, lp?.fecha, lp?.sdd, lp?.estado]);

  const dirty = !!lp && (
    wp !== (lp.work_package ?? "") ||
    fproc !== (lp.fecha ?? "").slice(0, 10) ||
    sdd !== (lp.sdd ?? "").slice(0, 10) ||
    estado !== (lp.estado ?? "")
  );

  const brokeragePct = Number(r.gross_premium)
    ? `${fmtMiles((Number(r.brokerage) / Number(r.gross_premium)) * 100)} %` : "—";

  // Generar LPAN: abre el explorador de Windows para elegir la carpeta del documento (recuerda la
  // última por binder), genera el Word con cifras y crea el LPAN en estado «Work in Progress».
  async function generar() {
    const key = `mayrit.lpan.docdir.${binderId}`;
    const prev = localStorage.getItem(key) ?? "";
    setSaving(true);
    try {
      const { carpeta } = await lpanApi.elegirCarpeta(prev || undefined);
      if (!carpeta) return; // cancelado
      localStorage.setItem(key, carpeta);
      await lpanApi.generarLpan(binderId, { risk_code: r.risk_code, section, periodo, comision_pct: r.comision_pct, carpeta });
      await onChanged();
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
      });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  // Exención: marcar el grupo como "no requiere LPAN" (no se liquida al mercado) o quitar la marca.
  async function toggleExencion() {
    setSaving(true);
    try {
      if (r.exento_lpan) await lpanApi.quitarExencion(binderId, periodo, section, r.risk_code, r.comision_pct);
      else {
        const motivo = window.prompt("Motivo (opcional): por qué no se liquida al mercado / no requiere LPAN", "") ?? "";
        await lpanApi.marcarExencion(binderId, { periodo, section, risk_code: r.risk_code, comision_pct: r.comision_pct, motivo: motivo.trim() || null });
      }
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  const statusOpts = WP_STATUS.includes(estado) || !estado ? WP_STATUS : [estado, ...WP_STATUS];
  // Al pasar a Completed se bloquean WP, Procesado y SDD (cambia el estado a otro para volver a editar).
  const bloqueado = estado === "Completed";

  return (
    <tr>
      <th>{r.risk_code}<span className="hint" style={{ display: "block", fontWeight: 400 }}>com. {Number(r.comision_pct).toFixed(2)}%</span></th>
      <td className="num">{r.num_lineas}</td>
      <td className="num">{fmtMiles(r.gross_premium)}</td>
      <td className="num">{brokeragePct}</td>
      <td className="num">{fmtMiles(r.tax)}</td>
      <td className="num">{fmtMiles(r.net_premium)}</td>
      <td>{r.cobrado
        ? <span className="pill pill-cobrado">Cobrado</span>
        : <span className="pill pill-pendiente">Pendiente</span>}</td>
      <td>
        {lp ? (
          <span className="pill pill-cobrado" title={lp.tipo}>{lp.broker_ref2 || lp.tipo}</span>
        ) : r.exento_lpan ? (
          <span style={{ whiteSpace: "nowrap" }}>
            <span className="pill pill-anulado" title={r.exencion_motivo || "No se liquida al mercado: no requiere LPAN"}>🚫 Exento</span>{" "}
            <button className="btn-link btn-sm" disabled={busy || saving} onClick={toggleExencion}>Quitar</button>
          </span>
        ) : r.cubierto_historico ? (
          <span className="pill pill-cobrado" title="Este risk code ya tiene un LPAN histórico (enviado en su día, sin distinguir comisión). No se rehace.">✓ LPAN histórico</span>
        ) : Number(r.gross_premium) === 0 ? (
          <span className="pill pill-pendiente" title="Prima neta 0 € (alta y devolución se netean): no requiere LPAN">Sin prima</span>
        ) : (
          <span style={{ whiteSpace: "nowrap" }}>
            <button className="btn-secondary btn-sm"
              disabled={busy || saving || !r.cobrado || !r.signing_number}
              title={!r.signing_number ? "Falta el signing number del FDO de este risk code"
                : !r.cobrado ? "El bloque no está cobrado" : "Generar el LPAN de este bloque"}
              onClick={generar}>
              Generar LPAN
            </button>{" "}
            <button className="btn-link btn-sm" disabled={busy || saving}
              title="No se liquida al mercado: marcar como exento de LPAN" onClick={toggleExencion}>No requiere</button>
          </span>
        )}
      </td>
      {lp ? (
        <>
          <td><input type="text" value={wp} placeholder="BNIXQUR" style={{ width: 90 }}
            disabled={bloqueado} title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setWp(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={fproc}
            disabled={bloqueado} title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setFproc(e.target.value)} /></td>
          <td><input type="date" className="inp-fecha" value={sdd}
            disabled={bloqueado} title={bloqueado ? "Bloqueado al estar Completed" : undefined}
            onChange={(e) => setSdd(e.target.value)} /></td>
          <td>
            <select value={estado} onChange={(e) => setEstado(e.target.value)}>
              {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
          <td>{lp.liberado ? fmtFechaES(lp.liberado) : "—"}</td>
          <td>{lp.pagado ? fmtFechaES(lp.pagado) : "—"}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="btn-primary btn-sm" disabled={saving || busy || !dirty} onClick={guardar}>Guardar</button>{" "}
            <button className="btn-link" disabled={busy || saving}
              onClick={() => onBorrar({ id: lp.id, etiqueta: `${lp.broker_ref2 || lp.tipo} · Sección ${section} · ${r.risk_code} · ${periodo}` })}>Borrar</button>
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
