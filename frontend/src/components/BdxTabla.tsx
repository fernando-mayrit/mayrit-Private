import { useEffect, useMemo, useRef, useState } from "react";
import type { BdxLinea } from "../types";
import { fmtMiles, fmtFechaES } from "../format";

type ColTipo = "date" | "num" | "pct" | "int" | "bool" | "text";
type Col = { key: string; label: string; tipo: ColTipo; calc?: (l: BdxLinea) => number | null };

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
// Pendiente = base − hecho, sólo si hay base (si no, vacío).
function pendiente(base: unknown, hecho: unknown): number | null {
  return base == null || base === "" ? null : num(base) - num(hecho);
}

// Estado de una línea de Risk frente al Premium (mismo criterio que el backend `bdx_estado`):
// en Premium (verde) · sin premium por prima 0 o cancelación (gris) · pendiente (ámbar).
export function estadoPremiumLinea(l: BdxLinea): { label: string; clase: string } {
  if (l.incluido_en_premium) return { label: "En Premium", clase: "pill-cobrado" };
  if (l.sin_premium_motivo) return { label: `Sin premium · ${l.sin_premium_motivo}`, clase: "pill-anulado" };
  if (num(l.net_premium_to_broker) === 0) return { label: "Sin premium · Prima 0", clase: "pill-anulado" };
  return { label: "Pendiente", clase: "pill-parcial" };
}

