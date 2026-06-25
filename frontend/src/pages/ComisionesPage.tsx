import { useEffect, useMemo, useState, type ReactNode } from "react";
import { comisionesApi, type MesComision } from "../api";
import { fmtMiles } from "../format";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import NumberInput from "../components/NumberInput";
import ConfirmDialog from "../components/ConfirmDialog";

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

  // Ratificación
  const [ratDe, setRatDe] = useState<MesComision | null>(null);
  const [defi, setDefi] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmar, setConfirmar] = useState<{ titulo: string; mensaje: ReactNode; accion: () => void } | null>(null);

  async function cargar() {
    try { setMeses(await comisionesApi.iberian()); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { cargar(); }, []);

  // El borrado se hace DESDE la edición y siempre con confirmación (ConfirmDialog).
  function pedirBorrar(m: MesComision) {
    setConfirmar({
      titulo: "Borrar el reparto",
      mensaje: <>Vas a borrar el reparto de <b>{mesLargo(m.periodo)}</b> (y, si el recibo lo creó este módulo, también el recibo). Esta acción no se puede deshacer.</>,
      accion: async () => {
        setConfirmar(null);
        if (!m.liq_id) return;
        setSaving(true); setError(null);
        try { await comisionesApi.borrar(m.liq_id); setRatDe(null); await cargar(); }
        catch (e) { setError((e as Error).message); } finally { setSaving(false); }
      },
    });
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
  // Al teclear una sociedad, la otra se autocompleta con la diferencia hasta la cedida (editable).
  const resto = (v: string) => { const r = cedidaEsperada - num(v); return r > 0 ? r.toFixed(2) : "0"; };
  const setIberian = (v: string) => { setP1(v); setP2(resto(v)); };
  const setHauora = (v: string) => { setP2(v); setP1(resto(v)); };

  async function repartir() {
    if (!ratDe) return;
    // El recibo se puede generar AUNQUE no tengamos todavía el desglose Iberian/Hauora (a veces lo
    // envían más tarde): en ese caso queda «Pendiente Reparto» y salta un aviso verde.
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

  const PILL: Record<string, string> = {
    Emitido: "pill-anulado", Preparado: "pill-parcial",
    "Pendiente Reparto": "pill-parcial", Ratificado: "pill-cobrado",
  };

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
              <td style={{ textAlign: "center" }}>
                {conReparto
                  ? <span className="pill pill-cobrado" title="Reparto registrado">✓</span>
                  : m.recibo_numero
                    ? <span className="pill pill-parcial" title="Recibo generado; falta el desglose Iberian/Hauora">Pendiente</span>
                    : "—"}
              </td>
              <td title={m.recibos && m.recibos.length > 1 ? `Recibos del mes: ${m.recibos.join(", ")}` : undefined}
                  style={m.recibos && m.recibos.length > 1 ? { cursor: "help", textDecoration: "underline dotted" } : undefined}>
                {m.recibo_numero ?? "—"}
              </td>
              <td className="acciones" style={{ whiteSpace: "nowrap" }}>
                {!m.recibo_numero
                  ? <button className="btn-primary btn-sm" onClick={() => abrirReparto(m)}>Preparar</button>
                  : conReparto
                    ? <button className="btn-link btn-sm" onClick={() => abrirReparto(m)}>Editar</button>
                    : <button className="btn-primary btn-sm" onClick={() => abrirReparto(m)}>Reparto</button>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {ratDe && (
        <FormPanel
          title={`${ratDe.liq_id ? "Editar reparto" : !ratDe.recibo_numero ? "Preparar recibo" : "Reparto cedida"} — ${mesLargo(ratDe.periodo)}`}
          dirty saving={saving} saveLabel={!ratDe.recibo_numero ? "Generar recibo" : "Guardar reparto"}
          onSave={repartir} onClose={() => setRatDe(null)}
          onDelete={ratDe.liq_id ? () => pedirBorrar(ratDe) : undefined}
        >
          <p className="hint" style={{ marginBottom: 8 }}>
            Reparte el <b>8,5% cedido</b> (85% de la comisión) entre las dos sociedades, según lo que indique Iberian.
            {!ratDe.recibo_numero && <> Al guardar se <b>genera el recibo</b> de este mes.</>}
            {" "}Si aún no tienes el desglose de Iberian, <b>déjalo en blanco</b>: el recibo se genera igual y el mes
            queda <b>«Pendiente Reparto»</b> (con un aviso verde) hasta que lo completes.
          </p>
          <div className="field">
            <label>Comisión del mes</label>
            <div className="ci-val" style={{ fontSize: 16 }}>{eur(ratDe.comision ?? ratDe.comision_premium)}</div>
            <span className="hint">Cedida 8,5% (85%) = <b>{eur(cedidaEsperada)}</b></span>
          </div>
          <div className="field">
            <label>Iberian Insurance Broker, S.L.</label>
            <NumberInput value={p1} onChange={setIberian} decimals={2} suffix="€" />
          </div>
          <div className="field">
            <label>Hauora Brokerage, S.L. <span className="hint">(desaparecerá)</span></label>
            <NumberInput value={p2} onChange={setHauora} decimals={2} suffix="€" />
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

      {confirmar && (
        <ConfirmDialog
          titulo={confirmar.titulo}
          mensaje={confirmar.mensaje}
          detalle="Se borrará la liquidación de comisión de este mes."
          confirmLabel="Borrar"
          onConfirm={confirmar.accion}
          onClose={() => setConfirmar(null)}
        />
      )}
    </div>
  );
}
