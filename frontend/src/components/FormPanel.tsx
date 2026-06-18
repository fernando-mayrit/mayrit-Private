import { useEffect, useRef, useState, type ReactNode } from "react";
import ConfirmDialog from "./ConfirmDialog";

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
  saveDisabled?: boolean; // deshabilita "Guardar" (p. ej. faltan datos obligatorios)
  error?: string | null; // mensaje de validación/guardado; se muestra visible junto a los botones
  onSave: () => void;
  onClose: () => void; // se llama solo cuando el cierre está confirmado
  onDelete?: () => void; // si se pasa, muestra "Borrar" dentro del panel (normalmente solo al editar)
  deleteLabel?: string;
  readOnly?: boolean; // solo consulta: oculta Guardar/Borrar y "Cancelar" pasa a "Cerrar"
  wide?: boolean; // panel ancho (p. ej. el modal de recibo con varias columnas)
  escEnabled?: boolean; // si false, ignora la tecla Esc (útil al apilar otro panel encima)
  children: ReactNode;
};

export default function FormPanel({
  title,
  dirty,
  saving = false,
  saveLabel = "Guardar",
  saveDisabled = false,
  error,
  onSave,
  onClose,
  onDelete,
  deleteLabel = "Borrar",
  readOnly = false,
  wide = false,
  escEnabled = true,
  children,
}: Props) {
  const errorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmCerrar, setConfirmCerrar] = useState(false);

  // Al aparecer un error, llevarlo a la vista (el panel puede estar desplazado).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [error]);

  // Focus-trap: el tabulador circula dentro del panel (solo el panel activo; si hay otro
  // apilado encima, escEnabled=false y este no atrapa). Evita que el foco se escape a la página.
  useEffect(() => {
    if (!escEnabled || confirmCerrar) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const sel =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      // Visible = tiene caja (getClientRects); offsetParent falla dentro de overlays position:fixed.
      const list = Array.from(panelRef.current.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => el.getClientRects().length > 0
      );
      if (list.length === 0) return;
      // Movemos el foco SIEMPRE nosotros (no dependemos del orden por defecto del navegador,
      // que dentro del overlay se escapa del modal).
      e.preventDefault();
      const idx = list.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.shiftKey) next = idx <= 0 ? list.length - 1 : idx - 1;
      else next = idx === -1 || idx === list.length - 1 ? 0 : idx + 1;
      list[next].focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escEnabled, confirmCerrar]);
  function attemptClose() {
    if (saving) return;
    if (dirty) {
      setConfirmCerrar(true); // aviso contundente (ConfirmDialog), no el confirm() nativo
      return;
    }
    onClose();
  }

  // Tecla Esc = intentar cerrar (con el mismo aviso si hay cambios).
  useEffect(() => {
    if (!escEnabled || confirmCerrar) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") attemptClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, escEnabled, confirmCerrar]);

  return (
    // El overlay NO cierra al hacer clic: es intencionado.
    <div className="overlay">
      <div ref={panelRef} className={"panel" + (wide ? " panel-wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
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
          {!readOnly && onDelete && (
            <button className="btn-danger" onClick={onDelete} disabled={saving}>
              {deleteLabel}
            </button>
          )}
          <div className="panel-actions-right">
            {!readOnly && (
              <button className="btn-primary" onClick={onSave} disabled={saving || saveDisabled}>
                {saving ? "Guardando…" : saveLabel}
              </button>
            )}
            <button className="btn-secondary" onClick={attemptClose} disabled={saving}>
              {readOnly ? "Cerrar" : "Cancelar"}
            </button>
          </div>
        </div>
      </div>

      {confirmCerrar && (
        <ConfirmDialog
          titulo="Cambios sin guardar"
          mensaje="Hay cambios sin guardar en este formulario."
          detalle="Si sales ahora, se perderán y no se podrán recuperar."
          confirmLabel="Salir sin guardar"
          onConfirm={() => { setConfirmCerrar(false); onClose(); }}
          onClose={() => setConfirmCerrar(false)}
        />
      )}
    </div>
  );
}
