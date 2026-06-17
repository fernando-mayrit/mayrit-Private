import { useEffect, useState } from "react";
import { polizasApi } from "../api";
import type { Poliza } from "../types";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import PolizaForm from "../components/PolizaForm";
import { fmtMiles } from "../format";

const eur = (v: unknown) => `${fmtMiles(v)} €`;
const num = (v: unknown) => Number(v) || 0;
const seguroLabel = (s: string | null) => (s === "1" ? "Seguro Directo" : s === "2" ? "Reaseguro" : s ?? "");

// Catálogo de columnas (clic derecho en la cabecera para elegir/ocultar).
const CATALOGO: Col<Poliza>[] = [
  { key: "numero_poliza", label: "Nº Póliza", tipo: "text" },
  { key: "referencia", label: "Referencia", tipo: "text" },
  { key: "asegurado", label: "Asegurado", tipo: "text" },
  { key: "corredor", label: "Corredor", tipo: "text" },
  { key: "ramo", label: "Ramo", tipo: "text" },
  { key: "mercado", label: "Mercado", tipo: "text" },
  { key: "produccion", label: "Producción", tipo: "text" },
  { key: "seguro", label: "Seguro", tipo: "text", calc: (p) => seguroLabel(p.seguro) },
  { key: "tipo_documento", label: "Tipo Documento", tipo: "text" },
  { key: "estado", label: "Estado", tipo: "text" },
  { key: "pago", label: "Pago", tipo: "text" },
  { key: "moneda", label: "Moneda", tipo: "text" },
  { key: "fecha_efecto", label: "F. Efecto", tipo: "date" },
  { key: "fecha_vencimiento", label: "F. Vto.", tipo: "date" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "renovacion_automatica", label: "Ren. Auto.", tipo: "bool" },
  { key: "coaseguro", label: "Coaseguro", tipo: "bool" },
  { key: "limite", label: "Límite 100%", tipo: "num" },
  { key: "franquicia", label: "Franquicia", tipo: "num" },
  { key: "capacidad", label: "Capacidad", tipo: "num" },
  { key: "prima_neta", label: "Prima Neta", tipo: "num" },
  { key: "impuestos_porc", label: "Impuestos %", tipo: "pct" },
  { key: "impuestos", label: "Impuestos", tipo: "num" },
  { key: "recargos", label: "Recargos", tipo: "num" },
  { key: "prima_total", label: "Prima Total", tipo: "num" },
  { key: "comision_porc", label: "Comisión %", tipo: "pct" },
  { key: "comision_total", label: "Comisión Total", tipo: "num" },
  { key: "prima_participacion", label: "Prima Part.", tipo: "num" },
];
const DEFAULT_KEYS = [
  "numero_poliza", "asegurado", "ramo", "mercado", "seguro",
  "prima_neta", "comision_total", "estado", "fecha_efecto", "fecha_vencimiento", "yoa",
];

export default function PolizasPage() {
  const [items, setItems] = useState<Poliza[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fYoa, setFYoa] = useState("");
  const [form, setForm] = useState<Poliza | "nueva" | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setItems(await polizasApi.listar());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  const yoas = [...new Set(items.map((p) => p.yoa).filter((y): y is number => y != null))].sort((a, b) => b - a);
  const filtrados = items.filter(
    (p) =>
      (!fYoa || String(p.yoa) === fYoa) &&
      (!q ||
        `${p.numero_poliza ?? ""} ${p.asegurado ?? ""} ${p.corredor ?? ""} ${p.referencia ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase()))
  );
  const totalPrima = filtrados.reduce((a, p) => a + num(p.prima_neta), 0);
  const totalComision = filtrados.reduce((a, p) => a + num(p.comision_total), 0);

  return (
    <div className="container lista-page">
      <PageHeader emoji="📄" title="Pólizas (OM)" />
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <select className="filtro" value={fYoa} onChange={(e) => setFYoa(e.target.value)}>
          <option value="">YOA: todos</option>
          {yoas.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar nº póliza / asegurado / corredor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-primary" onClick={() => setForm("nueva")}>
          + Nueva póliza
        </button>
        <span className="hint">
          Prima Neta: <b>{eur(totalPrima)}</b> · Comisión: <b>{eur(totalComision)}</b>
        </span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay pólizas.</div>
      ) : (
        <TablaDatos
          filas={filtrados}
          columnas={CATALOGO}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.polizas.tabla.v1"
          onRowClick={(p) => setForm(p)}
        />
      )}

      {form && (
        <PolizaForm
          poliza={form === "nueva" ? null : form}
          onSaved={() => { setForm(null); cargar(); }}
          onDeleted={() => { setForm(null); cargar(); }}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
