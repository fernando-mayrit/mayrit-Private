import { useState } from "react";
import { crud, buscarCp } from "../api";
import type { Tomador, TomadorWrite } from "../types";
import FormPanel from "./FormPanel";
import OptionButtons from "./OptionButtons";
import { PAISES } from "../data/paises";

const api = crud<Tomador, TomadorWrite>("/tomadores");

const TIPOS = ["Persona física", "Persona jurídica", "Otros"];

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
  nombre: "", tipo: "", pais: "España", cif: "", domicilio: "",
  codigo_postal: "", localidad: "", provincia: "", notas: "",
};

function desde(t: Tomador | null): FormState {
  if (!t) return { ...VACIO };
  return {
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
  };
}

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

export default function TomadorForm({
  initial,
  onSaved,
  onClose,
  onDeleted,
  escEnabled,
}: {
  initial: Tomador | null;
  onSaved: (t: Tomador) => void;
  onClose: () => void;
  onDeleted?: (id: number) => void;
  escEnabled?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => desde(initial));
  const [inicial] = useState<FormState>(() => desde(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localidadesCP, setLocalidadesCP] = useState<string[]>([]);

  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);
  const esEspana = form.pais === "España";

  async function onCp(cp: string) {
    setForm((f) => ({ ...f, codigo_postal: cp }));
    if (form.pais === "España" && /^\d{5}$/.test(cp)) {
      try {
        const r = await buscarCp(cp);
        const locs = [...new Set(r.resultados.map((x) => x.localidad))];
        const provs = [...new Set(r.resultados.map((x) => x.provincia))];
        setLocalidadesCP(locs);
        setForm((f) => ({ ...f, codigo_postal: cp, provincia: provs[0] ?? "", localidad: locs.length === 1 ? locs[0] : "" }));
      } catch {
        setLocalidadesCP([]);
      }
    } else {
      setLocalidadesCP([]);
    }
  }

  async function guardar() {
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
      if (!String(form[campo] ?? "").trim()) return setError(msg);
    }
    if (esEspana) {
      if (form.tipo === "Persona jurídica" && !/^[A-Z]-\d{8}$/.test(form.cif))
        return setError("El CIF (persona jurídica) debe tener el formato X-00000000.");
      if (form.tipo === "Persona física" && !/^\d{8}-[A-Z]$/.test(form.cif))
        return setError("El NIF (persona física) debe tener el formato 00000000-X.");
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
    if (!confirm(`¿Borrar el tomador "${form.nombre}"?`)) return;
    try {
      await api.remove(form.id);
      onDeleted?.(form.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function campo(label: string, key: keyof FormState, req = false) {
    return (
      <div className="field">
        <label>{label} {req && <span className="required">*</span>}</label>
        <input type="text" value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      </div>
    );
  }

  const cifPlaceholder = !esEspana
    ? "Identificación fiscal"
    : form.tipo === "Persona jurídica"
    ? "X-00000000"
    : form.tipo === "Persona física"
    ? "00000000-X"
    : form.tipo === "Otros"
    ? "Identificación fiscal (libre)"
    : "Elige antes el tipo";

  return (
    <FormPanel
      title={form.id ? "Editar Tomador" : "Nuevo Tomador"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={form.id && onDeleted ? borrarActual : undefined}
      escEnabled={escEnabled}
    >
      {campo("Nombre", "nombre", true)}

      <div className="field">
        <label>Tipo <span className="required">*</span></label>
        <OptionButtons
          value={form.tipo}
          options={TIPOS}
          onChange={(v) => setForm({ ...form, tipo: v, cif: formateaCif(form.cif, form.pais, v) })}
        />
      </div>

      <div className="field">
        <label>País <span className="required">*</span></label>
        <select
          value={form.pais}
          onChange={(e) => {
            setLocalidadesCP([]);
            setForm({ ...form, pais: e.target.value, cif: formateaCif(form.cif, e.target.value, form.tipo) });
          }}
        >
          {PAISES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="field">
        <label>CIF / NIF <span className="required">*</span></label>
        <input
          type="text"
          value={form.cif}
          placeholder={cifPlaceholder}
          onChange={(e) => setForm({ ...form, cif: formateaCif(e.target.value, form.pais, form.tipo) })}
        />
      </div>

      {campo("Domicilio", "domicilio", true)}

      <div className="field">
        <label>Código postal <span className="required">*</span></label>
        <input type="text" value={form.codigo_postal} onChange={(e) => onCp(e.target.value)} />
      </div>

      <div className="field">
        <label>Localidad <span className="required">*</span></label>
        {esEspana ? (
          <select value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })}>
            <option value="">
              {localidadesCP.length || form.localidad ? "— Elige localidad —" : "— Escribe antes el código postal —"}
            </option>
            {[...new Set([...(form.localidad ? [form.localidad] : []), ...localidadesCP])].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        ) : (
          <input type="text" value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} />
        )}
      </div>

      <div className="field">
        <label>Provincia <span className="required">*</span></label>
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
  );
}
