import { useState, useEffect } from "react";
import { crud } from "../api";
import type { Tomador, TomadorWrite } from "../types";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import TomadorForm from "../components/TomadorForm";

const api = crud<Tomador, TomadorWrite>("/tomadores");

// Catálogo de columnas (clic derecho en la cabecera para elegir/ocultar/mover).
const CATALOGO: Col<Tomador>[] = [
  { key: "nombre", label: "Nombre", tipo: "text" },
  { key: "tipo", label: "Tipo", tipo: "text" },
  { key: "cif", label: "CIF / NIF", tipo: "text" },
  { key: "domicilio", label: "Domicilio", tipo: "text" },
  { key: "codigo_postal", label: "C.P.", tipo: "text" },
  { key: "localidad", label: "Localidad", tipo: "text" },
  { key: "provincia", label: "Provincia", tipo: "text" },
  { key: "pais", label: "País", tipo: "text" },
  { key: "notas", label: "Notas", tipo: "text" },
];
const DEFAULT_KEYS = ["nombre", "tipo", "pais", "cif", "localidad"];

export default function TomadoresPage() {
  const [items, setItems] = useState<Tomador[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = cerrado; "nuevo" = alta; Tomador = edición.
  const [editing, setEditing] = useState<Tomador | "nuevo" | null>(null);

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
    <div className="container lista-page">
      <PageHeader emoji="👥" title="Tomadores" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o CIF…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={() => setEditing("nuevo")}>
          + Nuevo tomador
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay tomadores. Crea el primero con «+ Nuevo tomador».</div>
      ) : (
        <TablaDatos
          filas={items}
          columnas={CATALOGO}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.tomadores.tabla.v1"
          rowAction={(t) => (
            <button className="btn-link" onClick={() => setEditing(t)}>
              Editar
            </button>
          )}
        />
      )}

      {editing && (
        <TomadorForm
          initial={editing === "nuevo" ? null : editing}
          onSaved={() => { setEditing(null); cargar(); }}
          onDeleted={() => { setEditing(null); cargar(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
