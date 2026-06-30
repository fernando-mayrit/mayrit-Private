import { useEffect, useState } from "react";
import { polizasApi, recibosApi } from "../api";
import type { Poliza } from "../types";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import PolizaForm from "../components/PolizaForm";

const num = (v: unknown) => Number(v) || 0;
const seguroLabel = (s: string | null) => (s === "1" ? "Seguro Directo" : s === "2" ? "Reaseguro" : s ?? "");
const ESTADOS = ["En Vigor", "Cancelada", "Renovada", "No Renovada", "Temporal-Vencida"];

// ¿Queda menos de 1 mes para el vencimiento? (incluye ya vencidas)
function venceEnMenosDeUnMes(fv: string | null): boolean {
  if (!fv) return false;
  const venc = new Date(`${String(fv).slice(0, 10)}T00:00:00`);
  if (isNaN(venc.getTime())) return false;
  const limite = new Date();
  limite.setMonth(limite.getMonth() + 1);
  return venc <= limite;
}

// Catálogo de columnas (clic derecho en la cabecera para elegir/ocultar).
const CATALOGO: Col<Poliza>[] = [
  { key: "numero_poliza", label: "Nº Póliza", tipo: "text" },
  { key: "asegurado", label: "Asegurado", tipo: "text", width: 160 },
  { key: "corredor", label: "Corredor", tipo: "text" },
  { key: "ramo", label: "Ramo", tipo: "text", width: 90 },
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
  // Capacidad almacenada como fracción (0,5) → se muestra en % (50,00 %).
  { key: "capacidad", label: "Capacidad", tipo: "pct", calc: (p) => (p.capacidad == null || p.capacidad === "" ? "" : num(p.capacidad) * 100) },
  { key: "prima_neta", label: "Prima Neta 100%", tipo: "num" },
  { key: "impuestos_porc", label: "Impuestos %", tipo: "pct" },
  { key: "impuestos", label: "Impuestos", tipo: "num" },
  { key: "recargos", label: "Recargos", tipo: "num" },
  { key: "prima_total", label: "Prima Total", tipo: "num" },
  { key: "comision_porc", label: "Comisión %", tipo: "pct" },
  { key: "comision_cedida_porc", label: "Comisión corredor %", tipo: "pct" },
  { key: "comision_total", label: "Comisión Total", tipo: "num" },
  // Comisión de Mayrit (retenida) = prima participación × (comisión total − cedida) %.
  { key: "comision_mayrit", label: "Comisión Mayrit", tipo: "num", calc: (p) => (num(p.prima_participacion) * (num(p.comision_porc) - num(p.comision_cedida_porc))) / 100 },
  { key: "prima_participacion", label: "Prima Neta", tipo: "num" },
];
const DEFAULT_KEYS = [
  "numero_poliza", "asegurado", "corredor", "ramo", "mercado", "seguro",
  "capacidad", "prima_participacion", "comision_mayrit", "num_recibos", "estado", "fecha_efecto", "fecha_vencimiento",
];

export default function PolizasPage() {
  const [items, setItems] = useState<Poliza[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [estadoF, setEstadoF] = useState("En Vigor");
  const [form, setForm] = useState<Poliza | "nueva" | null>(null);
  const [renovarDe, setRenovarDe] = useState<Poliza | null>(null); // origen de un alta de renovación
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
      (!estadoF || p.estado === estadoF) &&
      (!q ||
        `${p.numero_poliza ?? ""} ${p.asegurado ?? ""} ${p.corredor ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase()))
  );

  // Columna "Recibos" (nº por póliza) con aviso rojo "Sin recibo" cuando es 0.
  const colRecibos: Col<Poliza> = {
    key: "num_recibos",
    label: "Recibos",
    tipo: "int",
    calc: (p) => recCount.get(p.id) ?? 0,
    render: (p) => {
      const c = recCount.get(p.id) ?? 0;
      return c === 0 ? <span className="pill pill-anulado">⚠ Sin recibo</span> : c;
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
        <select className="filtro" value={estadoF} onChange={(e) => setEstadoF(e.target.value)} title="Filtrar por Estado">
          <option value="">— Estado: todos —</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="btn-primary" onClick={() => { setRenovarDe(null); setForm("nueva"); }}>
          + Nueva póliza
        </button>
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
          storageKey="mayrit.polizas.tabla.v8"
          defaultSort={{ key: "fecha_efecto", dir: -1 }}
          rowClass={(p) =>
            p.estado === "En Vigor"
              ? venceEnMenosDeUnMes(p.fecha_vencimiento)
                ? "fila-vence"
                : "fila-envigor"
              : undefined
          }
          rowAction={(p) => (
            <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => setForm(p)}>
              ✏️
            </button>
          )}
        />
      )}

      {form && (
        <PolizaForm
          key={form === "nueva" ? (renovarDe ? `renov-${renovarDe.id}` : "nueva") : form.id}
          poliza={form === "nueva" ? null : form}
          polizas={items}
          renovarDe={form === "nueva" ? renovarDe : null}
          onRenovar={() => { if (form !== "nueva" && form) { setRenovarDe(form); setForm("nueva"); } }}
          onSaved={() => { setForm(null); setRenovarDe(null); cargar(); }}
          onDeleted={() => { setForm(null); setRenovarDe(null); cargar(); }}
          onClose={() => { setForm(null); setRenovarDe(null); }}
        />
      )}
    </div>
  );
}
