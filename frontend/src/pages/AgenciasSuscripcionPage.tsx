import { useEffect, useMemo, useState } from "react";
import {
  getDgsfpResumen, getDgsfpVinculos, getDgsfpAgencias, getDgsfpAgencia,
  updateDgsfpAgencia, updateDgsfpVinculo,
  type DgsfpResumen, type DgsfpVinculo, type AgenciaLista, type AgenciaFicha, type AgenciaUpdate,
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
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { getDgsfpAgencia(clave).then((d) => { setF(d); setBorr({}); }).catch(() => {}); }, [clave]);
  if (!f) return <div className="panel"><div className="loading">Cargando…</div></div>;

  const val = (k: keyof AgenciaFicha) => (borr[k as keyof AgenciaUpdate] ?? f[k] ?? "") as string;
  const set = (k: keyof AgenciaUpdate, v: unknown) => setBorr((b) => ({ ...b, [k]: v }));
  const guardar = async () => {
    setGuardando(true);
    try { await updateDgsfpAgencia(clave, borr); onSaved(); onClose(); }
    finally { setGuardando(false); }
  };
  const toggleVinculo = async (id: number, campo: "activo" | "revisar", v: boolean) => {
    const nv = await updateDgsfpVinculo(id, { [campo]: v });
    setF((prev) => prev ? { ...prev, vinculos: prev.vinculos.map((x) => x.id === id ? nv : x) } : prev);
    onSaved();
  };

  return (
    <div className="panel as-ficha">
      <div className="panel-head">
        <h2>{f.nombre} <span className="as-ficha-clave">{f.clave}</span></h2>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="panel-body">
        <div className="as-flags">
          <label><input type="checkbox" checked={borr.activo ?? f.activo} onChange={(e) => set("activo", e.target.checked)} /> Activa</label>
          <label><input type="checkbox" checked={borr.dudoso ?? f.dudoso} onChange={(e) => set("dudoso", e.target.checked)} /> Dudosa</label>
          <label><input type="checkbox" checked={borr.revisado ?? f.revisado} onChange={(e) => set("revisado", e.target.checked)} /> Revisada</label>
        </div>
        <div className="as-form">
          {CAMPOS.map((c) => (
            <div key={c.k} className={"field" + (c.full ? " campo-full" : "")}>
              <label>{c.label}</label>
              <input type={c.tipo ?? "text"} value={c.tipo === "date" ? (val(c.k) || "").slice(0, 10) : val(c.k)}
                     onChange={(e) => set(c.k as keyof AgenciaUpdate, e.target.value || null)} />
            </div>
          ))}
          <div className="field campo-full"><label>Productos</label>
            <textarea rows={2} value={val("productos")} onChange={(e) => set("productos", e.target.value || null)} /></div>
          <div className="field campo-full"><label>Notas</label>
            <textarea rows={3} value={val("notas")} onChange={(e) => set("notas", e.target.value || null)} /></div>
        </div>

        <h4 style={{ margin: "14px 0 6px" }}>Compañías vinculadas ({f.vinculos.length})</h4>
        <ul className="as-vinlist">
          {f.vinculos.map((v) => (
            <li key={v.id} className={v.activo ? "" : "inactivo"}>
              <label className="as-vin-check"><input type="checkbox" checked={v.activo}
                onChange={(e) => toggleVinculo(v.id, "activo", e.target.checked)} /></label>
              <span className="as-hijo-clave">{v.aseguradora_clave}</span>
              <span className="as-vin-nom">{v.aseguradora_nombre}</span>
              {v.en_dgsfp && <span className="as-badge as-badge-dgsfp" title="Presente en el registro DGSFP">DGSFP</span>}
              {v.revisar && (
                <button className="as-badge as-badge-rev" title={`${v.revisar_motivo} — marcar como revisado`}
                        onClick={() => toggleVinculo(v.id, "revisar", false)}>⚠ {v.revisar_motivo} ✓</button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="panel-actions">
        <button className="btn-secondary" onClick={onClose}>Cerrar</button>
        <button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

// ── Vista "Por compañía": acordeón aseguradora → agencias ──
type Grupo = { clave: string; titulo: string; sub: string; hijos: DgsfpVinculo[] };
function agruparPorCompania(vinc: DgsfpVinculo[]): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const v of vinc) {
    const g = m.get(v.aseguradora_clave) ?? {
      clave: v.aseguradora_clave, titulo: v.aseguradora_nombre,
      sub: `${v.aseguradora_clave}${v.aseguradora_nif ? " · " + v.aseguradora_nif : ""}`, hijos: [],
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
  const [vista, setVista] = useState<Vista>("compania");
  const [q, setQ] = useState("");
  const [soloRevisar, setSoloRevisar] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [ficha, setFicha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    const [v, a, r] = await Promise.all([getDgsfpVinculos(), getDgsfpAgencias(), getDgsfpResumen()]);
    setVinculos(v); setAgencias(a); setResumen(r);
  };
  useEffect(() => { cargar().catch((e) => setError((e as Error).message)).finally(() => setLoading(false)); }, []);

  const toggle = (c: string) => setAbiertos((p) => { const s = new Set(p); s.has(c) ? s.delete(c) : s.add(c); return s; });
  const t = q.trim().toLowerCase();

  // Vista compañía
  const grupos = useMemo(() => {
    let vin = vinculos;
    if (soloRevisar) vin = vin.filter((v) => v.revisar);
    let g = agruparPorCompania(vin);
    if (t) g = g.map((x) => {
      const enG = x.titulo.toLowerCase().includes(t) || x.sub.toLowerCase().includes(t);
      const hijos = enG ? x.hijos : x.hijos.filter((h) => h.agencia_nombre.toLowerCase().includes(t) || h.agencia_clave.toLowerCase().includes(t));
      return hijos.length ? { ...x, hijos } : null;
    }).filter(Boolean) as Grupo[];
    return g;
  }, [vinculos, soloRevisar, t]);

  // Vista agencia (lista de fichas)
  const revisarPorAgencia = useMemo(() => {
    const s = new Set<string>(); for (const v of vinculos) if (v.revisar) s.add(v.agencia_clave); return s;
  }, [vinculos]);
  const listaAgencias = useMemo(() => {
    let a = agencias;
    if (soloRevisar) a = a.filter((x) => revisarPorAgencia.has(x.clave));
    if (t) a = a.filter((x) => x.nombre.toLowerCase().includes(t) || x.clave.toLowerCase().includes(t) || (x.localidad ?? "").toLowerCase().includes(t) || (x.cif ?? "").toLowerCase().includes(t));
    return a;
  }, [agencias, soloRevisar, revisarPorAgencia, t]);

  const buscando = t.length > 0;

  return (
    <div className="container lista-page">
      <PageHeader emoji="🏛️" title="Agencias de Suscripción" />
      {error && <div className="error">⚠ {error}</div>}

      <div className="as-barra">
        <div className="as-toggle">
          <button className={"btn-toggle" + (vista === "compania" ? " on" : "")} onClick={() => { setVista("compania"); setAbiertos(new Set()); }}>Por compañía</button>
          <button className={"btn-toggle" + (vista === "agencia" ? " on" : "")} onClick={() => setVista("agencia")}>Agencias</button>
        </div>
        <input className="as-buscar" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {resumen && resumen.n_revisar > 0 && (
          <button className={"btn-toggle as-rev-btn" + (soloRevisar ? " on" : "")} onClick={() => setSoloRevisar((s) => !s)}>
            ⚠ A revisar ({resumen.n_revisar})
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
            const abierto = buscando || soloRevisar || abiertos.has(g.clave);
            return (
              <div className={"as-fila" + (abierto ? " abierta" : "")} key={g.clave}>
                <button className="as-fila-cab" onClick={() => toggle(g.clave)}>
                  <span className="as-chevron">{abierto ? "▾" : "▸"}</span>
                  <span className="as-fila-tit">{g.titulo}</span>
                  <span className="as-fila-sub">{g.sub}</span>
                  <span className="as-fila-n">{g.hijos.filter((h) => h.activo).length}</span>
                </button>
                {abierto && (
                  <ul className="as-hijos">
                    {g.hijos.map((h) => (
                      <li key={h.id} className={h.activo ? "" : "inactivo"}>
                        <span className="as-hijo-clave">{h.agencia_clave}</span> {h.agencia_nombre}
                        {!h.activo && <span className="as-badge as-badge-off">inactivo</span>}
                        {h.revisar && <span className="as-badge as-badge-rev" title={h.revisar_motivo ?? ""}>⚠ revisar</span>}
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
              {revisarPorAgencia.has(a.clave) && <span className="as-badge as-badge-rev">⚠</span>}
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
