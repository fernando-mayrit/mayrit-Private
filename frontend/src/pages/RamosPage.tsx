import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Ramo } from "../types";
import FormPanel from "../components/FormPanel";

const api = crud<Ramo, { nombre: string }>("/ramos");

type FormState = { id?: number; nombre: string };
const VACIO: FormState = { nombre: "" };

export default function RamosPage() {
  const [items, setItems] = useState<Ramo[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(inicial);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.list(search || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function abrir(estado: FormState) {
    setForm(estado);
    setInicial(estado);
    setError(null);
  }
  function cerrar() {
    setForm(null);
    setInicial(null);
  }

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (form.id) await api.update(form.id, { nombre: form.nombre.trim() });
      else await api.create({ nombre: form.nombre.trim() });
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrar(r: Ramo) {
    if (!confirm(`¿Borrar el ramo "${r.nombre}"?`)) return;
    try {
      await api.remove(r.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar ramo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-secondary" onClick={() => cargar()}>
          Buscar
        </button>
        <button className="btn-primary" onClick={() => abrir({ ...VACIO })}>
          + Nuevo ramo
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay ramos. Crea el primero con «+ Nuevo ramo».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ramo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrir({ id: r.id, nombre: r.nombre })}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(r)}>
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <FormPanel
          title={form.id ? "Editar Ramo" : "Nuevo Ramo"}
          dirty={dirty}
          saving={saving}
          onSave={guardar}
          onClose={cerrar}
        >
          <div className="field">
            <label>
              Nombre <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.nombre}
              autoFocus
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
