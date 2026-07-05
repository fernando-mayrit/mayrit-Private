import { useEffect, useMemo, useState } from "react";
import { getDgsfpResumen, getDgsfpVinculos, type DgsfpResumen, type DgsfpVinculo } from "../api";
import PageHeader from "../components/PageHeader";
import { fmtFechaES } from "../format";

type Vista = "compania" | "agencia";
type Grupo = { clave: string; titulo: string; sub: string; hijos: { clave: string; nombre: string }[] };

// Agrupa los vínculos por compañía o por agencia.
function agrupar(vinculos: DgsfpVinculo[], vista: Vista): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const v of vinculos) {
    if (vista === "compania") {
      const g = mapa.get(v.aseguradora_clave) ?? {
        clave: v.aseguradora_clave, titulo: v.aseguradora_nombre,
        sub: `${v.aseguradora_clave}${v.aseguradora_nif ? " · " + v.aseguradora_nif : ""}`, hijos: [],
      };
      g.hijos.push({ clave: v.agencia_clave, nombre: v.agencia_nombre });
      mapa.set(v.aseguradora_clave, g);
    } else {
      const g = mapa.get(v.agencia_clave) ?? { clave: v.agencia_clave, titulo: v.agencia_nombre, sub: v.agencia_clave, hijos: [] };
      g.hijos.push({ clave: v.aseguradora_clave, nombre: v.aseguradora_nombre });
      mapa.set(v.agencia_clave, g);
    }
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, hijos: g.hijos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
}

export default function AgenciasSuscripcionPage() {
  const [vinculos, setVinculos] = useState<DgsfpVinculo[]>([]);
  const [resumen, setResumen] = useState<DgsfpResumen | null>(null);
  const [vista, setVista] = useState<Vista>("compania");
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [v, r] = await Promise.all([getDgsfpVinculos(), getDgsfpResumen()]);
        setVinculos(v); setResumen(r);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Al cambiar de vista se pliega todo (las claves no se solapan entre vistas de todos modos).
  const cambiarVista = (nueva: Vista) => { setVista(nueva); setAbiertos(new Set()); };
  const toggle = (clave: string) =>
    setAbiertos((prev) => { const s = new Set(prev); s.has(clave) ? s.delete(clave) : s.add(clave); return s; });

  const grupos = useMemo(() => {
    const g = agrupar(vinculos, vista);
    const t = q.trim().toLowerCase();
    if (!t) return g;
    return g
      .map((x) => {
        const enGrupo = x.titulo.toLowerCase().includes(t) || x.sub.toLowerCase().includes(t);
        const hijos = enGrupo ? x.hijos : x.hijos.filter((h) => h.nombre.toLowerCase().includes(t) || h.clave.toLowerCase().includes(t));
        return hijos.length ? { ...x, hijos } : null;
      })
      .filter(Boolean) as Grupo[];
  }, [vinculos, vista, q]);

  const buscando = q.trim().length > 0;

  return (
    <div className="container lista-page">
      <PageHeader emoji="🏛️" title="Agencias de Suscripción" />
      {error && <div className="error">⚠ {error}</div>}

      <div className="as-barra">
        <div className="as-toggle">
          <button className={"btn-toggle" + (vista === "compania" ? " on" : "")} onClick={() => cambiarVista("compania")}>Por compañía</button>
          <button className={"btn-toggle" + (vista === "agencia" ? " on" : "")} onClick={() => cambiarVista("agencia")}>Por agencia</button>
        </div>
        <input className="as-buscar" placeholder="Buscar compañía, agencia, clave o NIF…" value={q} onChange={(e) => setQ(e.target.value)} />
        {resumen && (
          <span className="as-sello" title="Fuente: Registro Público DGSFP">
            {resumen.n_aseguradoras} compañías · {resumen.n_agencias} agencias
            {resumen.actualizado && <> · DGSFP {fmtFechaES(resumen.actualizado)}</>}
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : (
        <div className="as-scroll">
          {grupos.length === 0 ? <div className="hint">Sin resultados.</div> : grupos.map((g) => {
            const abierto = buscando || abiertos.has(g.clave);
            return (
              <div className={"as-fila" + (abierto ? " abierta" : "")} key={g.clave}>
                <button className="as-fila-cab" onClick={() => toggle(g.clave)} aria-expanded={abierto}>
                  <span className="as-chevron">{abierto ? "▾" : "▸"}</span>
                  <span className="as-fila-tit">{g.titulo}</span>
                  <span className="as-fila-sub">{g.sub}</span>
                  <span className="as-fila-n">{g.hijos.length}</span>
                </button>
                {abierto && (
                  <ul className="as-hijos">
                    {g.hijos.map((h) => (
                      <li key={h.clave}><span className="as-hijo-clave">{h.clave}</span> {h.nombre}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
