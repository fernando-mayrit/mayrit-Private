import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Binder, BinderWrite, Mercado, Productor } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";

const api = crud<Binder, BinderWrite>("/binders");
const apiProductores = crud<Productor, unknown>("/productores");
const apiMercados = crud<Mercado, unknown>("/mercados");

const ESTADOS = ["Activo", "Vencido", "Cancelado"];
const MONEDAS = ["EUR", "GBP", "USD"];

type LineaForm = { mercado_id: string; participacion: string };
type SeccionForm = { ramo: string; mercados: LineaForm[] };
type FormState = {
  id?: number;
  referencia: string;
  umr: string;
  agreement_number: string;
  productor_id: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  estado: string;
  moneda: string;
  comision: string;
  limite_primas: string;
  yoa: string;
  notas: string;
  secciones: SeccionForm[];
};

const SECCION_VACIA: SeccionForm = { ramo: "", mercados: [{ mercado_id: "", participacion: "" }] };

const VACIO: FormState = {
  referencia: "",
  umr: "",
  agreement_number: "",
  productor_id: "",
  fecha_efecto: "",
  fecha_vencimiento: "",
  estado: "",
  moneda: "",
  comision: "",
  limite_primas: "",
  yoa: "",
  notas: "",
  secciones: [{ ...SECCION_VACIA, mercados: [{ mercado_id: "", participacion: "" }] }],
};

