import { useEffect, useMemo, useState } from "react";
import { comisionesApi, type MesComision } from "../api";
import { fmtMiles } from "../format";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import NumberInput from "../components/NumberInput";

// Comisiones — liquidación mensual. Fuente Iberian: la comisión (coverholder) del Premium del programa
// Iberian-RC Profesional. Se PREPARA el recibo (estimado del Premium) y queda pendiente de RATIFICAR
// cuando Iberian envía la comisión definitiva y el reparto del 85% cedido entre sus dos sociedades.

// Formato único de la app (miles con punto, decimales con coma). Intl con es-ES no agrupa los
// números de 4 cifras (1234 -> "1234"), por eso usamos fmtMiles.
const eur = (v: number | string | null | undefined) => `${fmtMiles(v)} €`;
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
  function abrirReparto(m: MesComision) {
    setRatDe(m);
    setDefi("");   // vacío: la comisión es 10% del GWP; solo se teclea si Iberian la ajusta
    setP1(m.pago1_importe != null ? String(num(m.pago1_importe)) : "");
    setP2(m.pago2_importe != null ? String(num(m.pago2_importe)) : "");
  }
  // Cedida esperada (85%): por la comisión tecleada (si se ajusta) o la del mes.
  const cedidaEsperada = useMemo(() => (defi ? num(defi) * 0.85 : num(ratDe?.cedida ?? 0)), [defi, ratDe]);
  const sumaReparto = useMemo(() => num(p1) + num(p2), [p1, p2]);

  async function repartir() {
    if (!ratDe) return;
    setSaving(true); setError(null);
    try {
      await comisionesApi.reparto(ratDe.periodo, {
        pago1_importe: p1 ? num(p1) : null,
        pago2_importe: p2 ? num(p2) : null,
        comision_definitiva: defi ? num(defi) : null,
      });
      setRatDe(null);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const PILL: Record<string, string> = { Emitido: "pill-anulado", Preparado: "pill-parcial", Ratificado: "pill-cobrado" };

  return (
    <div className="container lista-page">
      <PageHeader emoji="💶" title="Comisiones" />
      <p className="hint" style={{ marginBottom: 8 }}>
        <b>Iberian</b> · programa <b>Iberian-RC Profesional</b>. Comisión = <b>10%</b> del GWP (our line) del
        Premium del mes; de ahí <b>8,5% cedida</b> (85%) y <b>1,5% retenida</b> (15%). El <b>reparto del 8,5%</b>
        entre Iberian Insurance Broker y Hauora se mete a mano cada mes (lo indica Iberian al liquidar).
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
            <th>Reparto cedida</th>
            <th>Recibo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m) => {
            const conReparto = m.pago1_importe != null || m.pago2_importe != null;
            return (
            <tr key={m.periodo}>
              <td>{mesLargo(m.periodo)}</td>
              <td className="num">{eur(m.base_prima)}</td>
              <td className="num">{eur(m.comision ?? m.comision_premium)}{m.recibo_numero ? "" : <span className="hint"> (est.)</span>}</td>
              <td className="num">{m.cedida != null ? eur(m.cedida) : "—"}</td>
              <td className="num">{m.retenida != null ? eur(m.retenida) : "—"}</td>
              <td>{m.estado ? <span className={`pill ${PILL[m.estado] ?? "pill-anulado"}`}>{m.estado}</span> : "—"}</td>
              <td style={{ fontSize: 12 }}>
                {conReparto
                  ? <>
                      {m.pago1_nombre?.split(",")[0]}: <b>{eur(m.pago1_importe)}</b>
                      {m.pago2_importe != null && <> · {m.pago2_nombre?.split(",")[0]}: <b>{eur(m.pago2_importe)}</b></>}
                    </>
                  : "—"}
              </td>
              <td>{m.recibo_numero ?? "—"}</td>
              <td className="acciones" style={{ whiteSpace: "nowrap" }}>
                {!m.recibo_numero
                  ? <button className="btn-primary btn-sm" disabled={busy === m.periodo} onClick={() => preparar(m.periodo)}>
                      {busy === m.periodo ? "…" : "Preparar"}
                    </button>
                  : <>
                      <button className="btn-primary btn-sm" onClick={() => abrirReparto(m)}>{conReparto ? "Reparto ✓" : "Reparto"}</button>
                      {m.liq_id && <>{" · "}<button className="btn-link btn-sm" disabled={busy === m.periodo} onClick={() => borrar(m)}>Borrar</button></>}
                    </>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {ratDe && (
        <FormPanel
          title={`Reparto cedida — ${mesLargo(ratDe.periodo)}`}
          dirty saving={saving} saveLabel="Guardar reparto"
          onSave={repartir} onClose={() => setRatDe(null)}
        >
          <p className="hint" style={{ marginBottom: 8 }}>
            Reparte el <b>8,5% cedido</b> (85% de la comisión) entre las dos sociedades, según lo que indique Iberian.
          </p>
          <div className="field">
            <label>Comisión del mes</label>
            <div className="ci-val" style={{ fontSize: 16 }}>{eur(ratDe.comision ?? ratDe.comision_premium)}</div>
            <span className="hint">Cedida 8,5% (85%) = <b>{eur(cedidaEsperada)}</b></span>
          </div>
          <div className="field">
            <label>Iberian Insurance Broker, S.L.</label>
            <NumberInput value={p1} onChange={setP1} decimals={2} suffix="€" />
          </div>
          <div className="field">
            <label>Hauora Brokerage, S.L. <span className="hint">(desaparecerá)</span></label>
            <NumberInput value={p2} onChange={setP2} decimals={2} suffix="€" />
          </div>
          {(p1 || p2) && (
            <div className={`hint${Math.abs(sumaReparto - cedidaEsperada) > 0.01 ? " error" : ""}`}>
              Suma del reparto: {eur(sumaReparto)} {Math.abs(sumaReparto - cedidaEsperada) > 0.01
                ? `(no cuadra con el 85% = ${eur(cedidaEsperada)})` : "✓"}
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label>Comisión definitiva <span className="hint">(opcional, solo si Iberian la ajusta; en blanco = 10% del GWP)</span></label>
            <NumberInput value={defi} onChange={setDefi} decimals={2} suffix="€"
              placeholder={fmtMiles(num(ratDe.comision ?? ratDe.comision_premium))} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
