import { useMemo } from "react";

// Accesos rápidos de la portada (id de página + etiqueta + emoji).
const ACCESOS: { id: string; label: string; emoji: string }[] = [
  { id: "binders", label: "Binders", emoji: "📑" },
  { id: "polizas", label: "Pólizas (OM)", emoji: "📄" },
  { id: "siniestros", label: "Siniestros", emoji: "🚨" },
  { id: "recibos", label: "Recibos", emoji: "🧾" },
  { id: "financiero", label: "Financiero", emoji: "💰" },
];

// Frases de bienvenida (se elige una al azar en cada entrada).
const FRASES = [
  "Hoy va a ser un gran día para cuadrar recibos. 💪",
  "Café en mano y a por el día. ☕",
  "Que los números cuadren a la primera. ✨",
  "Pólizas al día, mente tranquila. 🧘",
  "Un binder cada vez. Tú puedes. 🚀",
  "Que la prima te acompañe. 🪄",
  "Hoy también lo vas a bordar. 🌟",
  "Sonríe, que los siniestros son pocos. 😄",
  "Cada póliza, un cliente bien protegido. 🛡️",
  "Buenos acuerdos, mejores relaciones. 🤝",
  "A por un día de los que suman. 📈",
];

// Emoji + saludo según la hora del día.
function saludoDelDia(): { saludo: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 6) return { saludo: "Buenas noches", emoji: "🌙" };
  if (h < 13) return { saludo: "Buenos días", emoji: "☀️" };
  if (h < 21) return { saludo: "Buenas tardes", emoji: "🌤️" };
  return { saludo: "Buenas noches", emoji: "🌙" };
}

export default function Inicio({
  usuario,
  onIr,
  nAvisos = 0,
  onVerAvisos,
}: {
  usuario: string | null;
  onIr: (page: string) => void;
  nAvisos?: number;
  onVerAvisos?: () => void;
}) {
  const { saludo, emoji } = useMemo(saludoDelDia, []);
  const frase = useMemo(() => FRASES[Math.floor(Math.random() * FRASES.length)], []);
  const fecha = useMemo(
    () =>
      new Date().toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    []
  );
  const nombre = (usuario ?? "").split(/\s+/)[0]; // solo el nombre de pila

  return (
    <div className="inicio">
      <div className="inicio-hero">
        <div className="inicio-emoji" aria-hidden>
          {emoji}
        </div>
        <h1 className="inicio-saludo">
          {saludo}{nombre ? <>, <span className="inicio-nombre">{nombre}</span></> : ""} 👋
        </h1>
        <p className="inicio-fecha">{fecha.charAt(0).toUpperCase() + fecha.slice(1)}</p>
        <p className="inicio-frase">{frase}</p>
        <p className="inicio-bienvenida">
          Bienvenid@ a <b>Mayrit</b>. Que tengas un gran día. 🍀
        </p>
        {nAvisos > 0 && (
          <button className="inicio-avisos-chip" onClick={onVerAvisos}>
            🔔 Tienes {nAvisos} {nAvisos === 1 ? "tarea pendiente" : "tareas pendientes"}
          </button>
        )}
      </div>

      <div className="inicio-accesos">
        {ACCESOS.map((a) => (
          <button key={a.id} className="inicio-card" onClick={() => onIr(a.id)}>
            <span className="inicio-card-emoji">{a.emoji}</span>
            <span className="inicio-card-label">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
