import { useState } from "react";
import { polizasApi } from "../api";
import type { Poliza, PolizaWrite } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import OptionButtons from "./OptionButtons";
import { fmtMiles } from "../format";

const PAGOS = ["", "Único", "Fraccionado"];
const MONEDAS = ["EUR", "USD", "GBP"];

type FormState = {
  numero_poliza: string;
  referencia: string;
  asegurado: string;
  corredor: string;
  ramo: string;
  mercado: string;
  produccion: string;
  estado: string;
  seguro: string; // "1" directo / "2" reaseguro
  pago: string;
  moneda: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  renovacion_automatica: boolean;
  coaseguro: boolean;
  limite: string;
  franquicia: string;
  capacidad: string;
  prima_neta: string;
  impuestos_porc: string;
  recargos: string;
  comision_porc: string;
  notas: string;
};

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function s(v: unknown): string {
  return v == null ? "" : String(v);
}

function desde(p: Poliza | null): FormState {
  return {
    numero_poliza: s(p?.numero_poliza),
    referencia: s(p?.referencia),
    asegurado: s(p?.asegurado),
    corredor: s(p?.corredor),
    ramo: s(p?.ramo),
    mercado: s(p?.mercado),
    produccion: s(p?.produccion),
    estado: s(p?.estado),
    seguro: s(p?.seguro) || "1",
    pago: s(p?.pago),
    moneda: s(p?.moneda) || "EUR",
    fecha_efecto: s(p?.fecha_efecto).slice(0, 10),
    fecha_vencimiento: s(p?.fecha_vencimiento).slice(0, 10),
    renovacion_automatica: !!p?.renovacion_automatica,
    coaseguro: !!p?.coaseguro,
    limite: s(p?.limite),
    franquicia: s(p?.franquicia),
    capacidad: p?.capacidad != null ? s(p.capacidad) : "1",
    prima_neta: s(p?.prima_neta),
    impuestos_porc: s(p?.impuestos_porc),
    recargos: s(p?.recargos),
    comision_porc: s(p?.comision_porc),
    notas: s(p?.notas),
  };
}

