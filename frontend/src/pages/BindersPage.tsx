import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Binder, BinderWrite, CuentaBancaria, Mercado, Productor, Ramo } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";
import NumberInput from "../components/NumberInput";

const api = crud<Binder, BinderWrite>("/binders");
const apiProductores = crud<Productor, unknown>("/productores");
const apiMercados = crud<Mercado, unknown>("/mercados");
const apiRamos = crud<Ramo, { nombre: string }>("/ramos");
const apiCuentas = crud<CuentaBancaria, unknown>("/cuentas-bancarias");

const ESTADOS = ["En Vigor", "Cancelado", "Renovado", "No Renovado", "Cerrado"];
const INTERVALOS = ["Mensual", "Trimestral", "Semestral", "Anual"];
const PREFIJO_UMR = "B1634";

type LineaForm = { mercado_id: string; participacion: string };
type SeccionForm = {
  ramo: string;
  risk_codes: string[];
  limite_primas: string;
  notificacion: string;
  comision: string;
  sujeto_pc: boolean;
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
  // Datos comunes del binder (debajo de las secciones)
  profit_commission: boolean;
  pc_porcentaje: string;
  pc_gastos: string;
  risk_bdx_intervalo: string;
  risk_bdx_plazo: string;
  premium_bdx_intervalo: string;
  premium_bdx_plazo: string;
  claims_bdx_intervalo: string;
  claims_bdx_plazo: string;
  comision_mayrit: string;
  cuenta_bancaria_id: string;
  notas: string;
  secciones: SeccionForm[];
};

const SECCION_VACIA: SeccionForm = {
  ramo: "",
  risk_codes: [],
  limite_primas: "",
  notificacion: "",
  comision: "",
  sujeto_pc: false,
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
  profit_commission: false,
  pc_porcentaje: "",
  pc_gastos: "",
  risk_bdx_intervalo: "",
  risk_bdx_plazo: "",
  premium_bdx_intervalo: "",
  premium_bdx_plazo: "",
  claims_bdx_intervalo: "",
  claims_bdx_plazo: "",
  comision_mayrit: "",
  cuenta_bancaria_id: "",
  notas: "",
  secciones: [JSON.parse(JSON.stringify(SECCION_VACIA))],
};

