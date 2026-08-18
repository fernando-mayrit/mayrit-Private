import { useCallback, useEffect, useState } from "react";
import { getWebAnalitica, sincronizarWeb, type WebAnalitica, type WebPunto, type WebTop } from "../api";
import PageHeader from "../components/PageHeader";
import { fmtMiles } from "../format";

// Periodos ofrecidos. El histórico vive en NUESTRA BD (Cloudflare purga a los pocos días), así que
// los periodos largos van llenándose según pasa el tiempo.
const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 365, label: "12 meses" },
];

const MESES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Nombre del país en español a partir del código ISO. Lo resuelve el propio navegador (Intl), así
// no hay que mantener una lista de 250 países a mano. Las banderas emoji NO se usan: Windows no las
// dibuja (salen las dos letras en pequeño), que es justo lo que se veía al probar la pantalla.
const NOMBRES_PAIS = (() => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" });
  } catch {
    return null;                                    // navegador antiguo: se queda el código ISO
  }
})();
function pais(cod: string) {
  if (!/^[A-Z]{2}$/.test(cod)) return cod;
  try {
    return NOMBRES_PAIS?.of(cod) ?? cod;
  } catch {
    return cod;
  }
}

// Nombres de navegador/SO tal como los devuelve Cloudflare, en cristiano.
const BONITO: Record<string, string> = {
  Unknown: "Desconocido",
  MacOSX: "macOS",
  MobileSafari: "Safari (móvil)",
  ChromeHeadless: "Chrome (automatizado)",
};
const legible = (v: string) => BONITO[v] ?? v;

const fechaCorta = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MESES_ABR[d.getMonth()]}`;
};
const fechaLarga = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} de ${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()]} de ${d.getFullYear()}`;
};
const n0 = (v: number) => fmtMiles(v, 0);

function Stat({ label, value, sub, tono }: { label: string; value: string; sub?: string; tono?: "ok" | "warn" | "bad" }) {
  return (
    <div className={"kpi-stat" + (tono ? ` kpi-${tono}` : "")}>
      <div className="kpi-val">{value}</div>
      <div className="kpi-lbl">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Barras por día: visitas (barra sólida) sobre el total de páginas vistas (barra clara detrás).
function Barras({ datos }: { datos: WebPunto[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!datos.length) return <div className="hint">Todavía no hay días archivados en este periodo.</div>;

  const W = 720, H = 210, ML = 44, MR = 12, MT = 12, MB = 28;
  const iw = W - ML - MR, ih = H - MT - MB;
  const maxY = Math.max(1, ...datos.map((d) => d.paginas_vistas));
  const n = datos.length;
  const paso = iw / n;
  const ancho = Math.max(2, Math.min(28, paso * 0.62));
  const x = (i: number) => ML + paso * (i + 0.5);
  const y = (v: number) => MT + ih - (v / maxY) * ih;
  const yTicks = 4;
  // Con muchos días no caben todas las fechas: se etiqueta una de cada N.
  const cadaN = Math.ceil(n / 12);

  const ph = hover !== null ? datos[hover] : null;

  return (
    <div className="kpi-lm-plot">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}
           onMouseLeave={() => setHover(null)}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (maxY / yTicks) * i;
          return (
            <g key={i}>
              <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={ML - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#6b7280">{n0(v)}</text>
            </g>
          );
        })}
        {datos.map((p, i) => (
          <g key={p.dia} onMouseEnter={() => setHover(i)}>
            {/* zona sensible: toda la columna, para que el puntero no tenga que acertar la barra */}
            <rect x={x(i) - paso / 2} y={MT} width={paso} height={ih} fill="transparent" />
            <rect x={x(i) - ancho / 2} y={y(p.paginas_vistas)} width={ancho}
                  height={Math.max(0, MT + ih - y(p.paginas_vistas))} fill="#c7d2fe" rx={2} />
            <rect x={x(i) - ancho / 2} y={y(p.visitas)} width={ancho}
                  height={Math.max(0, MT + ih - y(p.visitas))}
                  fill={hover === i ? "#1d4ed8" : "#2563eb"} rx={2} />
          </g>
        ))}
        {datos.map((p, i) => (i % cadaN === 0 ? (
          <text key={p.dia} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#6b7280">
            {fechaCorta(p.dia)}
          </text>
        ) : null))}
      </svg>
      {ph && (
        <div className="kpi-lm-tip" style={{
          left: `${(x(hover!) / W) * 100}%`,
          transform: hover! > (n - 1) / 2 ? "translateX(-105%)" : "translateX(8px)",
        }}>
          <div className="kpi-lm-tip-tit">{fechaLarga(ph.dia)}</div>
          <div className="kpi-lm-tip-row">
            <span className="kpi-lm-dot" style={{ background: "#2563eb" }} />
            <span>Visitas</span><span className="kpi-lm-tip-val">{n0(ph.visitas)}</span>
          </div>
          <div className="kpi-lm-tip-row">
            <span className="kpi-lm-dot" style={{ background: "#c7d2fe" }} />
            <span>Páginas vistas</span><span className="kpi-lm-tip-val">{n0(ph.paginas_vistas)}</span>
          </div>
        </div>
      )}
      <div className="kpi-lm-leg">
        <span className="kpi-lm-legitem"><span className="kpi-lm-dot" style={{ background: "#2563eb" }} /> Visitas</span>
        <span className="kpi-lm-legitem"><span className="kpi-lm-dot" style={{ background: "#c7d2fe" }} /> Páginas vistas</span>
      </div>
    </div>
  );
}

