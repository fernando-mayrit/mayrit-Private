import { useEffect, useState } from "react";
import { recibosApi, exportarXlsx, crud } from "../api";
import type { Recibo, ReciboUpdate, CuentaBancaria } from "../types";
import PageHeader from "../components/PageHeader";
import ReciboModal from "../components/ReciboModal";
import ConfirmDialog from "../components/ConfirmDialog";
import FormPanel from "../components/FormPanel";
import TablaDatos, { type Col } from "../components/TablaDatos";
import { fmtMiles, fmtFechaES, estadoCobro } from "../format";

const eur = (v: unknown) => `${fmtMiles(v)} €`;
const num = (v: unknown) => Number(v) || 0;
const cuentasApi = crud<CuentaBancaria, unknown>("/cuentas-bancarias");
const hoyISO = () => new Date().toISOString().slice(0, 10);
// Etiqueta de la cuenta según el movimiento.
const LBL_CUENTA: Record<string, string> = {
  cobrar: "Cuenta de cobro",
  liquidar: "Cuenta de liquidación",
  traspasar: "Cuenta origen",
  pagar: "Cuenta de pago",
};
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
    // "Cobro" = cobro de la PRIMA al cliente (prima_adeudada → prima_cobrada), no de la comisión.
    calc: (r) => estadoCobro(r.prima_adeudada, r.prima_cobrada, r.estado).label,
    render: (r) => {
      const ec = estadoCobro(r.prima_adeudada, r.prima_cobrada, r.estado);
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
  // Confirmación de una acción íntegra (cobrar/liquidar/traspasar/pagar) sobre un recibo.
  const [gst, setGst] = useState<
    {
      r: Recibo;
      accion: "cobrar" | "liquidar" | "traspasar" | "pagar";
      deshacer: boolean;
      titulo: string;
      mensaje: string;
      fecha: string;
      cuentaId: string;
      cuentaDestId: string;
    } | null
  >(null);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [vistaEstados, setVistaEstados] = useState(false); // false = importes, true = pastillas de color
  const [gestionMode, setGestionMode] = useState(false);   // muestra acciones por línea y filtra a no-binder
  // Exportar a Excel: selector de columnas (por defecto, las visibles en la tabla).
  const [exportando, setExportando] = useState(false);
  const [expCols, setExpCols] = useState<Set<string>>(new Set());
  const [expSaving, setExpSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confBorrar, setConfBorrar] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  function limpiarFiltros() {
    setAnio("todos");
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
  useEffect(() => {
    cuentasApi.list(undefined, 5000).then((cs) => setCuentas(cs as CuentaBancaria[])).catch(() => {});
  }, []);

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
  async function descontabilizar() {
    if (!sel) return;
    setError(null);
    try {
      const r = await recibosApi.descontabilizar(sel.id);
      setSel(r);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Pide confirmación antes de una acción íntegra (evita clics accidentales).
  function pedirGestion(r: Recibo, accion: "cobrar" | "liquidar" | "traspasar" | "pagar", deshacer: boolean, lbl: string) {
    const importe: Record<typeof accion, number> = {
      cobrar: num(r.prima_adeudada),
      liquidar: num(r.liquidar_cobrado),
      traspasar: num(r.comision_retenida_cobrada),
      pagar: num(r.comision_cedida_a_pagar) || num(r.comision_cedida),
    } as Record<typeof accion, number>;
    const titulo = deshacer ? `Deshacer: ${lbl}` : lbl;
    const mensaje = deshacer
      ? `Vas a deshacer "${lbl}" del recibo ${r.numero}.`
      : `Vas a ${lbl.toLowerCase()} el recibo ${r.numero} por ${eur(importe[accion])}.`;
    // Preselección de la cuenta ya usada en ese movimiento (si existe).
    const ctaPrev: Record<typeof accion, number | null> = {
      cobrar: r.cuenta_cobro_id,
      liquidar: r.cuenta_liquidacion_id,
      traspasar: r.cuenta_traspaso_origen_id,
      pagar: r.cuenta_pago_id,
    } as Record<typeof accion, number | null>;
    setGst({
      r, accion, deshacer, titulo, mensaje,
      fecha: hoyISO(),
      cuentaId: ctaPrev[accion] != null ? String(ctaPrev[accion]) : "",
      cuentaDestId: r.cuenta_traspaso_destino_id != null ? String(r.cuenta_traspaso_destino_id) : "",
    });
  }
  // Abre el selector de columnas, marcando por defecto las que se ven ahora en la tabla.
  function abrirExport() {
    let visibles: string[] = DEFAULT_KEYS;
    try {
      const raw = localStorage.getItem("mayrit.recibos.tabla.v8.cols");
      if (raw) {
        const arr = (JSON.parse(raw) as string[]).filter((k) => CATALOGO.some((c) => c.key === k));
        if (arr.length) visibles = arr;
      }
    } catch { /* ignora */ }
    setExpCols(new Set(visibles));
    setExportando(true);
  }
  // Valor de una celda para Excel: números como número, fechas como dd/mm/aaaa, resto texto.
  function valorExport(r: Recibo, col: Col<Recibo>): string | number | null {
    const raw = col.calc ? col.calc(r) : (r as unknown as Record<string, unknown>)[col.key];
    if (raw == null || raw === "") return null;
    if (col.tipo === "num" || col.tipo === "pct" || col.tipo === "int") return Number(raw) || 0;
    if (col.tipo === "date") return fmtFechaES(raw);
    if (col.tipo === "bool") return raw ? "Sí" : "No";
    return String(raw);
  }
  async function descargarExcel() {
    const cols = CATALOGO.filter((c) => expCols.has(c.key)); // en el orden del catálogo
    if (!cols.length) return setError("Selecciona al menos una columna.");
    setExpSaving(true);
    setError(null);
    try {
      const blob = await exportarXlsx({
        nombre: `recibos_${anio}`,
        hoja: "Recibos",
        headers: cols.map((c) => c.label),
        filas: filtrados.map((r) => cols.map((c) => valorExport(r, c))),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibos_${anio}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportando(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpSaving(false);
    }
  }

  // Ejecuta la acción ya confirmada.
  async function gestionarConfirmado() {
    if (!gst) return;
    // Al hacer el movimiento (no al deshacer) hay que indicar fecha y cuenta(s).
    if (!gst.deshacer) {
      if (!gst.fecha) return setError("Indica la fecha del movimiento.");
      if (!gst.cuentaId) return setError("Indica la cuenta bancaria del movimiento.");
      if (gst.accion === "traspasar") {
        if (!gst.cuentaDestId) return setError("Indica la cuenta de destino del traspaso.");
        if (gst.cuentaDestId === gst.cuentaId) return setError("El traspaso debe ser entre cuentas distintas.");
      }
    }
    setError(null);
    try {
      await recibosApi.gestion(gst.r.id, gst.accion, {
        deshacer: gst.deshacer,
        fecha: gst.deshacer ? undefined : gst.fecha,
        cuenta_id: gst.deshacer ? undefined : Number(gst.cuentaId),
        cuenta_destino_id: !gst.deshacer && gst.accion === "traspasar" ? Number(gst.cuentaDestId) : undefined,
      });
      setGst(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const refDe = (r: Recibo) => r.numero_poliza ?? r.binder_umr ?? null;
  const umrs = [...new Set(items.map(refDe).filter(Boolean) as string[])].sort();
  const filtrados = items.filter(
    (r) =>
      (!gestionMode || r.binder_id == null) && // en modo gestión, solo recibos que NO son de binder
      (!umr || refDe(r) === umr) &&
      (!q || `${r.numero} ${r.nombre_mercado ?? ""} ${r.asegurado ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  );
  const totalComision = filtrados.reduce((a, r) => a + num(r.comision_retenida), 0);
  const totalCobrada = filtrados.reduce((a, r) => a + num(r.comision_retenida_cobrada), 0);
  const totalPdteTraspaso = filtrados.reduce(
    (a, r) => a + (num(r.comision_retenida_cobrada) - num(r.comision_retenida_traspasada)),
    0
  );
  const anios = Array.from({ length: new Date().getFullYear() - 2016 }, (_, i) => new Date().getFullYear() - i);

  // Columnas de "pendiente": en modo estados muestran pastilla (Pendiente/Parcial/Cobrado) por
  // su (total, hecho) en vez del importe.
  // verde = etiqueta del estado "completo" por columna (la roja=Pendiente y amarilla=Parcial son comunes).
  // noAplica: la fase no tiene sentido para ese recibo → pastilla gris "No Aplica" (p. ej. el pago
  // de comisión cedida en recibos de binder, donde no hay pago de comisión).
  const PEND: Record<string, { total: (r: Recibo) => unknown; hecho: (r: Recibo) => unknown; verde: string; noAplica?: (r: Recibo) => boolean }> = {
    comision_pendiente_cobro: { total: (r) => r.prima_adeudada, hecho: (r) => r.prima_cobrada, verde: "Cobrado" },
    pdte_liquidar: { total: (r) => r.liquidar_cobrado, hecho: (r) => r.liquidar_liquidado, verde: "Liquidado" },
    pdte_traspaso: { total: (r) => r.comision_retenida_cobrada, hecho: (r) => r.comision_retenida_traspasada, verde: "Traspasado" },
    pendiente_pago: { total: (r) => r.comision_cedida_a_pagar, hecho: (r) => r.comision_cedida_pagada, verde: "Pagado", noAplica: (r) => r.binder_id != null },
  };
  const etiquetaEstado = (p: { total: (r: Recibo) => unknown; hecho: (r: Recibo) => unknown; verde: string; noAplica?: (r: Recibo) => boolean }, r: Recibo) => {
    // La fase no aplica a este recibo (p. ej. pago de comisión en recibos de binder) → gris "No Aplica".
    if (p.noAplica?.(r)) return { descuadre: false, clase: "anulado", label: "No Aplica" };
    const total = num(p.total(r));
    const hecho = num(p.hecho(r));
    // Se compara EN MAGNITUD (valor absoluto) para que los recibos en negativo (extornos) se
    // comporten igual que los positivos.
    // Descuadre: lo realizado supera al total (incoherencia) → sin pastilla, para identificarlo.
    // Tolerancia de 5 céntimos para no marcar diferencias de redondeo de la migración.
    if (Math.abs(hecho) > Math.abs(total) + 0.05) return { descuadre: true, clase: "", label: "⚠" };
    // Base 0: "nada que hacer" en esta fase → verde (completada) SOLO si la prima ya está cobrada;
    // las fases dependen del cobro. Si aún no se ha cobrado → gris "—" (fase no alcanzada).
    // "Cobrada" se mide por IMPORTE (estadoCobro), no por la fecha: los recibos migrados traen
    // prima_cobrada pero sin prima_fecha_cobro, y aun así están cobrados.
    if (Math.abs(total) <= 0.005) {
      const cobrado = estadoCobro(r.prima_adeudada, r.prima_cobrada, r.estado).clase === "cobrado";
      return cobrado
        ? { descuadre: false, clase: "cobrado", label: p.verde }
        : { descuadre: false, clase: "anulado", label: "—" };
    }
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
    : // En modo cantidades, las columnas de pendientes muestran lo YA REALIZADO
      // (Cobrado / Liquidado / Traspasado / Pagado) en vez del pendiente.
      CATALOGO.map((c) => {
        const p = PEND[c.key];
        return p ? { ...c, label: p.verde, calc: p.hecho } : c;
      });

  return (
    <div className="container lista-page">
      <PageHeader emoji="🧾" title="Recibos" />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Columna izquierda: filtros + toggles justo debajo de los buscadores */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="toolbar" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <button className="btn-secondary" title="Limpiar todos los filtros" onClick={limpiarFiltros}>🧹</button>
            <select className="filtro" value={anio} onChange={(e) => setAnio(e.target.value)}>
              <option value="todos">Todos los años</option>
              {anios.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="filtro" value={umr} onChange={(e) => setUmr(e.target.value)}>
              <option value="">UMR/Póliza: todos</option>
              {umrs.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <input
              type="search"
              placeholder="Buscar nº / mercado / asegurado…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: "1 1 160px", minWidth: 160 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              {/* On/Off: pulsador a la izquierda del texto, tamaño compacto, mismo para los dos */}
              <button
                type="button"
                role="switch"
                aria-checked={gestionMode}
                className={"switch switch-sm" + (gestionMode ? " on" : "")}
                onClick={() => setGestionMode((v) => !v)}
                title="Acciones de cobro/pago por recibo (solo recibos que no son de binder)"
              >
                <span className="switch-track"><span className="switch-knob" /></span>
                <span className="switch-label" style={{ fontSize: 11 }}>⚙️ Gestión de cobros/pagos</span>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={vistaEstados}
                className={"switch switch-sm" + (vistaEstados ? " on" : "")}
                onClick={() => setVistaEstados((v) => !v)}
                title="Alterna entre importes y pastillas de estado por colores"
              >
                <span className="switch-track"><span className="switch-knob" /></span>
                <span className="switch-label" style={{ fontSize: 11 }}>{vistaEstados ? "Ver Cantidades" : "Ver estado por colores"}</span>
              </button>
            </div>
            {/* Excel: debajo del buscador, a la izquierda del cuadro contador */}
            <button className="btn-secondary btn-sm" title="Exportar el listado a Excel" onClick={abrirExport}>
              ⬇️ Excel
            </button>
          </div>
        </div>

        {/* Columna derecha: contador */}
        <div className="contador-recibos">
          <div className="cr-row cr-head"><span>Comisión</span><b>{eur(totalComision)}</b></div>
          <div className="cr-row cr-sub"><span>Cobrada</span><b>{eur(totalCobrada)}</b></div>
          <div className="cr-row cr-sub"><span>Pdte. Traspaso</span><b>{eur(totalPdteTraspaso)}</b></div>
        </div>
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
          rowAction={(r) => {
            // Fuera del modo gestión (o en recibos de binder, que van por Premium BDX): solo Editar.
            if (!gestionMode || r.binder_id != null) {
              return <button className="btn-link" onClick={() => setSel(r)}>Editar</button>;
            }
            const cobrado = !!r.prima_fecha_cobro;
            const liquidado = !!r.liquidar_fecha_liquidacion;
            const traspasado = !!r.comision_fecha_traspaso;
            const pagado = !!r.comision_cedida_fecha_pago;
            const tieneCedida = num(r.comision_cedida) > 0 || num(r.comision_cedida_a_pagar) > 0;
            const chip = (on: boolean, emoji: string, acc: "cobrar" | "liquidar" | "traspasar" | "pagar", lbl: string) => (
              <button
                className={"acc-chip" + (on ? " on" : "")}
                title={on ? `${lbl} ✓ — clic para deshacer` : lbl}
                onClick={() => pedirGestion(r, acc, on, lbl)}
              >
                {emoji}
              </button>
            );
            return (
              <div className="recibo-row-acc">
                {chip(cobrado, "💰", "cobrar", "Cobrar")}
                {/* Liquidar/Traspasar/Pagar SOLO tienen sentido (y aparecen) una vez cobrada la prima. */}
                {cobrado && chip(liquidado, "🏦", "liquidar", "Liquidar a compañía")}
                {cobrado && chip(traspasado, "🔁", "traspasar", "Traspasar comisión a gastos")}
                {cobrado && tieneCedida && chip(pagado, "💸", "pagar", "Pagar comisión al corredor")}
                <button className="btn-link" onClick={() => setSel(r)}>Editar</button>
              </div>
            );
          }}
          resetSignal={resetSignal}
        />
      )}

      {sel && (
        <ReciboModal
          titulo={<>Recibo <span style={{ color: "var(--naranja-osc)", fontWeight: 700 }}>{sel.numero}</span></>}
          saveLabel="Guardar"
          recibo={sel}
          bloqueado={sel.estado === "Contabilizado"}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={() => setSel(null)}
          onDelete={() => setConfBorrar(true)}
          onDescontabilizar={descontabilizar}
        />
      )}
      {exportando && (
        <FormPanel
          title="Exportar a Excel"
          dirty={false}
          saving={expSaving}
          saveLabel={`Descargar (${filtrados.length} filas)`}
          error={error}
          onSave={descargarExcel}
          onClose={() => setExportando(false)}
        >
          <p className="hint" style={{ marginBottom: 10 }}>
            Marca las columnas a exportar. Se exporta el listado tal y como está filtrado.
          </p>
          <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
            <button className="btn-link" onClick={() => setExpCols(new Set(CATALOGO.map((c) => c.key)))}>Todas</button>
            <button className="btn-link" onClick={() => setExpCols(new Set())}>Ninguna</button>
            <button className="btn-link" onClick={() => setExpCols(new Set(DEFAULT_KEYS))}>Por defecto</button>
          </div>
          <div className="export-cols">
            {CATALOGO.map((c) => (
              <label key={c.key} className="col-menu-item">
                <input
                  type="checkbox"
                  checked={expCols.has(c.key)}
                  onChange={() =>
                    setExpCols((s) => {
                      const nx = new Set(s);
                      if (nx.has(c.key)) nx.delete(c.key);
                      else nx.add(c.key);
                      return nx;
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </FormPanel>
      )}
      {gst && (
        <FormPanel
          title={gst.titulo}
          dirty={false}
          saving={false}
          saveLabel={gst.deshacer ? "Deshacer" : "Confirmar"}
          error={error}
          onSave={gestionarConfirmado}
          onClose={() => { setGst(null); setError(null); }}
        >
          <p className="hint" style={{ marginBottom: 12 }}>{gst.mensaje}</p>
          {!gst.deshacer && (
            <>
              <div className="field">
                <label>Fecha del movimiento <span className="required">*</span></label>
                <input
                  type="date"
                  className="inp-fecha"
                  value={gst.fecha}
                  autoFocus
                  onChange={(e) => setGst({ ...gst, fecha: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{LBL_CUENTA[gst.accion]} <span className="required">*</span></label>
                <select value={gst.cuentaId} onChange={(e) => setGst({ ...gst, cuentaId: e.target.value })}>
                  <option value="">— Elige cuenta —</option>
                  {cuentas
                    .filter((c) => c.activa || String(c.id) === gst.cuentaId)
                    .map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              {gst.accion === "traspasar" && (
                <div className="field">
                  <label>Cuenta destino <span className="required">*</span></label>
                  <select value={gst.cuentaDestId} onChange={(e) => setGst({ ...gst, cuentaDestId: e.target.value })}>
                    <option value="">— Elige cuenta —</option>
                    {cuentas
                      .filter((c) => c.activa || String(c.id) === gst.cuentaDestId)
                      .map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <span className="hint">El traspaso es entre dos cuentas de Mayrit (origen → destino).</span>
                </div>
              )}
            </>
          )}
        </FormPanel>
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
