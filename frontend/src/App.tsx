import { useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";

type Page = "productores" | "mercados" | "tomadores" | "binders";

// Barra superior: las Maestras (las partes).
const MAESTRAS: { id: Page; label: string }[] = [
  { id: "productores", label: "Productores" },
  { id: "mercados", label: "Mercados" },
  { id: "tomadores", label: "Tomadores" },
];

// Menú lateral: el Negocio (núcleo; de aquí colgarán BDX, Liquidaciones, etc.).
const NEGOCIO: { id: Page; label: string }[] = [{ id: "binders", label: "Binders" }];

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
        </main>
      </div>
    </div>
  );
}
