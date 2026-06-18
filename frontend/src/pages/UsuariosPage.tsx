import { useEffect, useState } from "react";
import { usuariosApi } from "../api";
import type { Usuario } from "../types";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";

export default function UsuariosPage() {
  const [items, setItems] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Usuario | "nuevo" | null>(null);
  const [nombre, setNombre] = useState("");
  const [activa, setActiva] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setItems(await usuariosApi.list(undefined, 5000));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function abrir(u: Usuario | "nuevo") {
    setEditing(u);
    setNombre(u === "nuevo" ? "" : u.nombre);
    setActiva(u === "nuevo" ? true : u.activa);
    setFormError(null);
  }

  async function guardar() {
    if (!nombre.trim()) return setFormError("El nombre es obligatorio.");
    setSaving(true);
    setFormError(null);
    try {
      if (editing && editing !== "nuevo") await usuariosApi.update(editing.id, { nombre: nombre.trim(), activa });
      else await usuariosApi.create({ nombre: nombre.trim(), activa });
      setEditing(null);
      cargar();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrar() {
    if (!editing || editing === "nuevo") return;
    if (!confirm(`¿Borrar el usuario "${editing.nombre}"?`)) return;
    try {
      await usuariosApi.remove(editing.id);
      setEditing(null);
      cargar();
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  const dirty = editing
    ? editing === "nuevo"
      ? nombre.trim() !== ""
      : nombre !== editing.nombre || activa !== editing.activa
    : false;

  return (
    <div className="container">
      <PageHeader emoji="👤" title="Usuarios" />
      <div className="toolbar">
        <button className="btn-primary" onClick={() => abrir("nuevo")}>
          + Nuevo usuario
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay usuarios. Crea el primero con «+ Nuevo usuario».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} style={u.activa ? undefined : { opacity: 0.55 }}>
                <td>{u.nombre}</td>
                <td>
                  {u.activa ? (
                    <span className="pill pill-cobrado">Activo</span>
                  ) : (
                    <span className="pill pill-anulado">Inactivo</span>
                  )}
                </td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrir(u)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <FormPanel
          title={editing === "nuevo" ? "Nuevo Usuario" : "Editar Usuario"}
          dirty={dirty}
          saving={saving}
          error={formError}
          onSave={guardar}
          onClose={() => setEditing(null)}
          onDelete={editing !== "nuevo" ? borrar : undefined}
        >
          <div className="field">
            <label>
              Nombre <span className="required">*</span>
            </label>
            <input type="text" value={nombre} autoFocus onChange={(e) => setNombre(e.target.value)} />
          </div>
          <label className="check-inline" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            Activo (desmárcalo para que deje de aparecer en el selector de usuario)
          </label>
        </FormPanel>
      )}
    </div>
  );
}