export default function PolizaForm({
  poliza,
  onSaved,
  onClose,
  onDeleted,
}: {
  poliza: Poliza | null;
  onSaved: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => desde(poliza));
  const [inicial] = useState<FormState>(() => desde(poliza));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Campos calculados (en gris), sobre la Prima Participación.
  const primaPart = num(form.prima_neta) * num(form.capacidad);
  const impuestos = (primaPart * num(form.impuestos_porc)) / 100;
  const primaTotal = primaPart + impuestos + num(form.recargos);
  const comisionTotal = (primaPart * num(form.comision_porc)) / 100;

  async function guardar() {
    if (!form.asegurado.trim() && !form.numero_poliza.trim())
      return setError("Indica al menos el Asegurado o el Nº de Póliza.");
    setSaving(true);
    setError(null);
    const yoa = form.fecha_efecto ? Number(form.fecha_efecto.slice(0, 4)) : null;
    const payload: PolizaWrite = {
      numero_poliza: form.numero_poliza.trim() || null,
      referencia: form.referencia.trim() || null,
      asegurado: form.asegurado.trim() || null,
      corredor: form.corredor.trim() || null,
      ramo: form.ramo.trim() || null,
      mercado: form.mercado.trim() || null,
      produccion: form.produccion.trim() || null,
      estado: form.estado.trim() || null,
      seguro: form.seguro || null,
      pago: form.pago || null,
      moneda: form.moneda || null,
      fecha_efecto: form.fecha_efecto || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      yoa,
      renovacion_automatica: form.renovacion_automatica,
      coaseguro: form.coaseguro,
      limite: form.limite ? num(form.limite) : null,
      franquicia: form.franquicia ? num(form.franquicia) : null,
      capacidad: form.capacidad ? num(form.capacidad) : null,
      prima_neta: form.prima_neta ? num(form.prima_neta) : null,
      impuestos_porc: form.impuestos_porc ? num(form.impuestos_porc) : null,
      recargos: form.recargos ? num(form.recargos) : null,
      comision_porc: form.comision_porc ? num(form.comision_porc) : null,
      // calculados
      prima_participacion: round2(primaPart),
      impuestos: round2(impuestos),
      prima_total: round2(primaTotal),
      comision_total: round2(comisionTotal),
      notas: form.notas.trim() || null,
    };
    try {
      if (poliza) await polizasApi.editar(poliza.id, payload);
      else await polizasApi.crear(payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function borrar() {
    if (!poliza) return;
    if (!confirm(`¿Borrar la póliza ${poliza.numero_poliza ?? poliza.asegurado ?? ""}?`)) return;
    setSaving(true);
    try {
      await polizasApi.borrar(poliza.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <FormPanel
      title={poliza ? `Editar Póliza · ${poliza.numero_poliza ?? ""}` : "Nueva Póliza"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={poliza ? borrar : undefined}
    >
      <div className="field">
        <label>Referencia</label>
        <input type="text" value={form.referencia} onChange={(e) => set("referencia", e.target.value)} />
      </div>
      <div className="field">
        <label>Nº Póliza</label>
        <input type="text" value={form.numero_poliza} onChange={(e) => set("numero_poliza", e.target.value)} />
      </div>
      <div className="field">
        <label>Asegurado</label>
        <input type="text" value={form.asegurado} autoFocus onChange={(e) => set("asegurado", e.target.value)} />
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
      <div className="field-row">
        <div className="field">
          <label>Producción</label>
          <input type="text" value={form.produccion} onChange={(e) => set("produccion", e.target.value)} />
        </div>
        <div className="field">
          <label>Estado</label>
          <input type="text" value={form.estado} onChange={(e) => set("estado", e.target.value)} />
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
          <label>Fecha Efecto</label>
          <input type="date" className="inp-fecha" value={form.fecha_efecto} onChange={(e) => set("fecha_efecto", e.target.value)} />
        </div>
        <div className="field">
          <label>Fecha Vto.</label>
          <input type="date" className="inp-fecha" value={form.fecha_vencimiento} onChange={(e) => set("fecha_vencimiento", e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <label className="field check">
          <input type="checkbox" checked={form.renovacion_automatica} onChange={(e) => set("renovacion_automatica", e.target.checked)} />
          Renovación automática
        </label>
        <label className="field check">
          <input type="checkbox" checked={form.coaseguro} onChange={(e) => set("coaseguro", e.target.checked)} />
          Coaseguro
        </label>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Pago</label>
          <select value={form.pago} onChange={(e) => set("pago", e.target.value)}>
            {PAGOS.map((p) => <option key={p} value={p}>{p || "—"}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Moneda</label>
          <select value={form.moneda} onChange={(e) => set("moneda", e.target.value)}>
            {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8 }}>Importes</h3>
      <div className="field-row">
        <div className="field">
          <label>Límite 100%</label>
          <NumberInput value={form.limite} onChange={(v) => set("limite", v)} />
        </div>
        <div className="field">
          <label>Franquicia</label>
          <NumberInput value={form.franquicia} onChange={(v) => set("franquicia", v)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Prima Neta</label>
          <NumberInput value={form.prima_neta} onChange={(v) => set("prima_neta", v)} />
        </div>
        <div className="field">
          <label>Capacidad (participación)</label>
          <NumberInput value={form.capacidad} onChange={(v) => set("capacidad", v)} decimals={4} thousands={false} />
        </div>
      </div>
      <div className="field">
        <label>Prima Participación</label>
        <div className="calc-box">{fmtMiles(primaPart)}</div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Impuestos %</label>
          <NumberInput value={form.impuestos_porc} onChange={(v) => set("impuestos_porc", v)} suffix="%" thousands={false} />
        </div>
        <div className="field">
          <label>Impuestos</label>
          <div className="calc-box">{fmtMiles(impuestos)}</div>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Recargos</label>
          <NumberInput value={form.recargos} onChange={(v) => set("recargos", v)} />
        </div>
        <div className="field">
          <label>Prima Total</label>
          <div className="calc-box">{fmtMiles(primaTotal)}</div>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Comisión %</label>
          <NumberInput value={form.comision_porc} onChange={(v) => set("comision_porc", v)} suffix="%" thousands={false} />
        </div>
        <div className="field">
          <label>Comisión Total</label>
          <div className="calc-box">{fmtMiles(comisionTotal)}</div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Notas</label>
        <textarea rows={3} value={form.notas} onChange={(e) => set("notas", e.target.value)} />
      </div>
    </FormPanel>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
