import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  transferenciasApi,
  type Transferencia,
  type TransferenciasOpciones,
  type TransferenciaFiltros,
} from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import NumberInput from "../components/NumberInput";
import ConfirmDialog from "../components/ConfirmDialog";

// Transferencias = ledger de movimientos de dinero (calca TLiquidaciones). El sentido lo marca el
// subtipo: Cobro = entrada, Liquidación = salida, Traspaso = interno. Los de Siniestros se dan de alta a mano.

const eur = (v: number | string | null | undefined) => `${fmtMiles(v)} €`;
const num = (v: number | string | null | undefined) => Number(v ?? 0);

// Clase de pastilla por sentido del movimiento.
const SENT_PILL: Record<string, string> = { entrada: "pill-cobrado", salida: "pill-anulado", interno: "pill-parcial" };
const SUBTIPOS = ["Cobro", "Liquidación", "Traspaso"];
const ORIGENES = ["Binder", "Póliza", "Comisiones", "Consultoría", "Slip de Reaseguro"];
const TIPOS = ["Primas", "Siniestros", "Comisiones", "Honorarios"];

type FormState = Partial<Transferencia>;

export default function TransferenciasPage() {
  const [data, setData] = useState<{ items: Transferencia[]; ent: number; sal: number; tra: number; neto: number; n: number } | null>(null);
  const [opciones, setOpciones] = useState<TransferenciasOpciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Filtros
  const [anio, setAnio] = useState<number | "">("");
  const [origen, setOrigen] = useState("");
  const [tipo, setTipo] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [sentido, setSentido] = useState("");
  const [q, setQ] = useState("");

  // Alta / edición manual
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmar, setConfirmar] = useState<{ titulo: string; mensaje: ReactNode; accion: () => void } | null>(null);

  const filtros: TransferenciaFiltros = useMemo(
    () => ({ anio: anio || null, origen: origen || null, tipo: tipo || null, subtipo: subtipo || null, sentido: sentido || null, q: q.trim() || null }),
    [anio, origen, tipo, subtipo, sentido, q],
  );

  async function cargar() {
    setCargando(true);
    try {
      const r = await transferenciasApi.listar(filtros);
      setData({ items: r.items, ent: num(r.total_entradas), sal: num(r.total_salidas), tra: num(r.total_traspasos), neto: num(r.neto), n: r.n_total });
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtros]);
  useEffect(() => { transferenciasApi.opciones().then(setOpciones).catch(() => {}); }, []);

  function nuevo() {
    setForm({ origen: "Binder", tipo: "Siniestros", subtipo: "Cobro", fecha: null, importe: undefined, manual: true });
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

  const cuentas = opciones?.cuentas ?? [];

  return (
    <div className="container lista-page">
      <PageHeader emoji="🔁" title="Transferencias" />
      <p className="hint" style={{ marginBottom: 8 }}>
        Movimientos de dinero (entradas y salidas). Los de <b>Primas/Comisiones/Honorarios</b> nacen de los recibos;
        los <b>cobros y pagos de Siniestros</b> se dan de alta a mano. El sentido lo marca el subtipo:
        Cobro = entrada, Liquidación = salida, Traspaso = interno.
      </p>

      {/* Filtros */}
      <div className="filtros-barra" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select value={anio} onChange={(e) => setAnio(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Año (todos)</option>
          {(opciones?.anios ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
          <option value="">Origen (todos)</option>
          {(opciones?.origenes ?? ORIGENES).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Tipo (todos)</option>
          {(opciones?.tipos ?? TIPOS).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)}>
          <option value="">Subtipo (todos)</option>
          {(opciones?.subtipos ?? SUBTIPOS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sentido} onChange={(e) => setSentido(e.target.value)}>
          <option value="">Sentido (todos)</option>
          <option value="entrada">Entrada</option>
          <option value="salida">Salida</option>
          <option value="interno">Interno</option>
        </select>
        <input type="search" placeholder="Buscar póliza, recibo, mercado, notas…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <button className="btn-primary" style={{ marginLeft: "auto" }} onClick={nuevo}>＋ Nuevo movimiento</button>
      </div>

      {/* Totales */}
      {data && (
        <div className="kpi-row" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <Kpi label={`Entradas`} valor={eur(data.ent)} clase="kpi-verde" />
          <Kpi label={`Salidas`} valor={eur(data.sal)} clase="kpi-rojo" />
          <Kpi label={`Traspasos`} valor={eur(data.tra)} clase="kpi-ambar" />
          <Kpi label={`Neto (entradas − salidas)`} valor={eur(data.neto)} clase={data.neto >= 0 ? "kpi-verde" : "kpi-rojo"} />
          <Kpi label={`Movimientos`} valor={String(data.n)} />
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="lista-scroll">
        <table className="compacto bdx-tabla" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Origen</th>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th className="num">Importe</th>
              <th>Nº Póliza</th>
              <th>Recibo</th>
              <th>Mercado</th>
              <th>Cuenta</th>
              <th>Notas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id}>
                <td>{fmtFechaES(t.fecha)}</td>
                <td>{t.origen}</td>
                <td>{t.tipo}</td>
                <td><span className={`pill ${SENT_PILL[t.sentido] ?? "pill-anulado"}`}>{t.subtipo}</span></td>
                <td className="num" style={{ color: t.sentido === "salida" ? "#b00" : t.sentido === "entrada" ? "#0a0" : undefined, fontWeight: 600 }}>
                  {t.sentido === "salida" ? "−" : t.sentido === "entrada" ? "+" : ""}{eur(t.importe)}
                </td>
                <td>{t.numero_poliza ?? "—"}</td>
                <td>{t.recibo_num ?? "—"}</td>
                <td>{t.mercado ?? "—"}</td>
                <td title={`${t.cuenta_origen ?? ""}${t.cuenta_destino ? ` → ${t.cuenta_destino}` : ""}`} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.cuenta_origen && t.cuenta_destino ? `${t.cuenta_origen} → ${t.cuenta_destino}` : (t.cuenta_destino ?? t.cuenta_origen ?? "—")}
                </td>
                <td title={t.notas ?? undefined} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notas ?? "—"}</td>
                <td className="acciones">
                  {t.manual
                    ? <button className="btn-link btn-sm" onClick={() => setForm(t)}>Editar</button>
                    : <span className="hint" title="Generado por el recibo">auto</span>}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && !cargando && (
              <tr><td colSpan={11} className="empty">No hay movimientos con esos filtros.</td></tr>
            )}
          </tbody>
        </table>
        {data && data.n > data.items.length && (
          <p className="hint" style={{ marginTop: 6 }}>Mostrando los {data.items.length} más recientes de {data.n}. Afina con los filtros para ver el resto.</p>
        )}
      </div>

      {form && (
        <FormPanel
          title={`${form.id ? "Editar movimiento" : "Nuevo movimiento"}${form.tipo ? ` — ${form.tipo}` : ""}`}
          dirty saving={saving} saveLabel={form.id ? "Guardar" : "Crear movimiento"}
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
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Nº Póliza / UMR</label>
              <input value={form.numero_poliza ?? ""} onChange={(e) => set("numero_poliza", e.target.value || null)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Recibo <span className="hint">(nº, opcional)</span></label>
              <input value={form.recibo_num ?? ""} onChange={(e) => set("recibo_num", e.target.value || null)} placeholder="2025-0001" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Mercado</label>
              <input value={form.mercado ?? ""} onChange={(e) => set("mercado", e.target.value || null)} />
            </div>
          </div>
          <div className="field-row" style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Cuenta origen</label>
              <input list="ctas-tr" value={form.cuenta_origen ?? ""} onChange={(e) => set("cuenta_origen", e.target.value || null)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Cuenta destino</label>
              <input list="ctas-tr" value={form.cuenta_destino ?? ""} onChange={(e) => set("cuenta_destino", e.target.value || null)} />
            </div>
            <datalist id="ctas-tr">{cuentas.map((c) => <option key={c} value={c} />)}</datalist>
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

function Kpi({ label, valor, clase }: { label: string; valor: string; clase?: string }) {
  return (
    <div className={`kpi-card ${clase ?? ""}`} style={{ minWidth: 150 }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-valor">{valor}</div>
    </div>
  );
}
