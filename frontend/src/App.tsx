import { useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";
import PolizasPage from "./pages/PolizasPage";
import RecibosPage from "./pages/RecibosPage";
import RamosPage from "./pages/RamosPage";
import CuentasBancariasPage from "./pages/CuentasBancariasPage";
import EnConstruccion from "./components/EnConstruccion";

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
};

type Page =
  | "productores"
  | "mercados"
  | "tomadores"
  | "binders"
  | "recibos"
  | "polizas"
  | "consultoria"
  | "comisiones"
  | "ramos"
  | "cuentas";

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
];

// Menú lateral: Configuración (catálogos compartidos).
const CONFIG: { id: Page; label: string }[] = [
  { id: "ramos", label: "Ramos" },
  { id: "cuentas", label: "Cuentas Bancarias" },
];

export default function App() {
  const [page, setPage] = useState<Page>("productores");

  return (
    <div className="app">
      <header className="app-header">
        <img className="logo" src={logo} alt="Mayrit" />
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
          {page === "productores" && <ProductoresPage />}
          {page === "mercados" && <MercadosPage />}
          {page === "tomadores" && <TomadoresPage />}
          {page === "binders" && <BindersPage />}
          {page === "recibos" && <RecibosPage />}
          {page === "polizas" && <PolizasPage />}
          {page === "consultoria" && <EnConstruccion titulo="Consultoría (Fees)" />}
          {page === "comisiones" && <EnConstruccion titulo="Comisiones" />}
          {page === "ramos" && <RamosPage />}
          {page === "cuentas" && <CuentasBancariasPage />}
        </main>
      </div>
    </div>
  );
}
