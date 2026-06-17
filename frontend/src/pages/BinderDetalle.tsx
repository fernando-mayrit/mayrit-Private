import { useEffect, useState } from "react";
import { bdxApi, recibosApi, type BdxDetalle, type BdxPreview, type BdxImportResult, type ExcelDir, type PremiumGrupo } from "../api";
import type { Binder, Bdx, BdxLinea, Recibo } from "../types";
import BdxLineaPanel from "../components/BdxLineaPanel";
import BdxTabla from "../components/BdxTabla";
import NumberInput from "../components/NumberInput";
import ReciboModal from "../components/ReciboModal";
import PremiumMatch from "../components/PremiumMatch";
import type { ReciboPreview, ReciboUpdate } from "../types";
import { fmtMiles, fmtFechaES, estadoCobro } from "../format";

function n(v: unknown): number {
  const x = Number(String(v ?? "").replace(",", "."));
  return isNaN(x) ? 0 : x;
}

const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
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

export default function BinderDetalle({ binder, onBack }: { binder: Binder; onBack: () => void }) {
  const [tab, setTab] = useState<"datos" | "bloqueo" | "bdx" | "premium" | "calculos" | "recibos" | "siniestros" | "triangulacion">("bdx");

  // ── BDX (uno por binder) ──
  const [bdxs, setBdxs] = useState<Bdx[]>([]);
  const [sel, setSel] = useState<BdxDetalle | null>(null); // el BDX del binder, con líneas
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linea, setLinea] = useState<BdxLinea | "nueva" | null>(null);

  // ── Selector de Excel (carpeta servida por el backend) ──
  const [excelOpen, setExcelOpen] = useState(false);
  const [excelDir, setExcelDir] = useState<ExcelDir | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelErr, setExcelErr] = useState<string | null>(null);
  const [excelSel, setExcelSel] = useState<string | null>(null);
  // Cálculos PC: siniestralidad simulada (aún sin datos reales) — entradas editables.
  const [indemPaid, setIndemPaid] = useState("0");
  const [indemRes, setIndemRes] = useState("0");
  const [feesPaid, setFeesPaid] = useState("0");
  const [feesRes, setFeesRes] = useState("0");
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
      setSel(lista.length > 0 ? await bdxApi.detalle(lista[0].id) : null);
      const bl = await bdxApi.listarBloqueos(binder.id);
      setBloqueos(new Set(bl.map((b) => `${b.tipo}:${b.periodo}`)));
      setRecibos(await recibosApi.deBinder(binder.id));
      setPremiums(await recibosApi.listarPremium(binder.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refrescarSel() {
    if (sel) setSel(await bdxApi.detalle(sel.id));
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
  const porMes = (() => {
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
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const totGwp = porMes.reduce((a, [, v]) => a + v.gwp, 0);
  const totNet = porMes.reduce((a, [, v]) => a + v.net, 0);

  // Recibo ya generado de cada periodo (1 por Risk BDX).
  const reciboDe = new Map(recibos.map((r) => [r.periodo, r]));

  // Totales del Premium (lo macheado) vs totales del Risk (todas las líneas). Cuando todo está
  // macheado, deben coincidir. Prima = our line + impuestos − comisión cedida; Comisión = brokerage.
  const lineasRisk = sel?.lineas ?? [];
  const riskLineas = lineasRisk.length;
  const riskPrima = lineasRisk.reduce((a, l) => a + n(l.total_gwp_our_line) + n(l.total_taxes_levies) - n(l.commission_coverholder_amount), 0);
  const riskComision = lineasRisk.reduce((a, l) => a + n(l.brokerage_amount), 0);
  const premLineas = premiums.reduce((a, p) => a + p.num_lineas, 0);
  const premPrima = premiums.reduce((a, p) => a + n(p.prima), 0);
  const premComision = premiums.reduce((a, p) => a + n(p.comision), 0);

  // Cobro de un Premium entero (marca líneas pagadas con la fecha real → deriva el cobro a los recibos).
  async function cobrarPremium(periodo: string) {
    const fecha = fechasPago[periodo] || new Date().toISOString().slice(0, 10);
    setError(null);
    try {
      await recibosApi.cobrarPremium(binder.id, periodo, fecha);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function descobrarPremium(periodo: string) {
    if (!confirm(`¿Deshacer el cobro del Premium ${periodo}?`)) return;
    setError(null);
    try {
      await recibosApi.descobrarPremium(binder.id, periodo, new Date().toISOString().slice(0, 10));
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
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
          {binder.estado ?? "—"}
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
        <button className={"tab" + (tab === "calculos" ? " active" : "")} onClick={() => setTab("calculos")}>
          Cálculos
        </button>
        <button className={"tab" + (tab === "recibos" ? " active" : "")} onClick={() => setTab("recibos")}>
          Recibos
        </button>
        <button className={"tab" + (tab === "siniestros" ? " active" : "")} onClick={() => setTab("siniestros")}>
          Siniestros
        </button>
        <button className={"tab" + (tab === "triangulacion" ? " active" : "")} onClick={() => setTab("triangulacion")}>
          Triangulación
        </button>
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
            <table className="compacto" style={{ maxWidth: 760 }}>
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
                  <th>Mes</th>
                  <th className="num">GWP</th>
                  <th className="num">Net Premium to Broker</th>
                  <th className="num">Comisión</th>
                  <th>Recibo</th>
                </tr>
              </thead>
              <tbody>
                {porMes.map(([mes, v]) => {
                  const [y, mo] = mes.split("-");
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
                      <td>{`${mo}/${y}`}</td>
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
          )}
        </>
      )}

      {tab === "bloqueo" && (
        (() => {
          const ls = sel?.lineas ?? [];
          const cols: { titulo: string; tipo: string; emoji: string; meses: string[] }[] = [
            { titulo: "Risk BDX", tipo: "risk", emoji: "📊", meses: mesesDe(ls, "reporting_period_start") },
            { titulo: "Premium BDX", tipo: "premium", emoji: "💷", meses: mesesDe(ls, "premium_bdx", (l) => !!l.incluido_en_premium) },
            { titulo: "Claims BDX", tipo: "claims", emoji: "⚖️", meses: [] },
          ];
          // Persistente: el bloqueo se guarda en el backend (impide editar líneas del periodo).
          const toggle = async (tipo: string, m: string) => {
            const key = `${tipo}:${m}`;
            try {
              if (bloqueos.has(key)) {
                await bdxApi.desbloquear(binder.id, tipo, m);
                setBloqueos((s) => { const ns = new Set(s); ns.delete(key); return ns; });
              } else {
                await bdxApi.bloquear(binder.id, tipo, m);
                setBloqueos((s) => new Set(s).add(key));
              }
            } catch (e) {
              alert((e as Error).message);
            }
          };
          return (
            <div className="bloqueo-cols">
              {cols.map((c) => (
                <div className="bloqueo-col" key={c.titulo}>
                  <h3>
                    <span className="page-title-emoji" style={{ fontSize: 20 }}>{c.emoji}</span> {c.titulo}
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
                          onClick={() => toggle(c.tipo, m)}
                          style={{ cursor: "pointer" }}
                          title={bloq ? "Bloqueado (clic para desbloquear)" : "Clic para bloquear este periodo"}
                        >
                          <input type="checkbox" checked={bloq} readOnly tabIndex={-1} />
                          <button type="button" className="lock-btn" tabIndex={-1}>
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
              ))}
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
              <div className="empty">
                {!sel
                  ? "Este binder no tiene BDX todavía. Impórtalo de SharePoint o sube el Excel."
                  : "El BDX no tiene líneas."}
              </div>
            </>
          ) : (
            <BdxTabla
              lineas={
                selMeses.size > 0
                  ? sel.lineas.filter((l) => selMeses.has(String(l.reporting_period_start ?? "").slice(0, 7)))
                  : sel.lineas
              }
              onRowClick={(l) => setLinea(l)}
              bloqueada={lineaBloqueada}
              hayFiltroExterno={selMeses.size > 0}
              onQuitarFiltros={() => setSelMeses(new Set())}
              acciones={
                <>
                  <button className="btn-primary btn-sm" onClick={() => elegirExcel("risk")}>
                    ⬆ Subir Risk
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => elegirExcel("premium")}>
                    ⬆ Subir Premium
                  </button>
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
            <table className="compacto" style={{ maxWidth: 900 }}>
              <thead>
                <tr>
                  <th>Mes Premium</th>
                  <th className="num">Líneas</th>
                  <th className="num">Prima</th>
                  <th className="num">Comisión</th>
                  <th>Estado</th>
                  <th>Cobro</th>
                </tr>
              </thead>
              <tbody>
                {premiums.map((p) => (
                  <tr key={p.periodo}>
                    <td>{mesLargo(p.periodo)}</td>
                    <td className="num">{p.num_lineas}</td>
                    <td className="num">{imp(n(p.prima))}</td>
                    <td className="num">{imp(n(p.comision))}</td>
                    <td>
                      {p.cobrado ? (
                        <span className="pill pill-cobrado">Cobrado {p.fecha_pago ? fmtFechaES(p.fecha_pago) : ""}</span>
                      ) : (
                        <span className="pill pill-pendiente">Pendiente</span>
                      )}
                    </td>
                    <td>
                      {p.cobrado ? (
                        <button className="btn-link" onClick={() => descobrarPremium(p.periodo)}>Deshacer</button>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="date"
                            className="inp-fecha"
                            value={fechasPago[p.periodo] ?? new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setFechasPago((s) => ({ ...s, [p.periodo]: e.target.value }))}
                          />
                          <button className="btn-primary btn-sm" onClick={() => cobrarPremium(p.periodo)}>Cobrado</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--borde)" }}>
                  <td>Total Premium</td>
                  <td className="num">{premLineas}</td>
                  <td className="num">{imp(premPrima)}</td>
                  <td className="num">{imp(premComision)}</td>
                  <td colSpan={2}></td>
                </tr>
                <tr className="hint">
                  <td>Total Risk</td>
                  <td className="num">{riskLineas}</td>
                  <td className="num">{imp(riskPrima)}</td>
                  <td className="num">{imp(riskComision)}</td>
                  <td colSpan={2}>
                    {premLineas === riskLineas
                      ? "✓ todo el Risk macheado"
                      : `faltan ${riskLineas - premLineas} línea(s) por machear`}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            El <b>Total Premium</b> debe igualar al <b>Total Risk</b> cuando todo está macheado. Al marcar un
            Premium como cobrado, el cobro se reparte automáticamente entre los recibos de esas líneas.
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
          // Siniestralidad (simulada): indemnización + fees, pagado + reservas.
          const claims = n(indemPaid) + n(indemRes) + n(feesPaid) + n(feesRes);
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
                La siniestralidad es simulada (campos editables, aún sin datos reales).
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
                  <tr><td>Indemnización — Pagado</td><td className="num"><NumberInput value={indemPaid} onChange={setIndemPaid} /></td></tr>
                  <tr><td>Indemnización — Reservas</td><td className="num"><NumberInput value={indemRes} onChange={setIndemRes} /></td></tr>
                  <tr><td>Fees — Pagado</td><td className="num"><NumberInput value={feesPaid} onChange={setFeesPaid} /></td></tr>
                  <tr><td>Fees — Reservas</td><td className="num"><NumberInput value={feesRes} onChange={setFeesRes} /></td></tr>
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
          <h3 style={{ margin: "4px 0 8px" }}>Recibos de este binder ({binder.umr ?? binder.agreement_number ?? binder.id})</h3>
          {recibos.length === 0 ? (
            <div className="empty">
              Aún no hay recibos. Genera uno desde la pestaña <b>Datos</b> («＋ Generar recibo» de un Risk BDX).
            </div>
          ) : (
            <table className="compacto" style={{ maxWidth: 960 }}>
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
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            Vista filtrada por este binder. La gestión completa está en el módulo <b>Facturación → Recibos</b>.
          </div>
        </>
      )}

      {tab === "siniestros" && (
        <div className="empty">Siniestros — pendiente de definir el contenido.</div>
      )}

      {tab === "triangulacion" && (
        <div className="empty">Triangulación — pendiente de definir el contenido.</div>
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

      {/* Macheo de un Premium (Excel) con el Risk */}
      {matchExcel && (
        <PremiumMatch
          binderId={binder.id}
          ruta={matchExcel.ruta}
          nombre={matchExcel.nombre}
          onClose={() => setMatchExcel(null)}
          onApplied={async () => {
            setMatchExcel(null);
            await cargar();
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
