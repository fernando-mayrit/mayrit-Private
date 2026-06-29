import { useState } from "react";
import { fmtMiles } from "../format";

/**
 * Campo numérico ESTÁNDAR de la app: alineado a la derecha, con formato es-ES
 * (separador de miles y decimales fijos) cuando NO está enfocado, y edición cómoda
 * (coma decimal, sin miles) mientras se escribe.
 *
 * - `value` es la cadena CANÓNICA: punto decimal y sin separador de miles
 *   (p. ej. "1234567.89"; "" = vacío). Es lo que se guarda en el formulario.
 * - `suffix` opcional a la derecha (p. ej. "%").
 * - `thousands` separador de miles (por defecto sí; para % conviene `false`).
 */
type Props = {
  value: string;
  onChange: (canonical: string) => void;
  decimals?: number;
  thousands?: boolean;
  suffix?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
};

// Edición (es-ES) → canónica (punto decimal, sin miles). El PUNTO del teclado numérico se trata
// como coma decimal: el ÚLTIMO separador (coma o punto) es el decimal; los demás, agrupación.
function toCanonical(editing: string): string {
  let s = editing.replace(/\s/g, "").replace(/\./g, ",");   // el punto cuenta como coma
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const partes = s.split(",");
  const out = partes.length > 1 ? partes.slice(0, -1).join("") + "." + partes[partes.length - 1] : partes[0];
  return (neg ? "-" : "") + out;
}
// Canónica → edición (lo que se muestra al enfocar para teclear).
function toEditing(canonical: string): string {
  return canonical ? canonical.replace(".", ",") : "";
}
// Canónica → presentación formateada cuando el campo no está enfocado (formato único de la app).
function formatDisplay(canonical: string, decimals: number, thousands: boolean): string {
  return fmtMiles(canonical, decimals, thousands);
}

export default function NumberInput({
  value,
  onChange,
  decimals = 2,
  thousands = true,
  suffix,
  placeholder,
  id,
  className,
  disabled = false,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [buf, setBuf] = useState("");

  const shown = focused ? buf : formatDisplay(value, decimals, thousands);

  return (
    <div className={className ? `num-input ${className}` : "num-input"}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className="inp-num"
        placeholder={placeholder}
        value={shown}
        disabled={disabled}
        onFocus={() => {
          setBuf(toEditing(value));
          setFocused(true);
        }}
        onChange={(e) => {
          // El punto (incluido el del teclado numérico) se muestra y trata como coma decimal.
          const raw = e.target.value.replace(/[^0-9.,-]/g, "").replace(/\./g, ",");
          setBuf(raw);
          onChange(toCanonical(raw));
        }}
        onBlur={() => setFocused(false)}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </div>
  );
}
