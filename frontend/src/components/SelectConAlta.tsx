import { useEffect, useRef, useState } from "react";

export type Opcion = { value: string; label: string };

/**
 * Desplegable con buscador + botón "+" para dar de alta un elemento nuevo.
 * Guarda un string (el `value` de la opción elegida). Permite mostrar un valor
 * previo aunque no esté en la lista (p. ej. datos antiguos en texto libre).
 */
export default function SelectConAlta({
  label,
  value,
  options,
  onChange,
  onAdd,
  required = false,
  placeholder = "— Elige o escribe para buscar —",
  addTitle = "Dar de alta uno nuevo",
}: {
  label: string;
  value: string;
  options: Opcion[];
  onChange: (v: string) => void;
  onAdd: () => void;
  required?: boolean;
  placeholder?: string;
  addTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtradas = (query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options
  ).slice(0, 50);

  return (
    <div className="field">
      <label>
        {label} {required && <span className="required">*</span>}
      </label>
      <div className="combo-row" ref={ref}>
        <div className="combo">
          <input
            type="text"
            value={open ? query : value}
            placeholder={placeholder}
            onFocus={() => {
              setQuery("");
              setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            // Al salir del campo (tabular/clic fuera) se cierra el desplegable. El clic en una
            // opción usa onMouseDown, que se dispara antes del blur, así que la selección no se pierde.
            onBlur={() => setOpen(false)}
          />
          {open && (
            <ul className="combo-list">
              {filtradas.length === 0 ? (
                <li className="combo-empty">Sin resultados · usa “+” para crear</li>
              ) : (
                filtradas.map((o) => (
                  <li
                    key={o.value}
                    className={o.value === value ? "sel" : ""}
                    // onMouseDown (no onClick): se dispara antes del blur del input.
                    onMouseDown={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <button type="button" className="btn-add" title={addTitle} onClick={onAdd}>
          +
        </button>
      </div>
    </div>
  );
}
