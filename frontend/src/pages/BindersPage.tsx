import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Binder, BinderWrite, Mercado, Productor, Ramo } from "../types";
import FormPanel from "../components/FormPanel";
import OptionButtons from "../components/OptionButtons";

const api = crud<Binder, BinderWrite>("/binders");
const apiProductores = crud<Productor, unknown>("/productores");
const apiMercados = crud<Mercado, unknown>("/mercados");
const apiRamos = crud<Ramo, { nombre: string }>("/ramos");

const ESTADOS = ["En Vigor", "Cancelado", "Renovado", "No Renovado", "Cerrado"];
const MONEDAS = ["EUR", "GBP", "USD"];
const PREFIJO_UMR = "B1634";

type LineaForm = { mercado_id: string; participacion: string };
type SeccionForm = {
  ramo: string;
  risk_code: string;
  comision: string;
  limite_primas: string;
  mercados: LineaForm[];
};
type FormState = {
  id?: number;
  agreement_number: string;
  umr: string;
  productor_id: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  yoa: string;
  estado: string;
  moneda: string;
  notas: string;
  secciones: SeccionForm[];
};

const SECCION_VACIA: SeccionForm = {
  ramo: "",
  risk_code: "",
  comision: "",
  limite_primas: "",
  mercados: [{ mercado_id: "", participacion: "" }],
};

const VACIO: FormState = {
  agreement_number: "",
  umr: "",
  productor_id: "",
  fecha_efecto: "",
  fecha_vencimiento: "",
  yoa: "",
  estado: "En Vigor",
  moneda: "EUR",
  notas: "",
  secciones: [JSON.parse(JSON.stringify(SECCION_VACIA))],
};

