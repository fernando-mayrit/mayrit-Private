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
import CierreContablePage from "./pages/CierreContablePage";
import FinancieroPage from "./pages/FinancieroPage";
import RamosPage from "./pages/RamosPage";
import CuentasBancariasPage from "./pages/CuentasBancariasPage";
import UsuariosPage from "./pages/UsuariosPage";
import EnConstruccion from "./components/EnConstruccion";
import Inicio from "./components/Inicio";
import LoginUsuario from "./components/LoginUsuario";
import { usuariosApi, usuarioEquipo } from "./api";
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
  ramos: "🏷️",
  cuentas: "🏧",
  usuarios: "👤",
  cierre: "🔒",
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
  | "polizas"
  | "consultoria"
  | "comisiones"
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
  { id: "polizas", label: "Pólizas (OM)" },
  { id: "consultoria", label: "Consultoría" },
  { id: "comisiones", label: "Comisiones" },
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
];
const GRUPO_CONFIG: Grupo = { titulo: "Configuración", items: CONFIG, sm: true };
const MENU_KEY = "mayrit.menu";

// Título del grupo que contiene una página (para abrirlo automáticamente al navegar).
function grupoDe(p: Page): string | undefined {
  return [...GRUPOS, GRUPO_CONFIG].find((g) => g.items.some((it) => it.id === p))?.titulo;
}

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

  // Estado abierto/cerrado de cada grupo del menú (persistido). Por defecto sólo se abre el grupo
  // de la página activa; el resto, plegados para ahorrar espacio.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(MENU_KEY) || "{}");
    } catch {
      return {};
    }
  });
  function guardarAbiertos(next: Record<string, boolean>) {
    setAbiertos(next);
    try {
      localStorage.setItem(MENU_KEY, JSON.stringify(next));
    } catch {
      /* sin localStorage: no se persiste */
    }
  }
  function esAbierto(titulo: string): boolean {
    return titulo in abiertos ? abiertos[titulo] : grupoDe(page) === titulo;
  }
  function toggleGrupo(titulo: string) {
    guardarAbiertos({ ...abiertos, [titulo]: !esAbierto(titulo) });
  }
  // Navegar: abre (y deja abierto) el grupo de la página destino para no ocultar el ítem activo.
  function ir(p: Page) {
    setPage(p);
    const t = grupoDe(p);
    if (t) guardarAbiertos({ ...abiertos, [t]: true });
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
          <nav className="sidebar-nav sidebar-bottom">
            <NavGroup
              grupo={GRUPO_CONFIG}
              page={page}
              colapsable
              abierto={esAbierto(GRUPO_CONFIG.titulo)}
              onToggle={() => toggleGrupo(GRUPO_CONFIG.titulo)}
              onIr={ir}
            />
          </nav>
        </aside>

        <main className="content">
          {page === "inicio" && <Inicio usuario={usuario} onIr={(p) => ir(p as Page)} />}
          {page === "productores" && <ProductoresPage />}
          {page === "mercados" && <MercadosPage />}
          {page === "tomadores" && <TomadoresPage />}
          {page === "binders" && <BindersPage />}
          {page === "programas" && <ProgramasPage />}
          {page === "recibos" && <RecibosPage />}
          {page === "siniestros" && <SiniestrosPage />}
          {page === "triangulacion" && <TriangulacionPage />}
          {page === "ucr" && <EnConstruccion titulo="UCR" />}
          {page === "cierre" && <CierreContablePage />}
          {page === "financiero" && <FinancieroPage />}
          {page === "transferencias" && <EnConstruccion titulo="Transferencias" />}
          {page === "contabilidad" && <EnConstruccion titulo="Contabilidad" />}
          {page === "polizas" && <PolizasPage />}
          {page === "consultoria" && <EnConstruccion titulo="Consultoría (Fees)" />}
          {page === "comisiones" && <EnConstruccion titulo="Comisiones" />}
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