function num(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export default function BindersPage() {
  const [items, setItems] = useState<Binder[]>([]);
  const [agencias, setAgencias] = useState<Productor[]>([]);
  const [mercados, setMercados] = useState<Mercado[]>([]);
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

  async function cargarRefs() {
    try {
      const [prod, merc] = await Promise.all([apiProductores.list(), apiMercados.list()]);
      setAgencias((prod as Productor[]).filter((p) => p.tipo === "Agencia de Suscripción"));
      setMercados(merc as Mercado[]);
    } catch {
      /* si fallan, los selectores quedan vacíos */
    }
  }

  useEffect(() => {
    cargar("");
    cargarRefs();
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
    abrir(JSON.parse(JSON.stringify(VACIO)));
  }
  function abrirEdicion(b: Binder) {
    abrir({
      id: b.id,
      referencia: b.referencia,
      umr: b.umr ?? "",
      agreement_number: b.agreement_number ?? "",
      productor_id: b.productor_id != null ? String(b.productor_id) : "",
      fecha_efecto: b.fecha_efecto ?? "",
      fecha_vencimiento: b.fecha_vencimiento ?? "",
      estado: b.estado ?? "",
      moneda: b.moneda ?? "",
      comision: b.comision != null ? String(b.comision) : "",
      limite_primas: b.limite_primas != null ? String(b.limite_primas) : "",
      yoa: b.yoa ?? "",
      notas: b.notas ?? "",
      secciones:
        b.secciones.length > 0
          ? b.secciones.map((s) => ({
              ramo: s.ramo ?? "",
              mercados:
                s.mercados.length > 0
                  ? s.mercados.map((m) => ({
                      mercado_id: String(m.mercado_id),
                      participacion: m.participacion != null ? String(m.participacion) : "",
                    }))
                  : [{ mercado_id: "", participacion: "" }],
            }))
          : [JSON.parse(JSON.stringify(SECCION_VACIA))],
    });
  }

  // ── edición de secciones/mercados (inmutable) ──
  function setSecciones(secs: SeccionForm[]) {
    setForm((f) => (f ? { ...f, secciones: secs } : f));
  }
  function addSeccion() {
    if (!form) return;
    setSecciones([...form.secciones, JSON.parse(JSON.stringify(SECCION_VACIA))]);
  }
  function removeSeccion(i: number) {
    if (!form) return;
    setSecciones(form.secciones.filter((_, idx) => idx !== i));
  }
  function setRamo(i: number, ramo: string) {
    if (!form) return;
    setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, ramo } : s)));
  }
  function addMercado(i: number) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) =>
        idx === i ? { ...s, mercados: [...s.mercados, { mercado_id: "", participacion: "" }] } : s
      )
    );
  }
  function removeMercado(i: number, j: number) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) =>
        idx === i ? { ...s, mercados: s.mercados.filter((_, k) => k !== j) } : s
      )
    );
  }
  function setLinea(i: number, j: number, campo: keyof LineaForm, valor: string) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) =>
        idx === i
          ? { ...s, mercados: s.mercados.map((m, k) => (k === j ? { ...m, [campo]: valor } : m)) }
          : s
      )
    );
  }

  async function guardar() {
    if (!form) return;
    if (!form.referencia.trim()) return setError("La referencia del binder es obligatoria.");
    if (!form.productor_id) return setError("El coverholder (agencia) es obligatorio.");
    if (!form.fecha_efecto) return setError("La fecha de efecto es obligatoria.");
    if (!form.fecha_vencimiento) return setError("La fecha de vencimiento es obligatoria.");
    for (let i = 0; i < form.secciones.length; i++) {
      const s = form.secciones[i];
      if (!s.ramo.trim()) return setError(`La sección ${i + 1} necesita un ramo.`);
      const conMercado = s.mercados.filter((m) => m.mercado_id);
      if (conMercado.length === 0) return setError(`La sección ${i + 1} necesita al menos un mercado.`);
    }

    setSaving(true);
    setError(null);
    const payload: BinderWrite = {
      referencia: form.referencia.trim(),
      umr: form.umr.trim() || null,
      agreement_number: form.agreement_number.trim() || null,
      productor_id: Number(form.productor_id),
      fecha_efecto: form.fecha_efecto || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      estado: form.estado || null,
      moneda: form.moneda || null,
      comision: num(form.comision),
      limite_primas: num(form.limite_primas),
      yoa: form.yoa.trim() || null,
      notas: form.notas.trim() || null,
      secciones: form.secciones.map((s) => ({
        ramo: s.ramo.trim() || null,
        mercados: s.mercados
          .filter((m) => m.mercado_id)
          .map((m) => ({ mercado_id: Number(m.mercado_id), participacion: num(m.participacion) })),
      })),
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

  async function borrar(b: Binder) {
    if (!confirm(`¿Borrar el binder "${b.referencia}"?`)) return;
    try {
      await api.remove(b.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por referencia o UMR…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-secondary" onClick={() => cargar()}>
          Buscar
        </button>
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nuevo binder
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay binders. Crea el primero con «+ Nuevo binder».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Referencia</th>
              <th>Coverholder</th>
              <th>Vigencia</th>
              <th>Estado</th>
              <th>Secciones</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td>{b.referencia}</td>
                <td>{b.coverholder_nombre ?? "—"}</td>
                <td>
                  {b.fecha_efecto ?? "—"} → {b.fecha_vencimiento ?? "—"}
                </td>
                <td>{b.estado ?? "—"}</td>
                <td>{b.secciones.length}</td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => abrirEdicion(b)}>
                    Editar
                  </button>
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrar(b)}>
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
          title={form.id ? "Editar Binder" : "Nuevo Binder"}
          dirty={dirty}
          saving={saving}
          onSave={guardar}
          onClose={cerrar}
        >
          <div className="field">
            <label>
              Referencia <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.referencia}
              autoFocus
              onChange={(e) => setForm({ ...form, referencia: e.target.value })}
            />
          </div>

          <div className="field">
            <label>
              Coverholder (agencia) <span className="required">*</span>
            </label>
            <select value={form.productor_id} onChange={(e) => setForm({ ...form, productor_id: e.target.value })}>
              <option value="">— Elige agencia —</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>UMR</label>
            <input type="text" value={form.umr} onChange={(e) => setForm({ ...form, umr: e.target.value })} />
          </div>
          <div className="field">
            <label>Agreement Number</label>
            <input
              type="text"
              value={form.agreement_number}
              onChange={(e) => setForm({ ...form, agreement_number: e.target.value })}
            />
          </div>

          <div className="field">
            <label>
              Fecha de efecto <span className="required">*</span>
            </label>
            <input
              type="date"
              value={form.fecha_efecto}
              onChange={(e) => setForm({ ...form, fecha_efecto: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              Fecha de vencimiento <span className="required">*</span>
            </label>
            <input
              type="date"
              value={form.fecha_vencimiento}
              onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Estado</label>
            <OptionButtons value={form.estado} options={ESTADOS} onChange={(v) => setForm({ ...form, estado: v })} />
          </div>
          <div className="field">
            <label>Moneda</label>
            <OptionButtons value={form.moneda} options={MONEDAS} onChange={(v) => setForm({ ...form, moneda: v })} />
          </div>

          <div className="field">
            <label>Comisión (%)</label>
            <input type="text" value={form.comision} onChange={(e) => setForm({ ...form, comision: e.target.value })} />
          </div>
          <div className="field">
            <label>Límite de primas</label>
            <input
              type="text"
              value={form.limite_primas}
              onChange={(e) => setForm({ ...form, limite_primas: e.target.value })}
            />
          </div>
          <div className="field">
            <label>YOA (año de cuenta)</label>
            <input type="text" value={form.yoa} onChange={(e) => setForm({ ...form, yoa: e.target.value })} />
          </div>

          {/* Secciones */}
          <h3 style={{ marginBottom: 8 }}>Secciones</h3>
          {form.secciones.map((s, i) => (
            <div className="seccion" key={i}>
              <div className="seccion-head">
                <strong>Sección {i + 1}</strong>
                {form.secciones.length > 1 && (
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeSeccion(i)}>
                    Quitar sección
                  </button>
                )}
              </div>
              <div className="field">
                <label>
                  Ramo <span className="required">*</span>
                </label>
                <input type="text" value={s.ramo} onChange={(e) => setRamo(i, e.target.value)} />
              </div>

              <label className="mini-label">Mercados y participación</label>
              {s.mercados.map((m, j) => (
                <div className="linea-mercado" key={j}>
                  <select value={m.mercado_id} onChange={(e) => setLinea(i, j, "mercado_id", e.target.value)}>
                    <option value="">— Mercado —</option>
                    {mercados.map((mc) => (
                      <option key={mc.id} value={mc.id}>
                        {mc.nombre}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="part"
                    placeholder="%"
                    value={m.participacion}
                    onChange={(e) => setLinea(i, j, "participacion", e.target.value)}
                  />
                  {s.mercados.length > 1 && (
                    <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeMercado(i, j)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button className="btn-secondary btn-sm" onClick={() => addMercado(i)}>
                + Añadir mercado
              </button>
            </div>
          ))}
          <button className="btn-secondary" onClick={addSeccion}>
            + Añadir sección
          </button>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
