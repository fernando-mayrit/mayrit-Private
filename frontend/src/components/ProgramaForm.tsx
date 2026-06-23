import { useEffect, useState } from "react";
import { crud, bindersDePrograma } from "../api";
import type { Programa, ProgramaWrite, Productor, Binder } from "../types";
import FormPanel from "./FormPanel";
import { fmtFechaES } from "../format";

const api = crud<Programa, ProgramaWrite>("/programas");

type FormState = {
  id?: number;
  nombre: string;
  productor_id: string;
  notas: string;
  activa: boolean;
  impuestos_locales: boolean;
};

function desde(p: Programa | null, productorInicial?: number | null): FormState {
  if (!p) return { nombre: "", productor_id: productorInicial != null ? String(productorInicial) : "", notas: "", activa: true, impuestos_locales: false };
  return {
    id: p.id,
    nombre: p.nombre,
    productor_id: p.productor_id != null ? String(p.productor_id) : "",
    notas: p.notas ?? "",
    activa: p.activa,
    impuestos_locales: p.impuestos_locales,
  };
}

export default function ProgramaForm({
  initial,
  productores,
  productorInicial,
  onSaved,
  onClose,
  onDeleted,
  escEnabled,
}: {
  initial: Programa | null;
  productores: Productor[];
  productorInicial?: number | null; // agencia del binder (preselecciona en altas)
  onSaved: (p: Programa) => void;
  onClose: () => void;
  onDeleted?: (id: number) => void;
  escEnabled?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => desde(initial, productorInicial));
  const [inicial] = useState<FormState>(() => desde(initial, productorInicial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Binders que pertenecen a este programa (solo al editar uno existente).
  const [binders, setBinders] = useState<Binder[] | null>(null);

  useEffect(() => {
    if (!initial?.id) return;
    bindersDePrograma(initial.id)
      .then((bs) =>
        setBinders(
          [...bs].sort((a, b) => (a.fecha_efecto ?? "").localeCompare(b.fecha_efecto ?? ""))
        )
      )
      .catch(() => setBinders([]));
  }, [initial?.id]);

  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);

  async function guardar() {
    if (!form.nombre.trim()) return setError("El nombre del programa es obligatorio.");
    setSaving(true);
    setError(null);
    const payload: ProgramaWrite = {
      nombre: form.nombre.trim(),
      productor_id: form.productor_id ? Number(form.productor_id) : null,
      notas: form.notas.trim() || null,
      activa: form.activa !== false,
      impuestos_locales: form.impuestos_locales,
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
    if (!confirm(`¿Borrar el programa "${form.nombre}"?`)) return;
    try {
      await api.remove(form.id);
      onDeleted?.(form.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <FormPanel
      title={form.id ? "Editar Programa" : "Nuevo Programa"}
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
        <input
          type="text"
          value={form.nombre}
          autoFocus
          placeholder="p. ej. CROUCO-BEAZLEY"
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Agencia (coverholder)</label>
        <select value={form.productor_id} onChange={(e) => setForm({ ...form, productor_id: e.target.value })}>
          <option value="">— Sin asignar —</option>
          {productores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.alias ? `${p.nombre} (${p.alias})` : p.nombre}
            </option>
          ))}
        </select>
      </div>
      <label className="check-inline" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.activa !== false} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
        Activo (desmárcalo para que deje de aparecer en los desplegables)
      </label>
      <label className="check-inline" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.impuestos_locales} onChange={(e) => setForm({ ...form, impuestos_locales: e.target.checked })} />
        Impuestos liquidados localmente por la agencia (excluir impuestos de "A Liquidar" — p. ej. agencias italianas)
      </label>
      <div className="field">
        <label>Notas</label>
        <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
      </div>

      {form.id && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Binders del programa {binders ? `(${binders.length})` : ""}</label>
          {binders === null ? (
            <span className="hint">Cargando…</span>
          ) : binders.length === 0 ? (
            <span className="hint">Aún no hay binders asignados a este programa.</span>
          ) : (
            <div className="caja-listado">
              <table className="tabla-mini">
                <thead>
                  <tr>
                    <th>Binder</th>
                    <th>Efecto</th>
                    <th>Vencimiento</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {binders.map((b) => (
                    <tr key={b.id}>
                      <td>{b.umr || b.agreement_number || `#${b.id}`}</td>
                      <td>{fmtFechaES(b.fecha_efecto)}</td>
                      <td>{fmtFechaES(b.fecha_vencimiento)}</td>
                      <td>{b.estado ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </FormPanel>
  );
}