function num(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function umrDe(agreement: string): string {
  return agreement.trim() ? PREFIJO_UMR + agreement.trim() : "";
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Vencimiento = efecto + 1 año − 1 día (el día anterior al aniversario).
function vencimientoDe(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return fmt(d);
}

// YOA = año de la fecha de efecto.
function yoaDe(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

export default function BindersPage() {
  const [items, setItems] = useState<Binder[]>([]);
  const [agencias, setAgencias] = useState<Productor[]>([]);
  const [mercados, setMercados] = useState<Mercado[]>([]);
  const [ramos, setRamos] = useState<Ramo[]>([]);
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
      const [prod, merc, ram] = await Promise.all([
        apiProductores.list(),
        apiMercados.list(),
        apiRamos.list(),
      ]);
      setAgencias((prod as Productor[]).filter((p) => p.tipo === "Agencia de Suscripción"));
      setMercados(merc as Mercado[]);
      setRamos(ram as Ramo[]);
    } catch {
      /* si fallan, los selectores quedan vacíos */
    }
  }

  async function nuevoRamo(i: number) {
    const nombre = window.prompt("Nuevo ramo:");
    if (!nombre || !nombre.trim()) return;
    const n = nombre.trim();
    try {
      await apiRamos.create({ nombre: n });
      setRamos((await apiRamos.list()) as Ramo[]);
      setRamo(i, n);
    } catch (e) {
      setError((e as Error).message);
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
      agreement_number: b.agreement_number ?? "",
      umr: b.umr ?? "",
      productor_id: b.productor_id != null ? String(b.productor_id) : "",
      fecha_efecto: b.fecha_efecto ?? "",
      fecha_vencimiento: b.fecha_vencimiento ?? "",
      yoa: b.yoa ?? "",
      estado: b.estado ?? "",
      moneda: b.moneda ?? "",
      notas: b.notas ?? "",
      secciones:
        b.secciones.length > 0
          ? b.secciones.map((s) => ({
              ramo: s.ramo ?? "",
              risk_code: s.risk_code ?? "",
              comision: s.comision != null ? String(s.comision) : "",
              limite_primas: s.limite_primas != null ? String(s.limite_primas) : "",
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

  // ── secciones / mercados (inmutable) ──
  function setSecciones(secs: SeccionForm[]) {
    setForm((f) => (f ? { ...f, secciones: secs } : f));
  }
  function addSeccion() {
    if (form) setSecciones([...form.secciones, JSON.parse(JSON.stringify(SECCION_VACIA))]);
  }
  function removeSeccion(i: number) {
    if (form) setSecciones(form.secciones.filter((_, idx) => idx !== i));
  }
  function setRamo(i: number, ramo: string) {
    // al cambiar de ramo se resetea el risk code (depende del ramo)
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, ramo, risk_code: "" } : s)));
  }
  function setSeccionCampo(i: number, campo: "comision" | "limite_primas" | "risk_code", valor: string) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function addMercado(i: number) {
    if (form)
      setSecciones(
        form.secciones.map((s, idx) =>
          idx === i ? { ...s, mercados: [...s.mercados, { mercado_id: "", participacion: "" }] } : s
        )
      );
  }
  function removeMercado(i: number, j: number) {
    if (form)
      setSecciones(
        form.secciones.map((s, idx) =>
          idx === i ? { ...s, mercados: s.mercados.filter((_, k) => k !== j) } : s
        )
      );
  }
  function setLinea(i: number, j: number, campo: keyof LineaForm, valor: string) {
    if (form)
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
    if (!form.agreement_number.trim()) return setError("El Agreement Number es obligatorio.");
    if (!form.productor_id) return setError("El coverholder es obligatorio.");
    if (!form.fecha_efecto) return setError("La fecha de efecto es obligatoria.");
    if (!form.fecha_vencimiento) return setError("La fecha de vencimiento es obligatoria.");
    for (let i = 0; i < form.secciones.length; i++) {
      const s = form.secciones[i];
      if (!s.ramo.trim()) return setError(`La sección ${i + 1} necesita un ramo.`);
      const codes = ramos.find((r) => r.nombre === s.ramo)?.risk_codes ?? [];
      if (codes.length && !s.risk_code) return setError(`La sección ${i + 1} necesita un risk code.`);
      if (s.mercados.filter((m) => m.mercado_id).length === 0)
        return setError(`La sección ${i + 1} necesita al menos un mercado.`);
    }

    setSaving(true);
    setError(null);
    const payload: BinderWrite = {
      agreement_number: form.agreement_number.trim(),
      umr: umrDe(form.agreement_number) || null,
      productor_id: Number(form.productor_id),
      fecha_efecto: form.fecha_efecto || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      yoa: form.yoa.trim() || null,
      estado: form.estado || null,
      moneda: form.moneda || null,
      notas: form.notas.trim() || null,
      secciones: form.secciones.map((s) => ({
        ramo: s.ramo.trim() || null,
        risk_code: s.risk_code || null,
        comision: num(s.comision),
        limite_primas: num(s.limite_primas),
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
    if (!confirm(`¿Borrar el binder "${b.umr ?? b.agreement_number}"?`)) return;
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
          placeholder="Buscar por UMR o Agreement Number…"
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
              <th>UMR</th>
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
                <td>{b.umr ?? "—"}</td>
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
              Agreement Number <span className="required">*</span>
            </label>
            <input
              type="text"
              value={form.agreement_number}
              autoFocus
              style={{ textTransform: "uppercase" }}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setForm({ ...form, agreement_number: v, umr: umrDe(v) });
              }}
            />
          </div>

          <div className="field">
            <label>UMR</label>
            <input type="text" value={form.umr} readOnly placeholder="Se genera con el Agreement Number" />
          </div>

          <div className="field">
            <label>
              Coverholder <span className="required">*</span>
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

          {/* Vigencia: efecto · YOA · vencimiento (vencimiento = efecto + 365, editable) */}
          <div className="field">
            <label>
              Vigencia <span className="required">*</span>
            </label>
            <div className="vigencia">
              <div className="vig-fechas">
                <div className="vig-campo">
                  <span className="sub">Efecto</span>
                  <input
                    type="date"
                    className="inp-fecha"
                    value={form.fecha_efecto}
                    onChange={(e) => {
                      const ef = e.target.value;
                      setForm({
                        ...form,
                        fecha_efecto: ef,
                        fecha_vencimiento: ef ? vencimientoDe(ef) : form.fecha_vencimiento,
                        yoa: ef ? yoaDe(ef) : form.yoa,
                      });
                    }}
                  />
                </div>
                <div className="vig-campo">
                  <span className="sub">Vencimiento</span>
                  <input
                    type="date"
                    className="inp-fecha"
                    value={form.fecha_vencimiento}
                    onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                  />
                </div>
              </div>
              <div className="vig-campo">
                <span className="sub">YOA</span>
                <input
                  type="text"
                  className="inp-yoa"
                  value={form.yoa}
                  onChange={(e) => setForm({ ...form, yoa: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="field">
            <label>Estado</label>
            <OptionButtons value={form.estado} options={ESTADOS} onChange={(v) => setForm({ ...form, estado: v })} />
          </div>
          <div className="field">
            <label>Moneda</label>
            <OptionButtons value={form.moneda} options={MONEDAS} onChange={(v) => setForm({ ...form, moneda: v })} />
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
                <select
                  value={s.ramo}
                  onChange={(e) => (e.target.value === "__nuevo__" ? nuevoRamo(i) : setRamo(i, e.target.value))}
                >
                  <option value="">— Elige ramo —</option>
                  {[...new Set([...(s.ramo ? [s.ramo] : []), ...ramos.map((r) => r.nombre)])].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="__nuevo__">➕ Añadir ramo…</option>
                </select>
              </div>
              {(() => {
                const codes = ramos.find((r) => r.nombre === s.ramo)?.risk_codes ?? [];
                return (
                  <div className="field">
                    <label>Risk Code</label>
                    <select
                      value={s.risk_code}
                      disabled={!s.ramo}
                      onChange={(e) => setSeccionCampo(i, "risk_code", e.target.value)}
                    >
                      <option value="">
                        {!s.ramo
                          ? "— Elige antes el ramo —"
                          : codes.length
                          ? "— Elige risk code —"
                          : "(ese ramo no tiene risk codes)"}
                      </option>
                      {[
                        ...new Set([
                          ...(s.risk_code ? [s.risk_code] : []),
                          ...codes.map((c) => c.codigo),
                        ]),
                      ].map((c) => {
                        const desc = codes.find((x) => x.codigo === c)?.descripcion;
                        return (
                          <option key={c} value={c}>
                            {desc ? `${c} — ${desc}` : c}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })()}
              <div className="field">
                <label>Comisión (%)</label>
                <input
                  type="text"
                  value={s.comision}
                  onChange={(e) => setSeccionCampo(i, "comision", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Límite de primas</label>
                <input
                  type="text"
                  value={s.limite_primas}
                  onChange={(e) => setSeccionCampo(i, "limite_primas", e.target.value)}
                />
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
