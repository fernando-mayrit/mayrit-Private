import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Ramo, RamoWrite } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";

const api = crud<Ramo, RamoWrite>("/ramos");

type RCForm = { codigo: string; descripcion: string };
type FormState = { id?: number; nombre: string; risk_codes: RCForm[] };
const VACIO: FormState = { nombre: "", risk_codes: [] };

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

  // Búsqueda en vivo: filtra mientras se teclea (pequeño retardo para no saturar).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrir(estado: FormState) {
    setForm(estado);
    setInicial(estado);
    setError(null);
  }
  function cerrar() {
    setForm(null);
    setInicial(null);
  }
  function abrirNuevo() {
    abrir({ ...VACIO, risk_codes: [] });
  }
  function abrirEdicion(r: Ramo) {
    abrir({
      id: r.id,
      nombre: r.nombre,
      risk_codes: r.risk_codes.map((rc) => ({ codigo: rc.codigo, descripcion: rc.descripcion ?? "" })),
    });
  }

  function setRC(i: number, campo: keyof RCForm, valor: string) {
    if (!form) return;
    setForm({ ...form, risk_codes: form.risk_codes.map((rc, idx) => (idx === i ? { ...rc, [campo]: valor } : rc)) });
  }
  function addRC() {
    if (!form) return;
    setForm({ ...form, risk_codes: [...form.risk_codes, { codigo: "", descripcion: "" }] });
  }
  function removeRC(i: number) {
    if (!form) return;
    setForm({ ...form, risk_codes: form.risk_codes.filter((_, idx) => idx !== i) });
  }

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload: RamoWrite = {
      nombre: form.nombre.trim(),
      risk_codes: form.risk_codes
        .filter((rc) => rc.codigo.trim())
        .map((rc) => ({ codigo: rc.codigo.trim().toUpperCase(), descripcion: rc.descripcion.trim() || null })),
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
    if (!confirm(`¿Borrar el ramo "${form.nombre}"? (se borran también sus Risk Codes)`)) return;
    try {
      await api.remove(form.id);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container compacto">
      <PageHeader emoji="🏷️" title="Ramos" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar ramo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={abrirNuevo}>
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
              <th>Risk Codes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td>{r.risk_codes.length ? r.risk_codes.map((rc) => rc.codigo).join(", ") : "—"}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(r)}>
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
          title={form.id ? "Editar Ramo" : "Nuevo Ramo"}
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

          <label className="mini-label">Risk Codes</label>
          {form.risk_codes.map((rc, i) => (
            <div className="linea-mercado" key={i}>
              <input
                type="text"
                className="part"
                style={{ width: 90, textTransform: "uppercase" }}
                placeholder="Código"
                value={rc.codigo}
                onChange={(e) => setRC(i, "codigo", e.target.value)}
              />
              <input
                type="text"
                style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--borde)", borderRadius: 8, fontSize: 14 }}
                placeholder="Descripción (opcional)"
                value={rc.descripcion}
                onChange={(e) => setRC(i, "descripcion", e.target.value)}
              />
              <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeRC(i)}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn-primary btn-sm" onClick={addRC}>
            ➕ Añadir Risk Code
          </button>
        </FormPanel>
      )}
    </div>
  );
}
