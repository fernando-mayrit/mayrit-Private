export default function EnConstruccion({ titulo }: { titulo: string }) {
  return (
    <div className="container">
      <div className="empty">La pantalla de <strong>{titulo}</strong> está en construcción.</div>
    </div>
  );
}
