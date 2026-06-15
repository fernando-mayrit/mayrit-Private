import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Mercado, MercadoWrite } from "../types";
import FormPanel from "../components/FormPanel";

const api = crud<Mercado, MercadoWrite>("/mercados");

type FormState = MercadoWrite & { id?: number };

const VACIO: FormState = {
  nombre: "",
  codigo: "",
  tipo_mercado: "",
  mercado: "",
  risk: "",
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

  useEffect(() => {
    cargar("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      codigo: m.codigo ?? "",
      tipo_mercado: m.tipo_mercado ?? "",
      mercado: m.mercado ?? "",
      risk: m.risk ?? "",
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
    setSaving(true);
    setError(null);
    const payload: MercadoWrite = {
      nombre: form.nombre.trim(),
      codigo: form.codigo?.trim() || null,
      tipo_mercado: form.tipo_mercado?.trim() || null,
      mercado: form.mercado?.trim() || null,
      risk: form.risk?.trim() || null,
      toba: !!form.toba,
      fecha: form.fecha || null,
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

  async function borrar(m: Mercado) {
    if (!confirm(`¿Borrar el mercado "${m.nombre}"?`)) return;
    try {
      await api.remove(m.id);
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
          placeholder="Buscar por nombre o código…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-secondary" onClick={() => cargar()}>
          Buscar
        </button>
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
              <th>Código</th>
              <th>Tipo</th>
              <th>Risk</th>
              <th>TOBA</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}</td>
                <td>{m.codigo ?? "—"}</td>
                <td>{m.tipo_mercado ?? "—"}</td>
                <td>{m.risk ?? "—"}</td>
                <td>{m.toba ? <span className="badge si">Sí</span> : <span className="badge">No</span>}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(m)}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(m)}>
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
          title={form.id ? "Editar mercado" : "Nuevo mercado"}
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
          <div className="field">
            <label>Código</label>
            <input type="text" value={form.codigo ?? ""} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
          </div>
          <div className="field">
            <label>Tipo de mercado</label>
            <input
              type="text"
              value={form.tipo_mercado ?? ""}
              onChange={(e) => setForm({ ...form, tipo_mercado: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Mercado (agrupador)</label>
            <input type="text" value={form.mercado ?? ""} onChange={(e) => setForm({ ...form, mercado: e.target.value })} />
          </div>
          <div className="field">
            <label>Risk</label>
            <input type="text" value={form.risk ?? ""} onChange={(e) => setForm({ ...form, risk: e.target.value })} />
          </div>
          <div className="field check">
            <input
              type="checkbox"
              id="toba"
              checked={!!form.toba}
              onChange={(e) => setForm({ ...form, toba: e.target.checked })}
            />
            <label htmlFor="toba">TOBA</label>
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={form.fecha ?? ""} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
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
