import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Productor, ProductorWrite } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";

const api = crud<Productor, ProductorWrite>("/productores");

const TIPOS = ["Corredor", "Agencia de Suscripción"];

type FormState = {
  id?: number;
  nombre: string;
  codigo: string;
  tipo: string;
  es_coverholder: boolean | null;
  cif: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  provincia: string;
  pais: string;
  notas: string;
};

const VACIO: FormState = {
  nombre: "",
  codigo: "",
  tipo: "",
  es_coverholder: null,
  cif: "",
  domicilio: "",
  codigo_postal: "",
  localidad: "",
  provincia: "",
  pais: "",
  notas: "",
};

export default function ProductoresPage() {
  const [items, setItems] = useState<Productor[]>([]);
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

  function abrirNuevo() {
    abrir({ ...VACIO });
  }

  function abrirEdicion(p: Productor) {
    abrir({
      id: p.id,
      nombre: p.nombre,
      codigo: p.codigo ?? "",
      tipo: p.tipo ?? "",
      es_coverholder: p.es_coverholder,
      cif: p.cif ?? "",
      domicilio: p.domicilio ?? "",
      codigo_postal: p.codigo_postal ?? "",
      localidad: p.localidad ?? "",
      provincia: p.provincia ?? "",
      pais: p.pais ?? "",
      notas: p.notas ?? "",
    });
  }

  async function guardar() {
    if (!form) return;
    const obligatorios: [keyof FormState, string][] = [
      ["nombre", "El nombre es obligatorio."],
      ["codigo", "El código es obligatorio."],
      ["tipo", "El tipo es obligatorio."],
      ["cif", "El CIF es obligatorio."],
      ["domicilio", "El domicilio es obligatorio."],
      ["codigo_postal", "El código postal es obligatorio."],
      ["localidad", "La localidad es obligatoria."],
      ["provincia", "La provincia es obligatoria."],
      ["pais", "El país es obligatorio."],
    ];
    for (const [campo, msg] of obligatorios) {
      if (!String(form[campo] ?? "").trim()) {
        setError(msg);
        return;
      }
    }
    if (form.es_coverholder === null) {
      setError("Indica si es coverholder (Sí o No).");
      return;
    }

    setSaving(true);
    setError(null);
    const payload: ProductorWrite = {
      nombre: form.nombre.trim(),
      codigo: form.codigo.trim(),
      tipo: form.tipo,
      es_coverholder: form.es_coverholder,
      cif: form.cif.trim(),
      domicilio: form.domicilio.trim(),
      codigo_postal: form.codigo_postal.trim(),
      localidad: form.localidad.trim(),
      provincia: form.provincia.trim(),
      pais: form.pais.trim(),
      notas: form.notas.trim() || null,
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

  async function borrar(p: Productor) {
    if (!confirm(`¿Borrar el productor "${p.nombre}"?`)) return;
    try {
      await api.remove(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function campo(label: string, key: keyof FormState, req = false) {
    return (
      <div className="field">
        <label>
          {label} {req && <span className="required">*</span>}
        </label>
        <input
          type="text"
          value={String(form![key] ?? "")}
          onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, código o CIF…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-secondary" onClick={() => cargar()}>
          Buscar
        </button>
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nuevo productor
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay productores. Crea el primero con «+ Nuevo productor».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Tipo</th>
              <th>Coverholder</th>
              <th>Localidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.codigo ?? "—"}</td>
                <td>{p.tipo ?? "—"}</td>
                <td>
                  {p.es_coverholder ? <span className="badge si">Sí</span> : <span className="badge">No</span>}
                </td>
                <td>{p.localidad ?? "—"}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(p)}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(p)}>
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
          title={form.id ? "Editar productor" : "Nuevo productor"}
          dirty={dirty}
          saving={saving}
          onSave={guardar}
          onClose={cerrar}
        >
          {campo("Nombre", "nombre", true)}
          {campo("Código", "codigo", true)}

          <div className="field">
            <label>
              Tipo <span className="required">*</span>
            </label>
            <OptionButtons
              value={form.tipo}
              options={TIPOS}
              onChange={(v) => setForm({ ...form, tipo: v })}
              vertical
            />
          </div>

          <div className="field">
            <label>
              ¿Coverholder? <span className="required">*</span>
            </label>
            <OptionButtons
              value={form.es_coverholder === null ? "" : form.es_coverholder ? "Sí" : "No"}
              options={["Sí", "No"]}
              onChange={(v) => setForm({ ...form, es_coverholder: v === "Sí" })}
            />
          </div>

          {campo("CIF", "cif", true)}
          {campo("Domicilio", "domicilio", true)}
          {campo("Código postal", "codigo_postal", true)}
          {campo("Localidad", "localidad", true)}
          {campo("Provincia", "provincia", true)}
          {campo("País", "pais", true)}

          <div className="field">
            <label>Notas</label>
            <textarea
              rows={3}
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
            />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
