import { useEffect, useState } from "react";
import { polizasApi } from "../api";
import type { PolizaEmitir, EmisionPreview } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import OptionButtons from "./OptionButtons";
import { fmtMiles, fmtFechaES } from "../format";

// Etiqueta de pago ↔ nº de plazos.
const PLAZOS: { label: string; n: number }[] = [
  { label: "Único", n: 1 },
  { label: "Dos Pagos", n: 2 },
  { label: "Tres Pagos", n: 3 },
  { label: "Cuatro Pagos", n: 4 },
];

type FormState = {
  numero_poliza: string;
  referencia: string;
  asegurado: string;
  corredor: string;
  ramo: string;
  mercado: string;
  produccion: string;
  seguro: string; // "1" directo / "2" reaseguro
  moneda: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  capacidad: string;
  prima_neta: string;
  impuestos_porc: string;
  recargos: string;
  comision_cedida_porc: string;
  comision_retenida_porc: string;
  n_plazos: number;
  notas: string;
};

const VACIO: FormState = {
  numero_poliza: "", referencia: "", asegurado: "", corredor: "", ramo: "", mercado: "",
  produccion: "", seguro: "1", moneda: "EUR", fecha_efecto: "", fecha_vencimiento: "",
  capacidad: "1", prima_neta: "", impuestos_porc: "", recargos: "",
  comision_cedida_porc: "", comision_retenida_porc: "", n_plazos: 1, notas: "",
};

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Construye el payload de emisión a partir del formulario.
function payloadDe(f: FormState): PolizaEmitir {
  return {
    numero_poliza: f.numero_poliza.trim() || null,
    referencia: f.referencia.trim() || null,
    asegurado: f.asegurado.trim() || null,
    corredor: f.corredor.trim() || null,
    ramo: f.ramo.trim() || null,
    mercado: f.mercado.trim() || null,
    produccion: f.produccion.trim() || null,
    seguro: f.seguro || null,
    moneda: f.moneda || null,
    fecha_efecto: f.fecha_efecto || null,
    fecha_vencimiento: f.fecha_vencimiento || null,
    capacidad: f.capacidad ? num(f.capacidad) : null,
    prima_neta: f.prima_neta ? num(f.prima_neta) : null,
    impuestos_porc: f.impuestos_porc ? num(f.impuestos_porc) : null,
    recargos: f.recargos ? num(f.recargos) : null,
    comision_cedida_porc: f.comision_cedida_porc ? num(f.comision_cedida_porc) : null,
    comision_retenida_porc: f.comision_retenida_porc ? num(f.comision_retenida_porc) : null,
    n_plazos: f.n_plazos,
    notas: f.notas.trim() || null,
  };
}

const eur = (v: unknown) => fmtMiles(v);

