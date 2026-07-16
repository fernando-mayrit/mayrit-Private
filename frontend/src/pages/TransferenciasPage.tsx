import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  transferenciasApi,
  exportarXlsx,
  type Transferencia,
  type TransferenciaListada,
  type TransferenciasOpciones,
  type TransferenciaFiltros,
} from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import NumberInput from "../components/NumberInput";
import ConfirmDialog from "../components/ConfirmDialog";
import TablaDatos, { type Col } from "../components/TablaDatos";

// Transferencias = ledger de movimientos de dinero (calca TLiquidaciones). El sentido lo marca el
// subtipo: Cobro = entrada, Liquidación = salida, Traspaso = interno. Los de Siniestros se dan de alta a mano.

const eur = (v: number | string | null | undefined) => `${fmtMiles(v)} €`;
const num = (v: number | string | null | undefined) => Number(v ?? 0);

// Clase de pastilla por sentido del movimiento.
const SENT_PILL: Record<string, string> = { entrada: "pill-cobrado", salida: "pill-pendiente", interno: "pill-parcial" };
const SUBTIPOS = ["Cobro", "Liquidación", "Traspaso"];
const ORIGENES = ["Binder", "Póliza", "Comisiones", "Consultoría", "Slip de Reaseguro"];
const TIPOS = ["Primas", "Siniestros", "Comisiones", "Honorarios"];

const cuentaTexto = (t: Transferencia) =>
  t.cuenta_origen && t.cuenta_destino
    ? `${t.cuenta_origen} → ${t.cuenta_destino}`
    : (t.cuenta_destino ?? t.cuenta_origen ?? "");

// Columnas del listado: ordenables (clic en la cabecera) y filtrables (▾), igual que en Binders/Siniestros.
// Periodo (mes de riesgo/premium) 'YYYY-MM-DD' → 'MM/YYYY'.
const periodoMes = (p: string | null | undefined) => {
  if (!p) return "";
  const [y, m] = p.slice(0, 7).split("-");
  return m && y ? `${m}/${y}` : p;
};
const TR_COLS: Col<Transferencia>[] = [
  { key: "fecha", label: "Fecha", tipo: "date" },
  { key: "periodo", label: "Periodo", tipo: "text", calc: (t) => periodoMes(t.periodo) },
  { key: "origen", label: "Origen", tipo: "text" },
  { key: "tipo", label: "Tipo", tipo: "text" },
  {
    key: "subtipo", label: "Subtipo", tipo: "text",
    render: (t) => <span className={`pill ${SENT_PILL[t.sentido] ?? "pill-anulado"}`}>{t.subtipo}</span>,
  },
  {
    key: "importe", label: "Importe", tipo: "num",
    render: (t) => (
      <span style={{ color: t.sentido === "salida" ? "#b00" : t.sentido === "entrada" ? "#0a0" : undefined, fontWeight: 600 }}>
        {t.sentido === "salida" ? "−" : t.sentido === "entrada" ? "+" : ""}{eur(t.importe)}
      </span>
    ),
  },
  { key: "numero_poliza", label: "Nº Póliza", tipo: "text" },
  { key: "recibo_num", label: "Recibo", tipo: "text" },
  { key: "mercado", label: "Mercado", tipo: "text" },
  { key: "cuenta", label: "Cuenta", tipo: "text", width: 180, calc: cuentaTexto },
  { key: "notas", label: "Notas", tipo: "text", width: 220 },
];
const TR_DEFAULT = TR_COLS.map((c) => c.key);

type FormState = Partial<Transferencia>;

