import { useEffect, useMemo, useState } from "react";
import { tareasApi, crud, type Tarea, type TareaOcurrencia } from "../api";
import type { Binder } from "../types";
import { fmtFechaES } from "../format";
import FormPanel from "./FormPanel";

// Tareas recurrentes manuales. Dos modos (mismos datos):
//  - Por binder (prop binderId): solo las de ese binder; crear queda enganchado a él.
//  - Global (sin binderId): todas las de todos los binders, con columna y selector de Binder.
// La recurrencia se ajusta a la vigencia del binder (desde el efecto/fecha de inicio hasta el vto).

const bindersApi = crud<Binder, unknown>("/binders");
const FRECUENCIAS = ["Única", "Mensual", "Trimestral", "Semestral", "Anual", "Personalizada"];

type Form = {
  binder_id: string;
  titulo: string;
  descripcion: string;
  frecuencia: string;
  intervalo_meses: string;
  fecha_inicio: string;
  aviso_dias_antes: string;
  estado: string;
};
const VACIO: Form = {
  binder_id: "", titulo: "", descripcion: "", frecuencia: "Mensual", intervalo_meses: "1",
  fecha_inicio: "", aviso_dias_antes: "5", estado: "Activa",
};

const PILL: Record<string, [string, string]> = {
  hecha: ["pill-cobrado", "Hecha"],
  vencida: ["pill-pendiente", "Vencida"],
  pendiente: ["pill-parcial", "Pendiente"],
  futura: ["pill-anulado", "Futura"],
};

export default function TareasBinder({ binderId }: { binderId?: number }) {
  const esGlobal = binderId == null;
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [binders, setBinders] = useState<Binder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | "nuevo" | null>(null);
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
        .then((bs) => setBinders((bs as Binder[]).sort((a, b) => (a.umr ?? "").localeCompare(b.umr ?? "", "es"))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binderId]);

  const set = (k: keyof Form, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(formIni), [form, formIni]);

  function abrirNuevo() {
    const f = { ...VACIO, binder_id: esGlobal ? "" : String(binderId) };
    setForm(f); setFormIni(f); setEditId("nuevo");
  }
  function abrirEdicion(t: Tarea) {
    const f: Form = {
      binder_id: String(t.binder_id), titulo: t.titulo, descripcion: t.descripcion ?? "", frecuencia: t.frecuencia,
      intervalo_meses: t.intervalo_meses == null ? "1" : String(t.intervalo_meses),
      fecha_inicio: t.fecha_inicio ?? "", aviso_dias_antes: String(t.aviso_dias_antes ?? 5), estado: t.estado,
    };
    setForm(f); setFormIni(f); setEditId(t.id);
  }

  async function guardar() {
    if (!form.titulo.trim()) return setError("El título es obligatorio.");
    const bid = esGlobal ? Number(form.binder_id) : binderId!;
    if (editId === "nuevo" && !bid) return setError("Elige el binder.");
    setError(null); setSaving(true);
    const payload = {
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
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

  // En la página global, ordena por próxima pendiente (más urgente primero; las sin próxima al final).
  const filas = useMemo(() => {
    if (!esGlobal) return tareas;
    return [...tareas].sort((a, b) => (a.proxima ?? "9999").localeCompare(b.proxima ?? "9999"));
  }, [tareas, esGlobal]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8, justifyContent: "flex-end" }}>
        <button className="btn-primary" onClick={abrirNuevo}>＋ Nueva tarea</button>
      </div>
      {error && <div className="error">{error}</div>}

      {filas.length === 0 ? (
        <div className="empty">{esGlobal ? "No hay tareas todavía." : "No hay tareas para este binder todavía."}</div>
      ) : (
        <table className="compacto" style={{ width: "100%" }}>
          <thead>
            <tr>
              {esGlobal && <th>Binder</th>}
              <th>Tarea</th><th>Frecuencia</th><th>Estado</th><th>Próxima pendiente</th>
              <th className="num">Hechas</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((t) => (
              <tr key={t.id}>
                {esGlobal && <td>{t.binder_umr ?? "—"}</td>}
                <td>{t.titulo}</td>
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
              <div className="field">
                <label>Binder *</label>
                <select value={form.binder_id} onChange={(e) => set("binder_id", e.target.value)}>
                  <option value="">— elegir —</option>
                  {binders.map((b) => <option key={b.id} value={b.id}>{b.umr || b.agreement_number || `#${b.id}`}</option>)}
                </select>
              </div>
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
