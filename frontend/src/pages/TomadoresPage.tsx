import { useState, useEffect } from "react";
import { crud, buscarCp } from "../api";
import type { Tomador, TomadorWrite } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";
import { PAISES } from "../data/paises";

const api = crud<Tomador, TomadorWrite>("/tomadores");

const TIPOS = ["Persona física", "Persona jurídica"];

type FormState = {
  id?: number;
  nombre: string;
  tipo: string;
  pais: string;
  cif: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  provincia: string;
  notas: string;
};

const VACIO: FormState = {
  nombre: "",
  tipo: "",
  pais: "España",
  cif: "",
  domicilio: "",
  codigo_postal: "",
  localidad: "",
  provincia: "",
  notas: "",
};

// Máscara del CIF/NIF: solo España. Jurídica → X-00000000; Física → 00000000-X. Extranjero: libre.
function formateaCif(raw: string, pais: string, tipo: string): string {
  if (pais !== "España") return raw;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tipo === "Persona jurídica") {
    const letra = s.match(/[A-Z]/)?.[0] ?? "";
    const nums = s.replace(/[^0-9]/g, "").slice(0, 8);
    if (!letra) return nums;
    return nums ? `${letra}-${nums}` : letra;
  }
  if (tipo === "Persona física") {
    const nums = s.replace(/[^0-9]/g, "").slice(0, 8);
    const letra = s.replace(/[^A-Z]/g, "").slice(-1);
    if (!letra) return nums;
    return `${nums}-${letra}`;
  }
  return raw;
}

export default function TomadoresPage() {
  const [items, setItems] = useState<Tomador[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [localidadesCP, setLocalidadesCP] = useState<string[]>([]);

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
    setLocalidadesCP([]);
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
      tipo: t.tipo ?? "",
      pais: t.pais ?? "España",
      cif: t.cif ?? "",
      domicilio: t.domicilio ?? "",
      codigo_postal: t.codigo_postal ?? "",
      localidad: t.localidad ?? "",
      provincia: t.provincia ?? "",
      notas: t.notas ?? "",
    });
  }

  async function onCp(cp: string) {
    setForm((f) => (f ? { ...f, codigo_postal: cp } : f));
    if (form?.pais === "España" && /^\d{5}$/.test(cp)) {
      try {
        const r = await buscarCp(cp);
        const locs = [...new Set(r.resultados.map((x) => x.localidad))];
        const provs = [...new Set(r.resultados.map((x) => x.provincia))];
        setLocalidadesCP(locs);
        setForm((f) =>
          f ? { ...f, codigo_postal: cp, provincia: provs[0] ?? "", localidad: locs.length === 1 ? locs[0] : "" } : f
        );
      } catch {
        setLocalidadesCP([]);
      }
    } else {
      setLocalidadesCP([]);
    }
  }

  async function guardar() {
    if (!form) return;
    const obligatorios: [keyof FormState, string][] = [
      ["nombre", "El nombre es obligatorio."],
      ["tipo", "Indica si es persona física o jurídica."],
      ["pais", "El país es obligatorio."],
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
      if (form.tipo === "Persona jurídica" && !/^[A-Z]-\d{8}$/.test(form.cif)) {
        setError("El CIF (persona jurídica) debe tener el formato X-00000000.");
        return;
      }
      if (form.tipo === "Persona física" && !/^\d{8}-[A-Z]$/.test(form.cif)) {
        setError("El NIF (persona física) debe tener el formato 00000000-X.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    const payload: TomadorWrite = {
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      pais: form.pais,
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

  const cifPlaceholder = !esEspana
    ? "Identificación fiscal"
    : form?.tipo === "Persona jurídica"
    ? "X-00000000"
    : form?.tipo === "Persona física"
    ? "00000000-X"
    : "Elige antes Física/Jurídica";

  return (
    <div className="container">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o CIF…"
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
              <th>Tipo</th>
              <th>País</th>
              <th>CIF</th>
              <th>Localidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.nombre}</td>
                <td>{t.tipo ?? "—"}</td>
                <td>{t.pais ?? "—"}</td>
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
          title={form.id ? "Editar Tomador" : "Nuevo Tomador"}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
        >
          {campo("Nombre", "nombre", true)}

          <div className="field">
            <label>
              Tipo <span className="required">*</span>
            </label>
            <OptionButtons
              value={form.tipo}
              options={TIPOS}
              onChange={(v) => setForm({ ...form, tipo: v, cif: formateaCif(form.cif, form.pais, v) })}
            />
          </div>

          <div className="field">
            <label>
              País <span className="required">*</span>
            </label>
            <select
              value={form.pais}
              onChange={(e) => {
                setLocalidadesCP([]);
                setForm({ ...form, pais: e.target.value, cif: formateaCif(form.cif, e.target.value, form.tipo) });
              }}
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
              CIF / NIF <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.cif}
              placeholder={cifPlaceholder}
              onChange={(e) => setForm({ ...form, cif: formateaCif(e.target.value, form.pais, form.tipo) })}
            />
          </div>

          {campo("Domicilio", "domicilio", true)}

          <div className="field">
            <label>
              Código postal <span className="required">*</span>
            </label>
            <input type="text" value={form.codigo_postal} onChange={(e) => onCp(e.target.value)} />
          </div>

          <div className="field">
            <label>
              Localidad <span className="required">*</span>
            </label>
            {esEspana ? (
              <select value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })}>
                <option value="">
                  {localidadesCP.length || form.localidad ? "— Elige localidad —" : "— Escribe antes el código postal —"}
                </option>
                {[...new Set([...(form.localidad ? [form.localidad] : []), ...localidadesCP])].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.localidad}
                onChange={(e) => setForm({ ...form, localidad: e.target.value })}
              />
            )}
          </div>

          <div className="field">
            <label>
              Provincia <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.provincia}
              readOnly={esEspana}
              placeholder={esEspana ? "Se rellena con el código postal" : ""}
              onChange={(e) => setForm({ ...form, provincia: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
