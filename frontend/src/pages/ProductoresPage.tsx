import { useEffect, useState } from "react";
import { crud } from "../api";
import type { Productor, ProductorWrite } from "../types";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import ProductorForm from "../components/ProductorForm";

const api = crud<Productor, ProductorWrite>("/productores");

// Catálogo de columnas (clic derecho en la cabecera para elegir/ocultar/mover).
const CATALOGO: Col<Productor>[] = [
  { key: "nombre", label: "Nombre", tipo: "text", width: 220 },
  { key: "alias", label: "Alias", tipo: "text" },
  { key: "tipo", label: "Tipo", tipo: "text" },
  { key: "persona", label: "Persona", tipo: "text" },
  { key: "cif", label: "CIF / NIF", tipo: "text" },
  { key: "domicilio", label: "Domicilio", tipo: "text", width: 200 },
  { key: "codigo_postal", label: "C.P.", tipo: "text" },
  { key: "localidad", label: "Localidad", tipo: "text" },
  { key: "provincia", label: "Provincia", tipo: "text" },
  { key: "pais", label: "País", tipo: "text" },
  {
    key: "activa",
    label: "Estado",
    tipo: "text",
    calc: (p) => (p.activa ? "Activo" : "Inactivo"),
    render: (p) =>
      p.activa ? <span className="pill pill-cobrado">Activo</span> : <span className="pill pill-anulado">Inactivo</span>,
  },
  { key: "notas", label: "Notas", tipo: "text" },
];
const DEFAULT_KEYS = ["nombre", "alias", "tipo", "persona", "pais", "localidad", "activa"];

export default function ProductoresPage() {
  const [items, setItems] = useState<Productor[]>([]);
  const [q, setQ] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = cerrado; "nuevo" = alta; Productor = edición.
  const [editing, setEditing] = useState<Productor | "nuevo" | null>(null);

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

  const visibles = mostrarInactivos ? items : items.filter((p) => p.activa);

  return (
    <div className="container lista-page">
      <PageHeader emoji="🤝" title="Productores" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, alias o CIF…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <button className="btn-primary" onClick={() => setEditing("nuevo")}>
          + Nuevo productor
        </button>
        <label className="check-inline" title="Incluir productores desactivados">
          <input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : visibles.length === 0 ? (
        <div className="empty">No hay productores{mostrarInactivos ? "" : " activos"}.</div>
      ) : (
        <TablaDatos
          filas={visibles}
          columnas={CATALOGO}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.productores.tabla.v1"
          rowClass={(p) => (p.activa ? undefined : "fila-inactiva")}
          rowAction={(p) => (
            <button className="btn-link" onClick={() => setEditing(p)}>
              Editar
            </button>
          )}
        />
      )}

      {editing && (
        <ProductorForm
          initial={editing === "nuevo" ? null : editing}
          onSaved={() => { setEditing(null); cargar(); }}
          onDeleted={() => { setEditing(null); cargar(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