export default function EmisionPolizaForm({
  onEmitida,
  onClose,
}: {
  onEmitida: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...VACIO });
  const [preview, setPreview] = useState<EmisionPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(VACIO);
  const listoParaEmitir = !!form.fecha_efecto && num(form.prima_neta) > 0;

  // Vista previa en vivo de los recibos (con pequeño retardo para no saturar).
  useEffect(() => {
    if (!listoParaEmitir) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setPreview(await polizasApi.emitirPreview(payloadDe(form)));
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.prima_neta, form.capacidad, form.impuestos_porc, form.recargos,
    form.comision_cedida_porc, form.comision_retenida_porc, form.n_plazos,
    form.fecha_efecto, form.fecha_vencimiento,
  ]);

  async function emitir() {
    if (!form.fecha_efecto) return setError("La fecha de efecto es obligatoria.");
    if (num(form.prima_neta) <= 0) return setError("La prima neta es obligatoria.");
    setSaving(true);
    setError(null);
    try {
      await polizasApi.emitir(payloadDe(form));
      onEmitida();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const comisionTotalPct = num(form.comision_cedida_porc) + num(form.comision_retenida_porc);

  return (
    <FormPanel
      title="Emitir Póliza"
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={emitir}
      saveLabel="Emitir"
      saveDisabled={!listoParaEmitir}
      onClose={onClose}
      wide
    >
      <div className="field">
        <label>Asegurado</label>
        <input type="text" value={form.asegurado} autoFocus onChange={(e) => set("asegurado", e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Nº Póliza</label>
          <input type="text" value={form.numero_poliza} onChange={(e) => set("numero_poliza", e.target.value)} />
        </div>
        <div className="field">
          <label>Referencia</label>
          <input type="text" value={form.referencia} onChange={(e) => set("referencia", e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Corredor</label>
        <input type="text" value={form.corredor} onChange={(e) => set("corredor", e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Ramo</label>
          <input type="text" value={form.ramo} onChange={(e) => set("ramo", e.target.value)} />
        </div>
        <div className="field">
          <label>Mercado</label>
          <input type="text" value={form.mercado} onChange={(e) => set("mercado", e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Seguro</label>
        <OptionButtons
          value={form.seguro === "2" ? "Reaseguro" : "Seguro Directo"}
          options={["Seguro Directo", "Reaseguro"]}
          onChange={(v) => set("seguro", v === "Reaseguro" ? "2" : "1")}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Fecha Efecto <span className="required">*</span></label>
          <input type="date" className="inp-fecha" value={form.fecha_efecto} onChange={(e) => set("fecha_efecto", e.target.value)} />
        </div>
        <div className="field">
          <label>Fecha Vto.</label>
          <input type="date" className="inp-fecha" value={form.fecha_vencimiento} onChange={(e) => set("fecha_vencimiento", e.target.value)} />
        </div>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8 }}>Importes</h3>
      <div className="field-row">
        <div className="field">
          <label>Prima Neta <span className="required">*</span></label>
          <NumberInput value={form.prima_neta} onChange={(v) => set("prima_neta", v)} />
        </div>
        <div className="field">
          <label>Capacidad (participación)</label>
          <NumberInput value={form.capacidad} onChange={(v) => set("capacidad", v)} decimals={4} thousands={false} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Impuestos %</label>
          <NumberInput value={form.impuestos_porc} onChange={(v) => set("impuestos_porc", v)} suffix="%" thousands={false} />
        </div>
        <div className="field">
          <label>Recargos</label>
          <NumberInput value={form.recargos} onChange={(v) => set("recargos", v)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Comisión cedida % (corredor)</label>
          <NumberInput value={form.comision_cedida_porc} onChange={(v) => set("comision_cedida_porc", v)} suffix="%" thousands={false} />
        </div>
        <div className="field">
          <label>Comisión retenida % (Mayrit)</label>
          <NumberInput value={form.comision_retenida_porc} onChange={(v) => set("comision_retenida_porc", v)} suffix="%" thousands={false} />
        </div>
      </div>
      <div className="field">
        <label>Comisión total %</label>
        <div className="calc-box">{fmtMiles(comisionTotalPct, 4, false)} %</div>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8 }}>Emisión de recibos</h3>
      <div className="field">
        <label>Pago</label>
        <OptionButtons
          value={PLAZOS.find((p) => p.n === form.n_plazos)?.label ?? "Único"}
          options={PLAZOS.map((p) => p.label)}
          onChange={(v) => set("n_plazos", PLAZOS.find((p) => p.label === v)?.n ?? 1)}
        />
      </div>

      {!listoParaEmitir ? (
        <div className="hint" style={{ marginTop: 8 }}>
          Indica <b>fecha de efecto</b> y <b>prima neta</b> para ver los recibos a generar.
        </div>
      ) : preview ? (
        <div className="emision-preview">
          <table className="compacto">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th className="num">Prima Neta</th>
                <th className="num">Impuestos</th>
                <th className="num">Prima Bruta</th>
                <th className="num">Cedida</th>
                <th className="num">Retenida</th>
                <th className="num">Adeudada</th>
                <th className="num">A liquidar</th>
              </tr>
            </thead>
            <tbody>
              {preview.lineas.map((l) => (
                <tr key={l.recibo_num}>
                  <td>{l.recibo_num}/{l.recibos_totales}</td>
                  <td>{fmtFechaES(l.fecha_efecto_recibo)}</td>
                  <td className="num">{eur(l.prima_neta_recibo)}</td>
                  <td className="num">{eur(l.impuestos_recibo)}</td>
                  <td className="num">{eur(l.prima_bruta_recibo)}</td>
                  <td className="num">{eur(l.comision_cedida)}</td>
                  <td className="num">{eur(l.comision_retenida)}</td>
                  <td className="num">{eur(l.prima_adeudada)}</td>
                  <td className="num">{eur(l.liquidar)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><b>Total</b></td>
                <td className="num"><b>{eur(preview.prima_participacion)}</b></td>
                <td className="num"><b>{eur(preview.impuestos)}</b></td>
                <td className="num"><b>{eur(preview.prima_total)}</b></td>
                <td className="num" colSpan={2}><b>{eur(preview.comision_total)}</b></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div className="hint" style={{ marginTop: 6 }}>
            Se generarán <b>{preview.lineas.length}</b> recibo(s) ({preview.pago}) al emitir.
          </div>
        </div>
      ) : (
        <div className="loading">Calculando recibos…</div>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label>Notas</label>
        <textarea rows={2} value={form.notas} onChange={(e) => set("notas", e.target.value)} />
      </div>
    </FormPanel>
  );
}
