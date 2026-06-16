import { useEffect, useRef, type ReactNode } from "react";

/**
 * Panel lateral estándar para alta/edición en toda la app.
 *
 * Reglas de cierre (válidas para TODOS los formularios):
 *  - Clic fuera del panel NO cierra.
 *  - Solo se cierra con "Cancelar" o la "✕" (o la tecla Esc).
 *  - Si hay cambios sin guardar (`dirty`), al cerrar avisa y pide confirmación.
 *
 * El botón "Guardar" y los campos los aporta cada pantalla; el cierre seguro
 * lo gestiona este componente para que el comportamiento sea uniforme.
 */
type Props = {
  title: string;
  dirty: boolean;
  saving?: boolean;
  saveLabel?: string;
  error?: string | null; // mensaje de validación/guardado; se muestra visible junto a los botones
  onSave: () => void;
  onClose: () => void; // se llama solo cuando el cierre está confirmado
  children: ReactNode;
};

export default function FormPanel({
  title,
  dirty,
  saving = false,
  saveLabel = "Guardar",
  error,
  onSave,
  onClose,
  children,
}: Props) {
  const errorRef = useRef<HTMLDivElement>(null);

  // Al aparecer un error, llevarlo a la vista (el panel puede estar desplazado).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [error]);
  function attemptClose() {
    if (saving) return;
    if (dirty && !confirm("Hay cambios sin guardar. ¿Seguro que quieres cerrar sin guardarlos?")) {
      return;
    }
    onClose();
  }

  // Tecla Esc = intentar cerrar (con el mismo aviso si hay cambios).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") attemptClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  return (
    // El overlay NO cierra al hacer clic: es intencionado.
    <div className="overlay">
      <div className="panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="panel-close" onClick={attemptClose} aria-label="Cerrar" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="panel-body">{children}</div>

        {error && (
          <div className="panel-error" ref={errorRef} role="alert">
            ⚠ {error}
          </div>
        )}

        <div className="panel-actions">
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Guardando…" : saveLabel}
          </button>
          <button className="btn-secondary" onClick={attemptClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
