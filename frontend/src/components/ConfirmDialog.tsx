import { useState, type ReactNode } from "react";

// Diálogo de confirmación contundente para acciones sensibles (contabilidad/datos reales).
// `doble`=true exige DOS confirmaciones (dos pasos) antes de ejecutar.
export default function ConfirmDialog({
  titulo,
  mensaje,
  detalle,
  confirmLabel = "Confirmar",
  doble = false,
  onConfirm,
  onClose,
}: {
  titulo: string;
  mensaje: ReactNode;
  detalle?: ReactNode;       // consecuencia destacada (en rojo)
  confirmLabel?: string;
  doble?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [paso, setPaso] = useState(1);
  const enUltimoPaso = !doble || paso === 2;

  return (
    <div className="overlay">
      <div className="panel panel-confirm" role="alertdialog" aria-modal="true" aria-label={titulo}>
        <div className="confirm-head">
          <span className="confirm-icon">⚠️</span>
          <h2>{titulo}</h2>
        </div>
        <div className="confirm-body">
          <div>{mensaje}</div>
          {detalle && <div className="confirm-detalle">{detalle}</div>}
          {doble && paso === 2 && (
            <div className="confirm-warn">
              Última confirmación: esta acción afecta a datos contables reales y puede no ser
              reversible. ¿Seguro del todo?
            </div>
          )}
        </div>
        <div className="panel-actions">
          <button className="btn-secondary" onClick={onClose} autoFocus>
            Cancelar
          </button>
          {enUltimoPaso ? (
            <button className="btn-danger" onClick={onConfirm}>
              {doble ? "Sí, hacerlo definitivamente" : confirmLabel}
            </button>
          ) : (
            <button className="btn-danger" onClick={() => setPaso(2)}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
