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
  { key: "numero", label: "Número", tipo: "text" },
  { key: "binder_umr", label: "Binder (UMR)", tipo: "text" },
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
  { key: "numero_poliza", label: "Nº Póliza / UMR", tipo: "text" },
  { key: "asegurado", label: "Asegurado", tipo: "text" },
  { key: "corredor", label: "Corredor", tipo: "text" },
  { key: "ramo", label: "Ramo", tipo: "text" },
  { key: "tipo_poliza", label: "Tipo", tipo: "text" },
  { key: "pago", label: "Pago", tipo: "text" },
  { key: "moneda", label: "Moneda", tipo: "text" },
  { key: "recibo_num", label: "Recibo nº", tipo: "int" },
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
  { key: "comision_pendiente_cobro", label: "Pdte. Cobro", tipo: "num" },
  { key: "comision_retenida_traspasada", label: "Traspasada", tipo: "num" },
  { key: "prima_adeudada", label: "Prima Adeudada", tipo: "num" },
  { key: "prima_cobrada", label: "Prima Cobrada", tipo: "num" },
  { key: "liquidar", label: "A Liquidar", tipo: "num" },
  { key: "liquidar_cobrado", label: "A Liq. Cobrado", tipo: "num" },
  { key: "liquidar_liquidado", label: "Liquidado", tipo: "num" },
  { key: "honorarios", label: "Honorarios", tipo: "num" },
];
const DEFAULT_KEYS = [
  "numero", "binder_umr", "periodo", "nombre_mercado", "comision_retenida",
  "comision_retenida_cobrada", "comision_pendiente_cobro", "estado_cobro", "fecha_contable",
];

export default function RecibosPage() {
  const [items, setItems] = useState<Recibo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros: Año (servidor, por defecto el actual), YOA / UMR / búsqueda (cliente).
  const [anio, setAnio] = useState<string>(String(new Date().getFullYear()));
  const [yoa, setYoa] = useState("");
  const [umr, setUmr] = useState("");
  const [q, setQ] = useState("");

  const [sel, setSel] = useState<Recibo | null>(null);
  const [saving, setSaving] = useState(false);
  const [confBorrar, setConfBorrar] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  function limpiarFiltros() {
    setYoa("");
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

  const filtrados = items.filter(
    (r) =>
      (!yoa || String(r.yoa ?? "") === yoa.trim()) &&
      (!umr || (r.binder_umr ?? "").toLowerCase().includes(umr.toLowerCase())) &&
      (!q || `${r.numero} ${r.nombre_mercado ?? ""} ${r.asegurado ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  );
  const totalComision = filtrados.reduce((a, r) => a + num(r.comision_retenida), 0);
  const totalCobrada = filtrados.reduce((a, r) => a + num(r.comision_retenida_cobrada), 0);
  const anios = Array.from({ length: new Date().getFullYear() - 2016 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="container">
      <PageHeader emoji="🧾" title="Recibos" />
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <button className="btn-secondary" title="Limpiar todos los filtros" onClick={limpiarFiltros}>🧹</button>
        <select className="filtro" value={anio} onChange={(e) => setAnio(e.target.value)}>
          <option value="todos">Todos los años</option>
          {anios.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <input type="search" placeholder="YOA" style={{ flex: "0 0 90px" }} value={yoa} onChange={(e) => setYoa(e.target.value)} />
        <input type="search" placeholder="UMR…" style={{ flex: "0 0 180px" }} value={umr} onChange={(e) => setUmr(e.target.value)} />
        <input type="search" placeholder="Buscar nº / mercado / asegurado…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="hint">
          Comisión: <b>{eur(totalComision)}</b> · Cobrada: <b>{eur(totalCobrada)}</b>
        </span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay recibos para {anio === "todos" ? "ningún año" : anio}. Cambia el filtro de Año.</div>
      ) : (
        <TablaDatos
          filas={filtrados}
          columnas={CATALOGO}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.recibos.tabla.v1"
          onRowClick={(r) => setSel(r)}
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
