import { useEffect, useMemo, useState } from "react";
import {
  inversionesApi,
  type Inversion,
  type InversionDetalle,
  type InversionWrite,
  type InversionesResumen,
} from "../api";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";
import { fmtFechaES, fmtMiles } from "../format";

const TIPOS = ["Fondo", "Depósito", "Cuenta remunerada", "Renta fija", "Otro"];
const ORIGENES = ["Propio", "Primas"];
const ESTADOS = ["Abierta", "Cerrada"];
const TIPOS_MOV = ["Aportación", "Rescate", "Rendimiento", "Comisión", "Retención"];

const hoyISO = () => new Date().toISOString().slice(0, 10);
const eur = (v: number | null | undefined) => `${fmtMiles(v ?? 0)} €`;
// Verde si gana, rojo si pierde, gris si está a cero.
const colorGanancia = (v: number) => (v > 0.005 ? "#16a34a" : v < -0.005 ? "#dc2626" : "var(--gris-medio)");

type FormState = InversionWrite & { id?: number };

const VACIO: FormState = {
  nombre: "",
  entidad: "",
  tipo: "Fondo",
  isin: "",
  referencia: "",
  origen: "Propio",
  capital_garantizado: false,
  fecha_alta: hoyISO(),
  fecha_vencimiento: "",
  tae_pct: null,
  moneda: "EUR",
  estado: "Abierta",
  notas: "",
};

// Tarjeta de cifra (mismo aspecto que las de KPIs).
function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="kpi-stat">
      <div className="kpi-val" style={color ? { color } : undefined}>{value}</div>
      <div className="kpi-lbl">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Pastilla del origen del dinero: el dato que manda en todo el módulo.
function PillOrigen({ origen }: { origen: string }) {
  return (
    <span className={"pill " + (origen === "Primas" ? "pill-parcial" : "pill-cobrado")}>{origen}</span>
  );
}

