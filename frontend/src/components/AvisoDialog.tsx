import { type ReactNode } from "react";

// Aviso modal (información / advertencia / error) con un solo botón "Aceptar". Sustituye al alert()
// nativo del navegador: mismo estilo que la app, centrado e imposible de ignorar. Se cierra con el
// botón o pulsando fuera. Reutiliza las clases de ConfirmDialog para no duplicar estilos.
export default function AvisoDialog({
  titulo,
  mensaje,
  icono = "⚠️",
  cerrarLabel = "Aceptar",
  onClose,
}: {
  titulo: string;
  mensaje: ReactNode;
  icono?: string;          // ⚠️ advertencia (defecto), ℹ️ info, ✅ ok, ⛔ error…
  cerrarLabel?: string;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="panel panel-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          <span className="confirm-icon">{icono}</span>
          <h2>{titulo}</h2>
        </div>
        <div className="confirm-body">
          <div>{mensaje}</div>
        </div>
        <div className="panel-actions">
          <button className="btn-primary" onClick={onClose} autoFocus>
            {cerrarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
