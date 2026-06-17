import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtMiles, fmtFechaES } from "../format";

// Tabla genérica reutilizable (basada en la de BDX): elegir columnas (clic derecho),
// mover (arrastrar), ordenar (clic), filtrar por columna (▾) y persistencia en localStorage.
export type ColTipo = "date" | "num" | "pct" | "int" | "bool" | "text";
export type Col<T> = {
  key: string;
  label: string;
  tipo: ColTipo;
  width?: number;                 // ancho máx. en px; recorta el texto con "…" y tooltip
  calc?: (r: T) => unknown;       // valor calculado (si no es un campo directo)
  render?: (r: T) => ReactNode;   // celda personalizada (p. ej. pills); el filtro usa el texto
};

const VACIO = "(vacías)";

function valorRaw<T>(r: T, col: Col<T>): unknown {
  return col.calc ? col.calc(r) : (r as Record<string, unknown>)[col.key];
}
function fmtValor<T>(r: T, col: Col<T>): string {
  const v = valorRaw(r, col);
  if (col.tipo === "bool") return v ? "Sí" : "No";
  if (col.tipo === "date") return fmtFechaES(v);
  if (col.tipo === "num") return fmtMiles(v);
  if (col.tipo === "pct") return v == null || v === "" ? "" : `${fmtMiles(v)} %`;
  if (col.tipo === "int") return v == null ? "" : String(v);
  return v == null ? "" : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export default function TablaDatos<T extends { id: number }>({
  filas,
  columnas,
  defaultKeys,
  storageKey,
  onRowClick,
  acciones,
  rowAction,
  rowClass,
  defaultSort,
  resetSignal,
}: {
  filas: T[];
  columnas: Col<T>[];
  defaultKeys: string[];
  storageKey: string;
  onRowClick?: (r: T) => void;
  acciones?: ReactNode;
  rowAction?: (r: T) => ReactNode;        // columna fija a la derecha (p. ej. botón "Editar")
  rowClass?: (r: T) => string | undefined; // clase CSS por fila (p. ej. atenuar inactivos)
  defaultSort?: { key: string; dir: 1 | -1 }; // orden inicial si no hay uno guardado
  resetSignal?: number;   // al cambiar, limpia los filtros por columna
}) {
  const COLS_KEY = `${storageKey}.cols`;
  const SORT_KEY = `${storageKey}.sort`;
  type SortState = { key: string; dir: 1 | -1 } | null;

  const [visibles, setVisibles] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLS_KEY);
      if (raw) {
        const arr = (JSON.parse(raw) as string[]).filter((k) => columnas.some((c) => c.key === k));
        if (arr.length) return arr;
      }
    } catch { /* ignora */ }
    return defaultKeys;
  });
  const [sort, setSort] = useState<SortState>(() => {
    try {
      const raw = localStorage.getItem(SORT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SortState;
        if (parsed) return parsed; // un "null" guardado no debe tapar el orden por defecto
      }
    } catch { /* ignora */ }
    return defaultSort ?? null;
  });
  const [filtros, setFiltros] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filtro, setFiltro] = useState<{ key: string; x: number; y: number } | null>(null);
  const [filtroSel, setFiltroSel] = useState<Set<string>>(new Set());
  const [filtroBusca, setFiltroBusca] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filtroRef = useRef<HTMLDivElement | null>(null);

  // Limpiar filtros por columna cuando el padre lo pide (botón "Limpiar filtros").
  useEffect(() => {
    if (resetSignal !== undefined) { setFiltros({}); setFiltro(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(visibles)); } catch { /* */ } }, [visibles, COLS_KEY]);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* */ } }, [sort, SORT_KEY]);

  useEffect(() => {
    if (!menu && !filtro) return;
    const cerrar = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || filtroRef.current?.contains(t)) return;
      setMenu(null);
      setFiltro(null);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [menu, filtro]);

  const cols = visibles.map((k) => columnas.find((c) => c.key === k)!).filter(Boolean);

  function ordenarPor(key: string) {
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }
  function toggleCol(key: string) {
    setVisibles((vs) => (vs.includes(key) ? vs.filter((k) => k !== key) : [...vs, key]));
  }
  function moverCol(from: string, to: string) {
    if (from === to) return;
    setVisibles((vs) => {
      const arr = vs.filter((k) => k !== from);
      const idx = arr.indexOf(to);
      arr.splice(idx < 0 ? arr.length : idx, 0, from);
      return arr;
    });
  }
  function valoresDistintos(col: Col<T>): string[] {
    const s = new Set<string>();
    filas.forEach((r) => s.add(fmtValor(r, col) || VACIO));
    return [...s].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }
  function abrirFiltro(col: Col<T>, e: React.MouseEvent) {
    e.stopPropagation();
    setFiltroSel(new Set(filtros[col.key] ?? valoresDistintos(col)));
    setFiltroBusca("");
    setMenu(null);
    setFiltro({ key: col.key, x: e.clientX, y: e.clientY });
  }
  function aplicarFiltro() {
    if (!filtro) return;
    const col = columnas.find((c) => c.key === filtro.key)!;
    const distintos = valoresDistintos(col);
    setFiltros((f) => {
      const nx = { ...f };
      if (filtroSel.size >= distintos.length) delete nx[col.key];
      else nx[col.key] = new Set(filtroSel);
      return nx;
    });
    setFiltro(null);
  }
  function quitarFiltro() {
    if (!filtro) return;
    setFiltros((f) => { const nx = { ...f }; delete nx[filtro.key]; return nx; });
    setFiltro(null);
  }

  let datos = filas.filter((r) =>
    Object.entries(filtros).every(([k, set]) => {
      const col = columnas.find((c) => c.key === k)!;
      return set.has(fmtValor(r, col) || VACIO);
    })
  );
  if (sort) {
    const col = columnas.find((c) => c.key === sort.key);
    if (col) {
      const numCol = col.tipo === "num" || col.tipo === "pct" || col.tipo === "int";
      datos = [...datos].sort((a, b) => {
        let c: number;
        if (col.tipo === "bool") c = (valorRaw(a, col) ? 1 : 0) - (valorRaw(b, col) ? 1 : 0);
        else if (numCol) c = num(valorRaw(a, col)) - num(valorRaw(b, col));
        else c = String(valorRaw(a, col) ?? "").localeCompare(String(valorRaw(b, col) ?? ""), "es", { numeric: true });
        return c * sort.dir;
      });
    }
  }

  function celda(r: T, col: Col<T>) {
    if (col.render) return col.render(r);
    if (col.tipo === "bool") return <input type="checkbox" checked={!!valorRaw(r, col)} disabled readOnly />;
    const s = fmtValor(r, col);
    return s === "" ? "—" : s;
  }

  return (
    <div className="bdx-tabla-cont">
      <div className="bdx-topbar">
        <div className="bdx-acciones">
          {acciones}
          {Object.keys(filtros).length > 0 && (
            <button className="btn-link" onClick={() => setFiltros({})}>Quitar filtros</button>
          )}
          <span className="hint">{datos.length}{datos.length !== filas.length ? ` / ${filas.length}` : ""} fila(s)</span>
        </div>
      </div>

      <div className="tabla-scroll bdx-scroll">
        <table className="compacto bdx-tabla">
          <thead>
            <tr
              onContextMenu={(e) => { e.preventDefault(); setFiltro(null); setMenu({ x: e.clientX, y: e.clientY }); }}
              title="Clic derecho para elegir columnas"
            >
              {cols.map((c) => {
                const activo = sort?.key === c.key;
                const numCol = c.tipo === "num" || c.tipo === "pct" || c.tipo === "int";
                const filtrada = !!filtros[c.key];
                return (
                  <th
                    key={c.key}
                    className={(numCol ? "num " : "") + "col-arrastrable" + (dragKey === c.key ? " arrastrando" : "")}
                    style={{ whiteSpace: "nowrap", ...(c.width ? { maxWidth: c.width } : {}) }}
                    draggable
                    onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (dragKey) moverCol(dragKey, c.key); setDragKey(null); }}
                    onDragEnd={() => setDragKey(null)}
                    title="Arrastra para mover · clic para ordenar · clic derecho para columnas"
                  >
                    <span style={{ cursor: "pointer" }} onClick={() => ordenarPor(c.key)}>
                      {c.label}{activo ? (sort!.dir === 1 ? " ▲" : " ▼") : ""}
                    </span>
                    <span className={"col-filtro" + (filtrada ? " activo" : "")} title="Filtrar" onClick={(e) => abrirFiltro(c, e)}>▾</span>
                  </th>
                );
              })}
              {rowAction && <th></th>}
            </tr>
          </thead>
          <tbody>
            {datos.map((r) => (
              <tr
                key={r.id}
                className={[onRowClick ? "fila-click" : "", rowClass?.(r) ?? ""].join(" ").trim() || undefined}
                onClick={() => onRowClick?.(r)}
              >
                {cols.map((c) => {
                  const numCol = c.tipo === "num" || c.tipo === "pct" || c.tipo === "int";
                  return (
                    <td
                      key={c.key}
                      className={numCol ? "num" : c.tipo === "bool" ? "celda-centro" : undefined}
                      style={c.width ? { maxWidth: c.width } : undefined}
                      title={c.width && !c.render ? fmtValor(r, c) : undefined}
                    >
                      {c.width ? <span className="celda-recorte">{celda(r, c)}</span> : celda(r, c)}
                    </td>
                  );
                })}
                {rowAction && (
                  <td className="acciones" onClick={(e) => e.stopPropagation()}>
                    {rowAction(r)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && (
        <div ref={menuRef} className="col-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="col-menu-titulo">
            Columnas
            <button className="btn-link" style={{ float: "right", padding: 0 }} onClick={() => setVisibles(defaultKeys)}>Restablecer</button>
          </div>
          {columnas.map((c) => (
            <label key={c.key} className="col-menu-item">
              <input type="checkbox" checked={visibles.includes(c.key)} onChange={() => toggleCol(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}

      {filtro && (
        <div ref={filtroRef} className="col-menu col-filtro-pop" style={{ left: filtro.x, top: filtro.y }}>
          <input
            type="text" placeholder="Buscar…" value={filtroBusca}
            onChange={(e) => setFiltroBusca(e.target.value)}
            style={{ width: "100%", marginBottom: 6, padding: "5px 8px", border: "1px solid var(--borde)", borderRadius: 6 }}
          />
          {(() => {
            const col = columnas.find((c) => c.key === filtro.key)!;
            const distintos = valoresDistintos(col).filter((v) => v.toLowerCase().includes(filtroBusca.toLowerCase()));
            const todos = distintos.every((v) => filtroSel.has(v));
            return (
              <>
                <label className="col-menu-item">
                  <input type="checkbox" checked={todos} onChange={() => setFiltroSel((s) => {
                    const nx = new Set(s); if (todos) distintos.forEach((v) => nx.delete(v)); else distintos.forEach((v) => nx.add(v)); return nx;
                  })} />
                  <strong>(Seleccionar todo)</strong>
                </label>
                <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
                  {distintos.map((v) => (
                    <label key={v} className="col-menu-item">
                      <input type="checkbox" checked={filtroSel.has(v)} onChange={() => setFiltroSel((s) => {
                        const nx = new Set(s); if (nx.has(v)) nx.delete(v); else nx.add(v); return nx;
                      })} />
                      {v}
                    </label>
                  ))}
                </div>
                <div className="col-filtro-acciones">
                  <button className="btn-link" onClick={quitarFiltro}>Quitar filtro</button>
                  <button className="btn-primary btn-sm" onClick={aplicarFiltro}>Aplicar</button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
