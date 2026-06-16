import { useState, useEffect } from "react";
import { crud } from "../api";
import type { CuentaBancaria, CuentaBancariaWrite } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";

const api = crud<CuentaBancaria, CuentaBancariaWrite>("/cuentas-bancarias");

type FormState = {
  id?: number;
  nombre: string;
  banco: string;
  iban: string;
  swift_bic: string;
  moneda: string;
  notas: string;
};

const VACIO: FormState = {
  nombre: "",
  banco: "",
  iban: "",
  swift_bic: "",
  moneda: "EUR",
  notas: "",
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
      banco: c.banco ?? "",
      iban: c.iban ? formateaIban(c.iban) : "",
      swift_bic: c.swift_bic ?? "",
      moneda: c.moneda ?? "EUR",
      notas: c.notas ?? "",
    });
  }

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) return setError("El nombre de la cuenta es obligatorio.");
    const ibanLimpio = form.iban.replace(/\s/g, "").toUpperCase();
    if (ibanLimpio && !ibanValido(ibanLimpio))
      return setError("El IBAN no es válido (revisa los dígitos).");

    setSaving(true);
    setError(null);
    const payload: CuentaBancariaWrite = {
      nombre: form.nombre.trim(),
      banco: form.banco.trim() || null,
      iban: ibanLimpio || null,
      swift_bic: form.swift_bic.trim().toUpperCase() || null,
      moneda: form.moneda.trim() || null,
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

  async function borrar(c: CuentaBancaria) {
    if (!confirm(`¿Borrar la cuenta "${c.nombre}"?`)) return;
    try {
      await api.remove(c.id);
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
              <th>Banco</th>
              <th>IBAN</th>
              <th>Moneda</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.banco ?? "—"}</td>
                <td>{c.iban ?? "—"}</td>
                <td>{c.moneda ?? "—"}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(c)}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(c)}>
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
          title={form.id ? "Editar Cuenta Bancaria" : "Nueva Cuenta Bancaria"}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
        >
          {campo("Nombre", "nombre", true)}
          {campo("Banco", "banco")}
          <div className="field">
            <label>IBAN</label>
            <input
              type="text"
              value={form.iban}
              placeholder="ES91 2100 0418 4502 0005 1332"
              style={{ textTransform: "uppercase" }}
              onChange={(e) => setForm({ ...form, iban: formateaIban(e.target.value) })}
            />
          </div>
          {campo("SWIFT / BIC", "swift_bic", false, true)}
          {campo("Moneda", "moneda")}
          <div className="field">
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
