import { useEffect, useMemo, useState } from "react";
import {
  getDgsfpResumen, getDgsfpVinculos, getDgsfpAgencias, getDgsfpAgencia,
  updateDgsfpAgencia, updateDgsfpVinculo,
  getDgsfpInforme, abrirDgsfpInforme, eliminarDgsfpInforme,
  type DgsfpResumen, type DgsfpVinculo, type AgenciaLista, type AgenciaFicha, type AgenciaUpdate, type DgsfpInforme,
} from "../api";
import PageHeader from "../components/PageHeader";
import { fmtFechaES } from "../format";

type Vista = "compania" | "agencia";

// ── Ficha editable de una agencia (panel lateral) ──
const CAMPOS: { k: keyof AgenciaFicha; label: string; tipo?: string; full?: boolean }[] = [
  { k: "nombre", label: "Nombre", full: true },
  { k: "cif", label: "CIF" },
  { k: "fecha_constitucion", label: "Constitución", tipo: "date" },
  { k: "direccion", label: "Dirección", full: true },
  { k: "cp", label: "CP" }, { k: "localidad", label: "Localidad" },
  { k: "provincia", label: "Provincia" }, { k: "pais", label: "País" },
  { k: "contacto", label: "Contacto", full: true },
  { k: "telefono", label: "Teléfono" }, { k: "web", label: "Web" },
];

