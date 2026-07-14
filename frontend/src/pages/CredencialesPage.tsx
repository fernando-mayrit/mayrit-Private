import { useState, useEffect, useCallback } from "react";
import { credencialesApi, usuariosApi, type Credencial, type CredencialWrite } from "../api";
import type { Usuario } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";

type FormState = {
  id?: number;
  titulo: string;
  categoria: string;
  usuario: string;        // login del servicio
  url: string;
  secreto: string;        // contraseña en claro (vacío al editar = no cambiarla)
  notas: string;
  visibilidad: "privada" | "publica";
  permisos: string[];     // usuarios que pueden verla (si es pública)
};

const VACIO: FormState = {
  titulo: "", categoria: "", usuario: "", url: "", secreto: "", notas: "",
  visibilidad: "privada", permisos: [],
};

// Generador de contraseñas en el CLIENTE (no viaja hasta que se guarda). Evita caracteres
// ambiguos (l/I/1, O/0) para que sea fácil de leer/teclear si hace falta.
function generarPassword(longitud = 16): string {
  const abc = "abcdefghijkmnopqrstuvwxyz";
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const num = "23456789";
  const sim = "!@#$%&*?-_=+";
  const todos = abc + ABC + num + sim;
  const buf = new Uint32Array(longitud);
  crypto.getRandomValues(buf);
  // Garantiza al menos uno de cada grupo para cumplir requisitos habituales.
  const grupos = [abc, ABC, num, sim];
  const out: string[] = [];
  for (let i = 0; i < longitud; i++) {
    const fuente = i < grupos.length ? grupos[i] : todos;
    out.push(fuente[buf[i] % fuente.length]);
  }
  // Baraja (Fisher-Yates con aleatoriedad segura) para no dejar los obligatorios al principio.
  const mez = new Uint32Array(longitud);
  crypto.getRandomValues(mez);
  for (let i = longitud - 1; i > 0; i--) {
    const j = mez[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

export default function CredencialesPage({ usuario }: { usuario: string | null }) {
  const yo = (usuario ?? "").trim();
  const [items, setItems] = useState<Credencial[]>([]);
  const [equipo, setEquipo] = useState<Usuario[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [filtroCat, setFiltroCat] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Contraseñas reveladas en la tabla (id → texto) y avisos de "copiado".
  const [revelados, setRevelados] = useState<Record<number, string>>({});
  const [copiado, setCopiado] = useState<number | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [verSecretoForm, setVerSecretoForm] = useState(false);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(inicial);

  const cargar = useCallback(async () => {
    if (!yo) return;
    setLoading(true);
    setError(null);
    try {
      const [creds, cats] = await Promise.all([
        credencialesApi.listar(yo, { q: q || undefined, categoria: filtroCat || undefined }),
        credencialesApi.categorias(yo),
      ]);
      setItems(creds);
      setCategorias(cats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [yo, q, filtroCat]);

  // Búsqueda/filtro en vivo (con pequeño retardo). Al cambiar, se ocultan las reveladas.
  useEffect(() => {
    const t = setTimeout(() => { setRevelados({}); cargar(); }, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  // Lista de compañeros del equipo (para elegir con quién se comparte una pública).
  useEffect(() => {
    usuariosApi.list(undefined, 5000)
      .then((us) => setEquipo(us.filter((u) => u.activa && u.nombre !== yo)))
      .catch(() => setEquipo([]));
  }, [yo]);

  function abrir(estado: FormState) {
    setForm(estado);
    setInicial(estado);
    setVerSecretoForm(false);
    setError(null);
  }
  function cerrar() { setForm(null); setInicial(null); }
  function abrirNuevo() { abrir({ ...VACIO }); }
  function abrirEdicion(c: Credencial) {
    abrir({
      id: c.id,
      titulo: c.titulo,
      categoria: c.categoria ?? "",
      usuario: c.usuario ?? "",
      url: c.url ?? "",
      secreto: "",                 // no se trae la contraseña; vacío = mantener la actual
      notas: c.notas ?? "",
      visibilidad: c.visibilidad,
      permisos: c.permisos ?? [],
    });
  }

  async function guardar() {
    if (!form) return;
    if (!form.titulo.trim()) return setError("El título es obligatorio.");
    if (!form.id && !form.secreto) return setError("La contraseña es obligatoria.");

    setSaving(true);
    setError(null);
    const payload: CredencialWrite = {
      titulo: form.titulo.trim(),
      categoria: form.categoria.trim() || null,
      usuario: form.usuario.trim() || null,
      url: form.url.trim() || null,
      notas: form.notas.trim() || null,
      visibilidad: form.visibilidad,
      permisos: form.visibilidad === "publica" ? form.permisos : [],
    };
    if (form.secreto) payload.secreto = form.secreto;   // solo se manda si se escribió/generó una nueva
    try {
      if (form.id) await credencialesApi.editar(form.id, yo, payload);
      else await credencialesApi.crear(yo, payload);
      cerrar();
      setRevelados({});
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrarActual() {
    if (!form?.id) return;
    if (!confirm(`¿Borrar la contraseña "${form.titulo}"? No se puede deshacer.`)) return;
    try {
      await credencialesApi.borrar(form.id, yo);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Ver/ocultar la contraseña de una fila (la pide al backend la primera vez).
  async function toggleVer(c: Credencial) {
    if (revelados[c.id] !== undefined) {
      setRevelados((r) => { const n = { ...r }; delete n[c.id]; return n; });
      return;
    }
    try {
      const { secreto } = await credencialesApi.secreto(c.id, yo);
      setRevelados((r) => ({ ...r, [c.id]: secreto }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function copiar(c: Credencial) {
    try {
      const secreto = revelados[c.id] ?? (await credencialesApi.secreto(c.id, yo)).secreto;
      await navigator.clipboard.writeText(secreto);
      setCopiado(c.id);
      setTimeout(() => setCopiado((x) => (x === c.id ? null : x)), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleMiembro(nombre: string) {
    if (!form) return;
    const tiene = form.permisos.includes(nombre);
    setForm({ ...form, permisos: tiene ? form.permisos.filter((n) => n !== nombre) : [...form.permisos, nombre] });
  }

  // Agrupa las credenciales por categoría (las sin categoría, al final).
  const grupos = new Map<string, Credencial[]>();
  for (const c of items) {
    const k = c.categoria ?? "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }
  const gruposOrden = [...grupos.entries()].sort((a, b) => {
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return a[0].localeCompare(b[0], "es");
  });

  if (!yo) {
    return (
      <div className="container compacto">
        <PageHeader emoji="🔐" title="Contraseñas" />
        <div className="empty">Elige un usuario (arriba a la derecha) para ver tus contraseñas.</div>
      </div>
    );
  }

  return (
    <div className="container compacto">
      <PageHeader emoji="🔐" title="Contraseñas" />
      <p className="hint" style={{ marginTop: -6 }}>
        Tus contraseñas, cifradas. Las <strong>privadas</strong> solo las ves tú; las{" "}
        <strong>públicas</strong>, quien elijas del equipo.
      </p>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por título, usuario, categoría o web…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn-primary" onClick={abrirNuevo}>+ Nueva contraseña</button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">Aún no hay contraseñas. Crea la primera con «+ Nueva contraseña».</div>
      ) : (
        gruposOrden.map(([cat, creds]) => (
          <div key={cat || "—"} style={{ marginBottom: 18 }}>
            <div className="nav-group-title" style={{ padding: "6px 2px" }}>
              {cat || "Sin categoría"} <span style={{ opacity: 0.6, fontWeight: 400 }}>({creds.length})</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Usuario</th>
                  <th>Contraseña</th>
                  <th>Visibilidad</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.url ? (
                        <a href={/^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`}
                           target="_blank" rel="noreferrer">{c.titulo}</a>
                      ) : c.titulo}
                    </td>
                    <td>{c.usuario ?? "—"}</td>
                    <td>
                      <span style={{ fontFamily: "monospace" }}>
                        {revelados[c.id] !== undefined ? revelados[c.id] : "••••••••"}
                      </span>
                      <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => toggleVer(c)}>
                        {revelados[c.id] !== undefined ? "ocultar" : "ver"}
                      </button>
                      <button className="btn-link" style={{ marginLeft: 6 }} onClick={() => copiar(c)}>
                        {copiado === c.id ? "✓ copiado" : "copiar"}
                      </button>
                    </td>
                    <td>
                      {c.visibilidad === "publica" ? (
                        <span title={c.permisos.length ? `Compartida con: ${c.permisos.join(", ")}` : "Pública sin destinatarios"}>
                          👥 Pública{c.permisos.length ? ` (${c.permisos.length})` : ""}
                        </span>
                      ) : <span>🔒 Privada</span>}
                      {!c.es_propia && <span className="hint" style={{ marginLeft: 6 }}>· de {c.propietario}</span>}
                    </td>
                    <td className="acciones">
                      {c.es_propia
                        ? <button className="btn-link" onClick={() => abrirEdicion(c)}>Editar</button>
                        : <span className="hint">solo lectura</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {form && (
        <FormPanel
          title={form.id ? "Editar contraseña" : "Nueva contraseña"}
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={cerrar}
          onDelete={form.id ? borrarActual : undefined}
        >
          <div className="field">
            <label>Título <span className="required">*</span></label>
            <input type="text" value={form.titulo} placeholder="p. ej. Correo, Banco Sabadell…"
                   onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          </div>
          <div className="field">
            <label>Categoría</label>
            <input type="text" list="cred-categorias" value={form.categoria}
                   placeholder="p. ej. Correo, Bancos, Regulatorio…"
                   onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
            <datalist id="cred-categorias">
              {categorias.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Usuario</label>
            <input type="text" value={form.usuario} placeholder="usuario / email de acceso"
                   autoComplete="off"
                   onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
          </div>
          <div className="field">
            <label>Contraseña {!form.id && <span className="required">*</span>}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type={verSecretoForm ? "text" : "password"}
                style={{ flex: 1, fontFamily: "monospace" }}
                value={form.secreto}
                autoComplete="new-password"
                placeholder={form.id ? "(dejar vacío para no cambiarla)" : ""}
                onChange={(e) => setForm({ ...form, secreto: e.target.value })}
              />
              <button type="button" className="btn-secondary" onClick={() => setVerSecretoForm((v) => !v)}>
                {verSecretoForm ? "🙈" : "👁"}
              </button>
              <button type="button" className="btn-secondary"
                      onClick={() => { setForm({ ...form, secreto: generarPassword() }); setVerSecretoForm(true); }}>
                🎲 Generar
              </button>
            </div>
            <span className="hint">El generador es opcional; puedes escribir la que quieras.</span>
          </div>
          <div className="field">
            <label>Web (URL)</label>
            <input type="text" value={form.url} placeholder="https://…"
                   onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea rows={2} value={form.notas}
                      onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            <span className="hint">Las notas NO se cifran: no pongas aquí otros secretos.</span>
          </div>

          <div className="field">
            <label>Visibilidad</label>
            <label className="check-inline">
              <input type="radio" name="visibilidad" checked={form.visibilidad === "privada"}
                     onChange={() => setForm({ ...form, visibilidad: "privada" })} />
              🔒 Privada — solo tú
            </label>
            <label className="check-inline">
              <input type="radio" name="visibilidad" checked={form.visibilidad === "publica"}
                     onChange={() => setForm({ ...form, visibilidad: "publica" })} />
              👥 Pública — la ve quien elijas
            </label>
          </div>

          {form.visibilidad === "publica" && (
            <div className="field">
              <label>¿Quién puede verla?</label>
              {equipo.length === 0 ? (
                <span className="hint">No hay otros usuarios en el equipo.</span>
              ) : (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <button type="button" className="btn-link"
                            onClick={() => setForm({ ...form, permisos: equipo.map((u) => u.nombre) })}>
                      Todos
                    </button>
                    <button type="button" className="btn-link" style={{ marginLeft: 10 }}
                            onClick={() => setForm({ ...form, permisos: [] })}>
                      Ninguno
                    </button>
                  </div>
                  {equipo.map((u) => (
                    <label key={u.id} className="check-inline">
                      <input type="checkbox" checked={form.permisos.includes(u.nombre)}
                             onChange={() => toggleMiembro(u.nombre)} />
                      {u.nombre}
                    </label>
                  ))}
                </>
              )}
              <span className="hint">Tú siempre la ves (eres el propietario).</span>
            </div>
          )}
        </FormPanel>
      )}
    </div>
  );
}
