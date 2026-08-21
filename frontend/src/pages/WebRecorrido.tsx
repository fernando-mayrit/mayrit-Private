import { useCallback, useEffect, useState } from "react";
import {
  getWebRecorrido, getWebVisita, sincronizarWebRecorrido,
  type WebCuenta, type WebRecorrido, type WebVisitaDetalle, type WebVisitaFila,
} from "../api";
import FormPanel from "../components/FormPanel";
import { fmtMiles } from "../format";

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  El RECORRIDO: qué hace la gente DENTRO de la web.
//
//  Va en una pestaña aparte de las cifras de Cloudflare, y a propósito. Son dos mediciones
//  distintas: Cloudflare cuenta entradas al sitio (y cuenta también a quien no ejecuta
//  JavaScript); esto cuenta paseos completos. Sus cifras de visitas NO tienen por qué coincidir,
//  así que no se suman, no se restan y no se ponen una al lado de otra como si fueran lo mismo.
//
//  Lo que se ve aquí no se puede sacar de Cloudflare de ninguna manera, porque la web cambia de
//  página sin recargar y para él las siete páginas son una sola dirección.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const n0 = (v: number) => fmtMiles(v, 0);

// Los identificadores internos de las páginas, en cristiano.
const PAGINAS: Record<string, string> = {
  inicio: "Inicio",
  agencias: "Agencias",
  companias: "Compañías",
  como: "Cómo funciona",
  diccionario: "Diccionario",
  nosotros: "Nosotros",
  contacto: "Contacto",
  "aviso-legal": "Aviso legal",
  privacidad: "Privacidad",
  cookies: "Cookies",
  reclamaciones: "Reclamaciones",
  accesibilidad: "Accesibilidad",
};
const nombrePagina = (v: string) => PAGINAS[v] ?? v;

// Las secciones de dentro de cada página.
const SECCIONES: Record<string, string> = {
  puertas: "Las tres puertas (portada)",
  agencias: "Servicios a agencias",
  companias: "Servicios a compañías",
  "que-es": "Qué es la suscripción delegada",
  cadena: "Quién es quién",
  definiciones: "Definiciones",
  "dicc-cabeza": "Buscador del diccionario",
  quienes: "Quiénes somos",
  contacto: "Formulario de contacto",
};
const nombreSeccion = (v: string) => SECCIONES[v] ?? v;

const TIPO_CLIC: Record<string, string> = {
  correo: "📧 Correo",
  telefono: "📞 Teléfono",
  termino: "📖 Término del diccionario",
  externo: "🔗 Enlace de fuera",
};

const DISPOSITIVO: Record<string, string> = {
  ordenador: "💻 Ordenador", movil: "📱 Móvil", tableta: "📲 Tableta",
};

// Sin banderas: en Windows los emoji de bandera NO existen y salen las dos letras del país en
// pequeño, que es peor que no poner nada. (Ya pasó en el selector de idiomas de la web, donde hubo
// que dibujarlas en SVG.) Aquí basta el nombre.
const IDIOMA: Record<string, string> = {
  es: "Español", en: "Inglés", fr: "Francés", it: "Italiano", pt: "Portugués",
};

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-stat">
      <div className="kpi-val">{value}</div>
      <div className="kpi-lbl">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Una lista con barra proporcional. Es la misma idea que el Top de la pestaña de al lado, pero
