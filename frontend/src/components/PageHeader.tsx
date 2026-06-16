/** Título de pantalla: emoji + nombre de lo que se está viendo, encima del buscador. */
export default function PageHeader({ emoji, title }: { emoji: string; title: string }) {
  return (
    <h1 className="page-title">
      <span className="page-title-emoji">{emoji}</span> {title}
    </h1>
  );
}
