import type { ReactNode } from "react";
import PageHeader from "../components/PageHeader";

// Manual de uso (v1): reglas y flujos "no obvios" de la app. Contenido FIJO en el repo (versionado
// con la app). Pensado para migrarse a editable (BD) más adelante sin cambiar la estructura visual.

// Recuadro de "regla importante" (lo que más se olvida).
function Regla({ children }: { children: ReactNode }) {
  return <div className="manual-regla">📌 {children}</div>;
}
// Recuadro de "ojo/aviso".
function Ojo({ children }: { children: ReactNode }) {
  return <div className="manual-ojo">⚠️ {children}</div>;
}

type Seccion = { id: string; emoji: string; titulo: string; cuerpo: ReactNode };

const SECCIONES: Seccion[] = [
  {
    id: "conceptos",
    emoji: "🧩",
    titulo: "Conceptos base",
    cuerpo: (
      <>
        <p>La app gira alrededor del <b>binder</b> (acuerdo de suscripción agencia ↔ mercado):</p>
        <ul>
          <li><b>Binder → Secciones → Mercados</b> (con su % de participación). La suma de participaciones de una sección es 100 %.</li>
          <li><b>Lloyd's vs Compañía:</b> un binder es <b>Lloyd's</b> si algún mercado de sus secciones es de tipo <code>Lloyds</code> (sindicatos); el resto son de <b>Compañía</b>. Esta distinción cambia el proceso de LPAN/FDO (ver más abajo).</li>
          <li><b>Programa:</b> agrupa binders relacionados. Algunos programas son de <b>reaseguro</b> (p. ej. caución), con una economía de recibo distinta.</li>
        </ul>
      </>
    ),
  },
  {
    id: "bdx",
    emoji: "📥",
    titulo: "BDX: Risk y Premium",
    cuerpo: (
      <>
        <p>Cada binder reporta dos tipos de bordereau (BDX) por mes:</p>
        <ul>
          <li><b>Risk BDX:</b> los <b>riesgos suscritos</b> del mes (qué se ha vendido). De él se genera el <b>recibo</b>.</li>
          <li><b>Premium BDX:</b> las <b>primas cobradas</b> (el dinero que entra). Rara vez coincide en el tiempo con el Risk. El cobro/traspaso/liquidación del recibo se <b>derivan</b> del Premium.</li>
        </ul>
        <p>«<b>Our line</b>» = la parte que le corresponde a nuestra participación (no el 100 %). Una línea solo entra en la facturación si está marcada <b>«incluida en Premium»</b>.</p>
      </>
    ),
  },
  {
    id: "recibos",
    emoji: "🧾",
    titulo: "Recibos",
    cuerpo: (
      <>
        <ul>
          <li><b>1 recibo por Risk BDX</b> = por (binder, periodo <code>YYYY-MM</code>). Numeración por año natural: <code>AÑO-NNNN</code>.</li>
          <li>La comisión de Mayrit (<b>retenida</b>) = Σ brokerage de las líneas de ese periodo.</li>
          <li>El <b>cobro</b> llega con los Premium BDX (puede ser parcial); los «pendientes» los recalcula la app.</li>
        </ul>
        <Regla>
          La <b>Fecha Contable</b> es el <b>mes al que se imputa</b> el recibo (para el cierre). El día
          es <b>SIEMPRE 1</b>: se elige el mes libremente (el del periodo o, si está cerrado, otro
          abierto), pero nunca un día distinto del 1. La app lo fuerza sola.
        </Regla>
        <Ojo>
          Un recibo <b>Contabilizado</b> (enviado al cierre mensual) queda <b>bloqueado</b>: para
          corregirlo hay que <b>reabrirlo</b> primero.
        </Ojo>
      </>
    ),
  },
  {
    id: "ciclo",
    emoji: "🔗",
    titulo: "El ciclo de liquidación (la cadena)",
    cuerpo: (
      <>
        <p>Para pagar al mercado hay que seguir esta cadena. <b>Cada paso bloquea el siguiente</b> si no está hecho:</p>
        <div className="manual-cadena">
          <span>💰 Cobrar</span><span className="manual-flecha">→</span>
          <span>📐 Generar LPAN</span><span className="manual-flecha">→</span>
          <span>🔓 Liberar</span><span className="manual-flecha">→</span>
          <span>🏦 Liquidar</span>
        </div>
        <ul>
          <li><b>Cobrar</b> las líneas del Premium (marcar cobro con su fecha).</li>
          <li><b>Generar el LPAN</b> del periodo. <b>No se puede generar hasta que TODAS las líneas del grupo estén cobradas.</b></li>
          <li><b>Liberar</b> el LPAN (sello de Xchanging) — <b>solo en binders Lloyd's</b>.</li>
          <li><b>Liquidar</b> el Premium: paga al mercado y <b>sella la fecha de liquidación en los LPAN</b> automáticamente.</li>
        </ul>
        <Regla>
          Para liquidar, <b>tienen que existir LPAN que cuadren</b>: la suma del neto de los LPAN debe
          coincidir con el neto a pagar al mercado del Premium. Si no hay LPAN, o no cuadran, la app
          <b> no deja liquidar</b> (te avisa con los dos importes y la diferencia).
        </Regla>
        <Ojo>
          Los LPAN son obligatorios para liquidar <b>tanto en Lloyd's como en Compañía</b> (os sirven
          para controlar la liquidación). La diferencia está en el FDO y el «Liberado» (ver LPAN y FDO).
        </Ojo>
      </>
    ),
  },
  {
    id: "lpan",
    emoji: "📐",
    titulo: "LPAN y FDO (Lloyd's vs Compañía)",
    cuerpo: (
      <>
        <p>El <b>LPAN</b> (London Premium Advice Note) es la nota de pago que agrupa las líneas del Premium de un risk code y controla la liquidación al mercado.</p>
        <table className="manual-tabla">
          <thead><tr><th></th><th>Lloyd's</th><th>Compañía</th></tr></thead>
          <tbody>
            <tr><td><b>FDO previo</b> (con signing number)</td><td>✅ Obligatorio antes del LPAN</td><td>❌ No hace falta</td></tr>
            <tr><td><b>Generar LPAN</b></td><td>✅ (necesita el FDO)</td><td>✅ (directo, sin FDO)</td></tr>
            <tr><td><b>Liberar</b> (Xchanging)</td><td>✅ Se exige antes de liquidar</td><td>❌ No aplica</td></tr>
            <tr><td><b>LPAN para liquidar</b></td><td>✅ Obligatorio</td><td>✅ Obligatorio</td></tr>
          </tbody>
        </table>
        <p>En resumen: la <b>única diferencia real</b> es que los <b>Lloyd's exigen FDO previo</b> (y el paso «Liberado» de Xchanging). En Compañía se genera el LPAN directo y se liquida sin Liberado.</p>
      </>
    ),
  },
  {
    id: "comisiones",
    emoji: "💶",
    titulo: "Comisiones (Iberian)",
    cuerpo: (
      <>
        <ul>
          <li>Cada mes se <b>prepara un recibo tipo «Comisiones»</b> (prima 0, día 1 del mes) con la comisión <b>estimada</b> del Premium: <b>10 % del GWP</b> (our line).</li>
          <li>Queda <b>pendiente de ratificar</b> hasta que Iberian envía la comisión <b>definitiva</b> y el reparto del <b>85 % cedido</b> entre sus sociedades. Mayrit <b>retiene el 15 %</b>.</li>
        </ul>
        <Regla>
          En los recibos de comisiones de Iberian, el <b>Mercado</b> es siempre
          <b> «Iberian Insurance Group, S.L.»</b>.
        </Regla>
      </>
    ),
  },
  {
    id: "mercados",
    emoji: "🏦",
    titulo: "Mercados: alias vs nombre",
    cuerpo: (
      <>
        <p>Cada mercado tiene un <b>nombre canónico</b> y un <b>alias</b> corto (p. ej. nombre «Liberty Specialty Markets», alias «LSM»).</p>
        <Regla>
          En los recibos se guarda siempre el <b>nombre canónico</b> del mercado, no el alias
          (p. ej. «Axeria» → «Axeria Iard, S.L.»).
        </Regla>
      </>
    ),
  },
  {
    id: "cierre",
    emoji: "🔒",
    titulo: "Cierre contable",
    cuerpo: (
      <>
        <ul>
          <li>El cierre mensual <b>cierra un (año, mes)</b> por <b>Fecha Contable</b>: sus recibos pasan a <b>Contabilizado</b> y quedan bloqueados.</li>
          <li>No se pueden <b>crear ni imputar</b> recibos en un mes ya cerrado (hay que elegir un mes abierto).</li>
          <li>Para corregir algo de un mes cerrado, primero se <b>reabre</b> el recibo (descontabilizar).</li>
        </ul>
      </>
    ),
  },
];

export default function ManualPage() {
  function irA(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <div className="container manual-page">
      <PageHeader emoji="📖" title="Manual de uso" />
      <p className="manual-intro">
        Guía rápida de los flujos y reglas de la app que más se olvidan. Se irá ampliando.
      </p>
      <div className="manual-layout">
        <nav className="manual-toc">
          <div className="manual-toc-tit">Contenido</div>
          {SECCIONES.map((s) => (
            <button key={s.id} className="manual-toc-item" onClick={() => irA(s.id)}>
              <span className="manual-toc-emoji">{s.emoji}</span> {s.titulo}
            </button>
          ))}
        </nav>
        <div className="manual-content">
          {SECCIONES.map((s) => (
            <section key={s.id} id={s.id} className="manual-seccion">
              <h2 className="manual-seccion-tit">
                <span className="manual-seccion-emoji">{s.emoji}</span> {s.titulo}
              </h2>
              {s.cuerpo}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
