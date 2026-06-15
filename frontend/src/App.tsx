import { useState } from "react";
import logo from "./assets/mayrit-logo.png";
import MercadosPage from "./pages/MercadosPage";
import ProductoresPage from "./pages/ProductoresPage";
import BindersPage from "./pages/BindersPage";

type Page = "productores" | "mercados" | "binders";

const TABS: { id: Page; label: string }[] = [
  { id: "productores", label: "Productores" },
  { id: "mercados", label: "Mercados" },
  { id: "binders", label: "Binders" },
];

export default function App() {
  const [page, setPage] = useState<Page>("productores");

  return (
    <>
      <header className="app-header">
        <img className="logo" src={logo} alt="Mayrit" />
        <div className="sep" />
        <nav className="tabs">
          {TABS.map((t) => (
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

      {page === "productores" && <ProductoresPage />}
      {page === "mercados" && <MercadosPage />}
      {page === "binders" && <BindersPage />}
    </>
  );
}