// Catálogo de TODAS las columnas (clic derecho en la cabecera para elegir).
const CATALOGO: Col[] = [
  { key: "certificate_ref", label: "Certificado", tipo: "text" },
  { key: "insured_name", label: "Asegurado", tipo: "text" },
  { key: "reporting_period_start", label: "Risk Bdx", tipo: "date" },
  { key: "reporting_period_end", label: "Reporting End", tipo: "date" },
  { key: "net_premium_to_broker", label: "Prima a Mayrit", tipo: "num" },
  { key: "incluido_en_premium", label: "Incluido Premium", tipo: "bool" },
  { key: "estado_premium", label: "Estado Premium", tipo: "text" },
  { key: "premium_bdx", label: "Premium Bdx", tipo: "date" },
  { key: "ingresado", label: "Cobrado", tipo: "num" },
  { key: "pdte_cobro", label: "Pdte. Cobro", tipo: "num", calc: (l) => pendiente(l.net_premium_to_broker, l.ingresado) },
  { key: "traspasado", label: "Traspasado", tipo: "num" },
  { key: "pdte_traspaso", label: "Pdte. Traspaso", tipo: "num", calc: (l) => pendiente(l.brokerage_amount, l.traspasado) },
  { key: "liquidado_uw", label: "Liquidado", tipo: "num" },
  { key: "pdte_liq", label: "Pdte. Liq.", tipo: "num", calc: (l) => pendiente(l.final_net_premium_uw, l.liquidado_uw) },
  { key: "recibo", label: "Recibo", tipo: "text" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "section_no", label: "Sección", tipo: "int" },
  { key: "instalment_number", label: "Instalment", tipo: "int" },
  { key: "number_of_instalments", label: "Number Inst.", tipo: "int" },
  // Resto disponibles
  { key: "class_of_business", label: "Class of Business", tipo: "text" },
  { key: "type_of_insurance", label: "Type of Insurance", tipo: "text" },
  { key: "insured_id", label: "ID Asegurado", tipo: "text" },
  { key: "insured_province", label: "Provincia", tipo: "text" },
  { key: "insured_country", label: "País", tipo: "text" },
  { key: "risk_inception_date", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry_date", label: "Vto. riesgo", tipo: "date" },
  { key: "risk_transaction_type", label: "Risk Trans. Type", tipo: "text" },
  { key: "transaction_type", label: "Transaction Type", tipo: "text" },
  { key: "effective_date_transaction", label: "Efecto trans.", tipo: "date" },
  { key: "original_currency", label: "Moneda", tipo: "text" },
  { key: "gross_written_premium", label: "GWP", tipo: "num" },
  { key: "written_line_pct", label: "Written Line %", tipo: "pct" },
  { key: "total_gwp_our_line", label: "GWP (our line)", tipo: "num" },
  { key: "fees", label: "Fees", tipo: "num" },
  { key: "commission_coverholder_pct", label: "Comisión %", tipo: "pct" },
  { key: "commission_coverholder_amount", label: "Comisión", tipo: "num" },
  { key: "total_taxes_levies", label: "Impuestos", tipo: "num" },
  { key: "total_gwp_including_tax", label: "GWP c/imp.", tipo: "num" },
  { key: "sum_insured_total", label: "Suma aseg. (100%)", tipo: "num" },
  { key: "sum_insured_our_line", label: "Suma aseg. (our line)", tipo: "num" },
  { key: "brokerage_pct", label: "Brokerage %", tipo: "pct" },
  { key: "brokerage_amount", label: "Brokerage", tipo: "num" },
  { key: "final_net_premium_uw", label: "Final Net Prem. UW", tipo: "num" },
  { key: "prima_cobrada", label: "Cobrado (sí/no)", tipo: "bool" },
  { key: "premium_payment_date", label: "F. cobro", tipo: "date" },
  { key: "traspaso", label: "Traspaso (sí/no)", tipo: "bool" },
  { key: "fecha_traspaso", label: "F. traspaso", tipo: "date" },
  { key: "liquidado", label: "Liquidado (sí/no)", tipo: "bool" },
  { key: "fecha_liquidacion", label: "F. liquidación", tipo: "date" },
  { key: "policy_number_reinsured", label: "Nº Póliza", tipo: "text" },
  { key: "notas", label: "Notas", tipo: "text" },
];

const DEFAULT_KEYS: string[] = [
  "certificate_ref",
  "insured_name",
  "reporting_period_start",
  "net_premium_to_broker",
  "estado_premium",
  "premium_bdx",
  "ingresado",
  "pdte_cobro",
  "traspasado",
  "pdte_traspaso",
  "liquidado_uw",
  "pdte_liq",
];

const VACIO = "(vacías)";

function valorRaw(l: BdxLinea, col: Col): unknown {
  if (col.key === "estado_premium") return estadoPremiumLinea(l).label;   // texto canónico (para filtro/orden)
  return col.calc ? col.calc(l) : (l as unknown as Record<string, unknown>)[col.key];
}
// Texto canónico de una celda (para mostrar y para los filtros). "" = vacío.
function fmtValor(l: BdxLinea, col: Col): string {
  const v = valorRaw(l, col);
  if (col.tipo === "bool") return v ? "Sí" : "No";
  if (col.tipo === "date") return fmtFechaES(v);
  if (col.tipo === "num") return fmtMiles(v);
  if (col.tipo === "pct") return v == null || v === "" ? "" : `${fmtMiles(v)} %`;
  if (col.tipo === "int") return v == null ? "" : String(v);
  return v == null ? "" : String(v);
}

// Persistencia de la configuración de columnas (v2: nuevo orden/labels por defecto).
const COLS_KEY = "mayrit.bdx.columnas.v5";   // v5: + columna «Estado Premium», sin «Incluido Premium»
const SORT_KEY = "mayrit.bdx.orden.v4";
const WIDTHS_KEY = "mayrit.bdx.anchos.v1";   // anchos de columna ajustables (arrastrando el borde)
type SortState = { key: string; dir: 1 | -1 } | null;

function cargarVisibles(): string[] {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) {
      const arr = (JSON.parse(raw) as string[]).filter((k) => CATALOGO.some((c) => c.key === k));
      if (arr.length) return arr;
    }
  } catch {
    /* ignora */
  }
  return DEFAULT_KEYS;
}
function cargarSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) return JSON.parse(raw) as SortState;
  } catch {
    /* ignora */
  }
  return { key: "reporting_period_start", dir: 1 };
}

