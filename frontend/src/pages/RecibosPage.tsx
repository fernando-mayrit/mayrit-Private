import { useEffect, useState } from "react";
import { recibosApi } from "../api";
import type { Recibo, ReciboUpdate } from "../types";
import PageHeader from "../components/PageHeader";
import ReciboModal from "../components/ReciboModal";
import ConfirmDialog from "../components/ConfirmDialog";
import TablaDatos, { type Col } from "../components/TablaDatos";
import { fmtMiles, estadoCobro } from "../format";

const eur = (v: unknown) => `${fmtMiles(v)} €`;
const num = (v: unknown) => Number(v) || 0;
const periodoFmt = (p: string | null | undefined) => {
  if (!p) return "";
  const [y, m] = p.split("-");
  return m && y ? `${m}/${y}` : p;
};

// Catálogo de TODAS las columnas (clic derecho en la cabecera para elegir).
const CATALOGO: Col<Recibo>[] = [
  { key: "numero", label: "Recibo Nº", tipo: "text" },
  { key: "umr_poliza", label: "UMR / Nº Póliza", tipo: "text", calc: (r) => r.numero_poliza ?? r.binder_umr },
  { key: "periodo", label: "Risk BDX", tipo: "text", calc: (r) => periodoFmt(r.periodo) },
  { key: "anio", label: "Año", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  {
    key: "estado_cobro", label: "Cobro", tipo: "text",
    calc: (r) => estadoCobro(r.comision_retenida, r.comision_retenida_cobrada, r.estado).label,
    render: (r) => {
      const ec = estadoCobro(r.comision_retenida, r.comision_retenida_cobrada, r.estado);
      return <span className={`pill pill-${ec.clase}`}>{ec.label}</span>;
    },
  },
  { key: "estado", label: "Estado", tipo: "text" },
  { key: "nombre_mercado", label: "Mercado", tipo: "text" },
  { key: "mercado", label: "Mercado (alias)", tipo: "text" },
  { key: "asegurado", label: "Asegurado", tipo: "text", width: 120 },
  { key: "corredor", label: "Corredor", tipo: "text" },
  { key: "ramo", label: "Ramo", tipo: "text" },
  { key: "tipo_poliza", label: "Tipo", tipo: "text" },
  { key: "pago", label: "Pago", tipo: "text" },
  { key: "moneda", label: "Moneda", tipo: "text" },
  { key: "recibo_num", label: "Plazo", tipo: "int" },
  { key: "recibos_totales", label: "de", tipo: "text" },
  { key: "fecha_efecto_recibo", label: "F. Efecto", tipo: "date" },
  { key: "fecha_vcto_recibo", label: "F. Vto.", tipo: "date" },
  { key: "fecha_contable", label: "F. Contable", tipo: "date" },
  { key: "prima_neta_recibo", label: "Prima Neta", tipo: "num" },
  { key: "impuestos_recibo", label: "Impuestos", tipo: "num" },
  { key: "prima_bruta_recibo", label: "Prima Total", tipo: "num" },
  { key: "deduccion_total", label: "Deducción", tipo: "num" },
  { key: "comision_cedida_porc", label: "Cedida %", tipo: "pct" },
  { key: "comision_cedida", label: "Cedida", tipo: "num" },
  { key: "comision_retenida_porc", label: "Retenida %", tipo: "pct" },
  { key: "comision_retenida", label: "Comisión", tipo: "num" },
  { key: "comision_retenida_cobrada", label: "Cobrada", tipo: "num" },
  { key: "comision_pendiente_cobro", label: "Cobro", tipo: "num" },
  { key: "comision_retenida_traspasada", label: "Traspasada", tipo: "num" },
  { key: "prima_adeudada", label: "Prima Adeudada", tipo: "num" },
  { key: "prima_cobrada", label: "Prima Cobrada", tipo: "num" },
  { key: "liquidar", label: "A Liquidar", tipo: "num" },
  { key: "liquidar_cobrado", label: "A Liq. Cobrado", tipo: "num" },
  { key: "liquidar_liquidado", label: "Liquidado", tipo: "num" },
  { key: "honorarios", label: "Honorarios", tipo: "num" },
  // Pendientes calculados (sobre los importes base del recibo).
  { key: "pdte_liquidar", label: "Liquidación", tipo: "num", calc: (r) => num(r.liquidar_cobrado) - num(r.liquidar_liquidado) },
  { key: "pdte_traspaso", label: "Traspaso", tipo: "num", calc: (r) => num(r.comision_retenida_cobrada) - num(r.comision_retenida_traspasada) },
  { key: "pendiente_pago", label: "Pago Comi.", tipo: "num", calc: (r) => num(r.comision_cedida_a_pagar) - num(r.comision_cedida_pagada) },
];
const DEFAULT_KEYS = [
  "numero", "tipo_poliza", "umr_poliza", "corredor", "asegurado", "fecha_efecto_recibo",
  "ramo", "nombre_mercado", "pago",
  "comision_pendiente_cobro", "pdte_liquidar", "pdte_traspaso", "pendiente_pago",
];

export default function RecibosPage() {
  const [items, setItems] = useState<Recibo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros: Año (servidor, por defecto el actual), YOA / UMR / búsqueda (cliente).
  const [anio, setAnio] = useState<string>(String(new Date().getFullYear()));
  const [umr, setUmr] = useState("");
  const [q, setQ] = useState("");

  const [sel, setSel] = useState<Recibo | null>(null);
  const [vistaEstados, setVistaEstados] = useState(false); // false = importes, true = pastillas de color
  const [saving, setSaving] = useState(false);
  const [confBorrar, setConfBorrar] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  function limpiarFiltros() {
    setUmr("");
    setQ("");
    setResetSignal((n) => n + 1); // limpia los filtros por columna de la tabla
  }

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setItems(await recibosApi.listar(anio === "todos" ? undefined : { anio: Number(anio) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio]);

  async function guardar(payload: ReciboUpdate) {
    if (!sel) return;
    setSaving(true);
    setError(null);
    try {
      await recibosApi.editar(sel.id, payload);
      setSel(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function borrar() {
    if (!sel) return;
    setSaving(true);
    try {
      await recibosApi.borrar(sel.id);
      setSel(null);
      setConfBorrar(false);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const refDe = (r: Recibo) => r.numero_poliza ?? r.binder_umr ?? null;
  const umrs = [...new Set(items.map(refDe).filter(Boolean) as string[])].sort();
  const filtrados = items.filter(
    (r) =>
      (!umr || refDe(r) === umr) &&
      (!q || `${r.numero} ${r.nombre_mercado ?? ""} ${r.asegurado ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  );
  const totalComision = filtrados.reduce((a, r) => a + num(r.comision_retenida), 0);
  const totalCobrada = filtrados.reduce((a, r) => a + num(r.comision_retenida_cobrada), 0);
  const anios = Array.from({ length: new Date().getFullYear() - 2016 }, (_, i) => new Date().getFullYear() - i);

  // Columnas de "pendiente": en modo estados muestran pastilla (Pendiente/Parcial/Cobrado) por
  // su (total, hecho) en vez del importe.
  // verde = etiqueta del estado "completo" por columna (la roja=Pendiente y amarilla=Parcial son comunes).
  const PEND: Record<string, { total: (r: Recibo) => unknown; hecho: (r: Recibo) => unknown; verde: string }> = {
    comision_pendiente_cobro: { total: (r) => r.comision_retenida, hecho: (r) => r.comision_retenida_cobrada, verde: "Cobrado" },
    pdte_liquidar: { total: (r) => r.liquidar_cobrado, hecho: (r) => r.liquidar_liquidado, verde: "Liquidado" },
    pdte_traspaso: { total: (r) => r.comision_retenida_cobrada, hecho: (r) => r.comision_retenida_traspasada, verde: "Traspasado" },
    pendiente_pago: { total: (r) => r.comision_cedida_a_pagar, hecho: (r) => r.comision_cedida_pagada, verde: "Pagado" },
  };
  const etiquetaEstado = (p: { total: (r: Recibo) => unknown; hecho: (r: Recibo) => unknown; verde: string }, r: Recibo) => {
    const total = num(p.total(r));
    const hecho = num(p.hecho(r));
    // Descuadre: lo realizado supera al total (incoherencia) → sin pastilla, para identificarlo.
    if (hecho > total + 0.005) return { descuadre: true, clase: "", label: "⚠" };
    // Base 0 (aún no aplica: p. ej. no se puede liquidar/traspasar lo que no se ha cobrado) → gris "—".
    if (total <= 0.005) return { descuadre: false, clase: "anulado", label: "—" };
    const ec = estadoCobro(total, hecho, r.estado);
    return { descuadre: false, clase: ec.clase, label: ec.clase === "cobrado" ? p.verde : ec.label };
  };
  const columnas: Col<Recibo>[] = vistaEstados
    ? CATALOGO.map((c) => {
        const p = PEND[c.key];
        if (!p) return c;
        return {
          ...c,
          tipo: "text",
          calc: (r) => etiquetaEstado(p, r).label,
          render: (r) => {
            const e = etiquetaEstado(p, r);
            if (e.descuadre) return <span className="descuadre" title="Descuadre: lo realizado supera al total">⚠</span>;
            return <span className={`pill pill-${e.clase}`}>{e.label}</span>;
          },
        };
      })
    : CATALOGO;

  return (
    <div className="container lista-page">
      <PageHeader emoji="🧾" title="Recibos" />
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <button className="btn-secondary" title="Limpiar todos los filtros" onClick={limpiarFiltros}>🧹</button>
        <select className="filtro" value={anio} onChange={(e) => setAnio(e.target.value)}>
          <option value="todos">Todos los años</option>
          {anios.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="filtro" value={umr} onChange={(e) => setUmr(e.target.value)}>
          <option value="">UMR/Póliza: todos</option>
          {umrs.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input type="search" placeholder="Buscar nº / mercado / asegurado…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="hint">
          Comisión: <b>{eur(totalComision)}</b> · Cobrada: <b>{eur(totalCobrada)}</b>
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 4px 10px 0" }}>
        <label className="check-inline" style={{ fontSize: 11 }}>
          {vistaEstados ? "Ver Cantidades" : "Ver estado por colores"}
          <input type="checkbox" checked={vistaEstados} onChange={(e) => setVistaEstados(e.target.checked)} />
        </label>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay recibos para {anio === "todos" ? "ningún año" : anio}. Cambia el filtro de Año.</div>
      ) : (
        <TablaDatos
          filas={filtrados}
          columnas={columnas}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.recibos.tabla.v8"
          rowAction={(r) => (
            <button className="btn-link" onClick={() => setSel(r)}>
              Editar
            </button>
          )}
          resetSignal={resetSignal}
        />
      )}

      {sel && (
        <ReciboModal
          titulo={`Recibo ${sel.numero}`}
          saveLabel="Guardar"
          recibo={sel}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={() => setSel(null)}
          onDelete={() => setConfBorrar(true)}
        />
      )}
      {confBorrar && sel && (
        <ConfirmDialog
          titulo="BORRAR recibo"
          mensaje={<>Vas a <b>borrar</b> el recibo <b>{sel.numero}</b>.</>}
          detalle="Se desenlazarán sus líneas del BDX y se perderá el registro contable de este recibo."
          confirmLabel="Continuar"
          doble
          onConfirm={borrar}
          onClose={() => setConfBorrar(false)}
        />
      )}
    </div>
  );
}
