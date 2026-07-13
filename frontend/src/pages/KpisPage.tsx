import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getKpis, type Kpis } from "../api";
import PageHeader from "../components/PageHeader";
import { fmtMiles } from "../format";

const MESES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COLORES_ANIO = ["#7c3aed", "#db2777", "#9333ea", "#ca8a04", "#dc2626", "#0d9488", "#16a34a", "#2563eb", "#1e3a8a", "#ea6a1e", "#0891b2", "#65a30d"];
const eur = (v: number) => fmtMiles(v, 0);

// Tarjeta de un indicador: valor grande + etiqueta (+ pie opcional).
function Stat({ label, value, sub, tono }: { label: string; value: string; sub?: string; tono?: "ok" | "warn" | "bad" }) {
  return (
    <div className={"kpi-stat" + (tono ? ` kpi-${tono}` : "")}>
      <div className="kpi-val">{value}</div>
      <div className="kpi-lbl">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Gráfico de líneas anual (SVG): un valor por año, comparable (mismo periodo). Al pasar el puntero
// por encima resalta el punto más cercano y muestra un tooltip con el año, el valor y la variación
// respecto al año anterior.
function LineaAnual({ datos }: { datos: { anio: number; valor: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (datos.length < 2) return <div className="hint">Sin datos suficientes.</div>;
  const W = 560, H = 190, ML = 58, MR = 14, MT = 12, MB = 26;
  const iw = W - ML - MR, ih = H - MT - MB;
  const maxY = Math.max(1, ...datos.map((d) => d.valor));
  const n = datos.length;
  const x = (i: number) => ML + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => MT + ih - (v / maxY) * ih;
  const path = datos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.valor)}`).join(" ");
  const yTicks = 4;

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;               // x en coords del viewBox
    setHover(Math.max(0, Math.min(n - 1, Math.round(((vx - ML) / iw) * (n - 1)))));
  };

  const ph = hover !== null ? datos[hover] : null;
  const prev = hover !== null && hover > 0 ? datos[hover - 1] : null;
  const delta = ph && prev && prev.valor > 0 ? ((ph.valor - prev.valor) / prev.valor) * 100 : null;

  return (
    <div className="kpi-lm-plot">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (maxY / yTicks) * i;
          return (
            <g key={i}>
              <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={ML - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#6b7280">{eur(v)}</text>
            </g>
          );
        })}
        {datos.map((p, i) => (
          <text key={p.anio} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#6b7280">{p.anio}</text>
        ))}
        {hover !== null && <line x1={x(hover)} y1={MT} x2={x(hover)} y2={MT + ih} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2.5} />
        {datos.map((p, i) => <circle key={p.anio} cx={x(i)} cy={y(p.valor)} r={hover === i ? 4.5 : 2.8} fill="#2563eb" />)}
      </svg>
      {ph && (
        <div className="kpi-lm-tip" style={{ left: `${(x(hover!) / W) * 100}%`, transform: hover! > (n - 1) / 2 ? "translateX(-105%)" : "translateX(8px)" }}>
          <div className="kpi-lm-tip-tit">{ph.anio}</div>
          <div className="kpi-lm-tip-row">
            <span className="kpi-lm-dot" style={{ background: "#2563eb" }} />
            <span>Retenida</span>
            <span className="kpi-lm-tip-val">{fmtMiles(ph.valor)} €</span>
          </div>
          {delta !== null && (
            <div className="kpi-lm-tip-row">
              <span />
              <span>vs {prev!.anio}</span>
              <span className="kpi-lm-tip-val" style={{ color: delta >= 0 ? "#16a34a" : "#dc2626" }}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Multi-línea por año: comisión neta por mes. Leyenda con checks (mostrar/ocultar años) y tooltip
// al pasar por encima que lista el valor de cada año visible en ese mes.
const LM_STORAGE_KEY = "kpi-comis-neta-mensual:ocultas";
function LineasMensuales({ series }: { series: { anio: number; valores: number[] }[] }) {
  // Años ocultos, persistidos entre sesiones (se mantiene lo seleccionado al salir y volver).
  const [ocultas, setOcultas] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(LM_STORAGE_KEY);
      return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  useEffect(() => {
    try { localStorage.setItem(LM_STORAGE_KEY, JSON.stringify([...ocultas])); } catch { /* ignore */ }
  }, [ocultas]);
  const [hoverMes, setHoverMes] = useState<number | null>(null);
  const visibles = series.filter((s) => !ocultas.has(s.anio));
  const maxY = Math.max(1, ...visibles.flatMap((s) => s.valores));
  const colorDe = (anio: number) => COLORES_ANIO[series.findIndex((s) => s.anio === anio) % COLORES_ANIO.length];
  const toggle = (anio: number) =>
    setOcultas((prev) => { const n = new Set(prev); n.has(anio) ? n.delete(anio) : n.add(anio); return n; });

  const W = 620, H = 210, ML = 52, MR = 12, MT = 12, MB = 26;
  const iw = W - ML - MR, ih = H - MT - MB;
  const x = (i: number) => ML + (i / 11) * iw;
  const y = (v: number) => MT + ih - (v / maxY) * ih;
  const yTicks = 4;

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;               // x en coords del viewBox
    const i = Math.max(0, Math.min(11, Math.round(((vx - ML) / iw) * 11)));
    setHoverMes(i);
  };

  return (
    <div className="kpi-lm">
      <div className="kpi-lm-plot">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}
             onMouseMove={onMove} onMouseLeave={() => setHoverMes(null)}>
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (maxY / yTicks) * i;
            return (
              <g key={i}>
                <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
                <text x={ML - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#6b7280">{eur(v)}</text>
              </g>
            );
          })}
          {MESES_ABR.map((mm, i) => (
            <text key={mm} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="#6b7280">{mm}</text>
          ))}
          {hoverMes !== null && <line x1={x(hoverMes)} y1={MT} x2={x(hoverMes)} y2={MT + ih} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />}
          {visibles.map((s) => {
            const c = colorDe(s.anio);
            const d = s.valores.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
            return (
              <g key={s.anio}>
                <path d={d} fill="none" stroke={c} strokeWidth={1.8} />
                {hoverMes !== null && <circle cx={x(hoverMes)} cy={y(s.valores[hoverMes])} r={3} fill={c} />}
              </g>
            );
          })}
        </svg>
        {hoverMes !== null && (
          <div className="kpi-lm-tip" style={{ left: `${(x(hoverMes) / W) * 100}%`, transform: hoverMes > 6 ? "translateX(-105%)" : "translateX(8px)" }}>
            <div className="kpi-lm-tip-tit">{MESES_FULL[hoverMes]}</div>
            {visibles.filter((s) => s.valores[hoverMes] !== 0).map((s) => (
              <div key={s.anio} className="kpi-lm-tip-row">
                <span className="kpi-lm-dot" style={{ background: colorDe(s.anio) }} />
                <span>{s.anio}</span>
                <span className="kpi-lm-tip-val">{fmtMiles(s.valores[hoverMes])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="kpi-lm-leg">
        {series.map((s) => {
          const on = !ocultas.has(s.anio);
          return (
            <label key={s.anio} className="kpi-lm-legitem" style={{ opacity: on ? 1 : 0.45 }}>
              <input type="checkbox" checked={on} onChange={() => toggle(s.anio)} />
              <span className="kpi-lm-dot" style={{ background: colorDe(s.anio) }} />
              {s.anio}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function KpisPage() {
  const [k, setK] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getKpis().then(setK).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="container"><PageHeader emoji="📊" title="KPIs" /><div className="error">⚠ {error}</div></div>;
  if (!k) return <div className="container"><PageHeader emoji="📊" title="KPIs" /><div className="loading">Cargando…</div></div>;

  const p = k.produccion, f = k.financiero, o = k.operativo;
  const varPct = p.prima_anterior > 0 ? ((p.prima_anio - p.prima_anterior) / p.prima_anterior) * 100 : null;
  const varComis = p.comis_ret_anterior > 0 ? ((p.comis_ret_anio - p.comis_ret_anterior) / p.comis_ret_anterior) * 100 : null;
  const varFact = p.facturacion_anterior > 0 ? ((p.facturacion_anio - p.facturacion_anterior) / p.facturacion_anterior) * 100 : null;
  const varProy = (p.proyeccion !== null && p.comis_ret_anterior_full > 0)
    ? ((p.proyeccion - p.comis_ret_anterior_full) / p.comis_ret_anterior_full) * 100 : null;
  const mesCorte = MESES_ABR[p.corte_mes - 1];

  return (
    <div className="container">
      <PageHeader emoji="📊" title={`KPIs · ${k.anio}`} />

      {/* ── Producción ── */}
      <section className="kpi-section">
        <h3>📦 Producción</h3>
        <div className="kpi-stats">
          <Stat label={`Comisiones retenidas ${k.anio}`} value={`${eur(p.comis_ret_anio)} €`}
            sub={varComis !== null ? `${varComis >= 0 ? "▲" : "▼"} ${Math.abs(varComis).toFixed(1)}% vs ${k.anio - 1} (a ${mesCorte})` : undefined}
            tono={varComis === null ? undefined : varComis >= 0 ? "ok" : "bad"} />
          <Stat label={`Facturación ${k.anio}`} value={`${eur(p.facturacion_anio)} €`}
            sub={varFact !== null ? `${varFact >= 0 ? "▲" : "▼"} ${Math.abs(varFact).toFixed(1)}% vs ${k.anio - 1} (a ${mesCorte})` : undefined}
            tono={varFact === null ? undefined : varFact >= 0 ? "ok" : "bad"} />
          <Stat label={`Prima ${k.anio}`} value={`${eur(p.prima_anio)} €`}
            sub={varPct !== null ? `${varPct >= 0 ? "▲" : "▼"} ${Math.abs(varPct).toFixed(1)}% vs ${k.anio - 1} (a ${mesCorte})` : undefined}
            tono={varPct === null ? undefined : varPct >= 0 ? "ok" : "bad"} />
          <Stat label={`Proyección comisiones netas ${k.anio}`} value={p.proyeccion !== null ? `${eur(p.proyeccion)} €` : "—"}
            sub={varProy !== null ? `${varProy >= 0 ? "▲" : "▼"} ${Math.abs(varProy).toFixed(1)}% vs ${k.anio - 1} (100%)` : "presupuesto (Ppto 2026)"}
            tono={varProy === null ? undefined : varProy >= 0 ? "ok" : "bad"} />
        </div>
        <div className="kpi-graf">
          <div className="kpi-graf-box">
            <div className="kpi-graf-tit">Comisión neta por mes (por año)</div>
            <LineasMensuales series={p.comis_neta_mensual} />
          </div>
          <div className="kpi-graf-box">
            <div className="kpi-graf-tit">Comisión retenida por año (a {mesCorte}, comparable)</div>
            <LineaAnual datos={p.comis_ret_serie} />
          </div>
        </div>
      </section>

      {/* ── Financiero ── */}
      <section className="kpi-section">
        <h3>💰 Financiero <span className="hint" style={{ fontWeight: 400 }}>(acumulado, todos los años)</span></h3>
        <div className="kpi-stats">
          <Stat label="Pendiente de cobro" value={`${eur(f.pendiente_cobro)} €`} tono={f.pendiente_cobro > 0 ? "warn" : "ok"} />
          <Stat label="Pendiente de liquidación" value={`${eur(f.pendiente_liquidacion)} €`} tono={f.pendiente_liquidacion > 0 ? "warn" : "ok"} />
          <Stat label="Pendiente de traspaso" value={`${eur(f.pendiente_traspaso)} €`} tono={f.pendiente_traspaso > 0 ? "warn" : "ok"} />
          <Stat label="Pendiente de pago" value={`${eur(f.pendiente_pago)} €`} tono={f.pendiente_pago > 0 ? "warn" : "ok"} />
        </div>
      </section>

      {/* ── Operativo ── */}
      <section className="kpi-section">
        <h3>🔔 Operativo <span className="hint" style={{ fontWeight: 400 }}>(pendientes ahora)</span></h3>
        <div className="kpi-stats">
          <Stat label="Alertas" value={String(o.alertas)} tono={o.alertas > 0 ? "bad" : "ok"} />
          <Stat label="Avisos del día" value={String(o.avisos_dia)} tono={o.avisos_dia > 0 ? "warn" : "ok"} />
          <Stat label="Recibos por generar" value={String(o.recibos_por_generar)} tono={o.recibos_por_generar > 0 ? "warn" : "ok"} />
          <Stat label="Tareas pendientes" value={String(o.tareas_pendientes)} tono={o.tareas_pendientes > 0 ? "warn" : "ok"} />
          <Stat label="LPAN pendientes" value={String(o.lpan_pendientes)} tono={o.lpan_pendientes > 0 ? "warn" : "ok"} />
        </div>
      </section>
    </div>
  );
}
