import { useEffect, useMemo, useState } from "react";
import { tareasApi, crud, type Tarea, type TareaOcurrencia } from "../api";
import type { Binder } from "../types";
import { fmtFechaES } from "../format";
import FormPanel from "./FormPanel";

// Tareas recurrentes manuales. Dos modos (mismos datos):
//  - Por binder (prop binderId): solo las de ese binder; crear queda enganchado a él.
//  - Global (sin binderId): todas, AGRUPADAS en bloques Agencia → Programa → Binder. Al crear se elige
//    el binder en cascada (Agencia → Programa → Binder).
// La recurrencia se ajusta a la vigencia del binder (desde el efecto/fecha de inicio hasta el vto).

const bindersApi = crud<Binder, unknown>("/binders");
const FRECUENCIAS = ["Única", "Mensual", "Trimestral", "Semestral", "Anual", "Personalizada"];
const CATEGORIAS = ["Risk", "Premium", "Claims", "General"];

type Form = {
  agencia_id: string;     // solo para la cascada al crear (global)
  programa_id: string;    // idem
  binder_id: string;
  titulo: string;
  descripcion: string;
  categoria: string;
  frecuencia: string;
  intervalo_meses: string;
  fecha_inicio: string;
  aviso_dias_antes: string;
  estado: string;
};
const VACIO: Form = {
  agencia_id: "", programa_id: "", binder_id: "", titulo: "", descripcion: "", categoria: "General",
  frecuencia: "Mensual", intervalo_meses: "1", fecha_inicio: "", aviso_dias_antes: "5", estado: "Activa",
};

const PILL: Record<string, [string, string]> = {
  hecha: ["pill-cobrado", "Hecha"],
  vencida: ["pill-pendiente", "Vencida"],
  pendiente: ["pill-parcial", "Pendiente"],
  futura: ["pill-anulado", "Futura"],
};
// Pill y orden por categoría (Risk → Premium → Claims → General).
const CAT_PILL: Record<string, string> = {
  Risk: "pill-parcial", Premium: "pill-cobrado", Claims: "pill-pendiente", General: "pill-anulado",
};
const CAT_ORDEN: Record<string, number> = { Risk: 0, Premium: 1, Claims: 2, General: 3 };

const colACMP = (a: string, b: string) => a.localeCompare(b, "es");

