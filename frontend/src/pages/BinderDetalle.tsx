import { useEffect, useMemo, useState } from "react";
import { bdxApi, recibosApi, siniestrosApi, claimsBdxApi, triangulacionApi, type BdxDetalle, type BdxPreview, type BdxImportResult, type ExcelDir, type PremiumGrupo, type ClaimsBdxVista, type Triangulacion, type MetricaTriangulo } from "../api";
import type { Binder, Bdx, BdxLinea, Recibo, Siniestro } from "../types";
import BdxLineaPanel from "../components/BdxLineaPanel";
import BdxTabla from "../components/BdxTabla";
import TablaDatos, { type Col } from "../components/TablaDatos";
import NumberInput from "../components/NumberInput";
import ReciboModal from "../components/ReciboModal";
import PremiumMatch from "../components/PremiumMatch";
import ConfirmDialog from "../components/ConfirmDialog";
import FormPanel from "../components/FormPanel";
import type { ReactNode } from "react";
import type { ReciboPreview, ReciboUpdate } from "../types";
import { fmtMiles, fmtFechaES, estadoCobro, estadoSiniestroClase } from "../format";

function n(v: unknown): number {
  const x = Number(String(v ?? "").replace(",", "."));
  return isNaN(x) ? 0 : x;
}

const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
// Clase de color del Estado del binder para la etiqueta del encabezado.
function estadoBadgeClase(estado: string | null | undefined): string {
  switch (estado) {
    case "En Vigor": return "eb-vigor";
    case "Renovado": return "eb-renovado";
    case "No Renovado": return "eb-norenovado";
    case "Cancelado": return "eb-cancelado";
    case "Cerrado Producción": return "eb-cerrado-prod";
    case "Cerrado": return "eb-cerrado";
    default: return "eb-otro";
  }
}
function mesLargo(k: string): string {
  const [y, mo] = k.split("-");
  return `${MESES_ES[Number(mo) - 1] ?? mo} ${y}`;
}
// Meses (aaaa-mm) distintos de un campo de fecha en las líneas.
function mesesDe(lineas: BdxLinea[], campo: keyof BdxLinea, filtro?: (l: BdxLinea) => boolean): string[] {
  const s = new Set<string>();
  for (const l of lineas) {
    if (filtro && !filtro(l)) continue;
    const k = String(l[campo] ?? "").slice(0, 7);
    if (k) s.add(k);
  }
  return [...s].sort().reverse();
}

function fmtFecha(s: string | null | undefined): string {
  return fmtFechaES(s) || "—";
}
function imp(v: string | number | null | undefined): string {
  return fmtMiles(v) || "—";
}