function num(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

// Formato de % (es-ES, 2 decimales) para mensajes y totales en vivo.
function pct(n: number): string {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " %";
}

// Fecha ISO (aaaa-mm-dd) → dd/mm/aaaa para mostrar en tablas.
function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

// Ramos distintos de un binder (de sus secciones), unidos por coma.
function ramosDe(b: Binder): string {
  const set = [...new Set(b.secciones.map((s) => s.ramo).filter(Boolean))];
  return set.length ? (set.join(", ") as string) : "—";
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
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(inicial);
  // Profit Commission del binder solo se puede activar si alguna sección tiene "Sujeto a PC?".
  const algunaPC = !!form && form.secciones.some((s) => s.sujeto_pc);

  useEffect(() => {
    if (!algunaPC) {
      setForm((f) =>
        f && f.profit_commission ? { ...f, profit_commission: false, pc_porcentaje: "", pc_gastos: "" } : f
      );
    }
  }, [algunaPC]);

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
      const [prod, merc, ram, cta] = await Promise.all([
        apiProductores.list(),
        apiMercados.list(),
        apiRamos.list(),
        apiCuentas.list(),
      ]);
      setAgencias((prod as Productor[]).filter((p) => p.tipo === "Agencia de Suscripción"));
      setMercados(merc as Mercado[]);
      setRamos(ram as Ramo[]);
      setCuentas(cta as CuentaBancaria[]);
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
    cargarRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      profit_commission: !!b.profit_commission,
      pc_porcentaje: b.pc_porcentaje != null ? String(b.pc_porcentaje) : "",
      pc_gastos: b.pc_gastos != null ? String(b.pc_gastos) : "",
      risk_bdx_intervalo: b.risk_bdx_intervalo ?? "",
      risk_bdx_plazo: b.risk_bdx_plazo != null ? String(b.risk_bdx_plazo) : "",
      premium_bdx_intervalo: b.premium_bdx_intervalo ?? "",
      premium_bdx_plazo: b.premium_bdx_plazo != null ? String(b.premium_bdx_plazo) : "",
      claims_bdx_intervalo: b.claims_bdx_intervalo ?? "",
      claims_bdx_plazo: b.claims_bdx_plazo != null ? String(b.claims_bdx_plazo) : "",
      comision_mayrit: b.comision_mayrit != null ? String(b.comision_mayrit) : "",
      cuenta_bancaria_id: b.cuenta_bancaria_id != null ? String(b.cuenta_bancaria_id) : "",
      notas: b.notas ?? "",
      secciones:
        b.secciones.length > 0
          ? b.secciones.map((s) => ({
              ramo: s.ramo ?? "",
              risk_codes: s.risk_codes ?? [],
              limite_primas: s.limite_primas != null ? String(s.limite_primas) : "",
              notificacion: s.notificacion != null ? String(s.notificacion) : "",
              comision: s.comision != null ? String(s.comision) : "",
              sujeto_pc: !!s.sujeto_pc,
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
    // al cambiar de ramo se resetean los risk codes (dependen del ramo)
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, ramo, risk_codes: [] } : s)));
  }
  function setSeccionCampo(
    i: number,
    campo: "comision" | "limite_primas" | "notificacion",
    valor: string
  ) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function setSeccionFlag(i: number, campo: "sujeto_pc", valor: boolean) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function toggleRiskCode(i: number, codigo: string) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) => {
        if (idx !== i) return s;
        const has = s.risk_codes.includes(codigo);
        return { ...s, risk_codes: has ? s.risk_codes.filter((c) => c !== codigo) : [...s.risk_codes, codigo] };
      })
    );
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
    // Todos los campos son obligatorios al dar de alta un binder (salvo notas).
    if (!form.agreement_number.trim()) return setError("El Agreement Number es obligatorio.");
    if (!form.productor_id) return setError("El coverholder es obligatorio.");
    if (!form.fecha_efecto) return setError("La fecha de efecto es obligatoria.");
    if (!form.fecha_vencimiento) return setError("La fecha de vencimiento es obligatoria.");
    if (!form.yoa.trim()) return setError("El YOA es obligatorio.");
    for (let i = 0; i < form.secciones.length; i++) {
      const s = form.secciones[i];
      const N = `La sección ${i + 1}`;
      if (!s.ramo.trim()) return setError(`${N} necesita un ramo.`);
      const codes = ramos.find((r) => r.nombre === s.ramo)?.risk_codes ?? [];
      if (codes.length && s.risk_codes.length === 0)
        return setError(`${N} necesita al menos un risk code.`);
      if (num(s.limite_primas) == null) return setError(`${N}: el límite de primas es obligatorio.`);
      if (num(s.notificacion) == null) return setError(`${N}: la notificación es obligatoria.`);
      const com = num(s.comision);
      if (com == null) return setError(`${N}: la comisión es obligatoria.`);
      if (com > 100) return setError(`${N}: la comisión no puede ser mayor que 100 %.`);
      const lineas = s.mercados.filter((m) => m.mercado_id);
      if (lineas.length === 0) return setError(`${N} necesita al menos un mercado.`);
      if (lineas.some((m) => num(m.participacion) == null))
        return setError(`${N}: cada mercado necesita su participación (%).`);
      const suma = lineas.reduce((a, m) => a + (num(m.participacion) ?? 0), 0);
      if (Math.abs(suma - 100) > 0.005)
        return setError(`${N}: la suma de participaciones debe ser 100 % (ahora ${pct(suma)}).`);
    }

    // Datos comunes del binder (obligatorios; las notas no).
    if (form.profit_commission) {
      if (num(form.pc_porcentaje) == null) return setError("Con Profit Commission, el PC (%) es obligatorio.");
      if (num(form.pc_gastos) == null) return setError("Con Profit Commission, los Gastos (%) son obligatorios.");
    }
    const bdx: [string, string, string][] = [
      ["Risk Bdx", form.risk_bdx_intervalo, form.risk_bdx_plazo],
      ["Premium Bdx", form.premium_bdx_intervalo, form.premium_bdx_plazo],
      ["Claims Bdx", form.claims_bdx_intervalo, form.claims_bdx_plazo],
    ];
    for (const [label, intervalo, plazo] of bdx) {
      if (!intervalo) return setError(`Indica el intervalo de ${label}.`);
      if (num(plazo) == null) return setError(`Indica el plazo (días) de ${label}.`);
    }
    if (num(form.comision_mayrit) == null) return setError("La comisión Mayrit es obligatoria.");
    if (!form.cuenta_bancaria_id) return setError("La cuenta bancaria es obligatoria.");

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
      profit_commission: form.profit_commission,
      pc_porcentaje: form.profit_commission ? num(form.pc_porcentaje) : null,
      pc_gastos: form.profit_commission ? num(form.pc_gastos) : null,
      risk_bdx_intervalo: form.risk_bdx_intervalo || null,
      risk_bdx_plazo: num(form.risk_bdx_plazo),
      premium_bdx_intervalo: form.premium_bdx_intervalo || null,
      premium_bdx_plazo: num(form.premium_bdx_plazo),
      claims_bdx_intervalo: form.claims_bdx_intervalo || null,
      claims_bdx_plazo: num(form.claims_bdx_plazo),
      comision_mayrit: num(form.comision_mayrit),
      cuenta_bancaria_id: form.cuenta_bancaria_id ? Number(form.cuenta_bancaria_id) : null,
      notas: form.notas.trim() || null,
      secciones: form.secciones.map((s) => ({
        ramo: s.ramo.trim() || null,
        risk_codes: s.risk_codes,
        limite_primas: num(s.limite_primas),
        notificacion: num(s.notificacion),
        comision: num(s.comision),
        sujeto_pc: s.sujeto_pc,
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

  // Mercado con mayor participación del binder (entre todas las secciones) → su Código (IdMercado).
  function mercadoPrincipal(b: Binder): string {
    let best: { id: number; part: number } | null = null;
    for (const s of b.secciones)
      for (const m of s.mercados) {
        const p = m.participacion ?? 0;
        if (!best || p > best.part) best = { id: m.mercado_id, part: p };
      }
    if (!best) return "—";
    const mc = mercados.find((x) => x.id === best!.id);
    return mc?.alias || mc?.nombre || "—";
  }

  return (
    <div className="container">
      <PageHeader emoji="📑" title="Binders" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por UMR o Agreement Number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
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
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>UMR</th>
                <th>YOA</th>
                <th>Coverholder</th>
                <th>Mercado</th>
                <th>Estado</th>
                <th>Ramo</th>
                <th>Efecto</th>
                <th>Vencimiento</th>
                <th className="num">GWP</th>
                <th className="num">Notificación</th>
                <th>Notificado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>{b.umr ?? "—"}</td>
                  <td>{b.yoa ?? "—"}</td>
                  <td>{b.coverholder_alias ?? b.coverholder_nombre ?? "—"}</td>
                  <td>{mercadoPrincipal(b)}</td>
                  <td>{b.estado ?? "—"}</td>
                  <td>{ramosDe(b)}</td>
                  <td>{fechaCorta(b.fecha_efecto)}</td>
                  <td>{fechaCorta(b.fecha_vencimiento)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td>—</td>
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
        </div>
      )}

      {form && (
        <FormPanel
          title={form.id ? "Editar Binder" : "Nuevo Binder"}
          dirty={dirty}
          saving={saving}
          error={error}
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
            <select
              value={form.estado}
              disabled={!form.id}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
            >
              {ESTADOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
                    <label>Risk Codes</label>
                    {!s.ramo ? (
                      <span className="hint">Elige antes el ramo</span>
                    ) : codes.length === 0 ? (
                      <span className="hint">(ese ramo no tiene risk codes)</span>
                    ) : (
                      <div className="rc-checks">
                        {codes.map((c) => (
                          <label key={c.codigo} className="rc-check">
                            <input
                              type="checkbox"
                              checked={s.risk_codes.includes(c.codigo)}
                              onChange={() => toggleRiskCode(i, c.codigo)}
                            />
                            {c.descripcion ? `${c.codigo} — ${c.descripcion}` : c.codigo}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="field-row">
                <div className="field">
                  <label>Límite de primas</label>
                  <NumberInput
                    value={s.limite_primas}
                    onChange={(v) => setSeccionCampo(i, "limite_primas", v)}
                  />
                </div>
                <div className="field">
                  <label>Notificación</label>
                  <NumberInput
                    value={s.notificacion}
                    onChange={(v) => setSeccionCampo(i, "notificacion", v)}
                    suffix="%"
                    thousands={false}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Comisión</label>
                  <NumberInput
                    value={s.comision}
                    onChange={(v) => setSeccionCampo(i, "comision", v)}
                    suffix="%"
                    thousands={false}
                  />
                </div>
                <label className="field check pc-check">
                  <input
                    type="checkbox"
                    checked={s.sujeto_pc}
                    onChange={(e) => setSeccionFlag(i, "sujeto_pc", e.target.checked)}
                  />
                  Sujeto a PC?
                </label>
              </div>

              <label className="mini-label">Mercados y participación</label>
              {s.mercados.map((m, j) => {
                // Excluir del desplegable los mercados ya elegidos en OTRAS líneas de esta sección.
                const usados = new Set(
                  s.mercados.filter((_, k) => k !== j).map((x) => x.mercado_id).filter(Boolean)
                );
                return (
                <div className="linea-mercado" key={j}>
                  <select value={m.mercado_id} onChange={(e) => setLinea(i, j, "mercado_id", e.target.value)}>
                    <option value="">— Mercado —</option>
                    {mercados
                      .filter((mc) => !usados.has(String(mc.id)) || String(mc.id) === m.mercado_id)
                      .map((mc) => (
                        <option key={mc.id} value={mc.id}>
                          {mc.nombre}
                        </option>
                      ))}
                  </select>
                  <NumberInput
                    className="part-num"
                    value={m.participacion}
                    onChange={(v) => setLinea(i, j, "participacion", v)}
                    suffix="%"
                    thousands={false}
                  />
                  {s.mercados.length > 1 && (
                    <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeMercado(i, j)}>
                      ✕
                    </button>
                  )}
                </div>
                );
              })}
              <button className="btn-secondary btn-sm" onClick={() => addMercado(i)}>
                + Añadir mercado
              </button>
              {(() => {
                const suma = s.mercados.reduce((a, m) => a + (num(m.participacion) ?? 0), 0);
                const ok = Math.abs(suma - 100) < 0.005;
                return (
                  <div className={ok ? "part-total ok" : "part-total"}>
                    Total participación: {pct(suma)}
                    {!ok && " (debe sumar 100 %)"}
                  </div>
                );
              })()}
            </div>
          ))}
          <button className="btn-secondary" onClick={addSeccion}>
            + Añadir sección
          </button>

          {/* ── Datos comunes del binder (no por sección) ── */}
          <h3 style={{ marginTop: 22, marginBottom: 8 }}>Datos del binder</h3>

          <label className="field check">
            <input
              type="checkbox"
              checked={form.profit_commission}
              disabled={!algunaPC}
              onChange={(e) => setForm({ ...form, profit_commission: e.target.checked })}
            />
            Profit Commission
          </label>
          {!algunaPC && <span className="hint">Para activarlo, alguna sección debe tener «Sujeto a PC?».</span>}
          {form.profit_commission && (
            <div className="field-row">
              <div className="field">
                <label>
                  PC <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.pc_porcentaje}
                  onChange={(v) => setForm({ ...form, pc_porcentaje: v })}
                  suffix="%"
                  thousands={false}
                />
              </div>
              <div className="field">
                <label>
                  Gastos <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.pc_gastos}
                  onChange={(v) => setForm({ ...form, pc_gastos: v })}
                  suffix="%"
                  thousands={false}
                />
              </div>
            </div>
          )}

          {(
            [
              ["Risk Bdx", "risk_bdx_intervalo", "risk_bdx_plazo"],
              ["Premium Bdx", "premium_bdx_intervalo", "premium_bdx_plazo"],
              ["Claims Bdx", "claims_bdx_intervalo", "claims_bdx_plazo"],
            ] as const
          ).map(([label, ik, pk]) => (
            <div className="field-row" key={ik}>
              <div className="field">
                <label>
                  {label} — Intervalo <span className="required">*</span>
                </label>
                <select value={form[ik]} onChange={(e) => setForm({ ...form, [ik]: e.target.value })}>
                  <option value="">— Intervalo —</option>
                  {INTERVALOS.map((iv) => (
                    <option key={iv} value={iv}>
                      {iv}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Plazo (días) <span className="required">*</span>
                </label>
                <NumberInput
                  value={form[pk]}
                  onChange={(v) => setForm({ ...form, [pk]: v })}
                  decimals={0}
                  thousands={false}
                />
              </div>
            </div>
          ))}

          <div className="field-row">
            <div className="field">
              <label>
                Comisión Mayrit <span className="required">*</span>
              </label>
              <NumberInput
                value={form.comision_mayrit}
                onChange={(v) => setForm({ ...form, comision_mayrit: v })}
                suffix="%"
                thousands={false}
              />
            </div>
            <div className="field" />
          </div>

          <div className="field">
            <label>
              Cuenta bancaria <span className="required">*</span>
            </label>
            <select
              value={form.cuenta_bancaria_id}
              onChange={(e) => setForm({ ...form, cuenta_bancaria_id: e.target.value })}
            >
              <option value="">— Elige cuenta —</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {cuentas.length === 0 && (
              <span className="hint">Crea cuentas en Configuración → Cuentas Bancarias.</span>
            )}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}
    </div>
  );
}
