import { useEffect, useState } from "react";
import { polizasApi, recibosApi } from "../api";
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
  { key: "asegurado", label: "Asegurado", tipo: "text", width: 160 },
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
  "numero_poliza", "asegurado", "corredor", "ramo", "mercado", "seguro",
  "prima_neta", "comision_total", "num_recibos", "estado", "fecha_efecto", "fecha_vencimiento",
];

export default function PolizasPage() {
  const [items, setItems] = useState<Poliza[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Poliza | "nueva" | null>(null);
  const [recCount, setRecCount] = useState<Map<number, number>>(new Map());

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const [pol, rec] = await Promise.all([polizasApi.listar(), recibosApi.listar()]);
      setItems(pol);
      const m = new Map<number, number>();
      for (const r of rec) if (r.poliza_id != null) m.set(r.poliza_id, (m.get(r.poliza_id) ?? 0) + 1);
      setRecCount(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  const filtrados = items.filter(
    (p) =>
      !q ||
      `${p.numero_poliza ?? ""} ${p.asegurado ?? ""} ${p.corredor ?? ""} ${p.referencia ?? ""}`
        .toLowerCase()
        .includes(q.toLowerCase())
  );
  const totalPrima = filtrados.reduce((a, p) => a + num(p.prima_neta), 0);
  const totalComision = filtrados.reduce((a, p) => a + num(p.comision_total), 0);
  const sinRecibo = items.filter((p) => (recCount.get(p.id) ?? 0) === 0).length;

  // Columna "Recibos" (nº por póliza) con aviso rojo "Sin recibo" cuando es 0.
  const colRecibos: Col<Poliza> = {
    key: "num_recibos",
    label: "Recibos",
    tipo: "int",
    calc: (p) => recCount.get(p.id) ?? 0,
    render: (p) => {
      const c = recCount.get(p.id) ?? 0;
      return c === 0 ? <span className="pill pill-pendiente">Sin recibo</span> : c;
    },
  };
  const columnas: Col<Poliza>[] = [...CATALOGO, colRecibos];

  return (
    <div className="container lista-page">
      <PageHeader emoji="📄" title="Pólizas (OM)" />
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
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
          {sinRecibo > 0 && <> · <b style={{ color: "var(--rojo)" }}>{sinRecibo} sin recibo</b></>}
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
          columnas={columnas}
          defaultKeys={DEFAULT_KEYS}
          storageKey="mayrit.polizas.tabla.v5"
          defaultSort={{ key: "fecha_efecto", dir: -1 }}
          rowAction={(p) => (
            <button className="btn-link" onClick={() => setForm(p)}>
              Editar
            </button>
          )}
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
