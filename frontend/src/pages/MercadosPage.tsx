import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Mercado, MercadoWrite } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";
import OptionButtons from "../components/OptionButtons";

const api = crud<Mercado, MercadoWrite>("/mercados");

const TIPOS_MERCADO = ["Lloyds", "Compañía", "Agencia de Suscripción", "Otros"];

type FormState = MercadoWrite & { id?: number };

const VACIO: FormState = {
  nombre: "",
  alias: "",
  tipo_mercado: "",
  toba: false,
  fecha: "",
  notas: "",
};

export default function MercadosPage() {
  const [items, setItems] = useState<Mercado[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario: null = cerrado. `inicial` guarda el estado al abrir para detectar cambios.
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

  // Búsqueda en vivo: filtra mientras se teclea (pequeño retardo para no saturar).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrir(estado: FormState) {
    setForm(estado);
    setInicial(estado); // misma referencia/valor inicial: dirty = false hasta que se edite
    setError(null);
  }

  function cerrar() {
    setForm(null);
    setInicial(null);
  }

  function abrirNuevo() {
    abrir({ ...VACIO });
  }

  function abrirEdicion(m: Mercado) {
    abrir({
      id: m.id,
      nombre: m.nombre,
      alias: m.alias ?? "",
      tipo_mercado: m.tipo_mercado ?? "",
      toba: m.toba,
      fecha: m.fecha ?? "",
      notas: m.notas ?? "",
    });
  }

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!form.alias?.trim()) {
      setError("El alias es obligatorio.");
      return;
    }
    if (!form.tipo_mercado?.trim()) {
      setError("El tipo de mercado es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload: MercadoWrite = {
      nombre: form.nombre.trim(),
      alias: form.alias?.trim(),
      tipo_mercado: form.tipo_mercado,
      toba: !!form.toba,
      fecha: form.toba ? form.fecha || null : null,
      notas: form.notas?.trim() || null,
    };
    try {
      if (form.id) await api.update(form.id, payload);
      else await api.create(payload);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrarActual() {
    if (!form?.id) return;
    if (!confirm(`¿Borrar el mercado "${form.nombre}"?`)) return;
    try {
      await api.remove(form.id);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container">
      <PageHeader emoji="🏦" title="Mercados" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o alias…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nuevo mercado
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay mercados. Crea el primero con «+ Nuevo mercado».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Alias</th>
              <th>Tipo</th>
              <th>TOBA</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}</td>
                <td>{m.alias ?? "—"}</td>
                <td>{m.tipo_mercado ?? "—"}</td>
                <td>{m.toba ? <span className="badge si">Sí</span> : <span className="badge">No</span>}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(m)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <FormPanel
          title={form.id ? "Editar Mercado" : "Nuevo Mercado"}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
          onDelete={form.id ? borrarActual : undefined}
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
          <div className="field">
            <label>
              Alias <span className="required">*</span>
            </label>
            <input type="text" value={form.alias ?? ""} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
          </div>
          <div className="field">
            <label>
              Tipo de mercado <span className="required">*</span>
            </label>
            <OptionButtons
              value={form.tipo_mercado ?? ""}
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
                  onChange={(e) =>
                    setForm({ ...form, toba: e.target.checked, fecha: e.target.checked ? form.fecha : "" })
                  }
                />
                TOBA
              </label>
              {form.toba && (
                <div className="fecha-inline">
                  <label htmlFor="toba-fecha">Fecha</label>
                  <input
                    id="toba-fecha"
                    type="date"
                    value={form.fecha ?? ""}
                    onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea rows={3} value={form.notas ?? ""} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