export default function TareasBinder({ binderId }: { binderId?: number }) {
  const esGlobal = binderId == null;
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [binders, setBinders] = useState<Binder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | "nuevo" | null>(null);
  const [autoEdit, setAutoEdit] = useState(false);   // se está editando una tarea automática
  const [sincronizando, setSincronizando] = useState(false);
  const [form, setForm] = useState<Form>(VACIO);
  const [formIni, setFormIni] = useState<Form>(VACIO);

  const [ocDe, setOcDe] = useState<Tarea | null>(null);
  const [ocs, setOcs] = useState<TareaOcurrencia[]>([]);
  const [busyOc, setBusyOc] = useState<string | null>(null);

  async function cargar() {
    try { setTareas(esGlobal ? await tareasApi.listAll() : await tareasApi.list(binderId!)); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    cargar();
    if (esGlobal) {
      bindersApi.list(undefined, 5000)
        .then((bs) => setBinders(bs as Binder[]))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binderId]);

  const set = (k: keyof Form, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(formIni), [form, formIni]);

  // ── Cascada Agencia → Programa → Binder (a partir de la lista de binders) ──
  const agencias = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of binders)
      if (b.productor_id != null) m.set(b.productor_id, b.coverholder_alias || b.coverholder_nombre || `#${b.productor_id}`);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => colACMP(a.nombre, b.nombre));
  }, [binders]);
  const programasDeAgencia = useMemo(() => {
    const aid = Number(form.agencia_id);
    const m = new Map<number, string>();
    for (const b of binders)
      if (b.productor_id === aid && b.programa_id != null) m.set(b.programa_id, b.programa_nombre || `#${b.programa_id}`);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => colACMP(a.nombre, b.nombre));
  }, [binders, form.agencia_id]);
  const bindersDePrograma = useMemo(() => {
    const aid = Number(form.agencia_id), pid = Number(form.programa_id);
    return binders.filter((b) => b.productor_id === aid && b.programa_id === pid)
      .sort((a, b) => colACMP(a.umr ?? "", b.umr ?? ""));
  }, [binders, form.agencia_id, form.programa_id]);

  const onAgencia = (v: string) => setForm((s) => ({ ...s, agencia_id: v, programa_id: "", binder_id: "" }));
  const onPrograma = (v: string) => setForm((s) => ({ ...s, programa_id: v, binder_id: "" }));

  function abrirNuevo() {
    const f = { ...VACIO, binder_id: esGlobal ? "" : String(binderId) };
    setForm(f); setFormIni(f); setEditId("nuevo"); setAutoEdit(false);
  }
  async function sincronizar() {
    if (!confirm("Generar/actualizar las tareas automáticas (Risk/Premium/Claims) desde el BDX de cada binder?")) return;
    setSincronizando(true); setError(null);
    try {
      const r = esGlobal ? await tareasApi.sincronizarTodas() : await tareasApi.sincronizarBinder(binderId!);
      await cargar();
      alert(`Tareas automáticas — creadas: ${r.creadas}, actualizadas: ${r.actualizadas}.`);
    } catch (e) { setError((e as Error).message); } finally { setSincronizando(false); }
  }
  function abrirEdicion(t: Tarea) {
    const f: Form = {
      agencia_id: "", programa_id: "", binder_id: String(t.binder_id), titulo: t.titulo,
      descripcion: t.descripcion ?? "", categoria: t.categoria || "General", frecuencia: t.frecuencia,
      intervalo_meses: t.intervalo_meses == null ? "1" : String(t.intervalo_meses),
      fecha_inicio: t.fecha_inicio ?? "", aviso_dias_antes: String(t.aviso_dias_antes ?? 5), estado: t.estado,
    };
    setForm(f); setFormIni(f); setEditId(t.id);
    setAutoEdit(t.origen === "auto");
  }

  async function guardar() {
    if (!form.titulo.trim()) return setError("El título es obligatorio.");
    const bid = esGlobal ? Number(form.binder_id) : binderId!;
    if (editId === "nuevo" && !bid) return setError("Elige Agencia, Programa y Binder.");
    setError(null); setSaving(true);
    const payload = {
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      categoria: form.categoria,
      frecuencia: form.frecuencia,
      intervalo_meses: form.frecuencia === "Personalizada" ? (Number(form.intervalo_meses) || 1) : null,
      fecha_inicio: form.fecha_inicio || null,
      aviso_dias_antes: Number(form.aviso_dias_antes) || 0,
      estado: form.estado,
    };
    try {
      if (editId === "nuevo") await tareasApi.crear(bid, payload);
      else if (typeof editId === "number") await tareasApi.editar(editId, payload);
      setEditId(null);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function borrar() {
    if (typeof editId !== "number") return;
    if (!confirm("¿Borrar esta tarea y su historial?")) return;
    setSaving(true);
    try { await tareasApi.borrar(editId); setEditId(null); await cargar(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function abrirOc(t: Tarea) {
    setOcDe(t);
    try { setOcs((await tareasApi.ocurrencias(t.id)).ocurrencias); }
    catch (e) { setError((e as Error).message); }
  }
  async function toggleHecha(o: TareaOcurrencia) {
    if (!ocDe) return;
    setBusyOc(o.fecha);
    try {
      await tareasApi.marcarHecha(ocDe.id, { fecha_ocurrencia: o.fecha, deshacer: o.hecha });
      setOcs((await tareasApi.ocurrencias(ocDe.id)).ocurrencias);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setBusyOc(null); }
  }

  // Ordena por categoría (Risk → Premium → Claims → General) y, dentro, por próxima pendiente.
  const porProxima = (a: Tarea, b: Tarea) => {
    const c = (CAT_ORDEN[a.categoria] ?? 9) - (CAT_ORDEN[b.categoria] ?? 9);
    return c !== 0 ? c : (a.proxima ?? "9999").localeCompare(b.proxima ?? "9999");
  };

  // Vista global agrupada en bloques: Agencia → Programa → Binder → tareas.
  const bloques = useMemo(() => {
    if (!esGlobal) return [];
    const ag = new Map<string, Map<string, Map<string, Tarea[]>>>();
    for (const t of tareas) {
      const a = t.agencia || "(sin agencia)";
      const p = t.programa || "(sin programa)";
      const b = t.binder_umr || "—";
      if (!ag.has(a)) ag.set(a, new Map());
      const pm = ag.get(a)!;
      if (!pm.has(p)) pm.set(p, new Map());
      const bm = pm.get(p)!;
      if (!bm.has(b)) bm.set(b, []);
      bm.get(b)!.push(t);
    }
    return [...ag.entries()].sort((x, y) => colACMP(x[0], y[0])).map(([a, pm]) => ({
      agencia: a,
      programas: [...pm.entries()].sort((x, y) => colACMP(x[0], y[0])).map(([p, bm]) => ({
        programa: p,
        binders: [...bm.entries()].sort((x, y) => colACMP(x[0], y[0])).map(([b, ts]) => ({
          binder: b, tareas: [...ts].sort(porProxima),
        })),
      })),
    }));
  }, [tareas, esGlobal]);

  const tablaDe = (ts: Tarea[]) => (
    <table className="compacto" style={{ width: "100%" }}>
      <thead>
        <tr><th>Cat.</th><th>Tarea</th><th>Frecuencia</th><th>Estado</th><th>Próxima pendiente</th><th className="num">Hechas</th><th></th></tr>
      </thead>
      <tbody>
        {ts.map((t) => (
          <tr key={t.id}>
            <td><span className={`pill ${CAT_PILL[t.categoria] ?? "pill-anulado"}`}>{t.categoria}</span></td>
            <td>{t.titulo}{t.origen === "auto" && <span className="hint" style={{ marginLeft: 6 }}>· auto</span>}</td>
            <td>{t.frecuencia === "Personalizada" ? `Cada ${t.intervalo_meses} meses` : t.frecuencia}</td>
            <td>{t.estado}</td>
            <td>{t.proxima ? fmtFechaES(t.proxima) : "—"}</td>
            <td className="num">{t.n_hechas}/{t.n_ocurrencias}</td>
            <td className="acciones" style={{ whiteSpace: "nowrap" }}>
              <button className="btn-link" onClick={() => abrirEdicion(t)}>Editar</button>
              {" · "}
              <button className="btn-link" onClick={() => abrirOc(t)}>Ocurrencias</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8, justifyContent: "flex-end", gap: 8 }}>
        <button className="btn-secondary" onClick={sincronizar} disabled={sincronizando}
          title="Crea/actualiza las tareas Risk/Premium/Claims desde el intervalo y plazo de BDX del binder">
          {sincronizando ? "Generando…" : "🔄 Generar automáticas"}
        </button>
        <button className="btn-primary" onClick={abrirNuevo}>＋ Nueva tarea</button>
      </div>
      {error && <div className="error">{error}</div>}

      {tareas.length === 0 ? (
        <div className="empty">{esGlobal ? "No hay tareas todavía." : "No hay tareas para este binder todavía."}</div>
      ) : esGlobal ? (
        <div className="tareas-bloques">
          {bloques.map((a) => (
            <section key={a.agencia} style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 16, borderBottom: "2px solid var(--borde, #d0d4dc)", paddingBottom: 4 }}>
                🏢 {a.agencia}
              </h3>
              {a.programas.map((p) => (
                <div key={p.programa} style={{ margin: "0 0 14px 12px" }}>
                  <div style={{ fontWeight: 600, color: "var(--texto-suave, #555)", margin: "8px 0 4px" }}>
                    📋 {p.programa}
                  </div>
                  {p.binders.map((b) => (
                    <div key={b.binder} style={{ margin: "0 0 8px 12px" }}>
                      <div style={{ fontSize: 13, color: "var(--texto-suave, #666)", margin: "4px 0 2px" }}>📑 {b.binder}</div>
                      {tablaDe(b.tareas)}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        tablaDe([...tareas].sort(porProxima))
      )}

      {editId !== null && (
        <FormPanel
          title={editId === "nuevo" ? "Nueva tarea" : "Editar tarea"}
          dirty={dirty} saving={saving}
          onSave={guardar} onClose={() => setEditId(null)}
          onDelete={typeof editId === "number" ? borrar : undefined}
        >
          {esGlobal && (
            editId === "nuevo" ? (
              <>
                <div className="field">
                  <label>Agencia *</label>
                  <select value={form.agencia_id} onChange={(e) => onAgencia(e.target.value)}>
                    <option value="">— elegir —</option>
                    {agencias.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Programa *</label>
                  <select value={form.programa_id} disabled={!form.agencia_id} onChange={(e) => onPrograma(e.target.value)}>
                    <option value="">{form.agencia_id ? "— elegir —" : "elige primero la agencia"}</option>
                    {programasDeAgencia.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Binder *</label>
                  <select value={form.binder_id} disabled={!form.programa_id} onChange={(e) => set("binder_id", e.target.value)}>
                    <option value="">{form.programa_id ? "— elegir —" : "elige primero el programa"}</option>
                    {bindersDePrograma.map((b) => <option key={b.id} value={b.id}>{b.umr || b.agreement_number || `#${b.id}`}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="field">
                <label>Binder</label>
                <input type="text" value={binders.find((b) => String(b.id) === form.binder_id)?.umr ?? form.binder_id} disabled />
              </div>
            )
          )}
          <div className="field">
            <label>Título *</label>
            <input type="text" value={form.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="p. ej. Revisar bordereaux" />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
          </div>
          <div className="field">
            <label>Categoría *</label>
            <select value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {autoEdit && (
            <div className="hint" style={{ marginBottom: 8 }}>
              Tarea <b>automática</b>: la recurrencia y las fechas se recalculan desde el BDX del binder al
              sincronizar. Puedes ajustar el aviso o pausarla; los demás cambios se sobrescribirán.
            </div>
          )}
          <div className="field">
            <label>Frecuencia *</label>
            <select value={form.frecuencia} onChange={(e) => set("frecuencia", e.target.value)}>
              {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {form.frecuencia === "Personalizada" && (
            <div className="field">
              <label>Cada cuántos meses *</label>
              <input type="number" min={1} value={form.intervalo_meses} onChange={(e) => set("intervalo_meses", e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>Fecha de inicio</label>
            <input type="date" value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} />
            <span className="hint">Vacío = fecha de efecto del binder. Las ocurrencias van hasta el vencimiento.</span>
          </div>
          <div className="field">
            <label>Avisar (días antes)</label>
            <input type="number" min={0} max={90} value={form.aviso_dias_antes} onChange={(e) => set("aviso_dias_antes", e.target.value)} />
          </div>
          {typeof editId === "number" && (
            <div className="field">
              <label>Estado</label>
              <select value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                <option value="Activa">Activa</option>
                <option value="Pausada">Pausada</option>
                <option value="Finalizada">Finalizada</option>
              </select>
            </div>
          )}
        </FormPanel>
      )}

      {ocDe && (
        <FormPanel
          title={`Ocurrencias — ${ocDe.titulo}`}
          dirty={false} saving={false} saveLabel="Cerrar" wide
          onSave={() => setOcDe(null)} onClose={() => setOcDe(null)}
        >
          {ocs.length === 0 ? (
            <div className="empty">Sin ocurrencias (revisa la vigencia del binder y la frecuencia).</div>
          ) : (
            <table className="compacto" style={{ width: "100%" }}>
              <thead>
                <tr><th>Fecha</th><th>Estado</th><th>Hecha el</th><th></th></tr>
              </thead>
              <tbody>
                {[...ocs].reverse().map((o) => {
                  const [cls, txt] = PILL[o.estado] ?? ["pill-anulado", o.estado];
                  return (
                    <tr key={o.fecha}>
                      <td>{fmtFechaES(o.fecha)}</td>
                      <td><span className={`pill ${cls}`}>{txt}</span></td>
                      <td>{o.fecha_hecha ? fmtFechaES(o.fecha_hecha) : "—"}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        {o.hecha
                          ? <button className="btn-link btn-sm" disabled={busyOc === o.fecha} onClick={() => toggleHecha(o)}>Deshacer</button>
                          : <button className="btn-primary btn-sm" disabled={busyOc === o.fecha} onClick={() => toggleHecha(o)}>{busyOc === o.fecha ? "…" : "Marcar hecha"}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </FormPanel>
      )}
    </>
  );
}
