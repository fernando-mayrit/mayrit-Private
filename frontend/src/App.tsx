import { useEffect, useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";
import ProgramasPage from "./pages/ProgramasPage";
import PolizasPage from "./pages/PolizasPage";
import RecibosPage from "./pages/RecibosPage";
import SiniestrosPage from "./pages/SiniestrosPage";
import TriangulacionPage from "./pages/TriangulacionPage";
import ConsultoriaPage from "./pages/ConsultoriaPage";
import ComisionesPage from "./pages/ComisionesPage";
import TareasPage from "./pages/TareasPage";
import LpanPage from "./pages/LpanPage";
import CierreContablePage from "./pages/CierreContablePage";
import ContabilidadPage from "./pages/ContabilidadPage";
import FinancieroPage from "./pages/FinancieroPage";
import TransferenciasPage from "./pages/TransferenciasPage";
import RamosPage from "./pages/RamosPage";
import CuentasBancariasPage from "./pages/CuentasBancariasPage";
import UsuariosPage from "./pages/UsuariosPage";
import EnConstruccion from "./components/EnConstruccion";
import Inicio from "./components/Inicio";
import LoginUsuario from "./components/LoginUsuario";
import { usuariosApi, usuarioEquipo, avisosApi, type Aviso, type AvisoNivel } from "./api";
import type { Usuario } from "./types";

const USUARIO_KEY = "mayrit.usuario";

// Iconos estilo Alea: emoji por opción.
const EMOJI: Record<string, string> = {
  productores: "🤝",
  mercados: "🏦",
  tomadores: "👥",
  binders: "📑",
  programas: "🔗",
  siniestros: "🚨",
  triangulacion: "🔺",
  ucr: "🔖",
  recibos: "🧾",
  polizas: "📄",
  consultoria: "💼",
  comisiones: "💶",
  tareas: "✅",
  ramos: "🏷️",
  cuentas: "🏧",
  usuarios: "👤",
  cierre: "🔒",
  lpan: "📐",
  financiero: "💰",
  transferencias: "🔁",
  contabilidad: "📒",
};

type Page =
  | "inicio"
  | "productores"
  | "mercados"
  | "tomadores"
  | "binders"
  | "programas"
  | "siniestros"
  | "triangulacion"
  | "ucr"
  | "recibos"
  | "lpan"
  | "polizas"
  | "consultoria"
  | "comisiones"
  | "tareas"
  | "ramos"
  | "cuentas"
  | "usuarios"
  | "cierre"
  | "financiero"
  | "transferencias"
  | "contabilidad";

// Barra superior: las Maestras (las partes).
const MAESTRAS: { id: Page; label: string }[] = [
  { id: "productores", label: "Productores" },
  { id: "mercados", label: "Mercados" },
  { id: "tomadores", label: "Tomadores" },
  { id: "programas", label: "Programas" },
];

// Menú lateral: el Negocio (las 4 fuentes principales).
const NEGOCIO: { id: Page; label: string }[] = [
  { id: "binders", label: "Binders" },
  { id: "polizas", label: "Pólizas" },
  { id: "consultoria", label: "Consultoría" },
  { id: "comisiones", label: "Comisiones" },
];

// Menú lateral: Tareas (tareas recurrentes manuales de los binders).
const TAREAS: { id: Page; label: string }[] = [
  { id: "tareas", label: "Tareas" },
];

// Menú lateral: Siniestros (Claims BDX de todos los binders).
const SINIESTROS: { id: Page; label: string }[] = [
  { id: "siniestros", label: "Siniestros" },
];

// Menú lateral: Triangulación (pendiente de configurar).
const TRIANGULACION: { id: Page; label: string }[] = [
  { id: "triangulacion", label: "Triangulaciones" },
];

// Menú lateral: UCR (Unique Claim Reference).
const UCR: { id: Page; label: string }[] = [
  { id: "ucr", label: "UCR" },
];

// Menú lateral: Facturación / Contabilidad (módulo propio, diferenciado del Negocio).
const FACTURACION: { id: Page; label: string }[] = [
  { id: "recibos", label: "Recibos" },
  { id: "lpan", label: "LPAN" },
];

// Menú lateral: Financiero / Caja (cuadros de pendientes de cobro/liquidación/traspaso/pago).
const FINANCIERO: { id: Page; label: string }[] = [
  { id: "financiero", label: "Financiero" },
  { id: "transferencias", label: "Transferencias" },
];

// Menú lateral: Contabilidad (solo Fernando y Lola).
type ItemMenu = { id: Page; label: string; soloUsuarios?: string[] };
const CONTABILIDAD: ItemMenu[] = [
  { id: "contabilidad", label: "Contabilidad" },
  { id: "cierre", label: "Cierre Contable" },
];

// Menú lateral: Configuración (catálogos compartidos).
const CONFIG: { id: Page; label: string }[] = [
  { id: "ramos", label: "Ramos" },
  { id: "cuentas", label: "Cuentas Bancarias" },
  { id: "usuarios", label: "Usuarios" },
];

// Grupos del menú lateral (desplegables/acordeón). El de Configuración va aparte, abajo del todo.
type Grupo = { titulo: string; items: ItemMenu[]; sm?: boolean; soloUsuarios?: string[] };
const GRUPOS: Grupo[] = [
  { titulo: "Negocio", items: NEGOCIO },
  { titulo: "Siniestros", items: [...SINIESTROS, ...TRIANGULACION, ...UCR] },
  { titulo: "Facturación", items: FACTURACION },
  { titulo: "Financiero", items: FINANCIERO },
  { titulo: "Contabilidad", items: CONTABILIDAD, soloUsuarios: ["Fernando", "Lola"] },
  { titulo: "Tareas", items: TAREAS },
];
// Páginas restringidas a ciertos usuarios (no aparecen en el menú ni se renderizan a los demás).
// Permitidos = restricción del grupo ∩ restricción del ítem (lo que no tiene restricción, lo ven todos).
const PAGINAS_RESTRINGIDAS: Record<string, string[]> = {};
for (const g of GRUPOS) {
  for (const it of g.items) {
    const gr = g.soloUsuarios, ir = it.soloUsuarios;
    if (!gr && !ir) continue;
    PAGINAS_RESTRINGIDAS[it.id] = gr && ir ? gr.filter((u) => ir.includes(u)) : (ir ?? gr ?? []);
  }
}
function NavGroup({
  grupo,
  page,
  usuario,
  colapsable = false,
  abierto = true,
  onToggle,
  onIr,
}: {
  grupo: Grupo;
  page: Page;
  usuario?: string | null;
  colapsable?: boolean;
  abierto?: boolean;
  onToggle?: () => void;
  onIr: (p: Page) => void;
}) {
  const mostrar = !colapsable || abierto;
  // Ítems visibles para este usuario (algunos ítems están restringidos, p. ej. Presupuesto → Fernando).
  const items = grupo.items.filter((it) => !it.soloUsuarios || it.soloUsuarios.includes(usuario ?? ""));
  return (
    <div className={"nav-group" + (colapsable && !abierto ? " nav-group-cerrado" : "")}>
      {colapsable ? (
        <button className="nav-group-title nav-group-title-btn" onClick={onToggle} aria-expanded={abierto}>
          <span className="nav-chevron">{abierto ? "▾" : "▸"}</span>
          {grupo.titulo}
        </button>
      ) : (
        <div className="nav-group-title">{grupo.titulo}</div>
      )}
      {mostrar &&
        items.map((it) => (
          <button
            key={it.id}
            className={
              "nav-item" + (grupo.sm ? " nav-item-sm" : "") + (page === it.id ? " active" : "")
            }
            onClick={() => onIr(it.id)}
          >
            <span className="nav-emoji">{EMOJI[it.id]}</span>
            {it.label}
          </button>
        ))}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("inicio");
  // Cambia en cada clic del menú; sirve de `key` del contenido para REMONTAR la página, también al
  // re-pulsar la página activa (así "Binders" desde dentro de un binder vuelve a la lista).
  const [navKey, setNavKey] = useState(0);

  function ir(p: Page) {
    setPage(p);
    setNavKey((k) => k + 1);
  }
  // ¿El usuario actual puede ver esta página? (páginas restringidas a ciertos usuarios)
  const puedeVer = (p: string) => {
    const permitidos = PAGINAS_RESTRINGIDAS[p];
    return !permitidos || permitidos.includes(usuario ?? "");
  };

  // Identificación de usuario (sin contraseña): autologin por equipo + selector.
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [listoUsuario, setListoUsuario] = useState(false);

  useEffect(() => {
    (async () => {
      let activos: Usuario[] = [];
      try {
        const todos = await usuariosApi.list(undefined, 5000);
        activos = todos.filter((u) => u.activa);
        setUsuarios(activos);
      } catch {
        /* sin backend: se queda sin lista */
      }
      const nombres = activos.map((u) => u.nombre);
      const guardado = localStorage.getItem(USUARIO_KEY);
      if (guardado && nombres.includes(guardado)) {
        setUsuario(guardado);
      } else {
        // Autologin por equipo (MAYRIT_USUARIO del .env).
        try {
          const eq = await usuarioEquipo();
          if (eq.nombre && nombres.includes(eq.nombre)) {
            setUsuario(eq.nombre);
            localStorage.setItem(USUARIO_KEY, eq.nombre);
          } else {
            setEligiendo(true);
          }
        } catch {
          setEligiendo(true);
        }
      }
      setListoUsuario(true);
    })();
  }, []);

  function elegirUsuario(nombre: string) {
    setUsuario(nombre);
    localStorage.setItem(USUARIO_KEY, nombre);
    setEligiendo(false);
  }

  // Avisos / tareas pendientes (dos campanas: 'Alertas' = temas gordos, 'Avisos' = rutina/día).
  // La categoría de cada tipo es configurable (se mueve de una campana a otra desde el ⚙️).
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [panelAviso, setPanelAviso] = useState<null | "alerta" | "dia">(null);
  const [verConfig, setVerConfig] = useState(false);
  const [configNiveles, setConfigNiveles] = useState(false);
  const [niveles, setNiveles] = useState<AvisoNivel[]>([]);
  function cargarAvisos() {
    avisosApi.listar().then(setAvisos).catch(() => { /* sin backend: sin avisos */ });
  }
  function abrirConfigNiveles() {
    setConfigNiveles(true);
    avisosApi.niveles().then(setNiveles).catch(() => setNiveles([]));
  }
  async function cambiarNivel(tipo: string, nivel: string) {
    setNiveles((ns) => ns.map((n) => (n.tipo === tipo ? { ...n, nivel } : n)));
    try { await avisosApi.fijarNivel(tipo, nivel); cargarAvisos(); } catch { /* noop */ }
  }
  async function cambiarCategoria(tipo: string, categoria: string) {
    setNiveles((ns) => ns.map((n) => (n.tipo === tipo ? { ...n, categoria } : n)));
    try { await avisosApi.fijarCategoria(tipo, categoria); cargarAvisos(); } catch { /* noop */ }
  }
  useEffect(() => {
    cargarAvisos();
  }, [page]);

  // Si el usuario actual no puede ver la página activa (módulo restringido), vuelve a Inicio.
  useEffect(() => {
    if (!puedeVer(page)) setPage("inicio");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, usuario]);

  // Cerrar el desplegable de Configuración al hacer clic fuera de él.
  useEffect(() => {
    if (!verConfig) return;
    const cerrar = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".header-config")) setVerConfig(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [verConfig]);

  // Auto-refresco de avisos SIN recargar la página: cada 60 s y al volver a la pestaña/ventana.
  useEffect(() => {
    const id = setInterval(cargarAvisos, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") cargarAvisos(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", cargarAvisos);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", cargarAvisos);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Avisos partidos en dos cubos por categoría, y helpers de render compartidos por los 3 modos.
  const avAlerta = avisos.filter((a) => a.categoria === "alerta");
  const avDia = avisos.filter((a) => a.categoria !== "alerta");
  const hayAlto = (xs: Aviso[]) => xs.some((a) => a.nivel === "alto");
  const abrirPanel = (p: "alerta" | "dia") => { cargarAvisos(); setPanelAviso((x) => (x === p ? null : p)); };
  // Ordena los avisos por Binder (UMR); los que no van ligados a un binder (p. ej. facturas de
  // Consultoría) al final. Desempate: importancia (alto→bajo) y luego título.
  const NIVEL_ORD: Record<string, number> = { alto: 0, medio: 1, bajo: 2 };
  const ordenarPorBinder = (xs: Aviso[]) =>
    [...xs].sort((a, b) => {
      if (!!a.umr !== !!b.umr) return a.umr ? -1 : 1;   // los que no tienen binder, al final
      const c = (a.umr ?? "").localeCompare(b.umr ?? "", "es", { numeric: true });
      if (c !== 0) return c;
      const nv = (NIVEL_ORD[a.nivel] ?? 9) - (NIVEL_ORD[b.nivel] ?? 9);
      return nv !== 0 ? nv : a.titulo.localeCompare(b.titulo, "es");
    });
  const renderLista = (xs: Aviso[]) =>
    xs.length === 0 ? (
      <div className="avisos-vacio">Sin avisos 🎉</div>
    ) : (
      <div className="avisos-lista">
        {ordenarPorBinder(xs).map((a, i) => (
          <button key={i} className={`aviso-item nivel-borde-${a.nivel}`}
            onClick={() => { if (a.pagina) ir(a.pagina as Page); setPanelAviso(null); }}>
            <span className="aviso-titulo"><span className={`nivel-dot nivel-${a.nivel}`} /> {a.titulo}</span>
            <span className="aviso-detalle">{a.detalle}</span>
          </button>
        ))}
      </div>
    );
  const renderConfig = () => (
    <div className="aviso-niveles">
      <p className="hint" style={{ padding: "8px 14px 4px" }}>Importancia (semáforo) y campana de cada aviso:</p>
      {niveles.map((n) => (
        <div key={n.tipo} className="aviso-nivel-fila">
          <span className="aviso-nivel-et">{n.etiqueta}</span>
          <span className="aviso-nivel-sel">
            {(["alto", "medio", "bajo"] as const).map((lv) => (
              <button key={lv} className={`nivel-dot nivel-${lv} ${n.nivel === lv ? "nivel-on" : ""}`}
                title={`Importancia: ${lv}`} onClick={() => cambiarNivel(n.tipo, lv)} />
            ))}
            <button className={`aviso-cat-toggle aviso-cat-${n.categoria}`}
              title="Cambiar de campana (Alertas ↔ Avisos)"
              onClick={() => cambiarCategoria(n.tipo, n.categoria === "dia" ? "alerta" : "dia")}>
              {n.categoria === "dia" ? "📋 Avisos" : "🔔 Alertas"}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
  const popHead = (titulo: string, n: number) => (
    <div className="avisos-pop-head">
      <span>{titulo} ({n})</span>
      <button className="btn-link aviso-config-btn" onClick={() => (configNiveles ? setConfigNiveles(false) : abrirConfigNiveles())}>⚙️ Configurar</button>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <img
          className="logo"
          src={logo}
          alt="Mayrit"
          style={{ cursor: "pointer" }}
          title="Inicio"
          onClick={() => ir("inicio")}
        />
        <div className="sep" />
        <nav className="tabs">
          {MAESTRAS.map((t) => (
            <button
              key={t.id}
              className={"tab" + (page === t.id ? " active" : "")}
              onClick={() => ir(t.id)}
            >
              <span className="nav-emoji">{EMOJI[t.id]}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-avisos">
          {/* 🔔 Alertas (temas gordos, se balancea si hay nivel alto) + 📋 Avisos (rutina/día) */}
          <button className={`campana${hayAlto(avAlerta) ? " campana-alerta" : ""}`}
            title="Alertas (temas importantes)" onClick={() => abrirPanel("alerta")}>
            🔔{avAlerta.length > 0 && (
              <span className={`campana-badge${hayAlto(avAlerta) ? " campana-badge-alto" : ""}`}>{avAlerta.length}</span>
            )}
          </button>
          <button className="campana campana-dia" title="Avisos (del día)" onClick={() => abrirPanel("dia")}>
            📋{avDia.length > 0 && <span className="campana-badge campana-badge-dia">{avDia.length}</span>}
          </button>
          {panelAviso === "alerta" && (
            <div className="avisos-pop">
              {popHead("Alertas", avAlerta.length)}
              {configNiveles ? renderConfig() : renderLista(avAlerta)}
            </div>
          )}
          {panelAviso === "dia" && (
            <div className="avisos-pop avisos-pop-dia">
              {popHead("Avisos", avDia.length)}
              {configNiveles ? renderConfig() : renderLista(avDia)}
            </div>
          )}
        </div>
        <div className="header-config">
          <button
            className={"header-config-btn" + (CONFIG.some((c) => c.id === page) ? " active" : "")}
            title="Configuración"
            onClick={() => setVerConfig((v) => !v)}
          >
            ⚙️ Configuración <span className="header-config-chevron">{verConfig ? "▴" : "▾"}</span>
          </button>
          {verConfig && (
            <div className="config-pop">
              {CONFIG.map((it) => (
                <button
                  key={it.id}
                  className={"config-item" + (page === it.id ? " active" : "")}
                  onClick={() => { ir(it.id); setVerConfig(false); }}
                >
                  <span className="nav-emoji">{EMOJI[it.id]}</span>
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="header-user">
          <span>👤 {usuario ?? "—"}</span>
          <button className="btn-link" onClick={() => setEligiendo(true)}>
            cambiar
          </button>
        </div>
      </header>
      <div className="acento-naranja" />

      <div className="body">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            {GRUPOS.filter((g) => !g.soloUsuarios || g.soloUsuarios.includes(usuario ?? "")).map((g) => (
              <NavGroup key={g.titulo} grupo={g} page={page} usuario={usuario} onIr={ir} />
            ))}
          </nav>
        </aside>

        <main className="content" key={navKey}>
          {page === "inicio" && <Inicio usuario={usuario} onIr={(p) => ir(p as Page)} alertas={avAlerta} nAvisosDia={avDia.length} />}
          {page === "productores" && <ProductoresPage />}
          {page === "mercados" && <MercadosPage />}
          {page === "tomadores" && <TomadoresPage />}
          {page === "binders" && <BindersPage />}
          {page === "programas" && <ProgramasPage />}
          {page === "recibos" && <RecibosPage />}
          {page === "lpan" && <LpanPage />}
          {page === "siniestros" && <SiniestrosPage />}
          {page === "tareas" && <TareasPage />}
          {page === "triangulacion" && <TriangulacionPage />}
          {page === "ucr" && <EnConstruccion titulo="UCR" />}
          {page === "cierre" && <CierreContablePage />}
          {page === "financiero" && <FinancieroPage />}
          {page === "transferencias" && <TransferenciasPage />}
          {page === "contabilidad" && puedeVer("contabilidad") && <ContabilidadPage />}
          {page === "polizas" && <PolizasPage />}
          {page === "consultoria" && <ConsultoriaPage />}
          {page === "comisiones" && <ComisionesPage />}
          {page === "ramos" && <RamosPage />}
          {page === "cuentas" && <CuentasBancariasPage />}
          {page === "usuarios" && <UsuariosPage />}
        </main>
      </div>

      {listoUsuario && eligiendo && (
        <LoginUsuario
          usuarios={usuarios}
          actual={usuario}
          onElegir={elegirUsuario}
          onClose={usuario ? () => setEligiendo(false) : undefined}
        />
      )}
    </div>
  );
}
