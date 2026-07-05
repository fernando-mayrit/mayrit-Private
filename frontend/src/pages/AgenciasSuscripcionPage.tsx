import { useEffect, useMemo, useState } from "react";
import { getDgsfpResumen, getDgsfpVinculos, type DgsfpResumen, type DgsfpVinculo } from "../api";
import PageHeader from "../components/PageHeader";
import { fmtFechaES } from "../format";

type Vista = "compania" | "agencia";

// Agrupa los vínculos por una clave (compañía o agencia) para pintar la lista.
function agrupar(vinculos: DgsfpVinculo[], vista: Vista) {
  const mapa = new Map<string, { titulo: string; sub: string; hijos: { clave: string; nombre: string }[] }>();
  for (const v of vinculos) {
    if (vista === "compania") {
      const g = mapa.get(v.aseguradora_clave) ?? {
        titulo: v.aseguradora_nombre, sub: `${v.aseguradora_clave}${v.aseguradora_nif ? " · " + v.aseguradora_nif : ""}`, hijos: [],
      };
      g.hijos.push({ clave: v.agencia_clave, nombre: v.agencia_nombre });
      mapa.set(v.aseguradora_clave, g);
    } else {
      const g = mapa.get(v.agencia_clave) ?? { titulo: v.agencia_nombre, sub: v.agencia_clave, hijos: [] };
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

  const grupos = useMemo(() => {
    const g = agrupar(vinculos, vista);
    const t = q.trim().toLowerCase();
    if (!t) return g;
    // Coincide en el título/sub del grupo, o en alguno de sus hijos.
    return g
      .map((x) => {
        const enGrupo = x.titulo.toLowerCase().includes(t) || x.sub.toLowerCase().includes(t);
        const hijos = enGrupo ? x.hijos : x.hijos.filter((h) => h.nombre.toLowerCase().includes(t) || h.clave.toLowerCase().includes(t));
        return hijos.length ? { ...x, hijos } : null;
      })
      .filter(Boolean) as typeof g;
  }, [vinculos, vista, q]);

  return (
    <div className="container lista-page">
      <PageHeader emoji="🏛️" title="Agencias de Suscripción" />
      {error && <div className="error">⚠ {error}</div>}

      <div className="as-barra">
        <div className="as-toggle">
          <button className={"btn-toggle" + (vista === "compania" ? " on" : "")} onClick={() => setVista("compania")}>Por compañía</button>
          <button className={"btn-toggle" + (vista === "agencia" ? " on" : "")} onClick={() => setVista("agencia")}>Por agencia</button>
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
          {grupos.length === 0 ? <div className="hint">Sin resultados.</div> : grupos.map((g) => (
            <div className="as-grupo" key={g.titulo + g.sub}>
              <div className="as-grupo-cab">
                <span className="as-grupo-tit">{g.titulo}</span>
                <span className="as-grupo-sub">{g.sub}</span>
                <span className="as-grupo-n">{g.hijos.length}</span>
              </div>
              <ul className="as-hijos">
                {g.hijos.map((h) => (
                  <li key={h.clave}><span className="as-hijo-clave">{h.clave}</span> {h.nombre}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
