import { useEffect, useState } from "react";
import { bdxApi, type BdxDetalle } from "../api";
import type { Binder, Bdx, BdxLinea } from "../types";
import FormPanel from "../components/FormPanel";
import BdxLineaPanel from "../components/BdxLineaPanel";

const TIPOS = ["Risk", "Premium"];
const ESTADOS_BDX = ["Abierto", "Cerrado"];

type BdxForm = {
  id?: number;
  tipo: string;
  reporting_period_start: string;
  reporting_period_end: string;
  estado: string;
  notas: string;
};
const BDX_VACIO: BdxForm = {
  tipo: "Risk",
  reporting_period_start: "",
  reporting_period_end: "",
  estado: "Abierto",
  notas: "",
};

function fecha(s: string | null): string {
  return s ?? "—";
}
function imp(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BinderDetalle({ binder, onBack }: { binder: Binder; onBack: () => void }) {
  const [tab, setTab] = useState<"datos" | "bdx">("datos");

  // ── BDX ──
  const [bdxs, setBdxs] = useState<Bdx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<BdxDetalle | null>(null); // BDX abierto (con líneas)
  const [bdxForm, setBdxForm] = useState<BdxForm | null>(null);
  const [bdxInicial, setBdxInicial] = useState<BdxForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [linea, setLinea] = useState<BdxLinea | "nueva" | null>(null);

  async function cargarBdx() {
    setLoading(true);
    setError(null);
    try {
      setBdxs(await bdxApi.listar(binder.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function abrirBdx(id: number) {
    setError(null);
    try {
      setSel(await bdxApi.detalle(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function refrescarSel() {
    if (sel) setSel(await bdxApi.detalle(sel.id));
  }

  useEffect(() => {
    if (tab === "bdx") cargarBdx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Cabecera BDX (alta/edición) ──
  const bdxDirty = !!bdxForm && JSON.stringify(bdxForm) !== JSON.stringify(bdxInicial);
  function nuevoBdx() {
    const f = { ...BDX_VACIO };
    setBdxForm(f);
    setBdxInicial(f);
  }
  async function guardarBdx() {
    if (!bdxForm) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        tipo: bdxForm.tipo,
        reporting_period_start: bdxForm.reporting_period_start || null,
        reporting_period_end: bdxForm.reporting_period_end || null,
        estado: bdxForm.estado || null,
        notas: bdxForm.notas.trim() || null,
      };
      if (bdxForm.id) await bdxApi.editar(bdxForm.id, payload);
      else await bdxApi.crear(binder.id, payload);
      setBdxForm(null);
      await cargarBdx();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function borrarBdx(b: Bdx) {
    if (!confirm(`¿Borrar el BDX ${b.tipo} ${fecha(b.reporting_period_start)} → ${fecha(b.reporting_period_end)} y todas sus líneas?`))
      return;
    try {
      await bdxApi.borrar(b.id);
      if (sel?.id === b.id) setSel(null);
      await cargarBdx();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container">
      <div className="detalle-top">
        <button className="btn-link" onClick={onBack}>
          ← Volver a Binders
        </button>
        <h1 className="page-title" style={{ margin: "8px 0 4px" }}>
          <span className="page-title-emoji">📑</span>
          {binder.umr ?? binder.agreement_number ?? `Binder ${binder.id}`}
        </h1>
        <div className="detalle-sub">
          {binder.coverholder_nombre ?? "—"} · {fecha(binder.fecha_efecto)} → {fecha(binder.fecha_vencimiento)} ·{" "}
          {binder.estado ?? "—"}
        </div>
      </div>

      <div className="tabs detalle-tabs">
        <button className={"tab" + (tab === "datos" ? " active" : "")} onClick={() => setTab("datos")}>
          Datos
        </button>
        <button className={"tab" + (tab === "bdx" ? " active" : "")} onClick={() => setTab("bdx")}>
          BDX
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {tab === "datos" && (
        <div className="datos-grid">
          <Dato label="UMR" valor={binder.umr} />
          <Dato label="Agreement Number" valor={binder.agreement_number} />
          <Dato label="Coverholder" valor={binder.coverholder_nombre} />
          <Dato label="YOA" valor={binder.yoa} />
          <Dato label="Efecto" valor={binder.fecha_efecto} />
          <Dato label="Vencimiento" valor={binder.fecha_vencimiento} />
          <Dato label="Estado" valor={binder.estado} />
          <Dato label="Moneda" valor={binder.moneda} />
          <Dato label="Comisión Mayrit %" valor={binder.comision_mayrit} />
          <Dato label="Cuenta bancaria" valor={binder.cuenta_bancaria_nombre} />
          <Dato label="Secciones" valor={String(binder.secciones?.length ?? 0)} />
          <div className="dato-full hint">
            Para editar los términos del binder, usa «Editar» / «+ Suplemento» en el listado de Binders.
          </div>
        </div>
      )}

      {tab === "bdx" && !sel && (
        <>
          <div className="toolbar">
            <button className="btn-primary" onClick={nuevoBdx}>
              + Nuevo BDX
            </button>
          </div>
          {loading ? (
            <div className="loading">Cargando…</div>
          ) : bdxs.length === 0 ? (
            <div className="empty">Este binder no tiene BDX. Crea el primero con «+ Nuevo BDX».</div>
          ) : (
            <table className="compacto">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Periodo</th>
                  <th>Estado</th>
                  <th>Nº líneas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bdxs.map((b) => (
                  <tr key={b.id} className="fila-click" onClick={() => abrirBdx(b.id)}>
                    <td>{b.tipo}</td>
                    <td>
                      {fecha(b.reporting_period_start)} → {fecha(b.reporting_period_end)}
                    </td>
                    <td>{b.estado ?? "—"}</td>
                    <td>{b.num_lineas}</td>
                    <td className="acciones" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-link" onClick={() => abrirBdx(b.id)}>
                        Abrir
                      </button>
                      <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => borrarBdx(b)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "bdx" && sel && (
        <>
          <div className="toolbar">
            <button className="btn-link" onClick={() => setSel(null)}>
              ← BDX del binder
            </button>
            <span style={{ fontWeight: 600 }}>
              {sel.tipo} · {fecha(sel.reporting_period_start)} → {fecha(sel.reporting_period_end)} ·{" "}
              {sel.lineas.length} líneas
            </span>
            <button className="btn-primary" onClick={() => setLinea("nueva")}>
              + Nueva línea
            </button>
          </div>
          {sel.lineas.length === 0 ? (
            <div className="empty">Este BDX no tiene líneas. Añade una con «+ Nueva línea» (o importa Excel — próximamente).</div>
          ) : (
            <div className="tabla-scroll">
              <table className="compacto">
                <thead>
                  <tr>
                    <th>Sec.</th>
                    <th>Risk Code</th>
                    <th>Certificado</th>
                    <th>Asegurado</th>
                    <th>Inicio</th>
                    <th>Vto.</th>
                    <th>GWP</th>
                    <th>Com.%</th>
                    <th>Cobr.</th>
                    <th>Liq.</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.lineas.map((l) => (
                    <tr key={l.id} className="fila-click" onClick={() => setLinea(l)}>
                      <td>{l.section_no ?? "—"}</td>
                      <td>{l.risk_code ?? "—"}</td>
                      <td>{l.certificate_ref ?? "—"}</td>
                      <td>{l.insured_name ?? "—"}</td>
                      <td>{fecha(l.risk_inception_date ?? null)}</td>
                      <td>{fecha(l.risk_expiry_date ?? null)}</td>
                      <td style={{ textAlign: "right" }}>{imp(l.gross_written_premium)}</td>
                      <td style={{ textAlign: "right" }}>{imp(l.commission_coverholder_pct)}</td>
                      <td>{l.prima_cobrada ? "✓" : ""}</td>
                      <td>{l.liquidado ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Alta/edición de cabecera BDX */}
      {bdxForm && (
        <FormPanel
          title={bdxForm.id ? "Editar BDX" : "Nuevo BDX"}
          dirty={bdxDirty}
          saving={saving}
          error={error}
          onSave={guardarBdx}
          onClose={() => setBdxForm(null)}
        >
          <div className="field">
            <label>Tipo</label>
            <select value={bdxForm.tipo} onChange={(e) => setBdxForm({ ...bdxForm, tipo: e.target.value })}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Periodo — inicio</label>
            <input
              type="date"
              className="inp-fecha"
              value={bdxForm.reporting_period_start}
              onChange={(e) => setBdxForm({ ...bdxForm, reporting_period_start: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Periodo — fin</label>
            <input
              type="date"
              className="inp-fecha"
              value={bdxForm.reporting_period_end}
              onChange={(e) => setBdxForm({ ...bdxForm, reporting_period_end: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={bdxForm.estado} onChange={(e) => setBdxForm({ ...bdxForm, estado: e.target.value })}>
              {ESTADOS_BDX.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea rows={3} value={bdxForm.notas} onChange={(e) => setBdxForm({ ...bdxForm, notas: e.target.value })} />
          </div>
        </FormPanel>
      )}

      {/* Ficha de línea */}
      {sel && linea && (
        <BdxLineaPanel
          bdxId={sel.id}
          linea={linea === "nueva" ? null : linea}
          onSaved={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onDeleted={async () => {
            setLinea(null);
            await refrescarSel();
          }}
          onClose={() => setLinea(null)}
        />
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | number | null | undefined }) {
  return (
    <div className="dato">
      <span className="dato-label">{label}</span>
      <span className="dato-valor">{valor == null || valor === "" ? "—" : String(valor)}</span>
    </div>
  );
}