export default function BdxTabla({
  lineas,
  onRowClick,
  acciones,
  hayFiltroExterno,
  onQuitarFiltros,
  bloqueada,
}: {
  lineas: BdxLinea[];
  onRowClick?: (l: BdxLinea) => void;
  acciones?: React.ReactNode;
  hayFiltroExterno?: boolean; // filtro aplicado desde fuera (p. ej. meses en la pestaña Datos)
  onQuitarFiltros?: () => void; // limpiar también ese filtro externo al pulsar "Quitar filtros"
  bloqueada?: (l: BdxLinea) => boolean; // línea en periodo bloqueado → candado + solo lectura
}) {
  const [visibles, setVisibles] = useState<string[]>(cargarVisibles);
  const [sort, setSort] = useState<SortState>(cargarSort);
  const [selId, setSelId] = useState<number | null>(null);   // fila sombreada (para no perderla al scrollear a la derecha)
  const [filtros, setFiltros] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filtro, setFiltro] = useState<{ key: string; x: number; y: number } | null>(null);
  const [filtroSel, setFiltroSel] = useState<Set<string>>(new Set());
  const [filtroBusca, setFiltroBusca] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filtroRef = useRef<HTMLDivElement | null>(null);
  // Anchos de columna ajustables arrastrando el borde derecho de la cabecera. Se tocan los <col> por
  // DOM durante el arrastre (0 re-renders de filas) y solo se persiste al soltar.
  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({});
  const anchosFirst = useRef(true);
  const [anchos, setAnchos] = useState<Record<string, number>>(() => {
    try { const raw = localStorage.getItem(WIDTHS_KEY); if (raw) return JSON.parse(raw) as Record<string, number>; } catch { /* ignora */ }
    return {};
  });
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const anchoDe = (c: Col) =>
    anchos[c.key] ?? (c.key === "estado_premium" ? 165 : c.tipo === "num" || c.tipo === "pct" || c.tipo === "int" ? 90 : 140);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(visibles));
    } catch {
      /* ignora */
    }
  }, [visibles]);
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      /* ignora */
    }
  }, [sort]);
  useEffect(() => {
    if (anchosFirst.current) { anchosFirst.current = false; return; }
    try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(anchos)); } catch { /* ignora */ }
  }, [anchos]);

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

  const cols = useMemo(() => visibles.map((k) => CATALOGO.find((c) => c.key === k)!).filter(Boolean), [visibles]);

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
  function valoresDistintos(col: Col): string[] {
    const s = new Set<string>();
    lineas.forEach((l) => s.add(fmtValor(l, col) || VACIO));
    return [...s].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }
  function abrirFiltro(col: Col, e: React.MouseEvent) {
    e.stopPropagation();
    const actual = filtros[col.key];
    setFiltroSel(new Set(actual ?? valoresDistintos(col)));
    setFiltroBusca("");
    setMenu(null);
    setFiltro({ key: col.key, x: e.clientX, y: e.clientY });
  }
  function aplicarFiltro() {
    if (!filtro) return;
    const col = CATALOGO.find((c) => c.key === filtro.key)!;
    const distintos = valoresDistintos(col);
    setFiltros((f) => {
      const n = { ...f };
      if (filtroSel.size >= distintos.length) delete n[col.key];
      else n[col.key] = new Set(filtroSel);
      return n;
    });
    setFiltro(null);
  }
  function quitarFiltro() {
    if (!filtro) return;
    setFiltros((f) => {
      const n = { ...f };
      delete n[filtro.key];
      return n;
    });
    setFiltro(null);
  }

  // Filtro + orden memoizados (solo se recalculan al cambiar líneas/filtros/orden). Misma lógica.
  const filas = useMemo(() => {
    let f = lineas.filter((l) =>
      Object.entries(filtros).every(([k, set]) => {
        const col = CATALOGO.find((c) => c.key === k)!;
        return set.has(fmtValor(l, col) || VACIO);
      })
    );
    if (sort) {
      const col = CATALOGO.find((c) => c.key === sort.key);
      if (col) {
        const numCol = col.tipo === "num" || col.tipo === "pct" || col.tipo === "int";
        f = [...f].sort((a, b) => {
          let c: number;
          if (col.tipo === "bool") c = (valorRaw(a, col) ? 1 : 0) - (valorRaw(b, col) ? 1 : 0);
          else if (numCol) c = num(valorRaw(a, col)) - num(valorRaw(b, col));
          else c = String(valorRaw(a, col) ?? "").localeCompare(String(valorRaw(b, col) ?? ""), "es", { numeric: true });
          return c * sort.dir;
        });
      }
    }
    return f;
  }, [lineas, filtros, sort]);

  // Totales (sobre las filas filtradas) para el cuadro de la derecha. Memoizados por `filas`.
  const tot = useMemo(() => {
    const sum = (f: keyof BdxLinea) => filas.reduce((a, l) => a + num(l[f]), 0);
    // Nº de pólizas: agrupa por (asegurado + fechas) → une los splits por risk code y los
    // suplementos no cuentan como póliza; solo cuenta las de prima neta (our line) > 0, así una
    // póliza anulada (que netea a 0) no se contabiliza.
    const acc = new Map<string, number>();
    for (const l of filas) {
      const aseg = String(l.insured_id || l.insured_name || "").trim();
      const key = `${aseg}|${l.risk_inception_date ?? ""}|${l.risk_expiry_date ?? ""}`;
      acc.set(key, (acc.get(key) ?? 0) + num(l.total_gwp_our_line));
    }
    let nPolizas = 0;
    for (const v of acc.values()) if (v > 0.005) nPolizas++;
    return {
      gwp: sum("total_gwp_our_line"),
      nPolizas,
      primaMayrit: sum("net_premium_to_broker"),
      cobrado: sum("ingresado"),
      aTraspasar: sum("brokerage_amount"),
      traspasado: sum("traspasado"),
      aLiquidar: sum("final_net_premium_uw"),
      liquidado: sum("liquidado_uw"),
    };
  }, [filas]);
  const { gwp, nPolizas, primaMayrit, cobrado, aTraspasar, traspasado, aLiquidar, liquidado } = tot;

  function celda(l: BdxLinea, col: Col) {
    if (col.key === "estado_premium") {
      const e = estadoPremiumLinea(l);
      return <span className={`pill ${e.clase}`}>{e.label}</span>;
    }
    if (col.tipo === "bool") return <input type="checkbox" checked={!!valorRaw(l, col)} disabled readOnly />;
    const s = fmtValor(l, col);
    return s === "" ? "—" : s;
  }

  return (
    <div className="bdx-tabla-cont">
      <div className="bdx-topbar">
        <div className="bdx-acciones">
          {acciones}
          {(Object.keys(filtros).length > 0 || hayFiltroExterno) && (
            <button
              className="btn-link"
              onClick={() => {
                setFiltros({});
                onQuitarFiltros?.();
              }}
            >
              Quitar filtros
            </button>
          )}
        </div>
        <div className="bdx-totales">
          <div className="tot-col">
            <div className="tot-row"><span>GWP (our line)</span><b>{fmtMiles(gwp)}</b></div>
            <div className="tot-row"><span>Pólizas</span><b title="Únicas por asegurado (CIF) + fechas: une los splits por risk code, los suplementos no cuentan y excluye las anuladas (prima neta ≤ 0)">{fmtMiles(nPolizas, 0)}</b></div>
            <div className="tot-row">
              <span>Líneas</span>
              <b>{Object.keys(filtros).length > 0 ? `${filas.length} / ${lineas.length}` : fmtMiles(filas.length, 0)}</b>
            </div>
          </div>
          <div className="tot-col">
            <div className="tot-row"><span>Prima a Mayrit</span><b>{fmtMiles(primaMayrit)}</b></div>
            <div className="tot-row"><span>Cobrado</span><b>{fmtMiles(cobrado)}</b></div>
            <div className="tot-row tot-pdte"><span>Pdte. Cobro</span><b>{fmtMiles(primaMayrit - cobrado)}</b></div>
          </div>
          <div className="tot-col">
            <div className="tot-row"><span>A traspasar</span><b>{fmtMiles(aTraspasar)}</b></div>
            <div className="tot-row"><span>Traspasado</span><b>{fmtMiles(traspasado)}</b></div>
            <div className="tot-row tot-pdte"><span>Pdte. Traspaso</span><b>{fmtMiles(aTraspasar - traspasado)}</b></div>
          </div>
          <div className="tot-col">
            <div className="tot-row"><span>A liquidar</span><b>{fmtMiles(aLiquidar)}</b></div>
            <div className="tot-row"><span>Liquidado</span><b>{fmtMiles(liquidado)}</b></div>
            <div className="tot-row tot-pdte"><span>Pdte. Liquidación</span><b>{fmtMiles(aLiquidar - liquidado)}</b></div>
          </div>
        </div>
      </div>

      <div className="tabla-scroll bdx-scroll">
        <table className="compacto bdx-tabla tabla-datos">
          <colgroup>
            {bloqueada && <col style={{ width: 22 }} />}
            {cols.map((c) => (
              <col key={c.key} ref={(el) => { colRefs.current[c.key] = el; }} style={{ width: anchoDe(c) }} />
            ))}
            {onRowClick && <col style={{ width: 34 }} />}
            <col className="col-spacer" />
          </colgroup>
          <thead>
            <tr
              onContextMenu={(e) => {
                e.preventDefault();
                setFiltro(null);
                setMenu({ x: e.clientX, y: e.clientY });
              }}
              title="Clic derecho para elegir columnas"
            >
              {bloqueada && <th className="col-lock" title="Bloqueo" />}
              {cols.map((c) => {
                const activo = sort?.key === c.key;
                const numCol = c.tipo === "num" || c.tipo === "pct" || c.tipo === "int";
                const filtrada = !!filtros[c.key];
                return (
                  <th
                    key={c.key}
                    className={(numCol ? "num " : "") + "col-arrastrable" + (dragKey === c.key ? " arrastrando" : "")}
                    style={{ whiteSpace: "nowrap" }}
                    draggable={!resizingKey}
                    onDragStart={(e) => {
                      setDragKey(c.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) moverCol(dragKey, c.key);
                      setDragKey(null);
                    }}
                    onDragEnd={() => setDragKey(null)}
                    title="Arrastra para mover · clic para ordenar · clic derecho para columnas"
                  >
                    <span style={{ cursor: "pointer" }} onClick={() => ordenarPor(c.key)}>
                      {c.label}
                      {activo ? (sort!.dir === 1 ? " ▲" : " ▼") : ""}
                    </span>
                    <span
                      className={"col-filtro" + (filtrada ? " activo" : "")}
                      title="Filtrar"
                      onClick={(e) => abrirFiltro(c, e)}
                    >
                      ▾
                    </span>
                    <span
                      className="col-resize"
                      title="Arrastra para ajustar el ancho (doble clic para auto)"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setAnchos((a) => { const nx = { ...a }; delete nx[c.key]; return nx; });
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const th = (e.currentTarget as HTMLElement).closest("th");
                        const col = colRefs.current[c.key];
                        const startX = e.clientX;
                        const startW = th?.offsetWidth ?? anchoDe(c);
                        let lastW = startW;
                        setResizingKey(c.key);
                        const onMove = (ev: MouseEvent) => {
                          lastW = Math.max(32, Math.round(startW + (ev.clientX - startX)));
                          if (col) col.style.width = `${lastW}px`;
                        };
                        const onUp = () => {
                          setResizingKey(null);
                          setAnchos((a) => ({ ...a, [c.key]: lastW }));
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                    />
                  </th>
                );
              })}
              {onRowClick && <th className="col-acciones" title="Acciones" />}
              <th className="col-spacer" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => {
              const bloq = bloqueada?.(l) ?? false;
              return (
              <tr
                key={l.id}
                className={(bloq ? "fila-bloqueada" : "") + (selId === l.id ? " fila-sel" : "")}
                onClick={() => setSelId(l.id)}
                style={{ cursor: "pointer" }}
              >
                {bloqueada && (
                  <td className="celda-centro col-lock" title={bloq ? "Periodo bloqueado (solo consulta)" : ""}>
                    {bloq ? "🔒" : ""}
                  </td>
                )}
                {cols.map((c) => {
                  const numCol = c.tipo === "num" || c.tipo === "pct" || c.tipo === "int";
                  return (
                    <td key={c.key} className={numCol ? "num" : c.tipo === "bool" ? "celda-centro" : undefined}>
                      {celda(l, c)}
                    </td>
                  );
                })}
                {onRowClick && (
                  <td className="celda-centro col-acciones">
                    <button
                      type="button"
                      className="btn-icono"
                      title={bloq ? "Ver línea (periodo bloqueado)" : "Editar línea"}
                      onClick={() => onRowClick(l)}
                    >
                      {bloq ? "📁" : "✏️"}
                    </button>
                  </td>
                )}
                <td className="col-spacer"></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {menu && (
        <div ref={menuRef} className="col-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="col-menu-titulo">
            Columnas
            <button className="btn-link" style={{ float: "right", padding: 0 }} onClick={() => setVisibles(DEFAULT_KEYS)}>
              Restablecer
            </button>
          </div>
          {CATALOGO.map((c) => (
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
            type="text"
            placeholder="Buscar…"
            value={filtroBusca}
            onChange={(e) => setFiltroBusca(e.target.value)}
            style={{ width: "100%", marginBottom: 6, padding: "5px 8px", border: "1px solid var(--borde)", borderRadius: 6 }}
          />
          {(() => {
            const col = CATALOGO.find((c) => c.key === filtro.key)!;
            const distintos = valoresDistintos(col).filter((v) => v.toLowerCase().includes(filtroBusca.toLowerCase()));
            const todos = distintos.every((v) => filtroSel.has(v));
            return (
              <>
                <label className="col-menu-item">
                  <input
                    type="checkbox"
                    checked={todos}
                    onChange={() =>
                      setFiltroSel((s) => {
                        const n = new Set(s);
                        if (todos) distintos.forEach((v) => n.delete(v));
                        else distintos.forEach((v) => n.add(v));
                        return n;
                      })
                    }
                  />
                  <strong>(Seleccionar todo)</strong>
                </label>
                <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
                  {distintos.map((v) => (
                    <label key={v} className="col-menu-item">
                      <input
                        type="checkbox"
                        checked={filtroSel.has(v)}
                        onChange={() =>
                          setFiltroSel((s) => {
                            const n = new Set(s);
                            if (n.has(v)) n.delete(v);
                            else n.add(v);
                            return n;
                          })
                        }
                      />
                      {v}
                    </label>
                  ))}
                </div>
                <div className="col-filtro-acciones">
                  <button className="btn-link" onClick={quitarFiltro}>
                    Quitar filtro
                  </button>
                  <button className="btn-primary btn-sm" onClick={aplicarFiltro}>
                    Aplicar
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
