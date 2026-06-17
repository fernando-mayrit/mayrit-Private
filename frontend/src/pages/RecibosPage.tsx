import { useEffect, useState } from "react";
import { recibosApi } from "../api";
import type { Recibo } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";
import OptionButtons from "../components/OptionButtons";
import NumberInput from "../components/NumberInput";
import { fmtMiles, fmtFechaES, estadoCobro } from "../format";

// El cobro real se deriva de cobrado vs importe; el estado manual solo marca Emitido/Anulado.
const ESTADOS = ["Emitido", "Anulado"];

const eur = (v: unknown) => `${fmtMiles(v)} €`;
// 'YYYY-MM' → 'MM/YYYY'
const periodoFmt = (p: string) => {
  const [y, m] = p.split("-");
  return m && y ? `${m}/${y}` : p;
};

type FormState = {
  id: number;
  estado: string;
  cobrado: string;
  fecha_emision: string;
  fecha_cobro: string;
  notas: string;
};

export default function RecibosPage() {
  const [items, setItems] = useState<Recibo[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sel, setSel] = useState<Recibo | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(inicial);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await recibosApi.listar(search ? { q: search } : undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Búsqueda en vivo (pequeño retardo).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrir(r: Recibo) {
    const estado: FormState = {
      id: r.id,
      estado: r.estado,
      cobrado: r.cobrado ?? "0",
      fecha_emision: r.fecha_emision ?? "",
      fecha_cobro: r.fecha_cobro ?? "",
      notas: r.notas ?? "",
    };
    setSel(r);
    setForm(estado);
    setInicial(estado);
    setError(null);
  }
  function cerrar() {
    setSel(null);
    setForm(null);
    setInicial(null);
  }

  async function guardar() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await recibosApi.editar(form.id, {
        estado: form.estado,
        cobrado: form.cobrado || "0",
        fecha_emision: form.fecha_emision || null,
        fecha_cobro: form.fecha_cobro || null,
        notas: form.notas.trim() || null,
      });
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrarActual() {
    if (!form) return;
    if (!confirm(`¿Borrar el recibo ${sel?.numero}? Se desenlazarán sus líneas del BDX.`)) return;
    try {
      await recibosApi.borrar(form.id);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalImporte = items.reduce((a, r) => a + Number(r.importe || 0), 0);

  return (
    <div className="container">
      <PageHeader emoji="🧾" title="Recibos" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por número o contraparte…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="hint">
          {items.length} recibo(s) · Comisión total: <b>{eur(totalImporte)}</b>
        </span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          No hay recibos. Se generan desde la ficha del binder (pestaña Datos → «Generar recibo» de un Risk BDX).
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Binder (UMR)</th>
              <th>Risk BDX</th>
              <th>Contraparte</th>
              <th className="num">Comisión</th>
              <th className="num">Cobrado</th>
              <th className="num">Pendiente</th>
              <th>Cobro</th>
              <th>Emisión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const ec = estadoCobro(r.importe, r.cobrado, r.estado);
              const pend = (Number(r.importe) || 0) - (Number(r.cobrado) || 0);
              return (
              <tr key={r.id}>
                <td><b>{r.numero}</b></td>
                <td>{r.binder_umr ?? `Binder ${r.binder_id}`}</td>
                <td>{periodoFmt(r.periodo)}</td>
                <td>{r.contraparte ?? "—"}</td>
                <td className="num">{eur(r.importe)}</td>
                <td className="num">{eur(r.cobrado)}</td>
                <td className="num">{eur(pend)}</td>
                <td><span className={`pill pill-${ec.clase}`}>{ec.label}</span></td>
                <td>{fmtFechaES(r.fecha_emision)}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrir(r)}>
                    Abrir
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {form && sel && (
        <FormPanel
          title={`Recibo ${sel.numero}`}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
          onDelete={borrarActual}
        >
          <div className="hint" style={{ marginBottom: 12 }}>
            Comisión de Mayrit del Risk BDX <b>{periodoFmt(sel.periodo)}</b> del binder{" "}
            <b>{sel.binder_umr ?? sel.binder_id}</b>. Importe = Σ Brokerage de {sel.num_lineas ?? 0} línea(s),
            exento de impuestos.
          </div>

          <div className="campos-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="field">
              <label>Base comisión (Σ Brokerage)</label>
              <input type="text" value={eur(sel.base_comision)} disabled />
            </div>
            <div className="field">
              <label>Importe a cobrar</label>
              <input type="text" value={eur(sel.importe)} disabled />
            </div>
            <div className="field">
              <label>Contraparte (mercado/s)</label>
              <input type="text" value={sel.contraparte ?? "—"} disabled />
            </div>
            <div className="field">
              <label>Moneda</label>
              <input type="text" value={sel.moneda ?? "EUR"} disabled />
            </div>
          </div>

          <div className="campos-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="field">
              <label>Cobrado (parcial)</label>
              <NumberInput value={form.cobrado} onChange={(v) => setForm({ ...form, cobrado: v })} suffix="€" />
            </div>
            <div className="field">
              <label>Pendiente</label>
              <input
                type="text"
                value={eur((Number(sel.importe) || 0) - (Number(form.cobrado) || 0))}
                disabled
              />
            </div>
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            {(() => {
              const ec = estadoCobro(sel.importe, form.cobrado, form.estado);
              return <>Estado de cobro: <span className={`pill pill-${ec.clase}`}>{ec.label}</span>. El cobro llega con los Premium BDX (rara vez coinciden con el Risk BDX), por eso puede ser parcial.</>;
            })()}
          </div>

          <div className="field">
            <label>Estado</label>
            <OptionButtons
              value={form.estado}
              options={ESTADOS}
              onChange={(v) => setForm({ ...form, estado: v })}
            />
          </div>
          <div className="campos-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="field">
              <label>Fecha de emisión</label>
              <input
                type="date"
                className="inp-fecha"
                value={form.fecha_emision}
                onChange={(e) => setForm({ ...form, fecha_emision: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Fecha de cobro</label>
              <input
                type="date"
                className="inp-fecha"
                value={form.fecha_cobro}
                onChange={(e) => setForm({ ...form, fecha_cobro: e.target.value })}
              />
            </div>
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
