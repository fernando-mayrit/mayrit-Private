import { useEffect, useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";
import PolizasPage from "./pages/PolizasPage";
import RecibosPage from "./pages/RecibosPage";
import CierreContablePage from "./pages/CierreContablePage";
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
  recibos: "🧾",
  polizas: "📄",
  consultoria: "💼",
  comisiones: "💶",
  ramos: "🏷️",
  cuentas: "🏧",
  usuarios: "👤",
  cierre: "🔒",
};

type Page =
  | "inicio"
  | "productores"
  | "mercados"
  | "tomadores"
  | "binders"
  | "recibos"
  | "polizas"
  | "consultoria"
  | "comisiones"
  | "ramos"
  | "cuentas"
  | "usuarios"
  | "cierre";

// Barra superior: las Maestras (las partes).
const MAESTRAS: { id: Page; label: string }[] = [
  { id: "productores", label: "Productores" },
  { id: "mercados", label: "Mercados" },
  { id: "tomadores", label: "Tomadores" },
];

// Menú lateral: el Negocio (las 4 fuentes principales).
const NEGOCIO: { id: Page; label: string }[] = [
  { id: "binders", label: "Binders" },
  { id: "polizas", label: "Pólizas (OM)" },
  { id: "consultoria", label: "Consultoría" },
  { id: "comisiones", label: "Comisiones" },
];

// Menú lateral: Facturación / Contabilidad (módulo propio, diferenciado del Negocio).
const FACTURACION: { id: Page; label: string }[] = [
  { id: "recibos", label: "Recibos" },
  { id: "cierre", label: "Cierre Contable" },
];

// Menú lateral: Configuración (catálogos compartidos).
const CONFIG: { id: Page; label: string }[] = [
  { id: "ramos", label: "Ramos" },
  { id: "cuentas", label: "Cuentas Bancarias" },
  { id: "usuarios", label: "Usuarios" },
];

export default function App() {
  const [page, setPage] = useState<Page>("inicio");

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
          onClick={() => setPage("inicio")}
        />
        <div className="sep" />
        <nav className="tabs">
          {MAESTRAS.map((t) => (
            <button
              key={t.id}
              className={"tab" + (page === t.id ? " active" : "")}
              onClick={() => setPage(t.id)}
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
            <div className="nav-group">
              <div className="nav-group-title">Negocio</div>
              {NEGOCIO.map((it) => (
                <button
                  key={it.id}
                  className={"nav-item" + (page === it.id ? " active" : "")}
                  onClick={() => setPage(it.id)}
                >
                  <span className="nav-emoji">{EMOJI[it.id]}</span>
                  {it.label}
                </button>
              ))}
            </div>
            <div className="nav-group">
              <div className="nav-group-title">Facturación</div>
              {FACTURACION.map((it) => (
                <button
                  key={it.id}
                  className={"nav-item" + (page === it.id ? " active" : "")}
                  onClick={() => setPage(it.id)}
                >
                  <span className="nav-emoji">{EMOJI[it.id]}</span>
                  {it.label}
                </button>
              ))}
            </div>
          </nav>
          <nav className="sidebar-nav sidebar-bottom">
            <div className="nav-group">
              <div className="nav-group-title">Configuración</div>
              {CONFIG.map((it) => (
                <button
                  key={it.id}
                  className={"nav-item nav-item-sm" + (page === it.id ? " active" : "")}
                  onClick={() => setPage(it.id)}
                >
                  <span className="nav-emoji">{EMOJI[it.id]}</span>
                  {it.label}
                </button>
              ))}
            </div>
          </nav>
        </aside>

        <main className="content">
          {page === "inicio" && <Inicio usuario={usuario} onIr={(p) => setPage(p as Page)} />}
          {page === "productores" && <ProductoresPage />}
          {page === "mercados" && <MercadosPage />}
          {page === "tomadores" && <TomadoresPage />}
          {page === "binders" && <BindersPage />}
          {page === "recibos" && <RecibosPage />}
          {page === "cierre" && <CierreContablePage />}
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
