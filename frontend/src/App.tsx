import { useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";
import EnConstruccion from "./components/EnConstruccion";

type Page =
  | "productores"
  | "mercados"
  | "tomadores"
  | "binders"
  | "polizas"
  | "consultoria"
  | "comisiones";

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
          {page === "polizas" && <EnConstruccion titulo="Pólizas (Open Market)" />}
          {page === "consultoria" && <EnConstruccion titulo="Consultoría (Fees)" />}
          {page === "comisiones" && <EnConstruccion titulo="Comisiones" />}
        </main>
      </div>
    </div>
  );
}
