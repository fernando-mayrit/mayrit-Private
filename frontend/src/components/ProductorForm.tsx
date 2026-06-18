import { useState } from "react";
import { crud, buscarCp } from "../api";
import type { Productor, ProductorWrite } from "../types";
import FormPanel from "./FormPanel";
import OptionButtons from "./OptionButtons";
import { PAISES } from "../data/paises";

const api = crud<Productor, ProductorWrite>("/productores");

const TIPOS = ["Corredor", "Agencia de Suscripción"];
const PERSONAS = ["Persona física", "Persona jurídica"];

type FormState = {
  id?: number;
  nombre: string;
  alias: string;
  tipo: string;
  pais: string;
  persona: string;
  activa: boolean;
  cif: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  provincia: string;
  notas: string;
};

const VACIO: FormState = {
  nombre: "", alias: "", tipo: "", pais: "España", persona: "", activa: true,
  cif: "", domicilio: "", codigo_postal: "", localidad: "", provincia: "", notas: "",
};

function desde(p: Productor | null): FormState {
  if (!p) return { ...VACIO };
  return {
    id: p.id,
    nombre: p.nombre,
    alias: p.alias ?? "",
    tipo: p.tipo ?? "",
    pais: p.pais ?? "España",
    persona: p.persona ?? "",
    activa: p.activa !== false,
    cif: p.cif ?? "",
    domicilio: p.domicilio ?? "",
    codigo_postal: p.codigo_postal ?? "",
    localidad: p.localidad ?? "",
    provincia: p.provincia ?? "",
    notas: p.notas ?? "",
  };
}

// Máscara del CIF/NIF: solo para España. Jurídica → X-00000000; Física → 00000000-X. Extranjero: libre.
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

export default function ProductorForm({
  initial,
  onSaved,
  onClose,
  onDeleted,
  escEnabled,
}: {
  initial: Productor | null;
  onSaved: (p: Productor) => void;
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
      ["alias", "El alias es obligatorio."],
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
      if (!String(form[campo] ?? "").trim()) return setError(msg);
    }
    if (esEspana) {
      if (form.persona === "Persona jurídica" && !/^[A-Z]-\d{8}$/.test(form.cif))
        return setError("El CIF (persona jurídica) debe tener el formato X-00000000.");
      if (form.persona === "Persona física" && !/^\d{8}-[A-Z]$/.test(form.cif))
        return setError("El NIF (persona física) debe tener el formato 00000000-X.");
    }
    setSaving(true);
    setError(null);
    const payload: ProductorWrite = {
      nombre: form.nombre.trim(),
      alias: form.alias.trim(),
      tipo: form.tipo,
      pais: form.pais,
      persona: form.persona,
      activa: form.activa !== false,
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
    if (!confirm(`¿Borrar el productor "${form.nombre}"?`)) return;
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
    : form.persona === "Persona jurídica"
    ? "X-00000000"
    : form.persona === "Persona física"
    ? "00000000-X"
    : "Elige antes Física/Jurídica";

  return (
    <FormPanel
      title={form.id ? "Editar Productor" : "Nuevo Productor"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={form.id && onDeleted ? borrarActual : undefined}
      escEnabled={escEnabled}
    >
      {campo("Nombre", "nombre", true)}
      {campo("Alias", "alias", true)}

      <div className="field">
        <label>Tipo <span className="required">*</span></label>
        <OptionButtons value={form.tipo} options={TIPOS} onChange={(v) => setForm({ ...form, tipo: v })} />
      </div>

      <div className="field">
        <label>País <span className="required">*</span></label>
        <select
          value={form.pais}
          onChange={(e) => {
            setLocalidadesCP([]);
            setForm({ ...form, pais: e.target.value, cif: formateaCif(form.cif, e.target.value, form.persona) });
          }}
        >
          {PAISES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Persona <span className="required">*</span></label>
        <OptionButtons
          value={form.persona}
          options={PERSONAS}
          onChange={(v) => setForm({ ...form, persona: v, cif: formateaCif(form.cif, form.pais, v) })}
        />
      </div>

      <div className="field">
        <label>CIF / NIF <span className="required">*</span></label>
        <input
          type="text"
          value={form.cif}
          placeholder={cifPlaceholder}
          onChange={(e) => setForm({ ...form, cif: formateaCif(e.target.value, form.pais, form.persona) })}
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

      <label className="check-inline" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.activa !== false} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
        Activo (desmárcalo para que deje de aparecer en listados y desplegables)
      </label>

      <div className="field">
        <label>Notas</label>
        <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
      </div>
    </FormPanel>
  );
}
