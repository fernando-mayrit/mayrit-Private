import { useState, useEffect, useCallback } from "react";
import { credencialesApi, usuariosApi, type Credencial, type CredencialWrite } from "../api";
import type { Usuario } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";

type FormState = {
  id?: number;
  titulo: string;
  grupo: string;          // agrupación de 1er nivel (Alea, Mayrit…)
  categoria: string;
  usuario: string;        // login del servicio
  url: string;
  secreto: string;        // contraseña en claro (vacío al editar = no cambiarla)
  notas: string;
  visibilidad: "privada" | "publica";
  permisos: string[];     // usuarios que pueden verla (si es pública)
};

const VACIO: FormState = {
  titulo: "", grupo: "", categoria: "", usuario: "", url: "", secreto: "", notas: "",
  visibilidad: "privada", permisos: [],
};

// Grupos que aparecen siempre en el desplegable, aunque aún no tengan credenciales.
const GRUPOS_SEMILLA = ["Alea", "Mayrit", "Lloyds", "Novacover"];

// Desplegable que además permite AÑADIR un valor nuevo (para Grupo y Categoría). Elige de la lista
// o pulsa «➕ Añadir…» para escribir uno nuevo (que quedará disponible al guardar).
const OPCION_NUEVA = "__nueva__";
function SelectorConAlta({ valor, opciones, onChange, placeholderNuevo }: {
  valor: string;
  opciones: string[];
  onChange: (v: string) => void;
  placeholderNuevo: string;
}) {
  // Modo "escribir nuevo": al elegir «➕ Añadir…», o si el valor guardado no está en la lista.
  const [modoNuevo, setModoNuevo] = useState(valor !== "" && !opciones.includes(valor));
  if (modoNuevo) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input type="text" style={{ flex: 1 }} value={valor} placeholder={placeholderNuevo}
               autoFocus onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-secondary" title="Volver a la lista"
                onClick={() => { setModoNuevo(false); onChange(""); }}>↩ Lista</button>
      </div>
    );
  }
  return (
    <select value={valor} onChange={(e) => {
      if (e.target.value === OPCION_NUEVA) { setModoNuevo(true); onChange(""); }
      else onChange(e.target.value);
    }}>
      <option value="">— (ninguno) —</option>
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={OPCION_NUEVA}>➕ Añadir nuevo…</option>
    </select>
  );
}

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
  const [grupos, setGrupos] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroCat, setFiltroCat] = useState("");
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({});   // grupos plegados en la lista
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Grupos del desplegable = semilla (Alea, Mayrit…) + los ya usados, sin duplicar.
  const gruposOpciones = [...GRUPOS_SEMILLA, ...grupos.filter((g) => !GRUPOS_SEMILLA.includes(g))];

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
      const [creds, grps, cats] = await Promise.all([
        credencialesApi.listar(yo, { q: q || undefined, grupo: filtroGrupo || undefined, categoria: filtroCat || undefined }),
        credencialesApi.grupos(yo),
        credencialesApi.categorias(yo),
      ]);
      setItems(creds);
      setGrupos(grps);
      setCategorias(cats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [yo, q, filtroGrupo, filtroCat]);

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
      grupo: c.grupo ?? "",
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
      grupo: form.grupo.trim() || null,
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

  // Agrupa las credenciales en dos niveles: Grupo → Categoría (los vacíos, al final).
  const ordenTexto = (a: string, b: string) => (!a ? 1 : !b ? -1 : a.localeCompare(b, "es"));
  const porGrupo = new Map<string, Credencial[]>();
  for (const c of items) {
    const g = c.grupo ?? "";
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g)!.push(c);
  }
  const gruposOrden = [...porGrupo.keys()].sort(ordenTexto);
  function porCategoria(creds: Credencial[]): { cat: string; creds: Credencial[] }[] {
    const m = new Map<string, Credencial[]>();
    for (const c of creds) {
      const k = c.categoria ?? "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.keys()].sort(ordenTexto).map((cat) => ({ cat, creds: m.get(cat)! }));
  }

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
          placeholder="Buscar por título, usuario, grupo, categoría o web…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="filtro" value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)}>
          <option value="">Todos los grupos</option>
          {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="filtro" value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
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
        gruposOrden.map((g) => {
          const creds = porGrupo.get(g)!;
          const abierto = !colapsados[g];
          return (
            <div key={g || "—"} style={{ marginBottom: 20 }}>
              <button
                type="button"
                className="nav-group-title nav-group-title-btn"
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 4px", fontSize: 15 }}
                onClick={() => setColapsados((s) => ({ ...s, [g]: abierto }))}
              >
                <span>{abierto ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 800 }}>{g || "Sin grupo"}</span>
                <span style={{ opacity: 0.6, fontWeight: 400 }}>({creds.length})</span>
              </button>
              {abierto && porCategoria(creds).map(({ cat, creds: cc }) => (
                <div key={cat || "—"} style={{ marginBottom: 12, marginLeft: 6 }}>
                  <div className="nav-group-title" style={{ padding: "4px 2px", fontSize: 12, opacity: 0.85 }}>
                    {cat || "Sin categoría"} <span style={{ opacity: 0.6, fontWeight: 400 }}>({cc.length})</span>
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
                      {cc.map((c) => (
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
              ))}
            </div>
          );
        })
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
            <label>Grupo</label>
            <SelectorConAlta valor={form.grupo} opciones={gruposOpciones}
                             placeholderNuevo="Nombre del grupo nuevo"
                             onChange={(v) => setForm({ ...form, grupo: v })} />
          </div>
          <div className="field">
            <label>Categoría</label>
            <SelectorConAlta valor={form.categoria} opciones={categorias}
                             placeholderNuevo="Nombre de la categoría nueva"
                             onChange={(v) => setForm({ ...form, categoria: v })} />
          </div>
          <div className="field">
            <label>Usuario</label>
            <input type="text" value={form.usuario} placeholder="usuario / email de acceso"
                   autoComplete="off"
                   onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
          </div>
          <div className="field">
            <label>Contraseña {!form.id && <span className="required">*</span>}</label>
            <input
              type={verSecretoForm ? "text" : "password"}
              value={form.secreto}
              autoComplete="new-password"
              placeholder={form.id ? "(dejar vacío para no cambiarla)" : ""}
              onChange={(e) => setForm({ ...form, secreto: e.target.value })}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button type="button" className="btn-secondary" onClick={() => setVerSecretoForm((v) => !v)}>
                {verSecretoForm ? "🙈 Ocultar" : "👁 Ver"}
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
