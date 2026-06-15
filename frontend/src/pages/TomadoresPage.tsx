import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Tomador, TomadorWrite } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";

const api = crud<Tomador, TomadorWrite>("/tomadores");

const TIPOS = ["Persona física", "Persona jurídica"];

type FormState = {
  id?: number;
  nombre: string;
  alias: string;
  tipo: string;
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
  alias: "",
  tipo: "",
  cif: "",
  domicilio: "",
  codigo_postal: "",
  localidad: "",
  provincia: "",
  pais: "",
  notas: "",
};

export default function TomadoresPage() {
  const [items, setItems] = useState<Tomador[]>([]);
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

  function abrirEdicion(t: Tomador) {
    abrir({
      id: t.id,
      nombre: t.nombre,
      alias: t.alias ?? "",
      tipo: t.tipo ?? "",
      cif: t.cif ?? "",
      domicilio: t.domicilio ?? "",
      codigo_postal: t.codigo_postal ?? "",
      localidad: t.localidad ?? "",
      provincia: t.provincia ?? "",
      pais: t.pais ?? "",
      notas: t.notas ?? "",
    });
  }

  async function guardar() {
    if (!form) return;
    const obligatorios: [keyof FormState, string][] = [
      ["nombre", "El nombre es obligatorio."],
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

    setSaving(true);
    setError(null);
    const payload: TomadorWrite = {
      nombre: form.nombre.trim(),
      alias: form.alias.trim() || null,
      tipo: form.tipo,
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

  async function borrar(t: Tomador) {
    if (!confirm(`¿Borrar el tomador "${t.nombre}"?`)) return;
    try {
      await api.remove(t.id);
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
          placeholder="Buscar por nombre, CIF o alias…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-secondary" onClick={() => cargar()}>
          Buscar
        </button>
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nuevo tomador
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay tomadores. Crea el primero con «+ Nuevo tomador».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Alias</th>
              <th>Tipo</th>
              <th>CIF</th>
              <th>Localidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.nombre}</td>
                <td>{t.alias ?? "—"}</td>
                <td>{t.tipo ?? "—"}</td>
                <td>{t.cif ?? "—"}</td>
                <td>{t.localidad ?? "—"}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(t)}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(t)}>
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
          title={form.id ? "Editar tomador" : "Nuevo tomador"}
          dirty={dirty}
          saving={saving}
          onSave={guardar}
          onClose={cerrar}
        >
          {campo("Nombre", "nombre", true)}
          {campo("Alias", "alias")}

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
