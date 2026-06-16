import { useState } from "react";

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
};

// Edición (estilo es-ES: coma decimal, sin miles) → canónica (punto decimal, sin miles).
function toCanonical(editing: string): string {
  return editing.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
}
// Canónica → edición (lo que se muestra al enfocar para teclear).
function toEditing(canonical: string): string {
  return canonical ? canonical.replace(".", ",") : "";
}
// Canónica → presentación formateada (es-ES) cuando el campo no está enfocado.
function formatDisplay(canonical: string, decimals: number, thousands: boolean): string {
  if (!canonical) return "";
  const n = Number(canonical);
  if (isNaN(n)) return canonical;
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: thousands,
  }).format(n);
}

export default function NumberInput({
  value,
  onChange,
  decimals = 2,
  thousands = true,
  suffix,
  placeholder,
  id,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [buf, setBuf] = useState("");

  const shown = focused ? buf : formatDisplay(value, decimals, thousands);

  return (
    <div className="num-input">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className="inp-num"
        placeholder={placeholder}
        value={shown}
        onFocus={() => {
          setBuf(toEditing(value));
          setFocused(true);
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.,-]/g, "");
          setBuf(raw);
          onChange(toCanonical(raw));
        }}
        onBlur={() => setFocused(false)}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </div>
  );
}
