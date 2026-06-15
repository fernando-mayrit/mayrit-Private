// Iconos (línea, monocromos) para el menú lateral. Usan currentColor, así heredan el color del texto.
const base = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export default function Icono({ name }: { name: string }) {
  switch (name) {
    case "binders":
      return (
        <svg {...base}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="13" y2="16" />
        </svg>
      );
    case "polizas":
      return (
        <svg {...base}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <polyline points="14 3 14 8 19 8" />
        </svg>
      );
    case "consultoria":
      return (
        <svg {...base}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case "comisiones":
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9.5a3.5 3.5 0 1 0 0 5" />
          <line x1="7.5" y1="11" x2="13" y2="11" />
        </svg>
      );
    case "ramos":
      return (
        <svg {...base}>
          <path d="M20.6 13.4 11 3.8a2 2 0 0 0-1.4-.6H5a2 2 0 0 0-2 2v4.6a2 2 0 0 0 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );
    default:
      return null;
  }
}
