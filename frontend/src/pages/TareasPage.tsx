import PageHeader from "../components/PageHeader";
import TareasBinder from "../components/TareasBinder";

// Página global de Tareas: todas las de todos los binders (mismos datos que la pestaña del binder).
export default function TareasPage() {
  return (
    <div className="container lista-page">
      <PageHeader emoji="✅" title="Tareas" />
      <TareasBinder />
    </div>
  );
}
