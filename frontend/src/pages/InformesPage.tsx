import { useState } from "react";
import PageHeader from "../components/PageHeader";

// Informe de Power BI incrustado ("secure embed"). NO es un enlace público: el iframe exige que
// quien lo abra tenga sesión de Microsoft Y licencia Power BI Pro con permiso sobre el informe
// (por eso el ítem del menú está restringido en App.tsx). Si no, el propio iframe pide login.
//
// La URL sale de Power BI (app.powerbi.com) → informe → Archivo → Insertar informe → «Sitio web o
// portal». Para cambiar de informe, basta con sustituir el reportId de aquí abajo:
//   · reportId = el informe ("Mayrit"). Está en Mi área de trabajo (por eso no lleva groupId).
//   · ctid     = tenant de Alea (el mismo de SharePoint, SP_TENANT_ID).
//   · autoAuth = hereda la sesión del navegador → normalmente no pide login.
//   · actionBarEnabled = barra de Power BI dentro del marco (filtros, marcadores, pantalla completa).
// No es un secreto (sin permisos no se ve nada), así que va aquí y no en ~/.mayrit/.env: se
// mantiene solo en los dos equipos con un `git pull`, sin configurar nada en cada máquina.
const INFORME_URL =
  "https://app.powerbi.com/reportEmbed?reportId=54ede371-9f6e-459f-a3e1-87e0f8029b52" +
  "&autoAuth=true&ctid=1e9cd105-6264-462d-9fde-b42fe6883fda&actionBarEnabled=true";

export default function InformesPage() {
  const [cargando, setCargando] = useState(true);
  // Cambiar la `key` obliga a React a tirar el iframe y montar uno nuevo: así se vuelve a pedir el
  // informe a Power BI. OJO: esto RECARGA la vista (trae lo último PUBLICADO), no refresca el dato
  // (el dato se actualiza desde Power BI Desktop y se publica).
  const [recarga, setRecarga] = useState(0);

  return (
    <div className="container">
      <PageHeader emoji="📈" title="Power BI" />
      <div className="pbi-barra">
        <button
          className="btn btn-primary"
          onClick={() => { setCargando(true); setRecarga((n) => n + 1); }}
        >
          🔄 Recargar informe
        </button>
        <span className="hint">
          Trae la última versión publicada. Para actualizar los datos: Power BI Desktop → Actualizar → Publicar.
        </span>
      </div>
      <div className="pbi-marco">
        {cargando && <div className="loading">Cargando el informe…</div>}
        <iframe
          key={recarga}
          className="pbi-iframe"
          title="Mayrit — Power BI"
          src={INFORME_URL}
          allowFullScreen
          onLoad={() => setCargando(false)}
        />
      </div>
    </div>
  );
}