export default function TransferenciasPage() {
  const [data, setData] = useState<TransferenciaListada | null>(null);
  const [opciones, setOpciones] = useState<TransferenciasOpciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Filtros
  const [anio, setAnio] = useState<number | "">("");
  const [origen, setOrigen] = useState("");
  const [tipo, setTipo] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [sentido, setSentido] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [q, setQ] = useState("");

  // Alta / edición manual
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [confirmar, setConfirmar] = useState<{ titulo: string; mensaje: ReactNode; accion: () => void } | null>(null);

  const filtros: TransferenciaFiltros = useMemo(
    () => ({ anio: anio || null, origen: origen || null, tipo: tipo || null, subtipo: subtipo || null, sentido: sentido || null, cuenta: cuenta || null, q: q.trim() || null }),
    [anio, origen, tipo, subtipo, sentido, cuenta, q],
  );

  async function cargar() {
    setCargando(true);
    try {
      setData(await transferenciasApi.listar(filtros));
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtros]);
  useEffect(() => { transferenciasApi.opciones().then(setOpciones).catch(() => {}); }, []);

  // Valor de una celda para Excel: números como número, fechas dd/mm/aaaa, resto texto.
  function valorExport(t: Transferencia, col: Col<Transferencia>): string | number | null {
    const raw = col.calc ? col.calc(t) : (t as unknown as Record<string, unknown>)[col.key];
    if (raw == null || raw === "") return null;
    if (col.tipo === "num") return Number(raw) || 0;
    if (col.tipo === "date") return fmtFechaES(raw);
    return String(raw);
  }
  // Descargar a Excel TODO lo que cumple los filtros actuales (no solo lo que se muestra en pantalla).
  async function descargarExcel() {
    setExportando(true); setError(null);
    try {
      const full = await transferenciasApi.listar({ ...filtros, limit: 100000 });
      const blob = await exportarXlsx({
        nombre: "Transferencias",
        hoja: "Transferencias",
        headers: TR_COLS.map((c) => c.label),
        filas: full.items.map((t) => TR_COLS.map((c) => valorExport(t, c))),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Transferencias${anio ? ` ${anio}` : ""}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExportando(false); }
  }

  // Detección de cambios: el aviso de cerrar solo salta si se ha tocado algo. Se compara el form
  // actual con el snapshot capturado al abrir (alta o edición).
  const [inicialJson, setInicialJson] = useState("");
  const snapForm = (f: FormState) => JSON.stringify({
    origen: f.origen ?? "", tipo: f.tipo ?? "", subtipo: f.subtipo ?? "", fecha: f.fecha ?? "",
    periodo: f.periodo ?? "", importe: f.importe != null ? num(f.importe) : "", numero_poliza: f.numero_poliza ?? "",
    recibo_num: f.recibo_num ?? "", mercado: f.mercado ?? "", cuenta_origen: f.cuenta_origen ?? "",
    cuenta_destino: f.cuenta_destino ?? "", notas: f.notas ?? "",
  });
  function abrir(f: FormState) { setForm(f); setInicialJson(snapForm(f)); }
  const dirty = !!form && snapForm(form) !== inicialJson;

  function nuevo() {
    abrir({ origen: "Binder", tipo: "Siniestros", subtipo: "Cobro", fecha: null, importe: undefined, manual: true });
  }
  function set<K extends keyof Transferencia>(k: K, v: Transferencia[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function guardar() {
    if (!form) return;
    if (!form.subtipo) return setError("Indica el subtipo (Cobro/Liquidación/Traspaso).");
    if (num(form.importe) <= 0) return setError("El importe debe ser mayor que 0.");
    setSaving(true); setError(null);
    try {
      const payload: Partial<Transferencia> = {
        origen: form.origen, tipo: form.tipo, subtipo: form.subtipo, fecha: form.fecha ?? null,
        periodo: form.periodo ?? null, importe: num(form.importe), numero_poliza: form.numero_poliza ?? null,
        recibo_num: form.recibo_num ?? null, mercado: form.mercado ?? null,
        cuenta_origen: form.cuenta_origen ?? null, cuenta_destino: form.cuenta_destino ?? null, notas: form.notas ?? null,
      };
      if (form.id) await transferenciasApi.editar(form.id, payload);
      else await transferenciasApi.crear(payload);
      setForm(null);
      await cargar();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  function pedirBorrar(t: Transferencia) {
    setConfirmar({
      titulo: "Borrar el movimiento",
      mensaje: <>Vas a borrar el movimiento manual de <b>{eur(t.importe)}</b> ({t.tipo} · {t.subtipo}). Esta acción no se puede deshacer.</>,
      accion: async () => {
        setConfirmar(null);
        if (!t.id) return;
        setSaving(true); setError(null);
        try { await transferenciasApi.borrar(t.id); setForm(null); await cargar(); }
        catch (e) { setError((e as Error).message); } finally { setSaving(false); }
      },
    });
  }

  const cuentasActivas = opciones?.cuentas_activas ?? [];
  // Opciones del desplegable de una cuenta: las activas + la ya guardada (por si está desactivada).
  const ctaOpciones = (actual: string | null | undefined) => {
    const base = [...cuentasActivas];
    if (actual && !base.includes(actual)) base.unshift(actual);
    return base;
  };

  return (
    <div className="container lista-page">
      <PageHeader emoji="🔁" title="Transferencias" />

      {/* Filtros (izquierda, alineados con el borde superior del contador) + contador (derecha).
          El botón Nuevo movimiento va debajo de los filtros. */}
      <div className="bdx-topbar tr-cab" style={{ alignItems: "flex-start", marginTop: 4 }}>
        <div className="tr-filtros">
          <div className="toolbar tr-filtros-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            <input
              type="search"
              placeholder="Buscar póliza, recibo, mercado, notas…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: "1 1 200px", minWidth: 170 }}
            />
            <select className="filtro" value={anio} onChange={(e) => setAnio(e.target.value ? Number(e.target.value) : "")} title="Filtrar por año">
              <option value="">Año: todos</option>
              {(opciones?.anios ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="filtro" value={origen} onChange={(e) => setOrigen(e.target.value)} title="Filtrar por origen">
              <option value="">Origen: todos</option>
              {(opciones?.origenes ?? ORIGENES).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className="filtro" value={tipo} onChange={(e) => setTipo(e.target.value)} title="Filtrar por tipo">
              <option value="">Tipo: todos</option>
              {(opciones?.tipos ?? TIPOS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="filtro" value={subtipo} onChange={(e) => setSubtipo(e.target.value)} title="Filtrar por subtipo">
              <option value="">Subtipo: todos</option>
              {(opciones?.subtipos ?? SUBTIPOS).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="filtro" value={sentido} onChange={(e) => setSentido(e.target.value)} title="Filtrar por sentido">
              <option value="">Sentido: todos</option>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="interno">Interno</option>
            </select>
            <select className="filtro" value={cuenta} onChange={(e) => setCuenta(e.target.value)} title="Filtrar por cuenta bancaria">
              <option value="">Cuenta: todas</option>
              {(opciones?.cuentas ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <button className="btn-primary" onClick={nuevo}>＋ Nuevo movimiento</button>
            <button className="btn-primary" onClick={descargarExcel} disabled={exportando || !data?.items.length}
              title="Descargar a Excel el listado tal y como está filtrado">
              {exportando ? "Generando…" : "📊 Descargar Excel"}
            </button>
          </div>
        </div>

        {/* Contador (mismo formato que la pestaña Siniestros) */}
        {data && (
          <div className="bdx-totales tr-totales">
            <div className="tot-col">
              <div className="tot-row tot-cab"><span>Primas</span><b /></div>
              <div className="tot-row"><span>Cobros</span><b>{eur(data.primas_cobros)}</b></div>
              <div className="tot-row"><span>Liquidaciones</span><b>{eur(data.primas_liquidaciones)}</b></div>
              <div className="tot-row"><span>Liq. Comisiones</span><b>{eur(data.comisiones_liquidacion)}</b></div>
              <div className="tot-row"><span>Traspasos Com.</span><b>{eur(data.comisiones_traspaso)}</b></div>
              <div className="tot-row tot-pdte"><span>TOTAL</span><b>{eur(data.primas_total)}</b></div>
            </div>
            <div className="tot-col">
              <div className="tot-row tot-cab"><span>Siniestros</span><b /></div>
              <div className="tot-row"><span>Cobros</span><b>{eur(data.siniestros_cobros)}</b></div>
              <div className="tot-row"><span>Liquidaciones</span><b>{eur(data.siniestros_liquidaciones)}</b></div>
              <div className="tot-row tot-pdte"><span>TOTAL</span><b>{eur(data.siniestros_total)}</b></div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {data && data.items.length === 0 && !cargando ? (
        <div className="empty">No hay movimientos con esos filtros.</div>
      ) : (
        <TablaDatos
          filas={data?.items ?? []}
          columnas={TR_COLS}
          defaultKeys={TR_DEFAULT}
          storageKey="mayrit.transferencias.tabla.v2"
          defaultSort={{ key: "fecha", dir: -1 }}
          rowAction={(t) =>
            t.manual
              ? <button className="btn-icono" title="Editar" aria-label="Editar" onClick={() => abrir(t)}>✏️</button>
              : <span className="hint" title="Generado por el recibo">auto</span>
          }
        />
      )}
      {data && data.n_total > data.items.length && (
        <p className="hint" style={{ marginTop: 6 }}>Mostrando los {data.items.length} más recientes de {data.n_total}. Afina con los filtros (arriba) para ver el resto.</p>
      )}

      {form && (
        <FormPanel
          title={`${form.id ? "Editar movimiento" : "Nuevo movimiento"}${form.tipo ? ` — ${form.tipo}` : ""}`}
          dirty={dirty} saving={saving} saveLabel={form.id ? "Guardar" : "Crear movimiento"}
          onSave={guardar} onClose={() => setForm(null)}
          onDelete={form.id ? () => pedirBorrar(form as Transferencia) : undefined}
        >
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Origen</label>
              <select value={form.origen ?? "Binder"} onChange={(e) => set("origen", e.target.value)}>
                {ORIGENES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Tipo</label>
              <select value={form.tipo ?? "Siniestros"} onChange={(e) => set("tipo", e.target.value)}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Subtipo</label>
              <select value={form.subtipo ?? "Cobro"} onChange={(e) => set("subtipo", e.target.value)}>
                {SUBTIPOS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {/* Nº Póliza / UMR + Nº de recibo */}
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Nº Póliza / UMR</label>
              <input
                type="text"
                list="umrs-tr"
                value={form.numero_poliza ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  set("numero_poliza", v);
                  const merc = v ? opciones?.umr_mercado?.[v] : undefined;
                  if (merc) set("mercado", merc);   // el Mercado sale automático según el UMR
                }}
              />
              <datalist id="umrs-tr">{Object.keys(opciones?.umr_mercado ?? {}).map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Recibo <span className="hint">(nº, opcional)</span></label>
              <input type="text" value={form.recibo_num ?? ""} onChange={(e) => set("recibo_num", e.target.value || null)} placeholder="2025-0001" />
            </div>
          </div>
          {/* Mercado: automático según el UMR → no editable */}
          <div className="field">
            <label>Mercado <span className="hint">(automático según el UMR)</span></label>
            <input type="text" value={form.mercado ?? ""} disabled />
          </div>
          {/* Fecha + Importe */}
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Fecha</label>
              <input type="date" value={form.fecha ?? ""} onChange={(e) => set("fecha", e.target.value || null)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Importe</label>
              <NumberInput value={form.importe != null ? String(num(form.importe)) : ""} onChange={(v) => set("importe", v as unknown as number)} decimals={2} suffix="€" />
            </div>
          </div>
          {/* Cuentas: desplegables de las cuentas bancarias activas */}
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Cuenta origen</label>
              <select value={form.cuenta_origen ?? ""} onChange={(e) => set("cuenta_origen", e.target.value || null)}>
                <option value="">— Ninguna —</option>
                {ctaOpciones(form.cuenta_origen).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Cuenta destino</label>
              <select value={form.cuenta_destino ?? ""} onChange={(e) => set("cuenta_destino", e.target.value || null)}>
                <option value="">— Ninguna —</option>
                {ctaOpciones(form.cuenta_destino).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea rows={2} value={form.notas ?? ""} onChange={(e) => set("notas", e.target.value || null)} />
          </div>
        </FormPanel>
      )}

      {confirmar && (
        <ConfirmDialog
          titulo={confirmar.titulo}
          mensaje={confirmar.mensaje}
          detalle="Solo se borran los movimientos dados de alta a mano."
          confirmLabel="Borrar"
          onConfirm={confirmar.accion}
          onClose={() => setConfirmar(null)}
        />
      )}
    </div>
  );
}
