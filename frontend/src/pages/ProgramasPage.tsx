import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Programa, ProgramaWrite, Productor } from "../types";
import PageHeader from "../components/PageHeader";
import ProgramaForm from "../components/ProgramaForm";

const api = crud<Programa, ProgramaWrite>("/programas");
const apiProductores = crud<Productor, unknown>("/productores");

export default function ProgramasPage() {
  const [items, setItems] = useState<Programa[]>([]);
  const [agencias, setAgencias] = useState<Productor[]>([]);
  const [q, setQ] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = cerrado; "nuevo" = alta; Programa = edición.
  const [editing, setEditing] = useState<Programa | "nuevo" | null>(null);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.list(search || undefined, 5000));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    apiProductores
      .list(undefined, 5000)
      .then((prod) => setAgencias((prod as Productor[]).filter((p) => p.tipo === "Agencia de Suscripción")))
      .catch(() => {});
  }, []);

  // Búsqueda en vivo (pequeño retardo para no saturar).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const agenciaNombre = (id: number | null) =>
    id == null ? "—" : agencias.find((a) => a.id === id)?.nombre ?? "—";

  return (
    <div className="container">
      <PageHeader emoji="🔗" title="Programas" />
      <div className="hint" style={{ margin: "0 0 12px" }}>
        Un programa agrupa la cadena de binders consecutivos que se comparan entre sí en la
        triangulación (p. ej. «Crouco Beazley» frente a «Crouco QBE»). Al renovar un binder, el
        nuevo se queda en el mismo programa.
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={() => setEditing("nuevo")}>
          + Nuevo programa
        </button>
        <label className="check-inline" title="Incluir programas desactivados">
          <input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {(() => {
        const visibles = mostrarInactivos ? items : items.filter((p) => p.activa);
        return loading ? (
          <div className="loading">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="empty">No hay programas{mostrarInactivos ? "" : " activos"}.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Agencia (coverholder)</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id} style={p.activa ? undefined : { opacity: 0.55 }}>
                  <td>{p.nombre}</td>
                  <td>{agenciaNombre(p.productor_id)}</td>
                  <td>
                    {p.activa ? (
                      <span className="pill pill-cobrado">Activo</span>
                    ) : (
                      <span className="pill pill-anulado">Inactivo</span>
                    )}
                  </td>
                  <td className="acciones">
                    <button className="btn-link" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}

      {editing && (
        <ProgramaForm
          initial={editing === "nuevo" ? null : editing}
          productores={agencias}
          onSaved={() => { setEditing(null); cargar(); }}
          onDeleted={() => { setEditing(null); cargar(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
