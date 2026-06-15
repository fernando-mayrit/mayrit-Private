import { useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import TomadoresPage from "./pages/TomadoresPage";
import BindersPage from "./pages/BindersPage";

type Page = "productores" | "mercados" | "tomadores" | "binders";

const GRUPOS: { titulo: string; items: { id: Page; label: string }[] }[] = [
  {
    titulo: "Maestras",
    items: [
      { id: "productores", label: "Productores" },
      { id: "mercados", label: "Mercados" },
      { id: "tomadores", label: "Tomadores" },
    ],
  },
  {
    titulo: "Negocio",
    items: [{ id: "binders", label: "Binders" }],
  },
];

export default function App() {
  const [page, setPage] = useState<Page>("productores");

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="Mayrit" />
        </div>
        <div className="acento-naranja" />
        <nav className="sidebar-nav">
          {GRUPOS.map((g) => (
            <div className="nav-group" key={g.titulo}>
              <div className="nav-group-title">{g.titulo}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  className={"nav-item" + (page === it.id ? " active" : "")}
                  onClick={() => setPage(it.id)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="content">
        {page === "productores" && <ProductoresPage />}
        {page === "mercados" && <MercadosPage />}
        {page === "tomadores" && <TomadoresPage />}
        {page === "binders" && <BindersPage />}
      </main>
    </div>
  );
}
