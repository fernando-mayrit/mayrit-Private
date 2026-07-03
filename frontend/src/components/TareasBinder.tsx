import { Fragment, useEffect, useMemo, useState } from "react";
import { tareasApi, crud, type Tarea, type TareaOcurrencia, type TareaPasoEstado, type TareaAgendaItem } from "../api";
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
// Reglas de auto-marcado de un paso (se tacha solo cuando el dato del periodo existe en la app).
const REGLAS_AUTO: { v: string; label: string }[] = [
  { v: "", label: "Manual" },
  { v: "risk", label: "Risk cargado" },
  { v: "premium", label: "Premium cargado" },
  { v: "lpan", label: "LPAN preparado" },
  { v: "claims", label: "Claims/Snapshot" },
];
const reglaLabel = (r?: string | null) => REGLAS_AUTO.find((x) => x.v === (r || ""))?.label ?? "Manual";

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
  secuencial: boolean;
};
const VACIO: Form = {
  agencia_id: "", programa_id: "", binder_id: "", titulo: "", descripcion: "", categoria: "General",
  frecuencia: "Mensual", intervalo_meses: "1", fecha_inicio: "", aviso_dias_antes: "5", estado: "Activa",
  secuencial: false,
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
  const [ocExpand, setOcExpand] = useState<string | null>(null);   // fecha de la ocurrencia con checklist abierto

  // Pasos (checklist) editados DENTRO del formulario de la tarea. Se persisten al Guardar.
  // Cada uno lleva su id si ya existe en el servidor; sin id = nuevo.
  type PasoEdit = { id?: number; titulo: string; regla_auto?: string | null };
  const [formPasos, setFormPasos] = useState<PasoEdit[]>([]);
  const [pasosIni, setPasosIni] = useState<PasoEdit[]>([]);   // snapshot para detectar cambios / diff al guardar
  const [nuevoPaso, setNuevoPaso] = useState("");

  const [vista, setVista] = useState<"bloques" | "mes">("bloques");
  const [soloPend, setSoloPend] = useState(true);
  const [agenda, setAgenda] = useState<TareaAgendaItem[]>([]);
  const [agCol, setAgCol] = useState<Record<string, boolean>>({});   // agencias plegadas (bloques)
  // Binder anterior del mismo programa (para copiar su esquema de tareas). Solo en vista de binder.
  const [prevInfo, setPrevInfo] = useState<{ binder_umr: string | null; n_tareas: number } | null>(null);

  async function cargar() {
    try { setTareas(esGlobal ? await tareasApi.listAll() : await tareasApi.list(binderId!)); }
    catch (e) { setError((e as Error).message); }
  }
  async function cargarAgenda() {
    try { setAgenda(await tareasApi.agenda({ binderId: esGlobal ? undefined : binderId, soloPendientes: soloPend })); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    cargar();
    if (esGlobal) {
      bindersApi.list(undefined, 5000)
        .then((bs) => setBinders(bs as Binder[]))
        .catch(() => {});
    } else {
      // Info del binder anterior del mismo programa (para el botón "copiar esquema").
      tareasApi.tareasAnterior(binderId!).then(setPrevInfo).catch(() => setPrevInfo(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binderId]);

  // El botón de copiar aparece si hay un binder anterior con esquema y ESTE binder aún NO tiene
  // esquema propio: ninguna tarea manual y ninguna automática con checklist (pasos). Tras copiar,
  // `tareas` incluye ese esquema → el botón desaparece solo (evita duplicados).
  const puedeCopiar = !esGlobal && (prevInfo?.n_tareas ?? 0) > 0
    && !tareas.some((t) => t.origen === "manual" || (t.n_pasos ?? 0) > 0);
  async function copiarEsquema() {
    if (!binderId || !puedeCopiar || !prevInfo) return;
    if (!window.confirm(`Copiar el esquema de tareas (con sus checklists) del binder anterior (${prevInfo.binder_umr ?? "—"}) a este binder?`)) return;
    setSaving(true); setError(null);
    try {
      const r = await tareasApi.copiarAnterior(binderId);
      await cargar();
      alert(`Copiado el esquema del binder ${r.desde_binder_umr ?? ""}: ${r.tareas} tarea(s) y ${r.pasos} paso(s).`);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  useEffect(() => {
    if (vista === "mes") cargarAgenda();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, soloPend, binderId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(formIni) || JSON.stringify(formPasos) !== JSON.stringify(pasosIni),
    [form, formIni, formPasos, pasosIni]
  );

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
    setFormPasos([]); setPasosIni([]); setNuevoPaso("");
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
  async function abrirEdicion(t: Tarea) {
    const f: Form = {
      agencia_id: "", programa_id: "", binder_id: String(t.binder_id), titulo: t.titulo,
      descripcion: t.descripcion ?? "", categoria: t.categoria || "General", frecuencia: t.frecuencia,
      intervalo_meses: t.intervalo_meses == null ? "1" : String(t.intervalo_meses),
      fecha_inicio: t.fecha_inicio ?? "", aviso_dias_antes: String(t.aviso_dias_antes ?? 5), estado: t.estado,
      secuencial: !!t.secuencial,
    };
    setForm(f); setFormIni(f); setEditId(t.id);
    setAutoEdit(t.origen === "auto");
    setFormPasos([]); setPasosIni([]); setNuevoPaso("");
    try {
      const ps = (await tareasApi.pasos(t.id)).map((p) => ({ id: p.id, titulo: p.titulo, regla_auto: p.regla_auto ?? null }));
      setFormPasos(ps); setPasosIni(ps);
    } catch (e) { setError((e as Error).message); }
  }

  async function guardar() {
    if (!form.titulo.trim()) return setError("El título es obligatorio.");
    const bid = esGlobal ? Number(form.binder_id) : binderId!;
    if (editId === "nuevo") {
      // Al crear, todos los campos son obligatorios.
      if (!bid) return setError("Elige Agencia, Programa y Binder.");
      if (!form.categoria) return setError("La categoría es obligatoria.");
      if (!form.frecuencia) return setError("La frecuencia es obligatoria.");
      if (form.frecuencia === "Personalizada" && !(Number(form.intervalo_meses) >= 1))
        return setError("Indica cada cuántos meses se repite.");
      if (!form.fecha_inicio) return setError("La fecha de inicio es obligatoria.");
      if (form.aviso_dias_antes.trim() === "" || Number.isNaN(Number(form.aviso_dias_antes)))
        return setError("Indica los días de aviso.");
    }
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
      secuencial: form.secuencial,
    };
    try {
      let tareaId: number;
      if (editId === "nuevo") tareaId = (await tareasApi.crear(bid, payload)).id;
      else if (typeof editId === "number") { await tareasApi.editar(editId, payload); tareaId = editId; }
      else return;
      await persistPasos(tareaId);
      setEditId(null);
      await cargar();
      await recargarOcs();   // si el panel de ocurrencias de esta tarea está abierto, refrescarlo
      if (vista === "mes") await cargarAgenda();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  // Sincroniza la lista de pasos del formulario contra el servidor: borra los quitados, crea los nuevos
  // y actualiza título/orden de los cambiados. Conserva el id de los existentes (y con él su historial).
  async function persistPasos(tareaId: number) {
    const vivos = new Set(formPasos.filter((p) => p.id != null).map((p) => p.id));
    for (const o of pasosIni) if (o.id != null && !vivos.has(o.id)) await tareasApi.borrarPaso(o.id);
    for (let i = 0; i < formPasos.length; i++) {
      const p = formPasos[i], orden = i + 1, titulo = p.titulo.trim();
      if (!titulo) continue;
      if (p.id == null) {
        await tareasApi.crearPaso(tareaId, { titulo, orden, regla_auto: p.regla_auto || null });
        continue;
      }
      const o = pasosIni.find((x) => x.id === p.id);
      const movido = pasosIni.findIndex((x) => x.id === p.id) !== i;
      const renombrado = !o || o.titulo !== titulo;
      const reglaCambia = (o?.regla_auto ?? null) !== (p.regla_auto ?? null);
      if (renombrado || movido || reglaCambia) {
        await tareasApi.editarPaso(p.id, {
          ...(renombrado ? { titulo } : {}),
          ...(movido ? { orden } : {}),
          ...(reglaCambia ? { regla_auto: p.regla_auto || null } : {}),
        });
      }
    }
  }
  async function borrar() {
    if (typeof editId !== "number") return;
    if (!confirm("¿Borrar esta tarea y su historial?")) return;
    setSaving(true);
    try { await tareasApi.borrar(editId); setEditId(null); await cargar(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function abrirOc(t: Tarea) {
    setOcDe(t); setOcExpand(null); setOcs([]);
    try { setOcs((await tareasApi.ocurrencias(t.id)).ocurrencias); }
    catch (e) { setError((e as Error).message); }
  }
  // Despliegue inline: si la tarea ya está abierta, cierra; si no, la abre.
  function toggleOc(t: Tarea) {
    if (ocDe?.id === t.id) setOcDe(null);
    else abrirOc(t);
  }
  async function recargarOcs() {
    if (!ocDe) return;
    setOcs((await tareasApi.ocurrencias(ocDe.id)).ocurrencias);
  }
  async function toggleHecha(o: TareaOcurrencia) {
    if (!ocDe) return;
    setBusyOc(o.fecha);
    try {
      await tareasApi.marcarHecha(ocDe.id, { fecha_ocurrencia: o.fecha, deshacer: o.hecha });
      await recargarOcs();
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setBusyOc(null); }
  }
  async function togglePaso(o: TareaOcurrencia, ps: TareaPasoEstado) {
    if (!ocDe) return;
    setBusyOc(o.fecha + ps.paso_id);
    try {
      await tareasApi.marcarPaso(ps.paso_id, { fecha_ocurrencia: o.fecha, deshacer: ps.hecho });
      await recargarOcs();
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setBusyOc(null); }
  }

  // ── Editor de pasos (checklist) DENTRO del formulario (todo local; se guarda al pulsar Guardar) ──
  function addPaso() {
    const titulo = nuevoPaso.trim();
    if (!titulo) return;
    setFormPasos((s) => [...s, { titulo }]);
    setNuevoPaso("");
  }
  function setPasoTitulo(i: number, titulo: string) {
    setFormPasos((s) => s.map((p, k) => (k === i ? { ...p, titulo } : p)));
  }
  function setPasoRegla(i: number, regla: string) {
    setFormPasos((s) => s.map((p, k) => (k === i ? { ...p, regla_auto: regla || null } : p)));
  }
  function delPaso(i: number) {
    setFormPasos((s) => s.filter((_, k) => k !== i));
  }
  function moverPaso(i: number, dir: -1 | 1) {
    const j = i + dir;
    setFormPasos((s) => {
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
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

  // Vista por mes: agrupa las entregas por mes → categoría (Risk/Premium/Claims) → binder.
  const meses = useMemo(() => {
    const m = new Map<string, Map<string, Map<string, TareaAgendaItem[]>>>();
    for (const a of agenda) {
      const k = a.fecha.slice(0, 7);          // YYYY-MM
      const cat = a.categoria || "General";
      const bnd = a.binder_umr || "—";
      if (!m.has(k)) m.set(k, new Map());
      const cm = m.get(k)!;
      if (!cm.has(cat)) cm.set(cat, new Map());
      const bm = cm.get(cat)!;
      if (!bm.has(bnd)) bm.set(bnd, []);
      bm.get(bnd)!.push(a);
    }
    const esPend = (i: TareaAgendaItem) => i.estado === "vencida" || i.estado === "pendiente";
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([mes, cm]) => ({
      mes,
      pendientes: [...cm.values()].reduce((n, bm) => n + [...bm.values()].flat().filter(esPend).length, 0),
      categorias: [...cm.entries()]
        .sort((x, y) => (CAT_ORDEN[x[0]] ?? 9) - (CAT_ORDEN[y[0]] ?? 9))
        .map(([cat, bm]) => ({
          cat,
          binders: [...bm.entries()].sort((x, y) => colACMP(x[0], y[0])).map(([binder, items]) => ({
            binder,
            items: items.sort((p, q) => p.fecha.localeCompare(q.fecha) || colACMP(p.titulo, q.titulo)),
          })),
        })),
    }));
  }, [agenda]);
  const mesLabel = (ym: string) => {
    const [y, mm] = ym.split("-").map(Number);
    const s = new Date(y, mm - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  async function toggleHechaAgenda(a: TareaAgendaItem) {
    setBusyOc(a.tarea_id + a.fecha);
    try {
      await tareasApi.marcarHecha(a.tarea_id, { fecha_ocurrencia: a.fecha, deshacer: a.estado === "hecha" });
      await Promise.all([cargar(), cargarAgenda()]);
    } catch (e) { setError((e as Error).message); } finally { setBusyOc(null); }
  }
  async function togglePasoAgenda(a: TareaAgendaItem, ps: TareaPasoEstado) {
    setBusyOc(a.tarea_id + a.fecha + ps.paso_id);
    try {
      await tareasApi.marcarPaso(ps.paso_id, { fecha_ocurrencia: a.fecha, deshacer: ps.hecho });
      await Promise.all([cargar(), cargarAgenda()]);
    } catch (e) { setError((e as Error).message); } finally { setBusyOc(null); }
  }

  // Lista de pasos (checklist) de una entrega. Los pasos auto salen bloqueados; los manuales se marcan.
  const listaPasos = (
    pasos: TareaPasoEstado[],
    onToggle: (ps: TareaPasoEstado) => void,
    busyKey: (ps: TareaPasoEstado) => string,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0 6px 26px" }}>
      {pasos.map((ps) => {
        const esAuto = !!ps.regla_auto;
        // Secuencial: un paso aún no hecho con algún anterior pendiente sale bloqueado (gris + 🔒).
        const bloqueado = !!ps.bloqueado && !ps.hecho;
        const inerte = esAuto || bloqueado;   // no marcable a mano (auto o bloqueado)
        return (
          <label key={ps.paso_id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: inerte ? "default" : "pointer", opacity: bloqueado ? 0.55 : 1 }}>
            <input type="checkbox" checked={ps.hecho}
              disabled={inerte || busyOc === busyKey(ps)}
              onChange={() => { if (!inerte) onToggle(ps); }} />
            <span style={{ textDecoration: ps.hecho ? "line-through" : "none", color: ps.hecho ? "var(--texto-suave, #888)" : undefined }}>
              {ps.titulo}
            </span>
            {bloqueado && !esAuto && (
              <span className="hint" title="Se desbloquea al completar el paso anterior">· 🔒 bloqueado</span>
            )}
            {esAuto && (
              <span className="hint" title={`Se marca solo: ${reglaLabel(ps.regla_auto)}${ps.periodo ? ` · periodo ${ps.periodo}` : ""}`}>
                · 🔒 auto ({reglaLabel(ps.regla_auto)}{ps.periodo ? ` ${ps.periodo}` : ""}) {ps.hecho ? "✓" : "pendiente"}
              </span>
            )}
            {!esAuto && ps.hecho && ps.fecha_hecha && <span className="hint">· {fmtFechaES(ps.fecha_hecha)}</span>}
          </label>
        );
      })}
    </div>
  );

  // Panel de ocurrencias (entregas) de la tarea abierta (ocDe). Se muestra inline, colgando de la fila.
  const ocurrenciasPanel = () => (
    <div className="tareas-oc-panel">
      {ocs.length === 0 ? (
        <div className="empty">No hay entregas pendientes ni pasadas.</div>
      ) : (
        <table className="compacto" style={{ width: "100%" }}>
          <thead>
            <tr><th>Fecha</th><th>Estado</th><th>Hecha el</th><th></th></tr>
          </thead>
          <tbody>
            {[...ocs].reverse().map((o) => {
              const [cls, txt] = PILL[o.estado] ?? ["pill-anulado", o.estado];
              const pasos = o.pasos ?? [];
              const tienePasos = pasos.length > 0;
              const abierto = ocExpand === o.fecha;
              const nHechos = pasos.filter((p) => p.hecho).length;
              return (
                <Fragment key={o.fecha}>
                  <tr>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {tienePasos && (
                        <button className="btn-link btn-sm" style={{ marginRight: 4 }}
                          onClick={() => setOcExpand(abierto ? null : o.fecha)} title="Ver pasos">
                          {abierto ? "▾" : "▸"}
                        </button>
                      )}
                      {fmtFechaES(o.fecha)}
                    </td>
                    <td>
                      <span className={`pill ${cls}`}>{txt}</span>
                      {tienePasos && <span className="hint" style={{ marginLeft: 6 }}>{nHechos}/{pasos.length}</span>}
                    </td>
                    <td>{o.fecha_hecha ? fmtFechaES(o.fecha_hecha) : "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {o.hecha
                        ? <button className="btn-link btn-sm" disabled={busyOc === o.fecha} onClick={() => toggleHecha(o)}>Deshacer</button>
                        : <button className="btn-primary btn-sm" disabled={busyOc === o.fecha} onClick={() => toggleHecha(o)}>{busyOc === o.fecha ? "…" : tienePasos ? "Marcar todo" : "Marcar hecha"}</button>}
                    </td>
                  </tr>
                  {tienePasos && abierto && (
                    <tr>
                      <td colSpan={4} style={{ background: "var(--fondo-suave, #f7f8fa)" }}>
                        {listaPasos(pasos, (ps) => togglePaso(o, ps), (ps) => o.fecha + ps.paso_id)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const tablaDe = (ts: Tarea[]) => (
    <table className="compacto" style={{ width: "100%" }}>
      <thead>
        <tr><th></th><th>Cat.</th><th>Tarea</th><th>Frecuencia</th><th>Estado</th><th>Próxima pendiente</th><th className="num">Hechas</th><th></th></tr>
      </thead>
      <tbody>
        {ts.map((t) => {
          const abierta = ocDe?.id === t.id;
          return (
            <Fragment key={t.id}>
              <tr className={abierta ? "fila-abierta" : undefined}>
                <td style={{ width: 22 }}>
                  <button className="btn-link" title="Ver ocurrencias" onClick={() => toggleOc(t)}>{abierta ? "▾" : "▸"}</button>
                </td>
                <td><span className={`pill ${CAT_PILL[t.categoria] ?? "pill-anulado"}`}>{t.categoria}</span></td>
                <td><button className="btn-link" style={{ fontWeight: 600 }} onClick={() => toggleOc(t)}>{t.titulo}</button>{t.origen === "auto" && <span className="hint" style={{ marginLeft: 6 }}>· auto</span>}</td>
                <td>{t.frecuencia === "Personalizada" ? `Cada ${t.intervalo_meses} meses` : t.frecuencia}</td>
                <td>{t.estado}</td>
                <td>{t.proxima ? fmtFechaES(t.proxima) : "—"}</td>
                <td className="num">{t.n_hechas}/{t.n_ocurrencias}</td>
                <td className="acciones" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => abrirEdicion(t)}>✏️{t.n_pasos ? <span className="hint" style={{ marginLeft: 4 }}>· {t.n_pasos} pasos</span> : ""}</button>
                </td>
              </tr>
              {abierta && (
                <tr className="fila-oc">
                  <td colSpan={8}>{ocurrenciasPanel()}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8, justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* La vista 'Por mes' solo tiene sentido en la página global (control del mes en conjunto). */}
          {esGlobal && (
            <span style={{ display: "inline-flex", gap: 4 }}>
              <button className={vista === "bloques" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setVista("bloques")}>Bloques</button>
              <button className={vista === "mes" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setVista("mes")}>📅 Por mes</button>
            </span>
          )}
          {esGlobal && vista === "mes" && (
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <input type="checkbox" checked={soloPend} onChange={(e) => setSoloPend(e.target.checked)} /> Solo pendientes
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {puedeCopiar && (
            <button className="btn-secondary" onClick={copiarEsquema} disabled={saving}
              title={`Copia el esquema de tareas (con su checklist) del binder anterior del mismo programa: ${prevInfo?.binder_umr ?? ""}`}>
              📋 Copiar esquema del anterior
            </button>
          )}
          <button className="btn-secondary" onClick={sincronizar} disabled={sincronizando}
            title="Crea/actualiza las tareas Risk/Premium/Claims desde el intervalo y plazo de BDX del binder">
            {sincronizando ? "Generando…" : "🔄 Generar automáticas"}
          </button>
          <button className="btn-primary" onClick={abrirNuevo}>＋ Nueva tarea</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {/* En la página global, el contenido va en lista-scroll (header/toolbar fijos, scroll en la lista). */}
      <div className={esGlobal ? "lista-scroll" : undefined}>
      {esGlobal && vista === "mes" ? (
        meses.length === 0 ? (
          <div className="empty">{soloPend ? "No hay tareas pendientes." : "No hay ocurrencias (revisa la vigencia y la frecuencia)."}</div>
        ) : (
          <div className="tareas-meses">
            {meses.map((g) => (
              <section key={g.mes} style={{ marginBottom: 20 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16, borderBottom: "2px solid var(--borde, #d0d4dc)", paddingBottom: 4 }}>
                  📅 {mesLabel(g.mes)}{g.pendientes > 0 && <span className="hint" style={{ marginLeft: 8 }}>· {g.pendientes} pendiente{g.pendientes > 1 ? "s" : ""}</span>}
                </h3>
                {g.categorias.map((c) => (
                  <div key={c.cat} style={{ margin: "0 0 12px 6px" }}>
                    <div style={{ margin: "8px 0 4px" }}>
                      <span className={`pill ${CAT_PILL[c.cat] ?? "pill-anulado"}`}>{c.cat}</span>
                    </div>
                    {c.binders.map((b) => (
                      <div key={b.binder} style={{ margin: "0 0 8px 14px" }}>
                        <div style={{ fontSize: 13, color: "var(--texto-suave, #666)", margin: "4px 0 2px" }}>📑 {b.binder}</div>
                        {b.items.map((a) => {
                          const [cls, txt] = PILL[a.estado] ?? ["pill-anulado", a.estado];
                          const k = a.tarea_id + a.fecha;
                          const tienePasos = a.n_pasos > 0;
                          return (
                            <div key={k} className="tareas-mes-item">
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600 }}>{a.titulo}</span>
                                {a.origen === "auto" && <span className="hint">· auto</span>}
                                <span className="hint">· {fmtFechaES(a.fecha)}</span>
                                <span className={`pill ${cls}`}>{txt}</span>
                                {tienePasos && <span className="hint">{a.n_pasos_hechos}/{a.n_pasos}</span>}
                                <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                                  {a.estado === "hecha"
                                    ? <button className="btn-link btn-sm" disabled={busyOc === k} onClick={() => toggleHechaAgenda(a)}>Deshacer</button>
                                    : <button className="btn-primary btn-sm" disabled={busyOc === k} onClick={() => toggleHechaAgenda(a)}>{busyOc === k ? "…" : tienePasos ? "Marcar todo" : "Marcar hecha"}</button>}
                                </span>
                              </div>
                              {tienePasos && listaPasos(
                                soloPend ? a.pasos.filter((p) => !p.hecho) : a.pasos,
                                (ps) => togglePasoAgenda(a, ps),
                                (ps) => a.tarea_id + a.fecha + ps.paso_id,
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )
      ) : tareas.length === 0 ? (
        <div className="empty">{esGlobal ? "No hay tareas todavía." : "No hay tareas para este binder todavía."}</div>
      ) : esGlobal ? (
        <div className="tareas-bloques">
          {bloques.map((a) => {
            const plegada = agCol[a.agencia] ?? false;
            return (
            <section key={a.agencia} style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 16, borderBottom: "2px solid var(--borde, #d0d4dc)", paddingBottom: 4, cursor: "pointer", userSelect: "none" }}
                onClick={() => setAgCol((s) => ({ ...s, [a.agencia]: !plegada }))}>
                <span style={{ display: "inline-block", width: 18, color: "var(--texto-suave, #777)" }}>{plegada ? "＋" : "－"}</span>
                🏢 {a.agencia}
              </h3>
              {!plegada && a.programas.map((p) => (
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
            );
          })}
        </div>
      ) : (
        tablaDe([...tareas].sort(porProxima))
      )}
      </div>

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
          <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1.3fr 0.9fr" }}>
            <div className="field">
              <label>Título *</label>
              <input type="text" value={form.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="p. ej. Revisar bordereaux" />
            </div>
            <div className="field">
              <label>Categoría *</label>
              <select value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
          </div>
          {autoEdit && (
            <div className="hint" style={{ marginBottom: 8 }}>
              Tarea <b>automática</b>: la recurrencia y las fechas se recalculan desde el BDX del binder al
              sincronizar. Puedes ajustar el aviso o pausarla; los demás cambios se sobrescribirán.
            </div>
          )}
          <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 1fr 0.8fr" }}>
            <div className="field">
              <label>Frecuencia *</label>
              <select value={form.frecuencia} onChange={(e) => set("frecuencia", e.target.value)}>
                {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Fecha de inicio{editId === "nuevo" ? " *" : ""}</label>
              <input type="date" value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} />
            </div>
            <div className="field">
              <label>Avisar (días) *</label>
              <input type="number" min={0} max={90} value={form.aviso_dias_antes} onChange={(e) => set("aviso_dias_antes", e.target.value)} />
            </div>
          </div>
          {form.frecuencia === "Personalizada" && (
            <div className="field">
              <label>Cada cuántos meses *</label>
              <input type="number" min={1} value={form.intervalo_meses} onChange={(e) => set("intervalo_meses", e.target.value)} />
            </div>
          )}
          {editId !== "nuevo" && (
            <span className="hint" style={{ marginTop: -6, marginBottom: 10, display: "block" }}>
              Fecha de inicio vacía = fecha de efecto del binder. Las ocurrencias van hasta el vencimiento.
            </span>
          )}
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

          {/* Pasos (checklist): se repiten en cada entrega y se van marcando en «Ocurrencias». */}
          <div className="field">
            <label>Pasos (checklist)</label>
            <span className="hint" style={{ marginBottom: 6 }}>
              Lista de pasos que se repite en cada entrega. Se van marcando en «Ocurrencias». Un paso con
              <b> marcado automático</b> se tacha solo cuando el dato del periodo ya está en la app (no hay que
              tocarlo). Cuando se completan todos, la entrega cuenta como hecha.
            </span>
            <label className="check" style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 0 8px", fontSize: 13 }}>
              <input type="checkbox" checked={form.secuencial} onChange={(e) => set("secuencial", e.target.checked)} />
              <b>Pasos secuenciales</b> — cada paso se desbloquea al completar el anterior (los siguientes salen 🔒 hasta que toquen).
            </label>
            {formPasos.length > 0 && (
              <ol style={{ paddingLeft: 20, margin: "2px 0 8px" }}>
                {formPasos.map((p, i) => (
                  <li key={i} style={{ margin: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="text" value={p.titulo} style={{ flex: 1 }}
                        onChange={(e) => setPasoTitulo(i, e.target.value)} />
                      <button type="button" className="btn-link btn-sm" disabled={i === 0} onClick={() => moverPaso(i, -1)} title="Subir">↑</button>
                      <button type="button" className="btn-link btn-sm" disabled={i === formPasos.length - 1} onClick={() => moverPaso(i, 1)} title="Bajar">↓</button>
                      <button type="button" className="btn-link btn-sm" onClick={() => delPaso(i)} title="Quitar">✕</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 2, marginTop: 2 }}>
                      <span className="hint">Marcado:</span>
                      <select value={p.regla_auto ?? ""} onChange={(e) => setPasoRegla(i, e.target.value)}
                        title="Cómo se marca este paso" style={{ fontSize: 12, padding: "2px 4px" }}>
                        {REGLAS_AUTO.map((r) => <option key={r.v} value={r.v}>{r.v ? `Auto · ${r.label}` : "Manual"}</option>)}
                      </select>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" value={nuevoPaso} style={{ flex: 1 }}
                placeholder="Añadir paso — p. ej. Recopilar datos del coverholder"
                onChange={(e) => setNuevoPaso(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPaso(); } }} />
              <button type="button" className="btn-secondary btn-sm" disabled={!nuevoPaso.trim()} onClick={addPaso}>＋ Añadir</button>
            </div>
          </div>
        </FormPanel>
      )}
    </>
  );
}
