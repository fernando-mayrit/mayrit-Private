import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PageHeader from "../components/PageHeader";
import { manualApi } from "../api";
import type { ManualSeccion, ManualSeccionWrite } from "../types";

// Manual de uso (v2): secciones EDITABLES desde la app (cuerpo en Markdown, guardadas en BD).
// Cualquier usuario puede editar. Convención de recuadros: un párrafo que empieza por 📌 se pinta
// como "regla" y por ⚠️ como "aviso".

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPONENTES: any = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p({ node, children }: any) {
    const first = node?.children?.[0];
    const t = first && first.type === "text" ? (first.value as string) : "";
    if (t.startsWith("📌")) return <div className="manual-regla">{children}</div>;
    if (t.startsWith("⚠️")) return <div className="manual-ojo">{children}</div>;
    return <p>{children}</p>;
  },
};

function Markdown({ texto }: { texto: string }) {
  return (
    <div className="manual-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>{texto}</ReactMarkdown>
    </div>
  );
}

const VACIO: ManualSeccionWrite = { emoji: "", titulo: "", cuerpo: "" };

export default function ManualPage() {
  const [secs, setSecs] = useState<ManualSeccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<ManualSeccionWrite>(VACIO);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true); setError(null);
    try { setSecs(await manualApi.listar()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  function irA(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const set = (k: keyof ManualSeccionWrite, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function nueva() { setEditingId("new"); setForm(VACIO); }
  function editar(s: ManualSeccion) { setEditingId(s.id); setForm({ emoji: s.emoji, titulo: s.titulo, cuerpo: s.cuerpo }); }
  function cancelar() { setEditingId(null); setForm(VACIO); }

  async function guardar() {
    if (!form.titulo.trim() && !form.cuerpo.trim()) { setError("La sección necesita al menos un título o un cuerpo."); return; }
    setSaving(true); setError(null);
    try {
      if (editingId === "new") await manualApi.crear(form);
      else if (typeof editingId === "number") await manualApi.actualizar(editingId, form);
      cancelar();
      await cargar();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function borrar(s: ManualSeccion) {
    if (!confirm(`¿Borrar la sección «${s.titulo || "(sin título)"}»?`)) return;
    setError(null);
    try { await manualApi.borrar(s.id); await cargar(); }
    catch (e) { setError((e as Error).message); }
  }

  async function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= secs.length) return;
    const arr = [...secs];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setSecs(arr);   // optimista
    try { setSecs(await manualApi.reordenar(arr.map((s) => s.id))); }
    catch (e) { setError((e as Error).message); cargar(); }
  }

  const anchorId = (s: ManualSeccion) => `manual-${s.id}`;

  // Editor inline de una sección (nueva o existente).
  const Editor = () => (
    <div className="manual-editor">
      <div className="manual-editor-fila">
        <input className="manual-emoji-input" placeholder="📌" value={form.emoji}
          onChange={(e) => set("emoji", e.target.value)} />
        <input className="manual-titulo-input" placeholder="Título de la sección" value={form.titulo}
          onChange={(e) => set("titulo", e.target.value)} autoFocus />
      </div>
      <textarea className="manual-cuerpo-input" rows={12} placeholder="Texto en Markdown…" value={form.cuerpo}
        onChange={(e) => set("cuerpo", e.target.value)} />
      <div className="hint manual-md-ayuda">
        Markdown: <code>**negrita**</code>, listas con <code>- </code>, tablas, <code>`código`</code>.
        Un párrafo que empiece por 📌 sale como recuadro de regla; por ⚠️ como aviso.
      </div>
      {form.cuerpo.trim() && (
        <div className="manual-preview">
          <div className="manual-preview-tit">Vista previa</div>
          <Markdown texto={form.cuerpo} />
        </div>
      )}
      <div className="manual-editor-acciones">
        <button className="btn-primary" onClick={guardar} disabled={saving}>{saving ? "Guardando…" : "💾 Guardar"}</button>
        <button className="btn-secondary" onClick={cancelar} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );

  return (
    <div className="container manual-page">
      <PageHeader emoji="📖" title="Manual de uso" />
      <div className="manual-top">
        <p className="manual-intro">Guía de los flujos y reglas de la app. Cualquiera puede editarla.</p>
        <button className={"btn-secondary btn-sm" + (edit ? " active" : "")} onClick={() => { setEdit((v) => !v); cancelar(); }}>
          {edit ? "✅ Hecho" : "✏️ Editar"}
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : edit ? (
        // ── Modo edición: lista con controles + editor inline ──
        <div className="manual-content">
          {secs.map((s, i) => (
            <section key={s.id} className="manual-seccion manual-seccion-edit">
              <div className="manual-seccion-barra">
                <h2 className="manual-seccion-tit"><span className="manual-seccion-emoji">{s.emoji}</span> {s.titulo || <em>(sin título)</em>}</h2>
                <div className="manual-seccion-btns">
                  <button className="btn-icon" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>▲</button>
                  <button className="btn-icon" title="Bajar" disabled={i === secs.length - 1} onClick={() => mover(i, 1)}>▼</button>
                  <button className="btn-icon" title="Editar" onClick={() => editar(s)}>✏️</button>
                  <button className="btn-icon btn-icon-rojo" title="Borrar" onClick={() => borrar(s)}>🗑️</button>
                </div>
              </div>
              {editingId === s.id && <Editor />}
            </section>
          ))}
          {editingId === "new" ? (
            <section className="manual-seccion manual-seccion-edit"><Editor /></section>
          ) : (
            <button className="btn-secondary manual-add" onClick={nueva}>＋ Añadir sección</button>
          )}
        </div>
      ) : secs.length === 0 ? (
        <div className="empty">El manual está vacío. Pulsa «✏️ Editar» para añadir la primera sección.</div>
      ) : (
        // ── Modo lectura: índice + secciones ──
        <div className="manual-layout">
          <nav className="manual-toc">
            <div className="manual-toc-tit">Contenido</div>
            {secs.map((s) => (
              <button key={s.id} className="manual-toc-item" onClick={() => irA(anchorId(s))}>
                <span className="manual-toc-emoji">{s.emoji}</span> {s.titulo}
              </button>
            ))}
          </nav>
          <div className="manual-content">
            {secs.map((s) => (
              <section key={s.id} id={anchorId(s)} className="manual-seccion">
                <h2 className="manual-seccion-tit"><span className="manual-seccion-emoji">{s.emoji}</span> {s.titulo}</h2>
                <Markdown texto={s.cuerpo} />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
