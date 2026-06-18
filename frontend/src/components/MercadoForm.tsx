import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Mercado, MercadoWrite, Ramo } from "../types";
import FormPanel from "./FormPanel";
import OptionButtons from "./OptionButtons";

const api = crud<Mercado, MercadoWrite>("/mercados");
const ramosApi = crud<Ramo, { nombre: string }>("/ramos");

const TIPOS_MERCADO = ["Lloyds", "Compañía", "Agencia de Suscripción", "Otros"];

type FormState = {
  id?: number;
  nombre: string;
  alias: string;
  tipo_mercado: string;
  toba: boolean;
  fecha: string;
  activa: boolean;
  ramos: string[];
  notas: string;
};

const VACIO: FormState = {
  nombre: "", alias: "", tipo_mercado: "", toba: false, fecha: "", activa: true, ramos: [], notas: "",
};

function desde(m: Mercado | null): FormState {
  if (!m) return { ...VACIO };
  return {
    id: m.id,
    nombre: m.nombre,
    alias: m.alias ?? "",
    tipo_mercado: m.tipo_mercado ?? "",
    toba: m.toba,
    fecha: m.fecha ?? "",
    activa: m.activa,
    ramos: m.ramos ?? [],
    notas: m.notas ?? "",
  };
}

export default function MercadoForm({
  initial,
  onSaved,
  onClose,
  onDeleted,
  escEnabled,
}: {
  initial: Mercado | null;
  onSaved: (m: Mercado) => void;
  onClose: () => void;
  onDeleted?: (id: number) => void;
  escEnabled?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => desde(initial));
  const [inicial] = useState<FormState>(() => desde(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ramosCat, setRamosCat] = useState<Ramo[]>([]);

  useEffect(() => {
    ramosApi.list(undefined, 5000).then(setRamosCat).catch(() => {});
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);
  const toggleRamo = (nombre: string) =>
    setForm((f) => ({
      ...f,
      ramos: f.ramos.includes(nombre) ? f.ramos.filter((r) => r !== nombre) : [...f.ramos, nombre],
    }));

  async function guardar() {
    if (!form.nombre.trim()) return setError("El nombre es obligatorio.");
    if (!form.alias.trim()) return setError("El alias es obligatorio.");
    if (!form.tipo_mercado.trim()) return setError("El tipo de mercado es obligatorio.");
    if (form.ramos.length === 0) return setError("Marca al menos un ramo que trabaja este mercado.");
    setSaving(true);
    setError(null);
    const payload: MercadoWrite = {
      nombre: form.nombre.trim(),
      alias: form.alias.trim(),
      tipo_mercado: form.tipo_mercado,
      toba: !!form.toba,
      fecha: form.toba ? form.fecha || null : null,
      activa: form.activa !== false,
      ramos: form.ramos,
      notas: form.notas.trim() || null,
    };
    try {
      const saved = form.id ? await api.update(form.id, payload) : await api.create(payload);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrarActual() {
    if (!form.id) return;
    if (!confirm(`¿Borrar el mercado "${form.nombre}"?`)) return;
    try {
      await api.remove(form.id);
      onDeleted?.(form.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <FormPanel
      title={form.id ? "Editar Mercado" : "Nuevo Mercado"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={form.id && onDeleted ? borrarActual : undefined}
      escEnabled={escEnabled}
    >
      <div className="field">
        <label>Nombre <span className="required">*</span></label>
        <input type="text" value={form.nombre} autoFocus onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
      </div>
      <div className="field">
        <label>Alias <span className="required">*</span></label>
        <input type="text" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
      </div>
      <div className="field">
        <label>Tipo de mercado <span className="required">*</span></label>
        <OptionButtons
          value={form.tipo_mercado}
          options={TIPOS_MERCADO}
          onChange={(v) => setForm({ ...form, tipo_mercado: v })}
          vertical
        />
      </div>
      <div className="field">
        <div className="toba-row">
          <label className="check-inline">
            <input
              type="checkbox"
              checked={!!form.toba}
              onChange={(e) => setForm({ ...form, toba: e.target.checked, fecha: e.target.checked ? form.fecha : "" })}
            />
            TOBA
          </label>
          {form.toba && (
            <div className="fecha-inline">
              <label htmlFor="toba-fecha">Fecha</label>
              <input id="toba-fecha" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </div>
          )}
        </div>
      </div>
      <label className="check-inline" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.activa !== false} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
        Activo (desmárcalo para que deje de aparecer en listados y desplegables)
      </label>
      <div className="field">
        <label>Ramos que trabaja <span className="required">*</span></label>
        <div className="ramos-check">
          {ramosCat.length === 0 ? (
            <span className="hint">No hay ramos en el catálogo.</span>
          ) : (
            ramosCat.map((r) => (
              <label key={r.id} className="check-inline" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={form.ramos.includes(r.nombre)} onChange={() => toggleRamo(r.nombre)} />
                {r.nombre}
              </label>
            ))
          )}
        </div>
      </div>
      <div className="field">
        <label>Notas</label>
        <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
      </div>
    </FormPanel>
  );
}
