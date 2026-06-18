import { useState } from "react";
import type { Usuario } from "../types";

// Selector "¿Quién eres?" — autologin por equipo con respaldo de selección manual.
export default function LoginUsuario({
  usuarios,
  actual,
  onElegir,
  onClose,
}: {
  usuarios: Usuario[];
  actual: string | null;
  onElegir: (nombre: string) => void;
  onClose?: () => void; // si se puede cancelar (ya hay un usuario activo)
}) {
  const [sel, setSel] = useState(actual ?? "");

  return (
    <div className="overlay">
      <div className="panel panel-confirm" role="dialog" aria-modal="true" aria-label="¿Quién eres?">
        <div className="confirm-head">
          <span className="confirm-icon">👤</span>
          <h2>¿Quién eres?</h2>
        </div>
        <div className="confirm-body">
          {usuarios.length === 0 ? (
            <div className="hint">
              No hay usuarios dados de alta. Crea usuarios en <b>Configuración → Usuarios</b>.
            </div>
          ) : (
            <div className="field">
              <label>Usuario</label>
              <select value={sel} onChange={(e) => setSel(e.target.value)} autoFocus>
                <option value="">— Elige usuario —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.nombre}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="panel-actions">
          {onClose && (
            <button className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
          )}
          <button className="btn-primary" disabled={!sel} onClick={() => sel && onElegir(sel)}>
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
}