function FichaAgencia({ clave, onClose, onSaved }: { clave: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<AgenciaFicha | null>(null);
  const [borr, setBorr] = useState<AgenciaUpdate>({});
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { getDgsfpAgencia(clave).then((d) => { setF(d); setBorr({}); setEditando(false); }).catch(() => {}); }, [clave]);
  if (!f) return <div className="panel as-ficha"><div className="loading">Cargando…</div></div>;

  const val = (k: keyof AgenciaFicha) => (borr[k as keyof AgenciaUpdate] ?? f[k] ?? "") as string;
  const set = (k: keyof AgenciaUpdate, v: unknown) => setBorr((b) => ({ ...b, [k]: v }));
  const guardar = async () => {
    setGuardando(true);
    try {
      const d = await updateDgsfpAgencia(clave, borr);
      setF(d); setBorr({}); setEditando(false); onSaved();
    } finally { setGuardando(false); }
  };
  const cancelar = () => { setBorr({}); setEditando(false); };
  const toggleVinculo = async (id: number, activo: boolean) => {
    const nv = await updateDgsfpVinculo(id, { activo });
    setF((prev) => prev ? { ...prev, vinculos: prev.vinculos.map((x) => x.id === id ? nv : x) } : prev);
    onSaved();
  };

  return (
    <div className={"panel as-ficha" + (editando ? " editando" : " viendo")}>
      <div className="panel-head">
        <h2>{f.nombre} <span className="as-ficha-clave">{f.clave}</span></h2>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="panel-body">
        <div className="as-flags">
          <label><input type="checkbox" disabled={!editando} checked={borr.activo ?? f.activo} onChange={(e) => set("activo", e.target.checked)} /> Activa</label>
          <label><input type="checkbox" disabled={!editando} checked={borr.dudoso ?? f.dudoso} onChange={(e) => set("dudoso", e.target.checked)} /> Dudosa</label>
        </div>
        <div className="as-form">
          {CAMPOS.map((c) => (
            <div key={c.k} className={"field" + (c.full ? " campo-full" : "")}>
              <label>{c.label}</label>
              <input type={c.tipo ?? "text"} disabled={!editando} placeholder="—"
                     value={c.tipo === "date" ? (val(c.k) || "").slice(0, 10) : val(c.k)}
                     onChange={(e) => set(c.k as keyof AgenciaUpdate, e.target.value || null)} />
            </div>
          ))}
          <div className="field campo-full"><label>Productos</label>
            <textarea rows={2} disabled={!editando} placeholder="—" value={val("productos")} onChange={(e) => set("productos", e.target.value || null)} /></div>
          <div className="field campo-full"><label>Notas</label>
            <textarea rows={3} disabled={!editando} placeholder="—" value={val("notas")} onChange={(e) => set("notas", e.target.value || null)} /></div>
        </div>

        <h4 style={{ margin: "14px 0 6px" }}>Compañías vinculadas ({f.vinculos.length})</h4>
        <ul className="as-vinlist">
          {f.vinculos.map((v) => (
            <li key={v.id} className={v.activo ? "" : "inactivo"}>
              <label className="as-vin-check"><input type="checkbox" disabled={!editando} checked={v.activo}
                onChange={(e) => toggleVinculo(v.id, e.target.checked)} /></label>
              <span className="as-hijo-clave">{v.aseguradora_clave}</span>
              <span className="as-vin-nom">{v.aseguradora_nombre}</span>
              {!v.aseguradora_licencia_activa && <span className="as-badge as-badge-rev" title="Licencia no activa en DGSFP">{v.aseguradora_situacion ?? "sin licencia"}</span>}
              {v.en_dgsfp && <span className="as-badge as-badge-dgsfp" title="Presente en el registro DGSFP">DGSFP</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="panel-actions">
        {editando ? (
          <>
            <button className="btn-secondary" onClick={cancelar} disabled={guardando}>Cancelar</button>
            <button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </>
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose}>Cerrar</button>
            <button className="btn-primary" onClick={() => setEditando(true)}>✎ Editar</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Vista "Por compañía": acordeón aseguradora → agencias ──
type Grupo = { clave: string; titulo: string; sub: string; sinLicencia: boolean; situacion: string | null; hijos: DgsfpVinculo[] };
function agruparPorCompania(vinc: DgsfpVinculo[]): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const v of vinc) {
    const g = m.get(v.aseguradora_clave) ?? {
      clave: v.aseguradora_clave, titulo: v.aseguradora_nombre,
      sub: `${v.aseguradora_clave}${v.aseguradora_nif ? " · " + v.aseguradora_nif : ""}`,
      sinLicencia: !v.aseguradora_licencia_activa, situacion: v.aseguradora_situacion, hijos: [],
    };
    g.hijos.push(v); m.set(v.aseguradora_clave, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, hijos: g.hijos.sort((a, b) => a.agencia_nombre.localeCompare(b.agencia_nombre, "es")) }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
}

export default function AgenciasSuscripcionPage() {
  const [vinculos, setVinculos] = useState<DgsfpVinculo[]>([]);
  const [agencias, setAgencias] = useState<AgenciaLista[]>([]);
  const [resumen, setResumen] = useState<DgsfpResumen | null>(null);
  const [vista, setVista] = useState<Vista>("agencia");
  const [orden, setOrden] = useState<"nombre" | "codigo">("nombre");
  const [q, setQ] = useState("");
  const [soloSinLic, setSoloSinLic] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [ficha, setFicha] = useState<string | null>(null);
  const [informe, setInforme] = useState<DgsfpInforme | null>(null);
  const [verInforme, setVerInforme] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    const [v, a, r] = await Promise.all([getDgsfpVinculos(), getDgsfpAgencias(), getDgsfpResumen()]);
    setVinculos(v); setAgencias(a); setResumen(r);
  };
  useEffect(() => { cargar().catch((e) => setError((e as Error).message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { getDgsfpInforme().then(setInforme).catch(() => {}); }, []);

  const abrirInforme = () => abrirDgsfpInforme().catch(() => alert("Solo se puede abrir desde el PC que tiene el fichero."));
  const eliminarInforme = async () => {
    if (!confirm("¿Eliminar el informe? Desaparecerá la alerta.")) return;
    await eliminarDgsfpInforme(); setInforme(null); setVerInforme(false);
  };

  const toggle = (c: string) => setAbiertos((p) => { const s = new Set(p); s.has(c) ? s.delete(c) : s.add(c); return s; });
  const t = q.trim().toLowerCase();

  // Vista compañía
  const grupos = useMemo(() => {
    let g = agruparPorCompania(vinculos);
    if (soloSinLic) g = g.filter((x) => x.sinLicencia);
    if (t) g = g.map((x) => {
      const enG = x.titulo.toLowerCase().includes(t) || x.sub.toLowerCase().includes(t);
      const hijos = enG ? x.hijos : x.hijos.filter((h) => h.agencia_nombre.toLowerCase().includes(t) || h.agencia_clave.toLowerCase().includes(t));
      return hijos.length ? { ...x, hijos } : null;
    }).filter(Boolean) as Grupo[];
    return g;
  }, [vinculos, soloSinLic, t]);

  // Vista agencia (lista de fichas)
  const listaAgencias = useMemo(() => {
    let a = agencias;
    if (t) a = a.filter((x) => x.nombre.toLowerCase().includes(t) || x.clave.toLowerCase().includes(t) || (x.localidad ?? "").toLowerCase().includes(t) || (x.cif ?? "").toLowerCase().includes(t));
    return [...a].sort((x, y) => orden === "codigo"
      ? x.clave.localeCompare(y.clave, "es", { numeric: true })
      : x.nombre.localeCompare(y.nombre, "es"));
  }, [agencias, t, orden]);

  const buscando = t.length > 0;

  return (
    <div className="container lista-page">
      <PageHeader emoji="🏛️" title="Agencias de Suscripción" />
      {error && <div className="error">⚠ {error}</div>}

      {informe && (
        <div className="as-alerta">
          <span className="as-alerta-txt">📋 El listado se actualizó — <b>informe de cambios del {informe.fecha}</b> pendiente de revisar.</span>
          <button className="btn-link" onClick={() => setVerInforme((s) => !s)}>{verInforme ? "ocultar" : "ver aquí"}</button>
          <button className="btn-link" onClick={abrirInforme} title={informe.ruta}>abrir en el PC</button>
          <button className="btn-primary btn-mini" onClick={eliminarInforme}>Revisado, eliminar</button>
          {verInforme && <pre className="as-alerta-cont">{informe.contenido}</pre>}
        </div>
      )}

      <div className="as-barra">
        <div className="as-toggle">
          <button className={"btn-toggle" + (vista === "compania" ? " on" : "")} onClick={() => { setVista("compania"); setAbiertos(new Set()); }}>Por compañía</button>
          <button className={"btn-toggle" + (vista === "agencia" ? " on" : "")} onClick={() => setVista("agencia")}>Agencias</button>
        </div>
        <input className="as-buscar" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {vista === "agencia" && (
          <div className="as-toggle">
            <button className={"btn-toggle" + (orden === "nombre" ? " on" : "")} onClick={() => setOrden("nombre")}>Nombre</button>
            <button className={"btn-toggle" + (orden === "codigo" ? " on" : "")} onClick={() => setOrden("codigo")}>Código</button>
          </div>
        )}
        {resumen && resumen.n_sin_licencia > 0 && vista === "compania" && (
          <button className={"btn-toggle as-rev-btn" + (soloSinLic ? " on" : "")} onClick={() => setSoloSinLic((s) => !s)}>
            ⚠ Sin licencia ({resumen.n_sin_licencia})
          </button>
        )}
        {resumen && (
          <span className="as-sello" title="Fuente: Registro DGSFP + ficha manual">
            {resumen.n_agencias} agencias ({resumen.n_agencias_activas} activas)
            {resumen.actualizado && <> · DGSFP {fmtFechaES(resumen.actualizado)}</>}
          </span>
        )}
      </div>

      {loading ? <div className="loading">Cargando…</div> : vista === "compania" ? (
        <div className="as-scroll">
          {grupos.length === 0 ? <div className="hint">Sin resultados.</div> : grupos.map((g) => {
            const abierto = buscando || soloSinLic || abiertos.has(g.clave);
            return (
              <div className={"as-fila" + (abierto ? " abierta" : "") + (g.sinLicencia ? " sin-lic" : "")} key={g.clave}>
                <button className="as-fila-cab" onClick={() => toggle(g.clave)}>
                  <span className="as-chevron">{abierto ? "▾" : "▸"}</span>
                  <span className="as-fila-tit">{g.titulo}</span>
                  {g.sinLicencia && <span className="as-badge as-badge-rev" title="Licencia no activa en el registro DGSFP">{g.situacion ?? "sin licencia"}</span>}
                  <span className="as-fila-sub">{g.sub}</span>
                  <span className="as-fila-n">{g.hijos.filter((h) => h.activo).length}</span>
                </button>
                {abierto && (
                  <ul className="as-hijos">
                    {g.hijos.map((h) => (
                      <li key={h.id} className={h.activo ? "" : "inactivo"}>
                        <span className="as-hijo-clave">{h.agencia_clave}</span> {h.agencia_nombre}
                        {!h.activo && <span className="as-badge as-badge-off">inactivo</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="as-scroll">
          {listaAgencias.length === 0 ? <div className="hint">Sin resultados.</div> : listaAgencias.map((a) => (
            <button key={a.clave} className={"as-ag-fila" + (a.activo ? "" : " inactiva")} onClick={() => setFicha(a.clave)}>
              <span className="as-hijo-clave">{a.clave}</span>
              <span className="as-ag-nom">{a.nombre}</span>
              <span className="as-ag-loc">{a.localidad ?? ""}</span>
              {!a.activo && <span className="as-badge as-badge-off">inactiva</span>}
              {a.dudoso && <span className="as-badge as-badge-dudoso">dudosa</span>}
              <span className="as-fila-n" title="vínculos activos / total">{a.n_vinculos_activos}/{a.n_vinculos}</span>
            </button>
          ))}
        </div>
      )}

      {ficha && (
        <div className="overlay" onClick={() => setFicha(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", height: "100%" }}>
            <FichaAgencia clave={ficha} onClose={() => setFicha(null)} onSaved={cargar} />
          </div>
        </div>
      )}
    </div>
  );
}
