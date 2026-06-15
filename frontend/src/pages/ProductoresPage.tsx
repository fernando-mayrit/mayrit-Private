import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Productor, ProductorWrite } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";
import { PAISES } from "../data/paises";

const api = crud<Productor, ProductorWrite>("/productores");

const TIPOS = ["Corredor", "Agencia de Suscripción"];
const PERSONAS = ["Persona física", "Persona jurídica"];

type FormState = {
  id?: number;
  nombre: string;
  codigo: string;
  tipo: string;
  pais: string;
  persona: string;
  cif: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  provincia: string;
  notas: string;
};

const VACIO: FormState = {
  nombre: "",
  codigo: "",
  tipo: "",
  pais: "España",
  persona: "",
  cif: "",
  domicilio: "",
  codigo_postal: "",
  localidad: "",
  provincia: "",
  notas: "",
};

// Máscara del CIF/NIF: solo para España. Jurídica → X-00000000; Física → 00000000-X.
// Para el extranjero, se deja tal cual (campo libre).
function formateaCif(raw: string, pais: string, persona: string): string {
  if (pais !== "España") return raw;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (persona === "Persona jurídica") {
    const letra = s.match(/[A-Z]/)?.[0] ?? "";
    const nums = s.replace(/[^0-9]/g, "").slice(0, 8);
    if (!letra) return nums;
    return nums ? `${letra}-${nums}` : letra;
  }
  if (persona === "Persona física") {
    const nums = s.replace(/[^0-9]/g, "").slice(0, 8);
    const letra = s.replace(/[^A-Z]/g, "").slice(-1);
    if (!letra) return nums;
    return `${nums}-${letra}`;
  }
  return raw;
}

export default function ProductoresPage() {
  const [items, setItems] = useState<Productor[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(inicial);
  const esEspana = form?.pais === "España";

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
      pais: p.pais ?? "España",
      persona: p.persona ?? "",
      cif: p.cif ?? "",
      domicilio: p.domicilio ?? "",
      codigo_postal: p.codigo_postal ?? "",
      localidad: p.localidad ?? "",
      provincia: p.provincia ?? "",
      notas: p.notas ?? "",
    });
  }

  async function guardar() {
    if (!form) return;
    const obligatorios: [keyof FormState, string][] = [
      ["nombre", "El nombre es obligatorio."],
      ["codigo", "El código es obligatorio."],
      ["tipo", "El tipo es obligatorio."],
      ["pais", "El país es obligatorio."],
      ["persona", "Indica si es persona física o jurídica."],
      ["cif", "El CIF/NIF es obligatorio."],
      ["domicilio", "El domicilio es obligatorio."],
      ["codigo_postal", "El código postal es obligatorio."],
      ["localidad", "La localidad es obligatoria."],
      ["provincia", "La provincia es obligatoria."],
    ];
    for (const [campo, msg] of obligatorios) {
      if (!String(form[campo] ?? "").trim()) {
        setError(msg);
        return;
      }
    }
    if (esEspana) {
      if (form.persona === "Persona jurídica" && !/^[A-Z]-\d{8}$/.test(form.cif)) {
        setError("El CIF (persona jurídica) debe tener el formato X-00000000.");
        return;
      }
      if (form.persona === "Persona física" && !/^\d{8}-[A-Z]$/.test(form.cif)) {
        setError("El NIF (persona física) debe tener el formato 00000000-X.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    const payload: ProductorWrite = {
      nombre: form.nombre.trim(),
      codigo: form.codigo.trim(),
      tipo: form.tipo,
      pais: form.pais,
      persona: form.persona,
      cif: form.cif.trim(),
      domicilio: form.domicilio.trim(),
      codigo_postal: form.codigo_postal.trim(),
      localidad: form.localidad.trim(),
      provincia: form.provincia.trim(),
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

  const cifPlaceholder = !esEspana
    ? "Identificación fiscal"
    : form?.persona === "Persona jurídica"
    ? "X-00000000"
    : form?.persona === "Persona física"
    ? "00000000-X"
    : "Elige antes Física/Jurídica";

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
              <th>País</th>
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
                <td>{p.pais ?? "—"}</td>
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
              País <span className="required">*</span>
            </label>
            <select
              value={form.pais}
              onChange={(e) => setForm({ ...form, pais: e.target.value, cif: formateaCif(form.cif, e.target.value, form.persona) })}
            >
              {PAISES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>
              Persona <span className="required">*</span>
            </label>
            <OptionButtons
              value={form.persona}
              options={PERSONAS}
              onChange={(v) => setForm({ ...form, persona: v, cif: formateaCif(form.cif, form.pais, v) })}
              vertical
            />
          </div>

          <div className="field">
            <label>
              CIF / NIF <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.cif}
              placeholder={cifPlaceholder}
              onChange={(e) => setForm({ ...form, cif: formateaCif(e.target.value, form.pais, form.persona) })}
            />
          </div>

          {campo("Domicilio", "domicilio", true)}
          {campo("Código postal", "codigo_postal", true)}
          {campo("Localidad", "localidad", true)}
          {campo("Provincia", "provincia", true)}

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
