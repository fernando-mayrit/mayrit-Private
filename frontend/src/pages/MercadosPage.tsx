import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Mercado, MercadoWrite } from "../types";
import PageHeader from "../components/PageHeader";
import MercadoForm from "../components/MercadoForm";

const api = crud<Mercado, MercadoWrite>("/mercados");

export default function MercadosPage() {
  const [items, setItems] = useState<Mercado[]>([]);
  const [q, setQ] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = cerrado; "nuevo" = alta; Mercado = edición.
  const [editing, setEditing] = useState<Mercado | "nuevo" | null>(null);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.list(search || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Búsqueda en vivo: filtra mientras se teclea (pequeño retardo para no saturar).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="container">
      <PageHeader emoji="🏦" title="Mercados" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o alias…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={() => setEditing("nuevo")}>
          + Nuevo mercado
        </button>
        <label className="check-inline" title="Incluir mercados desactivados">
          <input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {(() => {
        const visibles = mostrarInactivos ? items : items.filter((m) => m.activa);
        return loading ? (
          <div className="loading">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="empty">No hay mercados{mostrarInactivos ? "" : " activos"}.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Alias</th>
                <th>Tipo</th>
                <th>TOBA</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => (
                <tr key={m.id} style={m.activa ? undefined : { opacity: 0.55 }}>
                  <td>{m.nombre}</td>
                  <td>{m.alias ?? "—"}</td>
                  <td>{m.tipo_mercado ?? "—"}</td>
                  <td>{m.toba ? <span className="badge si">Sí</span> : <span className="badge">No</span>}</td>
                  <td>
                    {m.activa ? (
                      <span className="pill pill-cobrado">Activo</span>
                    ) : (
                      <span className="pill pill-anulado">Inactivo</span>
                    )}
                  </td>
                  <td className="acciones">
                    <button className="btn-link" onClick={() => setEditing(m)}>
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
        <MercadoForm
          initial={editing === "nuevo" ? null : editing}
          onSaved={() => { setEditing(null); cargar(); }}
          onDeleted={() => { setEditing(null); cargar(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
