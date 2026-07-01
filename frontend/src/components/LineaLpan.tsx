import { useEffect, useState } from "react";
import { lpanApi, type LpanRegistro } from "../api";

const WP_STATUS = ["Work in Progress", "Queried", "Completed", "Rejected"];

// Bloque "LPAN" dentro del modal de una línea de BDX: muestra el LPAN al que pertenece esa línea
// (por sección + risk code + mes de Premium + comisión) y permite corregir sus campos de seguimiento
// (signing, WP, Procesado, SDD, WP Status, Liberado, Liquidado). El LPAN es COMPARTIDO por todas las
// líneas de ese grupo: al guardar aquí se corrige el LPAN de todas ellas.
export default function LineaLpan({ lineId, readOnly = false }: { lineId: number; readOnly?: boolean }) {
  const [lp, setLp] = useState<LpanRegistro | null | undefined>(undefined);
  const [signing, setSigning] = useState("");
  const [wp, setWp] = useState("");
  const [fproc, setFproc] = useState("");
  const [sdd, setSdd] = useState("");
  const [estado, setEstado] = useState("");
  const [liberado, setLiberado] = useState("");
  const [pagado, setPagado] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState(false);

  function volcar(l: LpanRegistro) {
    setSigning(l.signing_number ?? "");
    setWp(l.work_package ?? "");
    setFproc((l.fecha ?? "").slice(0, 10));
    setSdd((l.sdd ?? "").slice(0, 10));
    setEstado(l.estado ?? "");
    setLiberado((l.liberado ?? "").slice(0, 10));
    setPagado((l.pagado ?? "").slice(0, 10));
  }

  useEffect(() => {
    let vivo = true;
    lpanApi.deLinea(lineId)
      .then((l) => { if (!vivo) return; setLp(l); if (l) volcar(l); })
      .catch((e) => { if (vivo) { setLp(null); setError((e as Error).message); } });
    return () => { vivo = false; };
  }, [lineId]);

  if (lp === undefined) return <div className="hint">Cargando LPAN…</div>;
  if (lp === null) return <div className="hint">Este riesgo no tiene LPAN generado.</div>;

  const statusOpts = WP_STATUS.includes(estado) || !estado ? WP_STATUS : [estado, ...WP_STATUS];
  const dirty =
    signing !== (lp.signing_number ?? "") || wp !== (lp.work_package ?? "") ||
    fproc !== (lp.fecha ?? "").slice(0, 10) || sdd !== (lp.sdd ?? "").slice(0, 10) ||
    estado !== (lp.estado ?? "") || liberado !== (lp.liberado ?? "").slice(0, 10) ||
    pagado !== (lp.pagado ?? "").slice(0, 10);

  async function guardar() {
    setSaving(true); setError(null); setOkMsg(false);
    try {
      const act = await lpanApi.actualizarLpan(lp!.id, {
        signing_number: signing.trim() || null,
        work_package: wp.trim() || null,
        fecha: fproc || null,
        sdd: sdd || null,
        estado: estado.trim() || null,
        liberado: liberado || null,
        pagado: pagado || null,
      });
      setLp(act); volcar(act); setOkMsg(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>
        LPAN <b>{lp.broker_ref2 || lp.tipo}</b> · {lp.periodo} · {lp.num_lineas} línea(s).
        Corrige aquí sus datos (afecta al LPAN completo, no solo a esta línea).
      </div>
      <div className="campos-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="field"><label>Signing number</label>
          <input type="text" value={signing} placeholder="21285*18/06/2026" disabled={readOnly} onChange={(e) => setSigning(e.target.value)} /></div>
        <div className="field"><label>Work Package</label>
          <input type="text" value={wp} placeholder="BNIXQUR" disabled={readOnly} onChange={(e) => setWp(e.target.value)} /></div>
        <div className="field"><label>Procesado</label>
          <input type="date" className="inp-fecha" value={fproc} disabled={readOnly} onChange={(e) => setFproc(e.target.value)} /></div>
        <div className="field"><label>SDD</label>
          <input type="date" className="inp-fecha" value={sdd} disabled={readOnly} onChange={(e) => setSdd(e.target.value)} /></div>
        <div className="field"><label>WP Status</label>
          <select value={estado} disabled={readOnly} onChange={(e) => setEstado(e.target.value)}>
            <option value="">—</option>
            {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="field" />
        <div className="field"><label>Liberado</label>
          <input type="date" className="inp-fecha" value={liberado} disabled={readOnly} onChange={(e) => setLiberado(e.target.value)} /></div>
        <div className="field"><label>Liquidado</label>
          <input type="date" className="inp-fecha" value={pagado} disabled={readOnly} onChange={(e) => setPagado(e.target.value)} /></div>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>⚠ {error}</div>}
      {!readOnly && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn-primary btn-sm" disabled={saving || !dirty} onClick={guardar}>
            {saving ? "Guardando…" : "Guardar LPAN"}
          </button>
          {okMsg && !dirty && <span className="hint" style={{ color: "var(--verde, #0a0)" }}>✓ Guardado</span>}
        </div>
      )}
    </div>
  );
}