// Ranking de un desglose: barra proporcional dentro de la propia fila.
function Top({ titulo, filas, formato }: { titulo: string; filas: WebTop[] | undefined; formato?: (v: string) => string }) {
  const datos = filas ?? [];
  const max = Math.max(1, ...datos.map((f) => f.visitas));
  return (
    <div className="kpi-graf-box">
      <div className="kpi-graf-tit">{titulo}</div>
      {datos.length === 0 ? (
        <div className="hint">Sin datos en este periodo.</div>
      ) : (
        <table className="web-top">
          <tbody>
            {datos.map((f) => (
              <tr key={f.valor}>
                <td className="web-top-lbl" title={f.valor}>{formato ? formato(f.valor) : f.valor}</td>
                <td className="web-top-bar">
                  <span style={{ width: `${(f.visitas / max) * 100}%` }} />
                </td>
                <td className="web-top-num">{n0(f.visitas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function WebPage() {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState<WebAnalitica | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback((periodo: number) => {
    setCargando(true);
    getWebAnalitica(periodo)
      .then((r) => { setD(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(dias); }, [dias, cargar]);

  const actualizar = async () => {
    setCargando(true);
    try {
      await sincronizarWeb(7);
      cargar(dias);
    } catch (e) {
      setError((e as Error).message);
      setCargando(false);
    }
  };

  const cabecera = (
    <PageHeader emoji="🌐" title={`Analítica web${d ? ` · ${d.host}` : ""}`} />
  );

  if (error && !d) return <div className="container">{cabecera}<div className="error">⚠ {error}</div></div>;
  if (!d) return <div className="container">{cabecera}<div className="loading">Cargando…</div></div>;

  const t = d.totales;
  const varVis = t.visitas_previo > 0 ? ((t.visitas - t.visitas_previo) / t.visitas_previo) * 100 : null;
  const varPag = t.paginas_vistas_previo > 0
    ? ((t.paginas_vistas - t.paginas_vistas_previo) / t.paginas_vistas_previo) * 100 : null;
  const flecha = (v: number) => `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}% vs periodo anterior`;

  return (
    <div className="container">
      {cabecera}

      <div className="web-barra">
        <div className="web-periodos">
          {PERIODOS.map((p) => (
            <button key={p.dias} className={"btn-toggle" + (p.dias === dias ? " on" : "")}
                    onClick={() => setDias(p.dias)}>{p.label}</button>
          ))}
        </div>
        <button className="btn-secondary" onClick={actualizar} disabled={cargando}>
          {cargando ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      {!d.configurado && (
        <div className="error">⚠ Falta configurar el acceso a Cloudflare (CF_API_TOKEN / CF_ACCOUNT_ID).
          Se muestra solo lo ya archivado.</div>
      )}
      {d.error_sync && (
        <div className="error">⚠ No se pudo actualizar desde Cloudflare: {d.error_sync}
          <div className="hint">Se muestran los datos archivados hasta la última vez que sí funcionó.</div>
        </div>
      )}

      <section className="kpi-section">
        <div className="kpi-stats">
          <Stat label={`Visitas · últimos ${dias} días`} value={n0(t.visitas)}
                sub={varVis !== null ? flecha(varVis) : "sin periodo anterior con datos"}
                tono={varVis === null ? undefined : varVis >= 0 ? "ok" : "bad"} />
          <Stat label="Páginas vistas" value={n0(t.paginas_vistas)}
                sub={varPag !== null ? flecha(varPag) : undefined}
                tono={varPag === null ? undefined : varPag >= 0 ? "ok" : "bad"} />
          <Stat label="Media diaria de visitas" value={fmtMiles(t.media_diaria, 1)} />
          <Stat label="Mejor día"
                value={t.mejor_dia ? n0(t.mejor_dia.visitas) : "—"}
                sub={t.mejor_dia ? fechaLarga(t.mejor_dia.dia) : undefined} />
        </div>

        <div className="kpi-graf">
          <div className="kpi-graf-box" style={{ gridColumn: "1 / -1" }}>
            <div className="kpi-graf-tit">Visitas por día</div>
            <Barras datos={d.serie} />
          </div>
        </div>
      </section>

      <section className="kpi-section">
        <h3>📄 Qué miran y de dónde vienen</h3>
        <div className="kpi-graf">
          <Top titulo="Páginas más vistas" filas={d.tops.pagina} />
          <Top titulo="De dónde llegan" filas={d.tops.referente}
               formato={(v) => (v === "(desconocido)" ? "Directo / sin referente" : v)} />
        </div>
      </section>

      <section className="kpi-section">
        <h3>🌍 Quién entra</h3>
        <div className="kpi-graf">
          <Top titulo="Países" filas={d.tops.pais} formato={pais} />
          <Top titulo="Dispositivos" filas={d.tops.dispositivo}
               formato={(v) => ({ desktop: "💻 Ordenador", mobile: "📱 Móvil", tablet: "📲 Tableta" }[v] ?? v)} />
          <Top titulo="Navegadores" filas={d.tops.navegador} formato={legible} />
          <Top titulo="Sistemas operativos" filas={d.tops.so} formato={legible} />
        </div>
      </section>

      <p className="hint" style={{ marginTop: 18 }}>
        Medición sin cookies (Cloudflare Web Analytics), tal como se declara en los legales de la web.
        Una <strong>visita</strong> es una entrada al sitio desde fuera; las{" "}
        <strong>páginas vistas</strong> cuentan cada página cargada. Los datos se archivan en Mayrit
        {d.historico_desde ? ` desde el ${fechaLarga(d.historico_desde)}` : ""} y ya no caducan, aunque
        Cloudflare los borre.
        {d.ultima_sync && ` · Última actualización: ${new Date(d.ultima_sync).toLocaleString("es-ES")}`}
      </p>
    </div>
  );
}