// Catálogo de columnas del listado de Siniestros (clic derecho en la cabecera para elegir/mover).
const SIN_COLS: Col<Siniestro>[] = [
  { key: "certificate", label: "Certificate", tipo: "text" },
  { key: "reference", label: "Reference", tipo: "text" },
  { key: "insured", label: "Asegurado", tipo: "text", width: 180 },
  { key: "section", label: "Secc.", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "currency", label: "Moneda", tipo: "text" },
  { key: "status", label: "Estado", tipo: "text",
    render: (s) => s.status ? <span className={`pill pill-sin-${estadoSiniestroClase(s.status)}`}>{s.status}</span> : <span className="hint">—</span> },
  { key: "claimant", label: "Reclamante", tipo: "text", width: 160 },
  { key: "reporting_period", label: "Periodo", tipo: "text" },
  { key: "risk_inception", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry", label: "Fin riesgo", tipo: "date" },
  { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
  { key: "date_opened", label: "Abierto", tipo: "date" },
  { key: "date_closed", label: "Cerrado", tipo: "date" },
  { key: "amount_claimed", label: "Reclamado", tipo: "num" },
  { key: "to_pay_indemnity", label: "A pagar ind.", tipo: "num" },
  { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
  { key: "paid_indemnity", label: "Pagado ind.", tipo: "num" },
  { key: "paid_fees", label: "Pagado fees", tipo: "num" },
  { key: "reserves_indemnity", label: "Reservas ind.", tipo: "num" },
  { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
  { key: "total_indemnity", label: "Total ind.", tipo: "num" },
  { key: "total_fees", label: "Total fees", tipo: "num" },
  { key: "total", label: "Total", tipo: "num", calc: (s) => n(s.total_indemnity) + n(s.total_fees) },
  { key: "ucr", label: "UCR", tipo: "text" },
  { key: "abogado", label: "Abogado", tipo: "text" },
  { key: "description", label: "Descripción", tipo: "text", width: 220 },
  { key: "refer", label: "Refer", tipo: "text" },
  { key: "denial", label: "Denial", tipo: "text" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
];
const SIN_DEFAULT = [
  "reference", "certificate", "insured", "risk_code", "claim_first_advised", "date_opened",
  "paid_fees", "paid_indemnity", "reserves_fees", "reserves_indemnity",
  "total_fees", "total_indemnity", "total", "date_closed", "status",
];

export default function BinderDetalle({ binder, onBack }: { binder: Binder; onBack: () => void }) {
  const [tab, setTab] = useState<"datos" | "bloqueo" | "bdx" | "lpan" | "premium" | "calculos" | "recibos" | "siniestros" | "claimsbdx" | "triangulacion">("bdx");

  // ── BDX (uno por binder) ──
  const [bdxs, setBdxs] = useState<Bdx[]>([]);
  const [sel, setSel] = useState<BdxDetalle | null>(null); // el BDX del binder, con líneas
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linea, setLinea] = useState<BdxLinea | "nueva" | null>(null);

  // ── Siniestros (Claims BDX del binder) ──
  const [siniestros, setSiniestros] = useState<Siniestro[]>([]);
  const [sinCargado, setSinCargado] = useState(false);

  async function cargarSiniestros() {
    try {
      setSiniestros(await siniestrosApi.listar(binder.id));
      setSinCargado(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    // Los Claims se usan en la pestaña Siniestros y en la siniestralidad del PC.
    // Se recarga al abrir la pestaña (refleja correcciones sin re-importar de SharePoint).
    if (tab === "siniestros" || tab === "calculos") cargarSiniestros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Claims BDX (bordereau mensual acumulativo) ──
  const [cbVista, setCbVista] = useState<ClaimsBdxVista | null>(null);
  const [cbPeriodos, setCbPeriodos] = useState<{ periodo: string; n: number; fecha: string | null }[]>([]);
  const [cbBusy, setCbBusy] = useState(false);
  const [cbMsg, setCbMsg] = useState<string | null>(null);
  const [cbPresentarMes, setCbPresentarMes] = useState<string | null>(null); // mes elegido a presentar

  // ── Triangulación de siniestralidad ──
  const [tri, setTri] = useState<Triangulacion | null>(null);
  const [triMetrica, setTriMetrica] = useState<MetricaTriangulo>("incurrido");
  const [triVista, setTriVista] = useState<"cal" | "edad">("cal"); // calendario o por antigüedad
  const [triScope, setTriScope] = useState<{ seccion?: number; risk_code?: string }>({});
  const [triBusy, setTriBusy] = useState(false);
  async function cargarTriangulacion(scope: { seccion?: number; risk_code?: string }) {
    setTriBusy(true);
    try {
      setTri(await triangulacionApi.deBinder(binder.id, scope));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTriBusy(false);
    }
  }
  async function exportarTriangulo() {
    try {
      const blob = await triangulacionApi.excelBinder(binder.id, triMetrica, triScope);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Triangulacion ${binder.umr} ${triMetrica} ${tri?.ambito ?? ""}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (tab === "triangulacion") cargarTriangulacion(triScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, triScope]);

  async function cargarClaimsBdx(periodo?: string) {
    try {
      const [v, ps] = await Promise.all([claimsBdxApi.vista(binder.id, periodo), claimsBdxApi.periodos(binder.id)]);
      setCbVista(v);
      setCbPeriodos(ps);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cargarClaimsPeriodos() {
    try {
      setCbPeriodos(await claimsBdxApi.periodos(binder.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function descargarSnapshot(periodo: string) {
    setError(null);
    try {
      const blob = await claimsBdxApi.excel(binder.id, periodo, "presentado");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claims BDX ${binder.umr ?? binder.id} ${periodo} (presentado).xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (tab === "claimsbdx") cargarClaimsBdx(cbVista?.periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    // La pestaña Bloqueo refleja presentaciones de Claims (su columna = periodos presentados).
    if (tab === "bloqueo") { refrescarBloqueos(); cargarClaimsPeriodos(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function descargarClaimsBdx(modo: "vivo" | "presentado", periodo?: string) {
    const per = periodo ?? cbVista?.periodo;
    if (!per) return;
    setError(null);
    try {
      const blob = await claimsBdxApi.excel(binder.id, per, modo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claims BDX ${binder.umr ?? binder.id} ${per}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function presentarClaimsBdx(mes: string) {
    setCbBusy(true);
    setCbMsg(null);
    setError(null);
    try {
      const r = (await claimsBdxApi.presentar(binder.id, mes, localStorage.getItem("mayrit.usuario") ?? undefined)) as { presentados: number };
      setCbMsg(`Presentado ${mes}: ${r.presentados} siniestro(s). Mes bloqueado.`);
      setCbPresentarMes(null);
      await cargarClaimsBdx(mes);        // pasa a ver el mes recién presentado
      await refrescarBloqueos();         // refleja el bloqueo en la pestaña Bloqueo
      await descargarClaimsBdx("vivo", mes); // descarga el bordereau presentado
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCbBusy(false);
    }
  }

  // ── Selector de Excel (carpeta servida por el backend) ──
  const [excelOpen, setExcelOpen] = useState(false);
  const [excelDir, setExcelDir] = useState<ExcelDir | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelErr, setExcelErr] = useState<string | null>(null);
  const [excelSel, setExcelSel] = useState<string | null>(null);
  // PC: IBNR manual (% s/ GWP). La siniestralidad sale de los Claims importados (no simulada).
  const [ibnrPct, setIbnrPct] = useState("0");
  // Selección de meses/periodos en la tabla de Datos.
  const [selMeses, setSelMeses] = useState<Set<string>>(new Set());
  // Bloqueo de periodos por tipo de BDX (local de momento; falta persistencia/lógica de presentar).
  const [bloqueos, setBloqueos] = useState<Set<string>>(new Set());
  // Recibos de comisión del binder (1 por Risk BDX). Mapa periodo 'YYYY-MM' → recibo.
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [generando, setGenerando] = useState<string | null>(null); // periodo cuyo preview se está pidiendo
  const [borrador, setBorrador] = useState<ReciboPreview | null>(null); // recibo precalculado a emitir
  const [emitiendo, setEmitiendo] = useState(false);
  // Macheo de un Premium (Excel) seleccionado
  const [matchExcel, setMatchExcel] = useState<{ ruta: string; nombre: string } | null>(null);
  const [excelModo, setExcelModo] = useState<"risk" | "premium">("risk");
  // Premiums del binder (grupos por mes) y fecha de pago por periodo (para el cobro)
  const [premiums, setPremiums] = useState<PremiumGrupo[]>([]);
  const [fechasPago, setFechasPago] = useState<Record<string, string>>({});
  // Diálogo de confirmación contundente para acciones sensibles
  const [confirmar, setConfirmar] = useState<
    { titulo: string; mensaje: ReactNode; detalle?: ReactNode; confirmLabel?: string; doble?: boolean; accion: () => void } | null
  >(null);

  // ── Importación desde SharePoint ──
  const [importAbierto, setImportAbierto] = useState(false);
  const [preview, setPreview] = useState<BdxPreview | null>(null);
  const [importRes, setImportRes] = useState<BdxImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const importado = bdxs.length > 0;

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const lista = await bdxApi.listar(binder.id);
      setBdxs(lista);
      // El resto de cargas son independientes entre sí → en paralelo (antes eran 4 awaits en serie).
      const [detalle, bl, recs, prems] = await Promise.all([
        lista.length > 0 ? bdxApi.detalle(lista[0].id) : Promise.resolve(null),
        bdxApi.listarBloqueos(binder.id),
        recibosApi.deBinder(binder.id),
        recibosApi.listarPremium(binder.id),
      ]);
      setSel(detalle);
      setBloqueos(new Set(bl.map((b) => `${b.tipo}:${b.periodo}`)));
      setRecibos(recs);
      setPremiums(prems);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refrescarSel() {
    if (sel) setSel(await bdxApi.detalle(sel.id));
  }
  async function refrescarBloqueos() {
    const bl = await bdxApi.listarBloqueos(binder.id);
    setBloqueos(new Set(bl.map((b) => `${b.tipo}:${b.periodo}`)));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binder.id]);

  async function abrirImport() {
    setImportAbierto(true);
    setPreview(null);
    setImportRes(null);
    setImportError(null);
    setImportBusy(true);
    try {
      setPreview(await bdxApi.sharepointPreview(binder.id));
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  async function hacerImport() {
    setImportBusy(true);
    setImportError(null);
    try {
      setImportRes(await bdxApi.importarSharepoint(binder.id));
      await cargar();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  function cerrarImport() {
    setImportAbierto(false);
    setPreview(null);
    setImportRes(null);
    setImportError(null);
  }

  async function cargarCarpeta(sub: string) {
    setExcelBusy(true);
    setExcelErr(null);
    try {
      setExcelDir(await bdxApi.excelDir(sub));
    } catch (e) {
      setExcelErr((e as Error).message);
    } finally {
      setExcelBusy(false);
    }
  }
  function elegirExcel(modo: "risk" | "premium" = "risk") {
    setExcelModo(modo);
    setExcelOpen(true);
    setExcelSel(null);
    setExcelDir(null);
    cargarCarpeta("");
  }
  function subirCarpeta() {
    const sub = excelDir?.sub ?? "";
    const padre = sub.includes("/") ? sub.slice(0, sub.lastIndexOf("/")) : "";
    cargarCarpeta(padre);
  }

  // Cifras por mes (Reporting Start): GWP (our line), Net Premium to Broker, comisión (brokerage).
  // Memoizado por `sel`: las líneas pueden ser miles; no recalcular en cada render.
  const { porMes, totGwp, totNet } = useMemo(() => {
    const m = new Map<string, { gwp: number; net: number; brk: number; recibos: Set<string> }>();
    for (const l of sel?.lineas ?? []) {
      const k = String(l.reporting_period_start ?? "").slice(0, 7); // aaaa-mm
      if (!k) continue;
      const cur = m.get(k) ?? { gwp: 0, net: 0, brk: 0, recibos: new Set<string>() };
      cur.gwp += n(l.total_gwp_our_line);
      cur.net += n(l.net_premium_to_broker);
      cur.brk += n(l.brokerage_amount);
      if (l.recibo) cur.recibos.add(String(l.recibo));
      m.set(k, cur);
    }
    const pm = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { porMes: pm, totGwp: pm.reduce((a, [, v]) => a + v.gwp, 0), totNet: pm.reduce((a, [, v]) => a + v.net, 0) };
  }, [sel]);

  // Recibo ya generado de cada periodo (1 por Risk BDX).
  const reciboDe = useMemo(() => new Map(recibos.map((r) => [r.periodo, r])), [recibos]);

  // Estado de cierre del binder: "Cerrado Producción" → no más Risk/Premium; "Cerrado" → además
  // cierra Siniestros.
  const produccionCerrada = (binder.estado || "").startsWith("Cerrado");
  const cerradoTotal = binder.estado === "Cerrado";
  // Los binders de Contingencias no se triangulan → se oculta esa pestaña.
  const esContingencias = binder.secciones.some((s) => (s.ramo ?? "").toLowerCase().includes("contingencias"));

  // Totales del Premium (lo macheado) vs totales del Risk (todas las líneas). Cuando todo está
  // macheado, deben coincidir. Prima = our line + impuestos − comisión cedida; Comisión = brokerage.
  // Totales del Risk (todas las líneas) + nº de pólizas. Memoizado por `sel`.
  const { riskLineas, riskPrima, riskComision, nPolizas } = useMemo(() => {
    const lineasRisk = sel?.lineas ?? [];
    // Nº de pólizas (mismo criterio que el contador del BDX): únicas por (asegurado + fechas),
    // une splits por risk code, ignora suplementos y excluye anuladas (prima neta our line ≤ 0).
    const acc = new Map<string, number>();
    for (const l of lineasRisk) {
      const aseg = String(l.insured_id || l.insured_name || "").trim();
      const key = `${aseg}|${l.risk_inception_date ?? ""}|${l.risk_expiry_date ?? ""}`;
      acc.set(key, (acc.get(key) ?? 0) + n(l.total_gwp_our_line));
    }
    let np = 0;
    for (const v of acc.values()) if (v > 0.005) np++;
    return {
      riskLineas: lineasRisk.length,
      riskPrima: lineasRisk.reduce((a, l) => a + n(l.total_gwp_our_line) + n(l.total_taxes_levies) - n(l.commission_coverholder_amount), 0),
      riskComision: lineasRisk.reduce((a, l) => a + n(l.brokerage_amount), 0),
      nPolizas: np,
    };
  }, [sel]);
  // Líneas que se muestran en la tabla del BDX (filtradas por los meses seleccionados). Memoizado
  // para no crear un array nuevo en cada render (que invalidaría el memo de BdxTabla).
  const lineasVista = useMemo(() => {
    const ls = sel?.lineas ?? [];
    return selMeses.size > 0
      ? ls.filter((l) => selMeses.has(String(l.reporting_period_start ?? "").slice(0, 7)))
      : ls;
  }, [sel, selMeses]);

  const premLineas = premiums.reduce((a, p) => a + p.num_lineas, 0);
  const premPrima = premiums.reduce((a, p) => a + n(p.prima), 0);
  const premComision = premiums.reduce((a, p) => a + n(p.comision), 0);

  // Fecha por (periodo, etapa) para las acciones del ciclo de cobro (cobro/traspaso/liquidación).
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const fechaDe = (periodo: string, etapa: string) => fechasPago[`${periodo}:${etapa}`] ?? hoyISO();
  const setFecha = (periodo: string, etapa: string, v: string) =>
    setFechasPago((s) => ({ ...s, [`${periodo}:${etapa}`]: v }));

  // Ejecuta una acción del ciclo (cobrar/traspasar/liquidar) sobre un Premium y recarga.
  function pedirAccionPremium(
    periodo: string,
    etapa: "cobro" | "traspaso" | "liquidacion",
    cfg: { titulo: string; verbo: ReactNode; detalle: string; confirmLabel: string; api: (b: number, p: string, f: string) => Promise<unknown> }
  ) {
    const fecha = fechaDe(periodo, etapa);
    setConfirmar({
      titulo: cfg.titulo,
      mensaje: (
        <>
          {cfg.verbo} el Premium <b>{mesLargo(periodo)}</b> con fecha <b>{fmtFechaES(fecha)}</b>.
        </>
      ),
      detalle: cfg.detalle,
      confirmLabel: cfg.confirmLabel,
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await cfg.api(binder.id, periodo, fecha);
          await cargar();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }
  const pedirCobrarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "cobro", {
      titulo: "💰 Marcar Premium como COBRADO",
      verbo: <>Vas a dar por <b>cobrado</b></>,
      detalle: "Se marcan las líneas como cobradas y se actualiza Cantidad Cobrada / Pdte. Cobro en los recibos.",
      confirmLabel: "💰 Sí, cobrar",
      api: recibosApi.cobrarPremium,
    });
  const pedirTraspasarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "traspaso", {
      titulo: "🔁 Traspasar la comisión",
      verbo: <>Vas a <b>traspasar nuestra comisión</b> (de la cuenta de primas a la de gastos) de</>,
      detalle: "Marca la comisión como traspasada y actualiza Traspasada / Pdte. Traspaso en los recibos.",
      confirmLabel: "🔁 Sí, traspasar",
      api: recibosApi.traspasarPremium,
    });
  const pedirLiquidarPremium = (periodo: string) =>
    pedirAccionPremium(periodo, "liquidacion", {
      titulo: "🏦 Liquidar a la compañía",
      verbo: <>Vas a <b>liquidar a la compañía / Lloyd's</b> el importe a liquidar de</>,
      detalle: "Marca como liquidado y actualiza Liquidado / Pdte. Liquidación en los recibos.",
      confirmLabel: "🏦 Sí, liquidar",
      api: recibosApi.liquidarPremium,
    });
  // Tras machear/subir un Premium, ofrecer bloquearlo (cerrar ese Premium).
  function pedirBloquearPremium(periodo: string) {
    setConfirmar({
      titulo: "¿Bloquear este Premium?",
      mensaje: (
        <>
          Premium <b>{mesLargo(periodo)}</b> macheado. ¿Quieres <b>bloquearlo</b> ahora?
        </>
      ),
      detalle: "Un Premium bloqueado no admite más cambios ni se puede deshacer su cobro. Podrás desbloquearlo en la pestaña Bloqueo.",
      confirmLabel: "Sí, bloquear",
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await bdxApi.bloquear(binder.id, "premium", periodo);
          await cargar();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }
  function pedirDescobrarPremium(periodo: string) {
    setConfirmar({
      titulo: "DESHACER el cobro del Premium",
      mensaje: (
        <>
          Vas a <b>deshacer el cobro</b> del Premium <b>{mesLargo(periodo)}</b>.
        </>
      ),
      detalle: "Sus líneas volverán a PENDIENTE y se revertirá el cobro en los recibos afectados (prima, comisión y liquidación cobradas).",
      confirmLabel: "Continuar",
      doble: true,
      accion: async () => {
        setConfirmar(null);
        setError(null);
        try {
          await recibosApi.descobrarPremium(binder.id, periodo, new Date().toISOString().slice(0, 10));
          await cargar();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  // Celda de una etapa del ciclo (cobro/traspaso/liquidación) en el listado de Premium.
  function celdaEtapa(p: PremiumGrupo, etapa: "cobro" | "traspaso" | "liquidacion", bloq: boolean): ReactNode {
    const done = etapa === "cobro" ? p.cobrado : etapa === "traspaso" ? p.traspasado : p.liquidado;
    const fecha = etapa === "cobro" ? p.fecha_pago : etapa === "traspaso" ? p.fecha_traspaso : p.fecha_liquidacion;
    if (etapa !== "cobro" && !p.cobrado) return <span className="hint">—</span>;
    if (done) {
      const puedeDeshacer = etapa === "cobro" && !bloq && !p.traspasado && !p.liquidado;
      return (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className="pill pill-cobrado">✓ {fecha ? fmtFechaES(fecha) : ""}</span>
          {puedeDeshacer && (
            <button className="btn-link" onClick={() => pedirDescobrarPremium(p.periodo)}>Deshacer</button>
          )}
        </span>
      );
    }
    if (bloq) return <span className="hint">🔒</span>;
    const cfg =
      etapa === "cobro"
        ? { emoji: "💰", label: "Cobrar", pedir: pedirCobrarPremium }
        : etapa === "traspaso"
        ? { emoji: "🔁", label: "Traspasar", pedir: pedirTraspasarPremium }
        : { emoji: "🏦", label: "Liquidar", pedir: pedirLiquidarPremium };
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input
          type="date"
          className="inp-fecha"
          value={fechaDe(p.periodo, etapa)}
          onChange={(e) => setFecha(p.periodo, etapa, e.target.value)}
        />
        <button className="btn-primary btn-sm" onClick={() => cfg.pedir(p.periodo)}>
          {cfg.emoji} {cfg.label}
        </button>
      </span>
    );
  }

  // Paso 1: NO crea el recibo; calcula el borrador (preview) y abre el formulario de emisión.
  async function generarRecibo(periodo: string) {
    setGenerando(periodo);
    setError(null);
    try {
      setBorrador(await recibosApi.preview(binder.id, periodo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando(null);
    }
  }

  // Paso 2: emite (crea) el recibo con los campos del formulario.
  async function emitirRecibo(payload: ReciboUpdate) {
    if (!borrador) return;
    setEmitiendo(true);
    setError(null);
    try {
      await recibosApi.generar(binder.id, borrador.periodo, payload);
      setBorrador(null);
      await cargar(); // refresca recibos y líneas (ya con su nº de recibo)
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEmitiendo(false);
    }
  }

  // Una línea está bloqueada si su periodo Risk (reporting start) o, si entra en Premium,
  // su mes de premium_bdx están bloqueados en la pestaña Bloqueo.
  function lineaBloqueada(l: BdxLinea): boolean {
    const rs = String(l.reporting_period_start ?? "").slice(0, 7);
    if (rs && bloqueos.has(`risk:${rs}`)) return true;
    const pm = String(l.premium_bdx ?? "").slice(0, 7);
    if (l.incluido_en_premium && pm && bloqueos.has(`premium:${pm}`)) return true;
    return false;
  }

  return (
    <div className="container detalle-binder">
      <div className="detalle-top">
        <button className="btn-link" onClick={onBack}>
          ← Volver a Binders
        </button>
        <h1 className="page-title" style={{ margin: "8px 0 4px" }}>
          <span className="page-title-emoji">📑</span>
          {binder.umr ?? binder.agreement_number ?? `Binder ${binder.id}`}
        </h1>
        <div className="detalle-sub">
          {binder.coverholder_nombre ?? "—"} · {fmtFecha(binder.fecha_efecto)} → {fmtFecha(binder.fecha_vencimiento)} ·{" "}
          <span className={"estado-badge " + estadoBadgeClase(binder.estado)}>{binder.estado ?? "—"}</span>
        </div>
      </div>

      <div className="tabs detalle-tabs">
        <button className={"tab" + (tab === "bdx" ? " active" : "")} onClick={() => setTab("bdx")}>
          BDX
        </button>
        <button className={"tab" + (tab === "bloqueo" ? " active" : "")} onClick={() => setTab("bloqueo")}>
          Bloqueo
        </button>
        <button className={"tab" + (tab === "datos" ? " active" : "")} onClick={() => setTab("datos")}>
          Risk
        </button>
        <button className={"tab" + (tab === "premium" ? " active" : "")} onClick={() => setTab("premium")}>
          Premium
        </button>
        <button className={"tab" + (tab === "lpan" ? " active" : "")} onClick={() => setTab("lpan")}>
          LPAN
        </button>
        <button className={"tab" + (tab === "calculos" ? " active" : "")} onClick={() => setTab("calculos")}>
          PC
        </button>
        <button className={"tab" + (tab === "recibos" ? " active" : "")} onClick={() => setTab("recibos")}>
          Recibos
        </button>
        <button className={"tab" + (tab === "siniestros" ? " active" : "")} onClick={() => setTab("siniestros")}>
          Siniestros
        </button>
        <button className={"tab" + (tab === "claimsbdx" ? " active" : "")} onClick={() => setTab("claimsbdx")}>
          Claims BDX
        </button>
        {!esContingencias && (
          <button className={"tab" + (tab === "triangulacion" ? " active" : "")} onClick={() => setTab("triangulacion")}>
            Triangulación
          </button>
        )}
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {tab === "datos" && (
        <>
          <h3 style={{ margin: "4px 0 8px" }}>Cifras por mes (Reporting Start)</h3>
          {loading ? (
            <div className="loading">Cargando…</div>
          ) : porMes.length === 0 ? (
            <div className="empty">Aún no hay BDX importado. Ve a la pestaña BDX para importarlo.</div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto risk-mes" style={{ maxWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={selMeses.size > 0 && selMeses.size === porMes.length}
                      onChange={(e) =>
                        setSelMeses(e.target.checked ? new Set(porMes.map(([m]) => m)) : new Set())
                      }
                    />
                  </th>
                  <th>Mes Risk</th>
                  <th className="num">GWP</th>
                  <th className="num">Net Premium to Broker</th>
                  <th className="num">Comisión</th>
                  <th>Recibo</th>
                </tr>
              </thead>
              <tbody>
                {porMes.map(([mes, v]) => {
                  const recibo = reciboDe.get(mes);
                  return (
                    <tr key={mes}>
                      <td className="celda-centro">
                        <input
                          type="checkbox"
                          checked={selMeses.has(mes)}
                          onChange={() =>
                            setSelMeses((s) => {
                              const ns = new Set(s);
                              if (ns.has(mes)) ns.delete(mes);
                              else ns.add(mes);
                              return ns;
                            })
                          }
                        />
                      </td>
                      <td>{mesLargo(mes)}</td>
                      <td className="num">{imp(v.gwp)}</td>
                      <td className="num">{imp(v.net)}</td>
                      <td className="num">{imp(v.brk)}</td>
                      <td>
                        {recibo ? (
                          <span title={`Comisión ${imp(n(recibo.comision_retenida))} · ${recibo.estado}`}>🧾 {recibo.numero}</span>
                        ) : (
                          <button
                            className="btn-link"
                            disabled={generando === mes || v.brk === 0}
                            title={v.brk === 0 ? "Sin comisión (brokerage) en este periodo" : "Preparar el recibo de comisión de este Risk BDX"}
                            onClick={() => generarRecibo(mes)}
                          >
                            {generando === mes ? "Abriendo…" : "＋ Generar recibo"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td></td>
                  <td>Total</td>
                  <td className="num">{imp(totGwp)}</td>
                  <td className="num">{imp(totNet)}</td>
                  <td className="num">{imp(porMes.reduce((a, [, v]) => a + v.brk, 0))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      {tab === "bloqueo" && (
        (() => {
          const ls = sel?.lineas ?? [];
          const cols: { titulo: string; tipo: string; emoji: string; meses: string[] }[] = [
            { titulo: "Risk BDX", tipo: "risk", emoji: "📊", meses: mesesDe(ls, "reporting_period_start") },
            { titulo: "Premium BDX", tipo: "premium", emoji: "💷", meses: mesesDe(ls, "premium_bdx", (l) => !!l.incluido_en_premium) },
            // Claims: solo los periodos YA presentados (los que existen en nuestro Claims BDX).
            { titulo: "Claims BDX", tipo: "claims", emoji: "⚖️", meses: cbPeriodos.map((p) => p.periodo) },
          ];
          // Persistente: el bloqueo se guarda en el backend (impide editar líneas del periodo).
          const toggle = async (tipo: string, m: string) => {
            const key = `${tipo}:${m}`;
            try {
              if (bloqueos.has(key)) {
                await bdxApi.desbloquear(binder.id, tipo, m);
                setBloqueos((s) => { const ns = new Set(s); ns.delete(key); return ns; });
              } else if (tipo === "claims") {
                // En Claims, bloquear = PRESENTAR el bordereau de ese mes (congela snapshot + bloquea).
                if (!window.confirm(`¿Presentar el Claims BDX de ${mesLargo(m)}? Se congelará el snapshot y se bloqueará el mes.`)) return;
                await claimsBdxApi.presentar(binder.id, m, localStorage.getItem("mayrit.usuario") ?? undefined);
                setBloqueos((s) => new Set(s).add(key));
                setCbVista(null); // fuerza recarga de la pestaña Claims BDX
              } else {
                await bdxApi.bloquear(binder.id, tipo, m);
                setBloqueos((s) => new Set(s).add(key));
              }
            } catch (e) {
              alert((e as Error).message);
            }
          };
          // Congelado por cierre del binder: Risk/Premium si producción cerrada; Claims si Cerrado total.
          const congelada = (tipo: string) =>
            tipo === "claims" ? cerradoTotal : produccionCerrada;
          return (
            <div className="bloqueo-cols">
              {cols.map((c) => {
                const frozen = congelada(c.tipo);
                return (
                <div className="bloqueo-col" key={c.titulo}>
                  <h3>
                    <span className="page-title-emoji" style={{ fontSize: 20 }}>{c.emoji}</span> {c.titulo}
                    {frozen && <span className="hint" style={{ marginLeft: 8 }}>🔒 cerrado</span>}
                  </h3>
                  {c.meses.length === 0 ? (
                    <div className="hint">— sin periodos —</div>
                  ) : (
                    c.meses.map((m) => {
                      const key = `${c.tipo}:${m}`;
                      const bloq = bloqueos.has(key);
                      return (
                        <div
                          className={"bloqueo-fila" + (bloq ? " bloqueada" : "")}
                          key={m}
                          onClick={frozen ? undefined : () => toggle(c.tipo, m)}
                          style={{ cursor: frozen ? "default" : "pointer", opacity: frozen ? 0.85 : 1 }}
                          title={frozen ? "Binder cerrado: los bloqueos no se pueden modificar" : bloq ? "Bloqueado (clic para desbloquear)" : "Clic para bloquear este periodo"}
                        >
                          <input type="checkbox" checked={bloq} readOnly tabIndex={-1} />
                          <button type="button" className="lock-btn" tabIndex={-1} disabled={frozen}>
                            {bloq ? "🔒" : "🔓"}
                          </button>
                          <span>{mesLargo(m)}</span>
                          <span
                            className="ayuda"
                            onClick={(e) => e.stopPropagation()}
                            title="Bloquear este periodo impide presentarlo / modificarlo."
                          >
                            ?
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                );
              })}
            </div>
          );
        })()
      )}

      {tab === "bdx" && (
        <>
          {excelSel && (
            <div className="hint" style={{ marginBottom: 10 }}>
              Seleccionado «{excelSel}». La carga del Excel estará disponible en el próximo paso.
            </div>
          )}

          {loading ? (
            <div className="loading">Cargando…</div>
          ) : !sel || sel.lineas.length === 0 ? (
            <>
              {produccionCerrada ? (
                <div className="hint" style={{ marginBottom: 10 }}>🔒 Producción cerrada: no se pueden subir más Risk ni Premium.</div>
              ) : (
                <div className="toolbar">
                  <button className="btn-primary" onClick={() => elegirExcel("risk")}>
                    ⬆ Subir Risk
                  </button>
                  <button className="btn-secondary" onClick={() => elegirExcel("premium")}>
                    ⬆ Subir Premium
                  </button>
                  {!importado && (
                    <button className="btn-secondary" onClick={abrirImport}>
                      ⤓ Importar de SharePoint
                    </button>
                  )}
                </div>
              )}
              <div className="empty">
                {!sel
                  ? "Este binder no tiene BDX todavía. Impórtalo de SharePoint o sube el Excel."
                  : "El BDX no tiene líneas."}
              </div>
            </>
          ) : (
            <BdxTabla
              lineas={lineasVista}
              onRowClick={(l) => setLinea(l)}
              bloqueada={lineaBloqueada}
              hayFiltroExterno={selMeses.size > 0}
              onQuitarFiltros={() => setSelMeses(new Set())}
              acciones={
                <>
                  {produccionCerrada ? (
                    <span className="hint">🔒 Producción cerrada</span>
                  ) : (
                    <>
                      <button className="btn-primary btn-sm" onClick={() => elegirExcel("risk")}>
                        ⬆ Subir Risk
                      </button>
                      <button className="btn-secondary btn-sm" onClick={() => elegirExcel("premium")}>
                        ⬆ Subir Premium
                      </button>
                    </>
                  )}
                  {selMeses.size > 0 && (
                    <span className="hint">
                      Filtrado por Datos:{" "}
                      {[...selMeses].sort().map((m) => { const [y, mo] = m.split("-"); return `${mo}/${y}`; }).join(", ")}
                    </span>
                  )}
                </>
              }
            />
          )}
        </>
      )}

      {tab === "premium" && (
        <>
          <h3 style={{ margin: "4px 0 8px" }}>Premium BDX (cobro)</h3>
          {premiums.length === 0 ? (
            <div className="empty">
              Aún no hay líneas incluidas en ningún Premium. En la pestaña <b>BDX</b> pulsa
              <b> «Subir Premium»</b> para machear un Premium con el Risk.
            </div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto premium-cobro" style={{ maxWidth: 1120 }}>
              <thead>
                <tr>
                  <th>Mes Premium</th>
                  <th className="num">Líneas</th>
                  <th className="num">Prima</th>
                  <th className="num">Comisión</th>
                  <th className="num">A liquidar</th>
                  <th>💰 Cobro</th>
                  <th>🔁 Traspaso</th>
                  <th>🏦 Liquidación</th>
                </tr>
              </thead>
              <tbody>
                {premiums.map((p) => {
                  const bloq = bloqueos.has(`premium:${p.periodo}`);
                  return (
                    <tr key={p.periodo}>
                      <td>{mesLargo(p.periodo)}</td>
                      <td className="num">{p.num_lineas}</td>
                      <td className="num">{imp(n(p.prima))}</td>
                      <td className="num">{imp(n(p.comision))}</td>
                      <td className="num">{imp(n(p.a_liquidar))}</td>
                      <td>{celdaEtapa(p, "cobro", bloq)}</td>
                      <td>{celdaEtapa(p, "traspaso", bloq)}</td>
                      <td>{celdaEtapa(p, "liquidacion", bloq)}</td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td>Total Premium</td>
                  <td className="num">{premLineas}</td>
                  <td className="num">{imp(premPrima)}</td>
                  <td className="num">{imp(premComision)}</td>
                  <td colSpan={4}></td>
                </tr>
                <tr className="hint">
                  <td>Total Risk</td>
                  <td className="num">{riskLineas}</td>
                  <td className="num">{imp(riskPrima)}</td>
                  <td className="num">{imp(riskComision)}</td>
                  <td colSpan={4}>
                    {premLineas === riskLineas
                      ? "✓ todo el Risk macheado"
                      : `faltan ${riskLineas - premLineas} línea(s) por machear`}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            💰 Cobrar (la agencia nos paga) · 🔁 Traspasar (nuestra comisión, de primas a gastos) ·
            🏦 Liquidar (pagar a la compañía/Lloyd's). Cada acción pide fecha y actualiza los recibos.
          </div>
        </>
      )}

      {tab === "calculos" && (
        (() => {
          if (!binder.profit_commission)
            return <div className="empty">Este binder no tiene Profit Commission.</div>;
          // Secciones (1-based) sujetas a PC y primas (GWP) de sus líneas en el BDX.
          const seccionesPC = new Set(
            binder.secciones.map((s, i) => (s.sujeto_pc ? i + 1 : 0)).filter((x) => x > 0)
          );
          const nombresPC = binder.secciones
            .map((s, i) => (s.sujeto_pc ? `Sección ${i + 1}${s.ramo ? ` (${s.ramo})` : ""}` : null))
            .filter(Boolean)
            .join(", ");
          const lineas = (sel?.lineas ?? []).filter((l) => seccionesPC.has(l.section_no ?? 0));
          // GWP = our line (es lo que usa el cálculo de PC), no el GWP al 100%.
          const gwp = lineas.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
          // Comisiones = importes REALES de los BDX (media ponderada; pueden variar por operación).
          const comCoverAmt = lineas.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
          const comCoverPct = gwp > 0 ? (comCoverAmt / gwp) * 100 : 0;
          const comMayritAmt = lineas.reduce((a, l) => a + n(l.brokerage_amount), 0);
          const comMayritPct = gwp > 0 ? (comMayritAmt / gwp) * 100 : 0;
          const comTotal = comCoverAmt + comMayritAmt;
          const netToUws = gwp - comTotal;
          // Siniestralidad REAL desde los Claims importados (secciones sujetas a PC).
          const sinPC = siniestros.filter((s) => seccionesPC.has(s.section ?? 0));
          const indemPaidR = sinPC.reduce((a, s) => a + n(s.paid_indemnity), 0);
          const indemResR = sinPC.reduce((a, s) => a + n(s.reserves_indemnity), 0);
          const feesPaidR = sinPC.reduce((a, s) => a + n(s.paid_fees), 0);
          const feesResR = sinPC.reduce((a, s) => a + n(s.reserves_fees), 0);
          const claims = indemPaidR + indemResR + feesPaidR + feesResR;
          // IBNR: % manual sobre la GWP (our line).
          const ibnr = (gwp * n(ibnrPct)) / 100;
          const uwPct = n(binder.pc_gastos);
          const uwAmt = (gwp * uwPct) / 100;
          const totalOutcome = comTotal + claims + ibnr + uwAmt;
          const lossRatio = netToUws > 0 ? (claims / netToUws) * 100 : 0;
          const resultado = gwp - totalOutcome;
          const pcPct = n(binder.pc_porcentaje);
          const pc = (resultado * pcPct) / 100;
          const Money = ({ v }: { v: number }) => <td className="num">{imp(v)}</td>;
          return (
            <>
              <h3 style={{ margin: "4px 0 8px" }}>Profit Commission</h3>
              <div className="hint" style={{ marginBottom: 10 }}>
                PC {fmtMiles(pcPct)} % · UW Expenses {fmtMiles(uwPct)} % · Sujetas a PC: {nombresPC || "—"}.
                La siniestralidad proviene de los Claims importados de este binder (secciones sujetas a PC).
              </div>
              <table className="compacto pc-tabla" style={{ maxWidth: 560 }}>
                <tbody>
                  <tr className="pc-fuerte"><td>GWP (our line)</td><Money v={gwp} /></tr>

                  <tr className="pc-seccion"><td colSpan={2}>Comisiones</td></tr>
                  <tr><td>Coverholder ({fmtMiles(comCoverPct)} %)</td><Money v={comCoverAmt} /></tr>
                  <tr><td>Mayrit ({fmtMiles(comMayritPct)} %)</td><Money v={comMayritAmt} /></tr>
                  <tr className="pc-subtotal"><td>Total comisiones</td><Money v={comTotal} /></tr>
                  <tr className="pc-fuerte"><td>Net to UWs</td><Money v={netToUws} /></tr>

                  <tr className="pc-seccion"><td colSpan={2}>Siniestralidad</td></tr>
                  <tr><td>Indemnización — Pagado</td><Money v={indemPaidR} /></tr>
                  <tr><td>Indemnización — Reservas</td><Money v={indemResR} /></tr>
                  <tr><td>Fees — Pagado</td><Money v={feesPaidR} /></tr>
                  <tr><td>Fees — Reservas</td><Money v={feesResR} /></tr>
                  <tr className="pc-subtotal"><td>Total siniestralidad</td><Money v={claims} /></tr>
                  <tr>
                    <td>IBNR (<span style={{ display: "inline-block", width: 70 }}><NumberInput value={ibnrPct} onChange={setIbnrPct} suffix="%" thousands={false} className="input-completar" /></span> s/ GWP)</td>
                    <Money v={ibnr} />
                  </tr>

                  <tr><td>UW Expenses ({fmtMiles(uwPct)} % s/ GWP)</td><Money v={uwAmt} /></tr>
                  <tr className="pc-subtotal"><td>Total Outcome</td><Money v={totalOutcome} /></tr>
                  <tr><td className="hint">Siniestralidad / Net to UWs</td><td className="num hint">{fmtMiles(lossRatio)} %</td></tr>

                  <tr className="pc-fuerte" style={{ borderTop: "2px solid var(--borde)" }}><td>Resultado (GWP − Outcome)</td><Money v={resultado} /></tr>
                  <tr className="pc-fuerte"><td>Profit Commission ({fmtMiles(pcPct)} %)</td><td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(pc)}</td></tr>
                </tbody>
              </table>
              {pc <= 0 && (
                <div className="hint" style={{ marginTop: 8 }}>Resultado ≤ 0 → no se genera Profit Commission (importe negativo informativo).</div>
              )}
            </>
          );
        })()
      )}

      {tab === "recibos" && (
        <>
          <h3 style={{ margin: "4px 0 4px" }}>Recibos de este binder ({binder.umr ?? binder.agreement_number ?? binder.id})</h3>
          <div className="hint" style={{ marginBottom: 8 }}>
            Vista filtrada por este binder. La gestión completa está en el módulo <b>Facturación → Recibos</b>.
          </div>
          {recibos.length === 0 ? (
            <div className="empty">
              Aún no hay recibos. Genera uno desde la pestaña <b>Datos</b> («＋ Generar recibo» de un Risk BDX).
            </div>
          ) : (
            <div className="bdx-scroll">
            <table className="compacto recibos-binder" style={{ maxWidth: 960 }}>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Risk BDX</th>
                  <th>Contraparte</th>
                  <th className="num">Comisión</th>
                  <th className="num">Cobrado</th>
                  <th className="num">Pendiente</th>
                  <th>Cobro</th>
                  <th>Emisión</th>
                </tr>
              </thead>
              <tbody>
                {recibos.map((r) => {
                  const ec = estadoCobro(r.comision_retenida, r.comision_retenida_cobrada, r.estado);
                  return (
                  <tr key={r.id}>
                    <td><b>🧾 {r.numero}</b></td>
                    <td>{mesLargo(r.periodo)}</td>
                    <td>{r.nombre_mercado ?? "—"}</td>
                    <td className="num">{imp(n(r.comision_retenida))}</td>
                    <td className="num">{imp(n(r.comision_retenida_cobrada))}</td>
                    <td className="num">{imp(n(r.comision_pendiente_cobro))}</td>
                    <td><span className={`pill pill-${ec.clase}`}>{ec.label}</span></td>
                    <td>{fmtFechaES(r.fecha_contable)}</td>
                  </tr>
                  );
                })}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td colSpan={3}>Total ({recibos.length})</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_retenida), 0))}</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_retenida_cobrada), 0))}</td>
                  <td className="num">{imp(recibos.reduce((a, r) => a + n(r.comision_pendiente_cobro), 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      {tab === "siniestros" && (
        <>
          {!sinCargado ? (
            <div className="loading">Cargando…</div>
          ) : siniestros.length === 0 ? (
            <div className="empty">
              {cerradoTotal
                ? "🔒 Binder cerrado sin siniestros: no tuvo ningún claim durante su vigencia."
                : "Sin siniestros migrados todavía."}
            </div>
          ) : (
            (() => {
              const nSin = siniestros.length;
              const abiertos = siniestros.filter((s) => !s.date_closed).length;
              const reclamado = siniestros.reduce((a, s) => a + n(s.amount_claimed), 0);
              const reservaFees = siniestros.reduce((a, s) => a + n(s.reserves_fees), 0);
              const pagosFees = siniestros.reduce((a, s) => a + n(s.paid_fees), 0);
              const totalFees = siniestros.reduce((a, s) => a + n(s.total_fees), 0);
              const reservaIndem = siniestros.reduce((a, s) => a + n(s.reserves_indemnity), 0);
              const pagosIndem = siniestros.reduce((a, s) => a + n(s.paid_indemnity), 0);
              const totalIndem = siniestros.reduce((a, s) => a + n(s.total_indemnity), 0);
              const total = totalFees + totalIndem; // total incurrido (siniestralidad total)
              const pct = (x: number) => (total > 0 ? `${fmtMiles((x / total) * 100)} %` : "—");
              // Ratio de siniestralidad = siniestralidad / (GWP our line − com. coverholder − brokerage).
              const lin = sel?.lineas ?? [];
              const gwpOL = lin.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
              const comCover = lin.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
              const brokerage = lin.reduce((a, l) => a + n(l.brokerage_amount), 0);
              const netUW = gwpOL - comCover - brokerage;
              const ratioStr = netUW > 0 ? `${fmtMiles((total / netUW) * 100)} %` : "—";
              return (
                <>
                  <div className="bdx-topbar">
                    <div />
                    <div className="bdx-totales">
                      <div className="tot-col">
                        <div className="tot-row"><span>Nº Siniestros</span><b>{fmtMiles(nSin, 0)}</b></div>
                        <div className="tot-row"><span>Abiertos</span><b>{fmtMiles(abiertos, 0)}</b></div>
                        <div className="tot-row"><span>Cerrados</span><b>{fmtMiles(nSin - abiertos, 0)}</b></div>
                        <div className="tot-row"><span>Cantidad Reclamada</span><b>{fmtMiles(reclamado)}</b></div>
                      </div>
                      <div className="tot-col">
                        <div className="tot-row"><span>% Fees</span><b>{pct(totalFees)}</b></div>
                        <div className="tot-row"><span>Reserva Fees</span><b>{fmtMiles(reservaFees)}</b></div>
                        <div className="tot-row"><span>Pagos Fees</span><b>{fmtMiles(pagosFees)}</b></div>
                        <div className="tot-row tot-pdte"><span>Total Fees</span><b>{fmtMiles(totalFees)}</b></div>
                      </div>
                      <div className="tot-col">
                        <div className="tot-row"><span>% Indem.</span><b>{pct(totalIndem)}</b></div>
                        <div className="tot-row"><span>Reserva Indem.</span><b>{fmtMiles(reservaIndem)}</b></div>
                        <div className="tot-row"><span>Pagos Indem.</span><b>{fmtMiles(pagosIndem)}</b></div>
                        <div className="tot-row tot-pdte"><span>Total Indem.</span><b>{fmtMiles(totalIndem)}</b></div>
                      </div>
                      <div className="tot-col">
                        <div className="tot-row" style={{ visibility: "hidden" }}><span>·</span><b>·</b></div>
                        <div className="tot-row"><span>Reserva Total</span><b>{fmtMiles(reservaFees + reservaIndem)}</b></div>
                        <div className="tot-row"><span>Pagos Total</span><b>{fmtMiles(pagosFees + pagosIndem)}</b></div>
                        <div className="tot-row tot-pdte"><span>Total</span><b>{fmtMiles(total)}</b></div>
                      </div>
                      <div className="tot-col">
                        <div className="tot-row"><span title="GWP our line − comisión coverholder − brokerage">Prima Neta</span><b>{fmtMiles(netUW)}</b></div>
                        <div className="tot-ratios">
                          <div className="tot-row tot-ratio"><span title="Nº siniestros / Nº pólizas">Ratio Frecuencia</span><b>{nPolizas > 0 ? `${fmtMiles((nSin / nPolizas) * 100)} %` : "—"}</b></div>
                          <div className="tot-row tot-ratio"><span title="Siniestralidad / (GWP our line − com. coverholder − brokerage)">Ratio Siniestralidad</span><b>{ratioStr}</b></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <TablaDatos
                    filas={siniestros}
                    columnas={SIN_COLS}
                    defaultKeys={SIN_DEFAULT}
                    storageKey="mayrit.siniestros.tabla.v2"
                  />
                </>
              );
            })()
          )}
        </>
      )}

      {tab === "claimsbdx" && (
        !cbVista ? (
          <div className="loading">Cargando…</div>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <button
                className="btn-primary btn-sm"
                title={cerradoTotal ? "Binder Cerrado: no se pueden cargar más claims." : "Elige un mes no presentado: congela el snapshot, bloquea el mes y descarga el bordereau (Excel)."}
                disabled={cbBusy || cerradoTotal || cbVista.meses_pendientes.length === 0}
                onClick={() => {
                  const ult = cbVista.meses[0] ?? "";
                  const sig = cbVista.meses_pendientes.find((m) => m > ult) ?? cbVista.meses_pendientes[0];
                  setCbPresentarMes(sig);
                }}
              >
                📤 Presentar mes…
              </button>
              {cerradoTotal && <span className="hint">🔒 Binder Cerrado: solo consulta.</span>}
              {cbMsg && <span className="hint">{cbMsg}</span>}
            </div>
            <div className="claims-box">
              <h3 style={{ margin: "2px 0 10px" }}>📚 Presentaciones realizadas</h3>
              {cbPeriodos.length === 0 ? (
                <div className="empty">Aún no hay presentaciones. Pulsa «Presentar mes…».</div>
              ) : (
                <div className="bdx-scroll">
                <table className="compacto claims-pres" style={{ maxWidth: 520 }}>
                  <thead>
                    <tr><th>Periodo</th><th className="num">Siniestros</th><th>Presentado el</th><th></th></tr>
                  </thead>
                  <tbody>
                    {cbPeriodos.map((p) => (
                      <tr key={p.periodo}>
                        <td>{p.periodo}</td>
                        <td className="num">{p.n}</td>
                        <td>{fmtFecha(p.fecha)}</td>
                        <td className="acciones">
                          <button className="btn-link" title="Descargar el bordereau presentado (snapshot)" onClick={() => descargarSnapshot(p.periodo)}>
                            ⬇️ Descargar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {tab === "lpan" && (
        <div className="empty">LPAN — pendiente de definir el contenido.</div>
      )}

      {tab === "triangulacion" && (
        triBusy && !tri ? (
          <div className="empty">Cargando triangulación…</div>
        ) : !tri ? (
          <div className="empty">No hay snapshots de Claims para triangular.</div>
        ) : (() => {
          const esPct = triMetrica === "pct";
          const esNum = triMetrica === "num";
          const matriz = tri.triangulos[esPct ? "incurrido" : triMetrica];
          const meses = tri.meses;
          const n = meses.length;
          const ratio = tri.net_uw ? (tri.incurrido_actual / tri.net_uw) * 100 : null;
          const ibnrPct = tri.gwp_our_line ? (tri.ibnr_sugerido / tri.gwp_our_line) * 100 : null;
          // En "%", cada celda = incurrido valuado / Net to UWs (siniestralidad hasta ese mes).
          const celda = (v: number | null) =>
            v == null ? "" : esPct ? (tri.net_uw ? `${fmtMiles((v / tri.net_uw) * 100)} %` : "—") : esNum ? v : fmtMiles(v);
          // Columnas según la vista:
          //  - "cal": meses de valuación, del MÁS RECIENTE (izquierda) al más antiguo (derecha).
          //  - "edad": antigüedad 0,1,2… (meses desde la apertura); celda = valor a origen+d.
          type ColDef = { label: string; get: (i: number) => number | null };
          const colDefs: ColDef[] =
            triVista === "cal"
              ? Array.from({ length: n }, (_, k) => n - 1 - k).map((j) => ({
                  label: meses[j], get: (i: number) => matriz[i][j],
                }))
              : Array.from({ length: n }, (_, d) => ({
                  label: String(d), get: (i: number) => (i + d < n ? matriz[i][i + d] : null),
                }));
          const totalCol = colDefs.map((c) => matriz.reduce((a, _f, i) => a + (c.get(i) ?? 0), 0));
          return (
            <>
              <div className="bdx-topbar" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <select className="filtro" value={triMetrica} onChange={(e) => setTriMetrica(e.target.value as MetricaTriangulo)}>
                  <option value="incurrido">Incurrido (pagado + reservas)</option>
                  <option value="pagado">Pagado</option>
                  <option value="num">Nº de siniestros</option>
                  <option value="pct">% Siniestralidad (s/ Net to UWs)</option>
                </select>
                <select className="filtro" value={triVista} onChange={(e) => setTriVista(e.target.value as "cal" | "edad")}>
                  <option value="cal">Vista: Calendario</option>
                  <option value="edad">Vista: Por antigüedad</option>
                </select>
                <select
                  className="filtro"
                  value={triScope.risk_code ? `rc:${triScope.risk_code}` : triScope.seccion != null ? `sec:${triScope.seccion}` : "total"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTriScope(v === "total" ? {} : v.startsWith("rc:") ? { risk_code: v.slice(3) } : { seccion: Number(v.slice(4)) });
                  }}
                >
                  <option value="total">Ámbito: Total</option>
                  {tri.risk_codes.map((rc) => <option key={`rc:${rc}`} value={`rc:${rc}`}>Código {rc}</option>)}
                  {tri.secciones.map((s) => <option key={`sec:${s}`} value={`sec:${s}`}>Sección {s}</option>)}
                </select>
                <button className="btn-secondary" onClick={exportarTriangulo} title="Exportar a Excel la métrica y el ámbito seleccionados">⤓ Excel</button>
                <span className="hint">
                  GWP Our Line: <b>{imp(tri.gwp_our_line)}</b> · Net to UWs: <b>{imp(tri.net_uw)}</b>
                  {" · "}Incurrido actual: <b>{imp(tri.incurrido_actual)}</b>
                  {" · "}Siniestralidad: <b>{ratio == null ? "—" : `${fmtMiles(ratio)} %`}</b>
                </span>
                <span className="hint" title="Estimación orientativa por chain-ladder. El % es sobre el GWP Our Line.">
                  IBNR sugerido: <b>{imp(tri.ibnr_sugerido)}{ibnrPct == null ? "" : ` (${fmtMiles(ibnrPct)} %)`}</b>
                  {" · "}Ultimate: <b>{imp(tri.ultimate_sugerido)}</b>
                </span>
                <span className="hint">
                  Filas = mes de apertura · columnas = {triVista === "cal" ? "mes de valuación (reciente → antiguo)" : "meses desde la apertura"}.
                </span>
              </div>
              {meses.length === 0 ? (
                <div className="empty">No hay siniestros en este ámbito.</div>
              ) : (
                <div className="tabla-scroll bdx-scroll">
                  <table className="compacto bdx-tabla tri-tabla">
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", left: 0 }}>Mes</th>
                        <th className="num tri-actual" title="Net to UWs del mes (GWP our line − comisiones)">Net to UWs</th>
                        {colDefs.map((c, k) => <th key={k} className="num">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {meses.map((m, i) => (
                        <tr key={m}>
                          <th style={{ position: "sticky", left: 0 }}>{m}</th>
                          <td className="num tri-actual">{fmtMiles(tri.net_premium_mes[i])}</td>
                          {colDefs.map((c, k) => <td key={k} className="num">{celda(c.get(i))}</td>)}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="tri-total">
                        <th style={{ position: "sticky", left: 0 }}>Total</th>
                        <td className="num tri-actual">{fmtMiles(tri.net_uw)}</td>
                        {totalCol.map((t, k) => <td key={k} className="num">{celda(t)}</td>)}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          );
        })()
      )}

      {cbPresentarMes && cbVista && (
        <FormPanel
          title="Presentar Claims BDX"
          dirty={false}
          saving={cbBusy}
          saveLabel="Presentar y descargar"
          onSave={() => presentarClaimsBdx(cbPresentarMes)}
          onClose={() => setCbPresentarMes(null)}
        >
          <p className="hint" style={{ marginBottom: 12 }}>
            Elige el mes a presentar (solo aparecen los meses <b>no presentados</b>). Se congelará el snapshot, se bloqueará el mes y se descargará el Excel del bordereau.
          </p>
          <div className="field">
            <label>Mes a presentar</label>
            <select value={cbPresentarMes} onChange={(e) => setCbPresentarMes(e.target.value)}>
              {cbVista.meses_pendientes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </FormPanel>
      )}

      {/* Ficha de línea */}
      {sel && linea && (
        <BdxLineaPanel
          bdxId={sel.id}
          linea={linea === "nueva" ? null : linea}
          readOnly={linea !== "nueva" && lineaBloqueada(linea)}
          onSaved={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onDeleted={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onClose={() => setLinea(null)}
        />
      )}

      {/* Emisión de recibo: modal precalculado (estilo Access); se crea al pulsar "Emitir recibo". */}
      {borrador && (
        <ReciboModal
          titulo={`Emitir recibo · Risk BDX ${mesLargo(borrador.periodo)}`}
          saveLabel="Emitir recibo"
          recibo={borrador}
          numeroProvisional
          soloLectura
          saving={emitiendo}
          error={error}
          onSave={emitirRecibo}
          onClose={() => setBorrador(null)}
        />
      )}

      {/* Confirmación contundente para acciones sensibles */}
      {confirmar && (
        <ConfirmDialog
          titulo={confirmar.titulo}
          mensaje={confirmar.mensaje}
          detalle={confirmar.detalle}
          confirmLabel={confirmar.confirmLabel}
          doble={confirmar.doble}
          onConfirm={confirmar.accion}
          onClose={() => setConfirmar(null)}
        />
      )}

      {/* Macheo de un Premium (Excel) con el Risk */}
      {matchExcel && (
        <PremiumMatch
          binderId={binder.id}
          ruta={matchExcel.ruta}
          nombre={matchExcel.nombre}
          onClose={() => setMatchExcel(null)}
          onApplied={async (periodo) => {
            setMatchExcel(null);
            await cargar();
            pedirBloquearPremium(periodo);
          }}
        />
      )}

      {/* Selector de Excel (carpeta servida por el backend) */}
      {excelOpen && (
        <div className="overlay">
          <div className="panel" role="dialog" aria-modal="true" aria-label="Seleccionar Excel">
            <div className="panel-head">
              <h2>{excelModo === "premium" ? "Subir Premium" : "Subir Risk"}</h2>
              <button className="panel-close" onClick={() => setExcelOpen(false)} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="panel-body">
              {excelErr && <div className="error">⚠ {excelErr}</div>}
              <div className="hint" style={{ marginBottom: 8 }}>
                📁 {excelDir ? (excelDir.sub ? excelDir.sub : "(carpeta base)") : "…"}
              </div>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                <button className="btn-secondary btn-sm" onClick={subirCarpeta} disabled={!excelDir?.sub}>
                  ↑ Subir
                </button>
              </div>
              {excelBusy ? (
                <div className="loading">Leyendo carpeta…</div>
              ) : excelDir ? (
                <table className="compacto">
                  <tbody>
                    {excelDir.dirs.map((d) => (
                      <tr
                        key={"d:" + d}
                        className="fila-click"
                        onClick={() => cargarCarpeta(excelDir.sub ? `${excelDir.sub}/${d}` : d)}
                      >
                        <td>📁 {d}</td>
                      </tr>
                    ))}
                    {excelDir.files.map((f) => (
                      <tr
                        key={"f:" + f.name}
                        className="fila-click"
                        onClick={() => {
                          const ruta = excelDir.sub ? `${excelDir.sub}/${f.name}` : f.name;
                          setExcelOpen(false);
                          if (excelModo === "premium") {
                            setMatchExcel({ ruta, nombre: f.name });
                          } else {
                            setExcelSel(f.name); // Risk: carga pendiente (parser del Risk Excel)
                          }
                        }}
                      >
                        <td>📄 {f.name}</td>
                      </tr>
                    ))}
                    {excelDir.dirs.length === 0 && excelDir.files.length === 0 && (
                      <tr>
                        <td className="hint">(carpeta vacía de Excel)</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={() => setExcelOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Importar BDX desde SharePoint: preview → importar → conciliación */}
      {importAbierto && (
        <div className="overlay">
          <div className="panel" role="dialog" aria-modal="true" aria-label="Importar BDX de SharePoint">
            <div className="panel-head">
              <h2>Importar BDX de SharePoint</h2>
              <button className="panel-close" onClick={cerrarImport} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="panel-body">
              {importError && <div className="error">⚠ {importError}</div>}
              {importBusy && !preview && <div className="loading">Leyendo SharePoint…</div>}

              {preview && !importRes && (
                <>
                  <div className="hint" style={{ marginBottom: 12 }}>
                    Lista de origen: <strong>{preview.list_title}</strong>
                  </div>
                  <div className="datos-grid">
                    <Dato label="Líneas en SharePoint" valor={preview.total_lineas} />
                    <Dato label="Periodos" valor={preview.periodos.length} />
                    <Dato label="Suma GWP" valor={imp(preview.suma_gwp)} />
                    <Dato label="Incluidas en Premium" valor={preview.incluidas_en_premium} />
                  </div>
                  <div className="hint" style={{ margin: "10px 0" }}>Periodos: {preview.periodos.join(" · ") || "—"}</div>
                  <div className="hint" style={{ marginTop: 8 }}>
                    Al importar se vuelca al BDX único del binder. Es <strong>idempotente</strong>: si ya
                    estaban, se actualizan (no se duplican).
                  </div>
                </>
              )}

              {importRes && (
                <>
                  <div className="hint" style={{ marginBottom: 12 }}>
                    Importación de <strong>{importRes.list_title}</strong> completada.
                  </div>
                  <div className="datos-grid">
                    <Dato label="Insertadas" valor={importRes.insertadas} />
                    <Dato label="Actualizadas" valor={importRes.actualizadas} />
                    <Dato label="Sin _OldID" valor={importRes.sin_old_id} />
                    <Dato label="Periodos" valor={importRes.periodos.length} />
                  </div>
                  <h3 style={{ marginTop: 16, marginBottom: 8 }}>Conciliación SharePoint ↔ base</h3>
                  <div className="datos-grid">
                    <Dato
                      label="Líneas (SP / base)"
                      valor={`${importRes.conciliacion.lineas_sharepoint} / ${importRes.conciliacion.lineas_postgres}`}
                    />
                    <Dato
                      label="GWP (SP / base)"
                      valor={`${imp(importRes.conciliacion.gwp_sharepoint)} / ${imp(importRes.conciliacion.gwp_postgres)}`}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      color: importRes.conciliacion.lineas_ok && importRes.conciliacion.gwp_ok ? "#15803d" : "var(--rojo)",
                      fontWeight: 600,
                    }}
                  >
                    {importRes.conciliacion.lineas_ok && importRes.conciliacion.gwp_ok
                      ? "✓ Todo cuadra (líneas y GWP)."
                      : "✗ Hay descuadre — revísalo antes de continuar."}
                  </div>
                </>
              )}
            </div>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={cerrarImport}>
                Cerrar
              </button>
              {preview && !importRes && (
                <button className="btn-primary" onClick={hacerImport} disabled={importBusy}>
                  {importBusy ? "Importando…" : `Importar ${preview.total_lineas} líneas`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | number | null | undefined }) {
  return (
    <div className="dato">
      <span className="dato-label">{label}</span>
      <span className="dato-valor">{valor == null || valor === "" ? "—" : String(valor)}</span>
    </div>
  );
}
