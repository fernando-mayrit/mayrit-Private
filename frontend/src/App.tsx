import MercadosPage from "./pages/MercadosPage";
import logo from "./assets/mayrit-logo.png";

export default function App() {
  return (
    <>
      <header className="app-header">
        <img className="logo" src={logo} alt="Mayrit" />
        <div className="sep" />
        <span className="subtitulo">Maestras · Mercados</span>
      </header>
      <div className="acento-naranja" />
      <MercadosPage />
    </>
  );
}