// contando VECES (no visitas de Cloudflare), que es lo único que esta medición sabe.
function Lista({ titulo, filas, formato, vacio }: {
  titulo: string; filas: WebCuenta[]; formato?: (v: string) => string; vacio?: string;
}) {
  const max = Math.max(1, ...filas.map((f) => f.veces));
  return (
    <div className="kpi-graf-box">
      <div className="kpi-graf-tit">{titulo}</div>
      {filas.length === 0 ? (
        <div className="hint" style={{ padding: "6px 0" }}>{vacio ?? "Todavía nada."}</div>
      ) : (
        <div className="web-lista">
          {filas.map((f) => (
            <div key={f.valor} className="web-fila">
              {/* el título emergente lleva el texto YA traducido: si no, al pasar por encima de
                  un recorrido largo salía "inicio → companias", que no se lee igual */}
              <div className="web-fila-txt" title={formato ? formato(f.valor) : f.valor}>
                {formato ? formato(f.valor) : f.valor}
              </div>
              <div className="web-fila-barra"><span style={{ width: `${(f.veces / max) * 100}%` }} /></div>
              <div className="web-fila-num">{n0(f.veces)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// El camino de una visita, en horizontal: Inicio → Compañías → Contacto
function Camino({ paginas }: { paginas: string[] }) {
  if (!paginas.length) return <span className="hint">—</span>;
  return (
    <span className="web-camino">
      {paginas.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="web-flecha"> → </span>}
          <span className="web-paso">{nombrePagina(p)}</span>
        </span>
      ))}
    </span>
  );
}

// Ficha de UNA visita: el paseo entero, segundo a segundo. Y, si esa persona ya había estado
// antes, sus otras visitas — que es justo lo que da la cookie propia y Cloudflare no puede dar.
function PanelVisita({ sesion, onCerrar, onOtra }: {
  sesion: string; onCerrar: () => void; onOtra: (s: string) => void;
}) {
  const [v, setV] = useState<WebVisitaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setV(null);
    getWebVisita(sesion).then(setV).catch((e) => setError((e as Error).message));
  }, [sesion]);

  const paso = (p: WebVisitaDetalle["pasos"][number]) => {
    switch (p.tipo) {
      case "pagina":
        return (
          <>
            <strong>{nombrePagina(p.valor)}</strong>
            {p.segundos != null && <> · {p.segundos} s</>}
            {p.pct != null && <> · vio el {p.pct}%</>}
          </>
        );
      case "seccion":
        return <>Leyó <strong>{nombreSeccion(p.valor)}</strong>{p.segundos != null && <> · {p.segundos} s</>}</>;
      case "busca":
        return (
          <>
            Buscó «<strong>{p.valor}</strong>» en el diccionario
            {p.detalle === "sin_resultado" && <span className="web-aviso"> · no encontró nada</span>}
          </>
        );
      case "clic":
        return <>{TIPO_CLIC[p.detalle] ?? "Pinchó"}: <strong>{p.valor}</strong></>;
      case "idioma":
        return <>Cambió el idioma a <strong>{IDIOMA[p.valor] ?? p.valor}</strong></>;
      case "envio":
        return <strong>📧 Envió el formulario de contacto</strong>;
      default:
        return <>{p.tipo} {p.valor}</>;
    }
  };

  return (
    <FormPanel title="Una visita, paso a paso" dirty={false} readOnly wide
               error={error} onSave={() => {}} onClose={onCerrar}>
      {!v ? <div className="loading">Cargando…</div> : (
        <>
          <div className="kpi-stats" style={{ marginBottom: 16 }}>
            <Stat label="Cuándo" value={cuando(v.cuando)} />
            <Stat label="Cuánto estuvo" value={v.duracion} />
            <Stat label="Páginas que vio" value={n0(v.paginas)} />
            <Stat label={v.nuevo ? "Primera vez" : "Ya había estado"}
                  value={v.nuevo ? "🆕" : "🔁"} />
          </div>

          <div className="hint" style={{ marginBottom: 16 }}>
            Llegó desde <strong>{v.origen === "directo" ? "escribiendo la dirección" : v.origen}</strong>
            {v.fuente && <> · etiqueta <strong>{v.fuente}</strong></>}
            {v.campana && <> / {v.campana}</>}
            {" · "}{DISPOSITIVO[v.dispositivo] ?? v.dispositivo}
            {v.navegador && <> · {v.navegador}</>}
            {v.so && <> / {v.so}</>}
            {v.idioma && <> · leyó en {IDIOMA[v.idioma] ?? v.idioma}</>}
          </div>

          <div className="web-pasos">
            {v.pasos.length === 0 ? (
              <div className="empty">De esta visita solo quedó la entrada: se fue enseguida.</div>
            ) : v.pasos.map((p, i) => (
              <div key={i} className="web-paso-fila">
                <div className="web-paso-seg">{p.segundo}s</div>
                <div className="web-paso-txt">{paso(p)}</div>
              </div>
            ))}
          </div>

          {v.otras_visitas.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="kpi-graf-tit">🔁 Esta misma persona ha estado {v.otras_visitas.length} vez
                {v.otras_visitas.length === 1 ? "" : "es"} más</div>
              <div className="hint" style={{ marginBottom: 8 }}>
                Lo sabemos por la cookie propia: es un número al azar, no dice quién es.
              </div>
              <div className="web-lista">
                {v.otras_visitas.map((o) => (
                  <button key={o.sesion} className="web-otra" onClick={() => onOtra(o.sesion)}>
                    {cuando(o.cuando)} · {o.paginas} página{o.paginas === 1 ? "" : "s"} · {o.duracion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </FormPanel>
  );
}

export default function WebRecorrido({ dias }: { dias: number }) {
  const [d, setD] = useState<WebRecorrido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [visita, setVisita] = useState<string | null>(null);

  const cargar = useCallback((periodo: number) => {
    setCargando(true);
    getWebRecorrido(periodo)
      .then((r) => { setD(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(dias); }, [dias, cargar]);

  const actualizar = async () => {
    setCargando(true);
    try { await sincronizarWebRecorrido(); cargar(dias); }
    catch (e) { setError((e as Error).message); setCargando(false); }
  };

  if (error && !d) return <div className="error">⚠ {error}</div>;
  if (!d) return <div className="loading">Cargando…</div>;

  const r = d.resumen;
  const sinDatos = r.visitas === 0;

  return (
    <>
      <div className="web-barra">
        <p className="hint" style={{ margin: 0, maxWidth: 720 }}>
          Esto lo mide <strong>nuestra propia baliza</strong>, no Cloudflare. Cuenta lo que hace cada
          visita dentro de la web: qué páginas ve, en qué orden y cuánto tiempo. Las cifras no tienen
          por qué coincidir con las de la pestaña Resumen, porque no cuentan lo mismo.
        </p>
        <button className="btn-secondary" onClick={actualizar} disabled={cargando}>
          {cargando ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      {!d.configurado && (
        <div className="error">⚠ Falta la clave de la baliza (WEB_MEDIR_CLAVE). Se muestra solo lo ya
          archivado.
          <div className="hint">Se genera con <code>python scripts\subir_medir.py</code> en el proyecto
            de la web, y se pega aquí y en Azure.</div>
        </div>
      )}
      {d.error_sync && (
        <div className="error">⚠ No se pudo recoger de la web: {d.error_sync}
          <div className="hint">Se muestra lo archivado hasta la última vez que sí funcionó.</div>
        </div>
      )}

      {sinDatos ? (
        <div className="empty" style={{ marginTop: 20 }}>
          Todavía no hay ningún recorrido archivado en este periodo.
          <div className="hint" style={{ marginTop: 8 }}>
            La baliza mide desde el 21 de agosto de 2026. Si acaba de publicarse, hay que esperar a
            que entre alguien: cada visita se archiva cuando la persona cierra la pestaña.
          </div>
        </div>
      ) : (
        <>
          <section className="kpi-section">
            <div className="kpi-stats">
              <Stat label={`Visitas · últimos ${dias} días`} value={n0(r.visitas)}
                    sub={`${n0(r.personas)} persona${r.personas === 1 ? "" : "s"} distinta${r.personas === 1 ? "" : "s"}`} />
              <Stat label="Ya habían estado antes" value={n0(r.repetidos)}
                    sub={r.visitas ? `${Math.round((r.repetidos / r.visitas) * 100)}% de las visitas` : undefined} />
              <Stat label="Páginas por visita" value={fmtMiles(r.paginas_por_visita, 1)} />
              <Stat label="Cuánto se quedan" value={r.duracion_media_texto} sub="de media" />
              <Stat label="Se van sin pasar de la primera" value={n0(r.solo_una_pagina)}
                    sub={r.visitas ? `${Math.round((r.solo_una_pagina / r.visitas) * 100)}% de las visitas` : undefined} />
              {r.escribieron > 0 && (
                <Stat label="📧 Escribieron por el formulario" value={n0(r.escribieron)} />
              )}
            </div>
          </section>

          <section className="kpi-section">
            <h3>📄 Qué páginas leen de verdad</h3>
            <div className="kpi-graf">
              <div className="kpi-graf-box" style={{ gridColumn: "1 / -1" }}>
                <div className="kpi-graf-tit">
                  Páginas <span className="hint">· cuántas veces se abre cada una, cuánto se está y
                  cuánto se llega a ver</span>
                </div>
                {d.paginas.length === 0 ? <div className="hint">Todavía nada.</div> : (
                  <table className="tabla compacta">
                    <thead>
                      <tr><th>Página</th><th className="num">Veces</th><th className="num">Tiempo medio</th>
                        <th className="num">Cuánto ven</th></tr>
                    </thead>
                    <tbody>
                      {d.paginas.map((p) => (
                        <tr key={p.valor}>
                          <td>{nombrePagina(p.valor)}</td>
                          <td className="num">{n0(p.veces)}</td>
                          <td className="num">{p.tiempo_medio}</td>
                          <td className="num">{p.visto_medio == null ? "—" : `${p.visto_medio}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="kpi-graf">
              <Lista titulo="Por dónde entran" filas={d.entradas} formato={nombrePagina} />
              <Lista titulo="Dónde acaban" filas={d.salidas} formato={nombrePagina} />
            </div>
          </section>

          <section className="kpi-section">
            <h3>🧭 El camino que hacen</h3>
            <div className="kpi-graf">
              <Lista titulo="Recorridos más repetidos" filas={d.caminos}
                     formato={(v) => v.split(" → ").map(nombrePagina).join(" → ")}
                     vacio="Aún no hay ningún recorrido de dos páginas o más." />
              <Lista titulo="Secciones más leídas" filas={d.secciones} formato={nombreSeccion} />
            </div>
          </section>

          <section className="kpi-section">
            <h3>🔍 Qué buscan en el diccionario</h3>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              Esto es lo más valioso de toda la pantalla: son <strong>sus palabras</strong>, no las
              nuestras. Lo que aparece marcado en rojo se buscó y <strong>no existe</strong> en el
              diccionario: son definiciones que faltan.
            </p>
            <div className="kpi-graf">
              <div className="kpi-graf-box" style={{ gridColumn: "1 / -1" }}>
                {d.busquedas.length === 0 ? (
                  <div className="hint">Todavía nadie ha buscado nada.</div>
                ) : (
                  <div className="web-lista">
                    {d.busquedas.map((b) => (
                      <div key={b.valor} className="web-fila">
                        <div className="web-fila-txt">
                          {b.valor}
                          {b.sin_resultado && <span className="web-aviso"> · no existe en el diccionario</span>}
                        </div>
                        <div className="web-fila-num">{n0(b.veces)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="kpi-section">
            <h3>🚪 De dónde vienen y qué pinchan</h3>
            <div className="kpi-graf">
              <Lista titulo="De dónde llegan" filas={d.origenes}
                     formato={(v) => (v === "directo" ? "Escribiendo la dirección" : v)} />
              <Lista titulo="Etiquetas de campaña" filas={d.campanas}
                     vacio="Ninguna visita traía etiqueta. Se ponen a mano en el enlace que publicas: ?utm_source=linkedin" />
              <Lista titulo="Qué pinchan" filas={d.clics}
                     formato={(v) => {
                       const [q, ...resto] = v.split(" · ");
                       return `${TIPO_CLIC[q] ?? q} · ${resto.join(" · ")}`;
                     }} />
              <Lista titulo="En qué idioma leen" filas={d.idiomas} formato={(v) => IDIOMA[v] ?? v} />
            </div>
          </section>

          <section className="kpi-section">
            <h3>👣 Visita por visita</h3>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              Pincha cualquiera para ver su paseo segundo a segundo. No hay nombres: cada visita es un
              número al azar.
            </p>
            <table className="tabla">
              <thead>
                <tr><th>Cuándo</th><th>De dónde</th><th>Recorrido</th>
                  <th className="num">Estuvo</th><th></th></tr>
              </thead>
              <tbody>
                {d.visitas.map((v: WebVisitaFila) => (
                  <tr key={v.sesion} className="fila-click" onClick={() => setVisita(v.sesion)}>
                    <td>{cuando(v.cuando)}</td>
                    <td>
                      {v.origen === "directo" ? "Directo" : v.origen}
                      {v.fuente && <span className="hint"> · {v.fuente}</span>}
                    </td>
                    <td><Camino paginas={v.camino} /></td>
                    <td className="num">{v.duracion}</td>
                    <td className="num">
                      {!v.nuevo && <span title="Ya había estado antes">🔁</span>}
                      {v.escribio && <span title="Envió el formulario"> 📧</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <p className="hint" style={{ marginTop: 18 }}>
        Medición propia, sin ceder nada a terceros. La cookie <code>mv</code> dura 13 meses y solo
        sirve para saber que alguien vuelve; no lleva nombre, correo ni nada que identifique. La
        dirección IP no se guarda en ningún momento. Está declarado en la política de cookies de la
        web, apartado 3.
        {d.ultima_sync && ` · Última recogida: ${new Date(d.ultima_sync).toLocaleString("es-ES")}`}
      </p>

      {visita && <PanelVisita sesion={visita} onCerrar={() => setVisita(null)} onOtra={setVisita} />}
    </>
  );
}
