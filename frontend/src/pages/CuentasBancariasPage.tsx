import { useState, useEffect } from "react";
import { crud } from "../api";
import type { CuentaBancaria, CuentaBancariaWrite } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";

const api = crud<CuentaBancaria, CuentaBancariaWrite>("/cuentas-bancarias");

type FormState = {
  id?: number;
  nombre: string;
  categoria: string;
  banco: string;
  iban: string;
  swift_bic: string;
  moneda: string;
  notas: string;
  activa: boolean;
};

const CATEGORIAS = ["Primas", "Gastos", "Siniestros"];

const VACIO: FormState = {
  nombre: "",
  categoria: "",
  banco: "",
  iban: "",
  swift_bic: "",
  moneda: "EUR",
  notas: "",
  activa: true,
};

// IBAN: mayúsculas, solo alfanumérico, en bloques de 4 (formato habitual de impresión).
function formateaIban(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 34);
  return s.replace(/(.{4})/g, "$1 ").trim();
}
// Validación ISO 13616 (mod 97) para no teclear un IBAN erróneo.
function ibanValido(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) || s.length < 15 || s.length > 34) return false;
  const reordenado = s.slice(4) + s.slice(0, 4);
  const expandido = reordenado.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let resto = 0;
  for (const c of expandido) resto = (resto * 10 + (c.charCodeAt(0) - 48)) % 97;
  return resto === 1;
}

export default function CuentasBancariasPage() {
  const [items, setItems] = useState<CuentaBancaria[]>([]);
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
    abrir({ ...VACIO });
  }
  function abrirEdicion(c: CuentaBancaria) {
    abrir({
      id: c.id,
      nombre: c.nombre,
      categoria: c.categoria ?? "",
      banco: c.banco ?? "",
      iban: c.iban ? formateaIban(c.iban) : "",
      swift_bic: c.swift_bic ?? "",
      moneda: c.moneda ?? "EUR",
      notas: c.notas ?? "",
      activa: c.activa,
    });
  }

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) return setError("El nombre de la cuenta es obligatorio.");
    if (!form.categoria) return setError("La categoría es obligatoria.");
    if (!form.banco.trim()) return setError("El banco es obligatorio.");
    const ibanLimpio = form.iban.replace(/\s/g, "").toUpperCase();
    if (!ibanLimpio) return setError("El IBAN es obligatorio.");
    if (!ibanValido(ibanLimpio)) return setError("El IBAN no es válido (revisa los dígitos).");
    if (!form.swift_bic.trim()) return setError("El SWIFT / BIC es obligatorio.");
    if (!form.moneda.trim()) return setError("La moneda es obligatoria.");

    setSaving(true);
    setError(null);
    const payload: CuentaBancariaWrite = {
      nombre: form.nombre.trim(),
      categoria: form.categoria || null,
      banco: form.banco.trim() || null,
      iban: ibanLimpio || null,
      swift_bic: form.swift_bic.trim().toUpperCase() || null,
      moneda: form.moneda.trim() || null,
      notas: form.notas.trim() || null,
      activa: form.activa,
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
    if (!confirm(`¿Borrar la cuenta "${form.nombre}"?`)) return;
    try {
      await api.remove(form.id);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function campo(label: string, key: keyof FormState, req = false, upper = false) {
    return (
      <div className="field">
        <label>
          {label} {req && <span className="required">*</span>}
        </label>
        <input
          type="text"
          value={String(form![key] ?? "")}
          style={upper ? { textTransform: "uppercase" } : undefined}
          onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div className="container compacto">
      <PageHeader emoji="🏧" title="Cuentas Bancarias" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, banco o IBAN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nueva cuenta
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay cuentas bancarias. Crea la primera con «+ Nueva cuenta».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Banco</th>
              <th>IBAN</th>
              <th>Moneda</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} style={c.activa ? undefined : { opacity: 0.55 }}>
                <td>{c.nombre}</td>
                <td>{c.categoria ?? "—"}</td>
                <td>{c.banco ?? "—"}</td>
                <td>{c.iban ?? "—"}</td>
                <td>{c.moneda ?? "—"}</td>
                <td>{c.activa ? "Activa" : "Inactiva"}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(c)}>
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
          title={form.id ? "Editar Cuenta Bancaria" : "Nueva Cuenta Bancaria"}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
          onDelete={form.id ? borrarActual : undefined}
        >
          {campo("Nombre", "nombre", true)}
          <div className="field">
            <label>
              Categoría <span className="required">*</span>
            </label>
            <select
              value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
            >
              <option value="">— Elige categoría —</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {campo("Banco", "banco", true)}
          <div className="field">
            <label>
              IBAN <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.iban}
              placeholder="ES91 2100 0418 4502 0005 1332"
              style={{ textTransform: "uppercase" }}
              onChange={(e) => setForm({ ...form, iban: formateaIban(e.target.value) })}
            />
          </div>
          {campo("SWIFT / BIC", "swift_bic", true, true)}
          {campo("Moneda", "moneda", true)}
          <div className="field">
            <label className="check-inline">
              <input
                type="checkbox"
                checked={form.activa}
                onChange={(e) => setForm({ ...form, activa: e.target.checked })}
              />
              Cuenta activa
            </label>
            <span className="hint">Si se desactiva, no se podrá elegir en binders ni en ningún otro sitio.</span>
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
