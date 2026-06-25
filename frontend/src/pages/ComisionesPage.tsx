import { useEffect, useMemo, useState } from "react";
import { comisionesApi, type MesComision } from "../api";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";

// Comisiones — liquidación mensual. Fuente Iberian: la comisión (coverholder) del Premium del programa
// Iberian-RC Profesional. Se PREPARA el recibo (estimado del Premium) y queda pendiente de RATIFICAR
// cuando Iberian envía la comisión definitiva y el reparto del 85% cedido entre sus dos sociedades.

const eur = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v ?? 0));
const num = (v: number | string | null | undefined) => Number(v ?? 0);
const mesLargo = (per: string) => {
  const [y, m] = per.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function ComisionesPage() {
  const [meses, setMeses] = useState<MesComision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Ratificación
  const [ratDe, setRatDe] = useState<MesComision | null>(null);
  const [defi, setDefi] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [saving, setSaving] = useState(false);

  async function cargar() {
    try { setMeses(await comisionesApi.iberian()); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { cargar(); }, []);

  async function preparar(per: string) {
    setBusy(per); setError(null);
    try { await comisionesApi.preparar(per); await cargar(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function borrar(m: MesComision) {
    if (!m.liq_id) return;
    if (!confirm(`¿Borrar la liquidación de ${mesLargo(m.periodo)} y su recibo?`)) return;
    setBusy(m.periodo); setError(null);
    try { await comisionesApi.borrar(m.liq_id); await cargar(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  function abrirRatificar(m: MesComision) {
    setRatDe(m);
    setDefi(m.comision != null ? String(num(m.comision)) : String(num(m.comision_premium)));
    setP1(m.pago1_importe != null ? String(num(m.pago1_importe)) : "");
    setP2(m.pago2_importe != null ? String(num(m.pago2_importe)) : "");
  }
  // Cedida esperada (85%) según la comisión definitiva tecleada, para cuadrar el reparto.
  const cedidaEsperada = useMemo(() => num(defi) * 0.85, [defi]);
  const sumaReparto = useMemo(() => num(p1) + num(p2), [p1, p2]);

  async function ratificar() {
    if (!ratDe?.liq_id) return;
    if (!defi) return setError("Indica la comisión definitiva.");
    setSaving(true); setError(null);
    try {
      await comisionesApi.ratificar(ratDe.liq_id, {
        comision_definitiva: num(defi),
        pago1_importe: p1 ? num(p1) : null,
        pago2_importe: p2 ? num(p2) : null,
      });
      setRatDe(null);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const PILL: Record<string, string> = { Preparado: "pill-parcial", Ratificado: "pill-cobrado" };

  return (
    <div className="container lista-page">
      <PageHeader emoji="💶" title="Comisiones" />
      <p className="hint" style={{ marginBottom: 8 }}>
        <b>Iberian</b> · programa <b>Iberian-RC Profesional</b>. Comisión = <b>10%</b> del GWP (our line) del
        Premium del mes; de ahí <b>8,5% cedida</b> (85%) y <b>1,5% retenida</b> (15%). Se prepara con la
        estimación del Premium y se ratifica con las cifras definitivas de Iberian.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="lista-scroll">
      <table className="compacto bdx-tabla" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Mes</th>
            <th className="num">Prima (GWP)</th>
            <th className="num">Comisión 10%</th>
            <th className="num">Cedida 8,5%</th>
            <th className="num">Retenida 1,5%</th>
            <th>Estado</th>
            <th>Reparto del 85%</th>
            <th>Recibo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m) => (
            <tr key={m.periodo}>
              <td>{mesLargo(m.periodo)}</td>
              <td className="num">{eur(m.base_prima)}</td>
              <td className="num">{eur(m.comision ?? m.comision_premium)}{m.liq_id ? "" : <span className="hint"> (est.)</span>}</td>
              <td className="num">{m.liq_id ? eur(m.cedida) : "—"}</td>
              <td className="num">{m.liq_id ? eur(m.retenida) : "—"}</td>
              <td>{m.estado ? <span className={`pill ${PILL[m.estado] ?? "pill-anulado"}`}>{m.estado}</span> : "—"}</td>
              <td style={{ fontSize: 12 }}>
                {m.estado === "Ratificado"
                  ? <>
                      {m.pago1_nombre?.split(",")[0]}: <b>{eur(m.pago1_importe)}</b>
                      {m.pago2_importe != null && <> · {m.pago2_nombre?.split(",")[0]}: <b>{eur(m.pago2_importe)}</b></>}
                    </>
                  : "—"}
              </td>
              <td>{m.recibo_numero ?? "—"}</td>
              <td className="acciones" style={{ whiteSpace: "nowrap" }}>
                {!m.liq_id
                  ? <button className="btn-primary btn-sm" disabled={busy === m.periodo} onClick={() => preparar(m.periodo)}>
                      {busy === m.periodo ? "…" : "Preparar"}
                    </button>
                  : <>
                      {m.estado === "Preparado" && <button className="btn-primary btn-sm" onClick={() => abrirRatificar(m)}>Ratificar</button>}
                      {m.estado === "Ratificado" && <button className="btn-link btn-sm" onClick={() => abrirRatificar(m)}>Editar</button>}
                      {" · "}
                      <button className="btn-link btn-sm" disabled={busy === m.periodo} onClick={() => borrar(m)}>Borrar</button>
                    </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {ratDe && (
        <FormPanel
          title={`Ratificar comisión — ${mesLargo(ratDe.periodo)}`}
          dirty saving={saving} saveLabel="Ratificar"
          onSave={ratificar} onClose={() => setRatDe(null)}
        >
          <p className="hint" style={{ marginBottom: 8 }}>
            Mete las cifras definitivas que envía Iberian. El 85% cedido se reparte entre las dos sociedades.
          </p>
          <div className="field">
            <label>Comisión definitiva (100%)</label>
            <input type="number" step="0.01" value={defi} onChange={(e) => setDefi(e.target.value)} />
            <span className="hint">Estimada del Premium: {eur(ratDe.comision_premium)}</span>
          </div>
          <div className="field">
            <label>Reparto del 85% cedido — esperado: {eur(cedidaEsperada)}</label>
          </div>
          <div className="field">
            <label>Iberian Insurance Broker, S.L.</label>
            <input type="number" step="0.01" value={p1} onChange={(e) => setP1(e.target.value)} />
          </div>
          <div className="field">
            <label>Hauora Brokerage, S.L. <span className="hint">(desaparecerá)</span></label>
            <input type="number" step="0.01" value={p2} onChange={(e) => setP2(e.target.value)} />
          </div>
          {(p1 || p2) && (
            <div className={`hint${Math.abs(sumaReparto - cedidaEsperada) > 0.01 ? " error" : ""}`}>
              Suma del reparto: {eur(sumaReparto)} {Math.abs(sumaReparto - cedidaEsperada) > 0.01
                ? `(no cuadra con el 85% = ${eur(cedidaEsperada)})` : "✓"}
            </div>
          )}
        </FormPanel>
      )}
    </div>
  );
}
