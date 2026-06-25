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
  { id: "cierre", label: "Cierre Contable" },
];

// Menú lateral: Financiero / Caja (cuadros de pendientes de cobro/liquidación/traspaso/pago).
const FINANCIERO: { id: Page; label: string }[] = [
  { id: "financiero", label: "Financiero" },
  { id: "transferencias", label: "Transferencias" },
];

// Menú lateral: Contabilidad (pendiente de configurar).
const CONTABILIDAD: { id: Page; label: string }[] = [
  { id: "contabilidad", label: "Contabilidad" },
];

// Menú lateral: Configuración (catálogos compartidos).
const CONFIG: { id: Page; label: string }[] = [
  { id: "ramos", label: "Ramos" },
  { id: "cuentas", label: "Cuentas Bancarias" },
  { id: "usuarios", label: "Usuarios" },
];

// Grupos del menú lateral (desplegables/acordeón). El de Configuración va aparte, abajo del todo.
type Grupo = { titulo: string; items: { id: Page; label: string }[]; sm?: boolean };
const GRUPOS: Grupo[] = [
  { titulo: "Negocio", items: NEGOCIO },
  { titulo: "Siniestros", items: [...SINIESTROS, ...TRIANGULACION, ...UCR] },
  { titulo: "Facturación", items: FACTURACION },
  { titulo: "Financiero", items: FINANCIERO },
  { titulo: "Contabilidad", items: CONTABILIDAD },
  { titulo: "Tareas", items: TAREAS },
];
function NavGroup({
  grupo,
  page,
  colapsable = false,
  abierto = true,
  onToggle,
  onIr,
}: {
  grupo: Grupo;
  page: Page;
  colapsable?: boolean;
  abierto?: boolean;
  onToggle?: () => void;
  onIr: (p: Page) => void;
}) {
  const mostrar = !colapsable || abierto;
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
        grupo.items.map((it) => (
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

  function ir(p: Page) {
    setPage(p);
  }

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

  // Avisos / tareas pendientes (campana + panel de Inicio). Se recargan al navegar.
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [verAvisos, setVerAvisos] = useState(false);
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
  useEffect(() => {
    cargarAvisos();
  }, [page]);

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
          <button
            className={`campana${avisos.some((a) => a.nivel === "alto") ? " campana-alerta" : ""}`}
            title="Avisos / tareas pendientes"
            onClick={() => { if (!verAvisos) cargarAvisos(); setVerAvisos((v) => !v); }}
          >
            🔔{avisos.length > 0 && (
              <span className={`campana-badge${avisos.some((a) => a.nivel === "alto") ? " campana-badge-alto" : ""}`}>
                {avisos.length}
              </span>
            )}
          </button>
          {verAvisos && (
            <div className="avisos-pop">
              <div className="avisos-pop-head">
                Tareas pendientes ({avisos.length})
                <button className="btn-link aviso-config-btn" onClick={() => (configNiveles ? setConfigNiveles(false) : abrirConfigNiveles())}>
                  ⚙️ Importancia
                </button>
              </div>
              {configNiveles ? (
                <div className="aviso-niveles">
                  <p className="hint" style={{ padding: "8px 14px 4px" }}>Nivel (semáforo) por tipo de aviso:</p>
                  {niveles.map((n) => (
                    <div key={n.tipo} className="aviso-nivel-fila">
                      <span className="aviso-nivel-et">{n.etiqueta}</span>
                      <span className="aviso-nivel-sel">
                        {(["alto", "medio", "bajo"] as const).map((lv) => (
                          <button
                            key={lv}
                            className={`nivel-dot nivel-${lv} ${n.nivel === lv ? "nivel-on" : ""}`}
                            title={lv}
                            onClick={() => cambiarNivel(n.tipo, lv)}
                          />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : avisos.length === 0 ? (
                <div className="avisos-vacio">Sin avisos 🎉</div>
              ) : (
                <div className="avisos-lista">
                  {avisos.map((a, i) => (
                    <button
                      key={i}
                      className={`aviso-item nivel-borde-${a.nivel}`}
                      onClick={() => { if (a.pagina) ir(a.pagina as Page); setVerAvisos(false); }}
                    >
                      <span className="aviso-titulo">
                        <span className={`nivel-dot nivel-${a.nivel}`} /> {a.titulo}
                      </span>
                      <span className="aviso-detalle">{a.detalle}</span>
                    </button>
                  ))}
                </div>
              )}
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
            {GRUPOS.map((g) => (
              <NavGroup key={g.titulo} grupo={g} page={page} onIr={ir} />
            ))}
          </nav>
        </aside>

        <main className="content">
          {page === "inicio" && <Inicio usuario={usuario} onIr={(p) => ir(p as Page)} nAvisos={avisos.length} onVerAvisos={() => setVerAvisos(true)} />}
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
          {page === "contabilidad" && <EnConstruccion titulo="Contabilidad" />}
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