export default function InversionesPage() {
  const [items, setItems] = useState<Inversion[]>([]);
  const [resumen, setResumen] = useState<InversionesResumen | null>(null);
  const [entidades, setEntidades] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [fOrigen, setFOrigen] = useState("");
  const [fEstado, setFEstado] = useState("Abierta");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Panel abierto: id de la inversión, "nueva", o null (cerrado).
  const [abierta, setAbierta] = useState<number | "nueva" | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const [lista, res, ents] = await Promise.all([
        inversionesApi.listar({ q: q || undefined, origen: fOrigen || undefined, estado: fEstado || undefined }),
        inversionesApi.resumen(),
        inversionesApi.entidades(),
      ]);
      setItems(lista);
      setResumen(res);
      setEntidades(ents);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fOrigen, fEstado]);

  // Avisos de la parte de arriba: solo se pintan los que tienen algo que decir.
  const avisos: { texto: string; grave: boolean }[] = [];
  if (resumen) {
    if (resumen.primas_bloqueado > 0.005) {
      avisos.push({
        grave: false,
        texto: `${eur(resumen.primas_bloqueado)} de primas no se pueden tocar hasta el ${fmtFechaES(resumen.primas_bloqueado_hasta)}.`,
      });
    }
    if (resumen.primas_sin_garantia > 0.005) {
      avisos.push({
        grave: true,
        texto: `${eur(resumen.primas_sin_garantia)} de primas están en productos que pueden bajar de valor. Ese dinero hay que devolverlo íntegro.`,
      });
    }
    if (resumen.primas_en_perdida > 0.005) {
      avisos.push({
        grave: true,
        texto: `El dinero de primas acumula ${eur(resumen.primas_en_perdida)} de pérdida.`,
      });
    }
    if (resumen.n_valoraciones_viejas > 0) {
      avisos.push({
        grave: false,
        texto:
          resumen.n_valoraciones_viejas === 1
            ? "Hay 1 inversión sin valorar desde hace más de mes y medio."
            : `Hay ${resumen.n_valoraciones_viejas} inversiones sin valorar desde hace más de mes y medio.`,
      });
    }
    if (resumen.proximo_vencimiento) {
      avisos.push({
        grave: false,
        texto: `Próximo vencimiento: ${resumen.proximo_vencimiento_nombre}, el ${fmtFechaES(resumen.proximo_vencimiento)}.`,
      });
    }
  }

  return (
    <div className="container compacto">
      <PageHeader emoji="💹" title="Inversiones" />

      {resumen && (
        <div className="kpi-stats" style={{ marginBottom: 16 }}>
          <Stat
            label="Valor hoy"
            value={eur(resumen.total.valor)}
            sub={`${resumen.total.n} inversión${resumen.total.n === 1 ? "" : "es"} abierta${resumen.total.n === 1 ? "" : "s"}`}
          />
          <Stat label="Dinero metido" value={eur(resumen.total.aportado_neto)} sub="aportado menos rescatado" />
          <Stat
            label="Ganancia"
            value={eur(resumen.total.ganancia)}
            color={colorGanancia(resumen.total.ganancia)}
            sub={
              resumen.total.rentabilidad_pct != null
                ? `${fmtMiles(resumen.total.rentabilidad_pct, 2)} % · ${eur(resumen.total.cobrado)} ya cobrados`
                : `${eur(resumen.total.cobrado)} ya cobrados`
            }
          />
          <Stat
            label="De primas"
            value={eur(resumen.primas.valor)}
            sub={`Propio: ${eur(resumen.propio.valor)}`}
          />
        </div>
      )}

      {avisos.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          {avisos.map((a, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 12px",
                borderRadius: 8,
                background: a.grave ? "#fde2dd" : "#fdecd1",
                color: a.grave ? "#b42318" : "#854d0e",
              }}
            >
              ⚠ {a.texto}
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, entidad, ISIN o contrato…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="filtro" value={fOrigen} onChange={(e) => setFOrigen(e.target.value)}>
          <option value="">Propio y primas</option>
          {ORIGENES.map((o) => (
            <option key={o} value={o}>
              Solo {o.toLowerCase()}
            </option>
          ))}
        </select>
        <select className="filtro" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="Abierta">Abiertas</option>
          <option value="Cerrada">Cerradas</option>
          <option value="">Todas</option>
        </select>
        <button className="btn-primary" onClick={() => setAbierta("nueva")}>
          + Nueva inversión
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay inversiones que mostrar. Crea la primera con «+ Nueva inversión».</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Inversión</th>
              <th>Origen</th>
              <th style={{ textAlign: "right" }}>Metido</th>
              <th style={{ textAlign: "right" }}>Vale hoy</th>
              <th style={{ textAlign: "right" }}>Ganancia</th>
              <th>Valorada</th>
              <th>Disponible</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} style={i.estado === "Cerrada" ? { opacity: 0.55 } : undefined}>
                <td>
                  <div style={{ fontWeight: 600 }}>{i.nombre}</div>
                  <div className="hint">
                    {[i.entidad, i.tipo, !i.capital_garantizado ? "sin garantía" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </td>
                <td>
                  <PillOrigen origen={i.origen} />
                </td>
                <td style={{ textAlign: "right" }}>{eur(i.aportado_neto)}</td>
                <td style={{ textAlign: "right" }}>
                  {eur(i.valor)}
                  {i.valor_estimado && i.estado === "Abierta" && (
                    <div className="hint" style={{ color: "#b45309" }}>estimado</div>
                  )}
                </td>
                <td style={{ textAlign: "right", color: colorGanancia(i.ganancia), fontWeight: 600 }}>
                  {eur(i.ganancia)}
                  {i.rentabilidad_pct != null && (
                    <div className="hint" style={{ color: "inherit" }}>{fmtMiles(i.rentabilidad_pct, 2)} %</div>
                  )}
                </td>
                <td>
                  {i.fecha_valoracion ? (
                    <span style={i.valoracion_vieja ? { color: "#b45309", fontWeight: 600 } : undefined}>
                      {fmtFechaES(i.fecha_valoracion)}
                    </span>
                  ) : (
                    <span className="hint">sin valorar</span>
                  )}
                </td>
                <td>
                  {i.fecha_vencimiento ? (
                    <>
                      {fmtFechaES(i.fecha_vencimiento)}
                      {i.vence_en_dias != null && i.vence_en_dias >= 0 && i.vence_en_dias <= 30 && (
                        <div className="hint" style={{ color: "#b45309" }}>en {i.vence_en_dias} días</div>
                      )}
                    </>
                  ) : (
                    <span className="hint">en cualquier momento</span>
                  )}
                </td>
                <td className="acciones">
                  <button className="btn-link" onClick={() => setAbierta(i.id)}>
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {abierta !== null && (
        <PanelInversion
          id={abierta === "nueva" ? null : abierta}
          entidades={entidades}
          onCerrar={() => setAbierta(null)}
          onCambio={cargar}
          onCreada={(id) => setAbierta(id)}
        />
      )}
    </div>
  );
}

// ─────────────────────── Panel de una inversión (ficha + movimientos + valoraciones) ───────────────────────
function PanelInversion({
  id,
  entidades,
  onCerrar,
  onCambio,
  onCreada,
}: {
  id: number | null;
  entidades: string[];
  onCerrar: () => void;
  onCambio: () => void;
  onCreada: (id: number) => void;
}) {
  const [detalle, setDetalle] = useState<InversionDetalle | null>(null);
  const [form, setForm] = useState<FormState>({ ...VACIO });
  const [inicial, setInicial] = useState<FormState>({ ...VACIO });
  const [cargando, setCargando] = useState(id != null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La entidad se ELIGE de tus bancos (o se escribe una nueva). Antes era una caja de texto con
  // "Banco Mediolanum" en gris de ejemplo, y parecía un dato fijo que no se podía cambiar.
  const [otraEntidad, setOtraEntidad] = useState(false);
  const listaEntidades = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const e of entidades) if (e.trim()) vistas.set(e.trim().toLowerCase(), e.trim());
    const actual = (form.entidad ?? "").trim();      // la de esta inversión, aunque no esté en la lista
    if (actual) vistas.set(actual.toLowerCase(), actual);
    return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [entidades, form.entidad]);

  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);

  function deDetalle(d: InversionDetalle): FormState {
    return {
      id: d.id,
      nombre: d.nombre,
      entidad: d.entidad ?? "",
      tipo: d.tipo,
      isin: d.isin ?? "",
      referencia: d.referencia ?? "",
      origen: d.origen,
      capital_garantizado: d.capital_garantizado,
      fecha_alta: d.fecha_alta ?? "",
      fecha_vencimiento: d.fecha_vencimiento ?? "",
      tae_pct: d.tae_pct ?? null,
      moneda: d.moneda ?? "EUR",
      estado: d.estado,
      notas: d.notas ?? "",
    };
  }

  async function recargar(invId: number) {
    const d = await inversionesApi.detalle(invId);
    setDetalle(d);
    const f = deDetalle(d);
    setForm(f);
    setInicial(f);
  }

  useEffect(() => {
    if (id == null) return;
    (async () => {
      setCargando(true);
      try {
        await recargar(id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Lo que se manda al backend: los textos vacíos viajan como null.
  function payload(): InversionWrite {
    const t = (s: string | null | undefined) => (s ?? "").trim() || null;
    return {
      nombre: form.nombre.trim(),
      entidad: t(form.entidad),
      tipo: form.tipo,
      isin: t(form.isin),
      referencia: t(form.referencia),
      origen: form.origen,
      capital_garantizado: form.capital_garantizado,
      fecha_alta: t(form.fecha_alta),
      fecha_vencimiento: t(form.fecha_vencimiento),
      tae_pct: form.tae_pct === null || Number.isNaN(form.tae_pct) ? null : form.tae_pct,
      moneda: t(form.moneda),
      estado: form.estado,
      notas: t(form.notas),
    };
  }

  async function guardar() {
    if (!form.nombre.trim()) return setError("El nombre de la inversión es obligatorio.");
    setGuardando(true);
    setError(null);
    try {
      if (id == null) {
        const creada = await inversionesApi.crear(payload());
        onCambio();
        onCreada(creada.id);   // el panel pasa a modo ficha: ya se pueden meter movimientos
      } else {
        await inversionesApi.editar(id, payload());
        await recargar(id);
        onCambio();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (id == null) return;
    if (!confirm(`¿Borrar la inversión "${form.nombre}" con todos sus movimientos y valoraciones?`)) return;
    try {
      await inversionesApi.borrar(id);
      onCambio();
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Acción sobre movimientos/valoraciones: se guardan al momento y se refresca la ficha.
  async function accion(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      if (id != null) await recargar(id);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const titulo = id == null ? "Nueva inversión" : form.nombre || "Inversión";

  return (
    <FormPanel
      title={titulo}
      dirty={dirty}
      saving={guardando}
      error={error}
      wide
      saveLabel={id == null ? "Crear" : "Guardar"}
      onSave={guardar}
      onClose={onCerrar}
      onDelete={id != null ? borrar : undefined}
    >
      {cargando ? (
        <div className="loading">Cargando…</div>
      ) : (
        <>
          {detalle && (
            <div className="kpi-stats" style={{ marginBottom: 18 }}>
              <Stat label="Dinero metido" value={eur(detalle.aportado_neto)} />
              <Stat
                label="Vale hoy"
                value={eur(detalle.valor)}
                sub={
                  detalle.valor_estimado
                    ? "estimado: aún no hay valoración"
                    : `a ${fmtFechaES(detalle.fecha_valoracion)}`
                }
              />
              <Stat
                label="Ganancia"
                value={eur(detalle.ganancia)}
                color={colorGanancia(detalle.ganancia)}
                sub={
                  detalle.rentabilidad_pct != null
                    ? `${fmtMiles(detalle.rentabilidad_pct, 2)} % · ${eur(detalle.cobrado)} ya cobrados`
                    : undefined
                }
              />
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label>
                Nombre <span className="required">*</span>
              </label>
              <input type="text" value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
            </div>
            <div className="field">
              <label>Entidad</label>
              {otraEntidad ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Escribe el banco o la gestora"
                    value={form.entidad ?? ""}
                    onChange={(e) => set("entidad", e.target.value)}
                  />
                  <button type="button" className="btn-link btn-sm" onClick={() => { setOtraEntidad(false); set("entidad", ""); }}>
                    elegir de la lista
                  </button>
                </>
              ) : (
                <select
                  value={form.entidad ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "__otra__") { setOtraEntidad(true); set("entidad", ""); }
                    else set("entidad", e.target.value);
                  }}
                >
                  <option value="">— elige la entidad —</option>
                  {listaEntidades.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                  <option value="__otra__">➕ Otra entidad…</option>
                </select>
              )}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Tipo de producto</label>
              <select value={form.tipo} onChange={(e) => set("tipo", e.target.value)}>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>¿De quién es el dinero?</label>
              <select value={form.origen} onChange={(e) => set("origen", e.target.value as FormState["origen"])}>
                {ORIGENES.map((o) => (
                  <option key={o} value={o}>
                    {o === "Propio" ? "Propio (de Mayrit)" : "Primas (hay que devolverlo)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.origen === "Primas" && (
            <div className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
              Este dinero no es nuestro: hay que devolverlo íntegro a la compañía. Rellena hasta cuándo está
              bloqueado y marca si la entidad garantiza que recuperas el 100 %.
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label>Fecha de contratación</label>
              <input
                type="date"
                value={form.fecha_alta ?? ""}
                onChange={(e) => set("fecha_alta", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Disponible el (vencimiento)</label>
              <input
                type="date"
                value={form.fecha_vencimiento ?? ""}
                onChange={(e) => set("fecha_vencimiento", e.target.value)}
              />
              <span className="hint">Vacío = se puede rescatar en cualquier momento.</span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Interés pactado (%)</label>
              <input
                type="number"
                step="0.0001"
                value={form.tae_pct ?? ""}
                onChange={(e) => set("tae_pct", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Estado</label>
              <select value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                {ESTADOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field check">
            <input
              id="inv-garantizado"
              type="checkbox"
              checked={form.capital_garantizado}
              onChange={(e) => set("capital_garantizado", e.target.checked)}
            />
            <label htmlFor="inv-garantizado">
              La entidad garantiza que recupero el 100 % (depósitos sí; los fondos no)
            </label>
          </div>

          <div className="field-row">
            <div className="field">
              <label>ISIN</label>
              <input type="text" value={form.isin ?? ""} onChange={(e) => set("isin", e.target.value)} />
            </div>
            <div className="field">
              <label>Nº de contrato / cuenta</label>
              <input
                type="text"
                value={form.referencia ?? ""}
                onChange={(e) => set("referencia", e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Notas</label>
            <textarea rows={2} value={form.notas ?? ""} onChange={(e) => set("notas", e.target.value)} />
          </div>

          {id == null ? (
            <div className="hint" style={{ marginTop: 10 }}>
              Al crearla podrás ir metiendo los movimientos de dinero y las valoraciones mensuales.
            </div>
          ) : (
            detalle && (
              <>
                <Movimientos
                  detalle={detalle}
                  onCrear={(datos) => accion(() => inversionesApi.crearMovimiento(detalle.id, datos))}
                  onBorrar={(movId) => accion(() => inversionesApi.borrarMovimiento(movId))}
                />
                <Valoraciones
                  detalle={detalle}
                  onCrear={(datos) => accion(() => inversionesApi.crearValoracion(detalle.id, datos))}
                  onBorrar={(valId) => accion(() => inversionesApi.borrarValoracion(valId))}
                />
              </>
            )
          )}
        </>
      )}
    </FormPanel>
  );
}

// ─────────────────────────────── Movimientos de dinero ───────────────────────────────
function Movimientos({
  detalle,
  onCrear,
  onBorrar,
}: {
  detalle: InversionDetalle;
  onCrear: (datos: { fecha: string; tipo: string; importe: number; interno: boolean; concepto: string | null }) => void;
  onBorrar: (movId: number) => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [tipo, setTipo] = useState("Aportación");
  const [importe, setImporte] = useState("");
  const [interno, setInterno] = useState(false);
  const [concepto, setConcepto] = useState("");

  // "Interno" solo tiene sentido en lo que se genera dentro del producto, no en aportar/rescatar.
  const admiteInterno = tipo === "Rendimiento" || tipo === "Comisión" || tipo === "Retención";
  const puedeAnadir = Number(importe) > 0 && !!fecha;

  function anadir() {
    onCrear({
      fecha,
      tipo,
      importe: Number(importe),
      interno: admiteInterno ? interno : false,
      concepto: concepto.trim() || null,
    });
    setImporte("");
    setConcepto("");
  }

  return (
    <section style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 4px" }}>Movimientos de dinero</h3>
      <div className="hint" style={{ marginBottom: 8 }}>
        El importe siempre en positivo: el sentido lo pone el tipo.
      </div>

      <div className="field-row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_MOV.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Importe (€)</label>
          <input type="number" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} />
        </div>
        <div className="field">
          <label>Concepto</label>
          <input type="text" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "0 0 auto" }}>
          <button className="btn-secondary" disabled={!puedeAnadir} onClick={anadir}>
            Añadir
          </button>
        </div>
      </div>

      {admiteInterno && (
        <div className="field check" style={{ marginTop: -6 }}>
          <input
            id="inv-mov-interno"
            type="checkbox"
            checked={interno}
            onChange={(e) => setInterno(e.target.checked)}
          />
          <label htmlFor="inv-mov-interno">
            Se queda dentro del producto (no llega a la cuenta del banco)
          </label>
        </div>
      )}

      {detalle.movimientos.length === 0 ? (
        <div className="hint">Todavía no hay movimientos.</div>
      ) : (
        <table className="tabla-mini">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th style={{ textAlign: "right" }}>Importe</th>
              <th>Concepto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {detalle.movimientos.map((m) => (
              <tr key={m.id}>
                <td>{fmtFechaES(m.fecha)}</td>
                <td>
                  {m.tipo}
                  {m.interno && <span className="hint"> · dentro</span>}
                </td>
                <td style={{ textAlign: "right" }}>{eur(m.importe)}</td>
                <td>{m.concepto ?? "—"}</td>
                <td className="acciones">
                  <button
                    className="btn-link"
                    onClick={() => confirm("¿Borrar este movimiento?") && onBorrar(m.id)}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ──────────────────────────── Valoraciones (cuánto vale a una fecha) ────────────────────────────
function Valoraciones({
  detalle,
  onCrear,
  onBorrar,
}: {
  detalle: InversionDetalle;
  onCrear: (datos: {
    fecha: string;
    valor: number;
    participaciones: number | null;
    valor_liquidativo: number | null;
    notas: string | null;
  }) => void;
  onBorrar: (valId: number) => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [valor, setValor] = useState("");
  const [parts, setParts] = useState("");
  const [vl, setVl] = useState("");

  const puedeAnadir = valor !== "" && !!fecha;

  function anadir() {
    onCrear({
      fecha,
      valor: Number(valor),
      participaciones: parts === "" ? null : Number(parts),
      valor_liquidativo: vl === "" ? null : Number(vl),
      notas: null,
    });
    setValor("");
    setParts("");
    setVl("");
  }

  return (
    <section style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 4px" }}>Cuánto vale (valoraciones)</h3>
      <div className="hint" style={{ marginBottom: 8 }}>
        Copia del extracto de la entidad lo que vale a esa fecha. Con una al mes basta; la última manda.
      </div>

      <div className="field-row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Vale (€)</label>
          <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Participaciones</label>
          <input type="number" step="0.000001" value={parts} onChange={(e) => setParts(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Valor liquidativo</label>
          <input type="number" step="0.000001" value={vl} onChange={(e) => setVl(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "0 0 auto" }}>
          <button className="btn-secondary" disabled={!puedeAnadir} onClick={anadir}>
            Añadir
          </button>
        </div>
      </div>

      {detalle.valoraciones.length === 0 ? (
        <div className="hint">Todavía no hay ninguna valoración: el valor que se muestra es una estimación.</div>
      ) : (
        <table className="tabla-mini">
          <thead>
            <tr>
              <th>Fecha</th>
              <th style={{ textAlign: "right" }}>Vale</th>
              <th style={{ textAlign: "right" }}>Participaciones</th>
              <th style={{ textAlign: "right" }}>Valor liquidativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {detalle.valoraciones.map((v, idx) => (
              <tr key={v.id} style={idx === 0 ? { fontWeight: 600 } : undefined}>
                <td>
                  {fmtFechaES(v.fecha)}
                  {idx === 0 && <span className="hint"> · la que cuenta</span>}
                </td>
                <td style={{ textAlign: "right" }}>{eur(v.valor)}</td>
                <td style={{ textAlign: "right" }}>
                  {v.participaciones != null ? fmtMiles(v.participaciones, 6) : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  {v.valor_liquidativo != null ? fmtMiles(v.valor_liquidativo, 6) : "—"}
                </td>
                <td className="acciones">
                  <button
                    className="btn-link"
                    onClick={() => confirm("¿Borrar esta valoración?") && onBorrar(v.id)}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
