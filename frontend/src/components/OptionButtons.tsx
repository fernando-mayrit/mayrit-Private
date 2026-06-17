/**
 * Selector de una sola opción en forma de botones (tipo radio).
 * Reutilizable en cualquier formulario (p. ej. "Tipo de mercado", "Tipo de productor").
 */
type Props = {
  value: string | null | undefined;
  options: string[];
  onChange: (v: string) => void;
  vertical?: boolean;
  disabled?: boolean;
};

export default function OptionButtons({ value, options, onChange, vertical = false, disabled = false }: Props) {
  return (
    <div className={"optbtns" + (vertical ? " vertical" : "")} role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          role="radio"
          aria-checked={value === o}
          className={"optbtn" + (value === o ? " sel" : "")}
          onClick={() => onChange(o)}
          disabled={disabled}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
