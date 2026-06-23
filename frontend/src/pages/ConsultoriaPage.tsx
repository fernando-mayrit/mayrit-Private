import { useEffect, useMemo, useState } from "react";
import { consultoriaApi, crud, type ConsultoriaContrato, type ConsultoriaCobro } from "../api";
import type { Productor, CuentaBancaria } from "../types";
import { fmtMiles, fmtFechaES } from "../format";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";

const apiProductores = crud<Productor, unknown>("/productores");
const apiCuentas = crud<CuentaBancaria, unknown>("/cuentas-bancarias");
const FRECUENCIAS = ["Mensual", "Trimestral", "Semestral", "Anual", "Único"];
const num = (v: unknown) => Number(v) || 0;
const eur = (v: unknown) => `${fmtMiles(v)} €`;

type FormState = {
  productor_id: string;
  concepto: string;
  fecha_inicio: string;
  indefinido: boolean;
  duracion_meses: string;
  frecuencia: string;
  importe: string;
  sujeto_impuestos: boolean;
  impuestos_porc: string;
  cuenta_bancaria_id: string;
  dia_facturacion: string;
  aviso_dias_antes: string;
  estado: string;
  notas: string;
};
const VACIO: FormState = {
  productor_id: "", concepto: "", fecha_inicio: new Date().toISOString().slice(0, 10),
  indefinido: false, duracion_meses: "12", frecuencia: "Mensual", importe: "",
  sujeto_impuestos: true, impuestos_porc: "21", cuenta_bancaria_id: "",
  dia_facturacion: "1", aviso_dias_antes: "5", estado: "Activo", notas: "",
};

export default function ConsultoriaPage() {
  const [items, setItems] = useState<ConsultoriaContrato[]>([]);
  const [productores, setProductores] = useState<Productor[]>([]);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | "nuevo" | null>(null);
  const [form, setForm] = useState<FormState>(VACIO);
  const [formIni, setFormIni] = useState<FormState>(VACIO);
  const [corrigiendo, setCorrigiendo] = useState(false);   // contrato guardado: abre en solo lectura

  const [cobrosDe, setCobrosDe] = useState<ConsultoriaContrato | null>(null);
  const [cobros, setCobros] = useState<ConsultoriaCobro[]>([]);
  const [busyCobro, setBusyCobro] = useState<string | null>(null);

  async function cargar() {
    try {
      setItems(await consultoriaApi.list());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        const [ps, cs] = await Promise.all([apiProductores.list(undefined, 5000), apiCuentas.list(undefined, 5000)]);
        setProductores((ps as Productor[]).filter((p) => p.activa !== false));
        setCuentas(cs as CuentaBancaria[]);
      } catch (e) { setError((e as Error).message); }
      cargar();
    })();
  }, []);

  function abrirNuevo() {
    setForm(VACIO); setFormIni(VACIO); setCorrigiendo(false); setEditId("nuevo");
  }
  function abrirEdicion(c: ConsultoriaContrato) {
    const f: FormState = {
      productor_id: String(c.productor_id), concepto: c.concepto ?? "",
      fecha_inicio: c.fecha_inicio, indefinido: c.duracion_meses == null,
      duracion_meses: c.duracion_meses == null ? "" : String(c.duracion_meses),
      frecuencia: c.frecuencia, importe: String(c.importe),
      sujeto_impuestos: c.sujeto_impuestos, impuestos_porc: String(c.impuestos_porc),
      cuenta_bancaria_id: c.cuenta_bancaria_id ? String(c.cuenta_bancaria_id) : "",
      dia_facturacion: c.dia_facturacion == null ? "" : String(c.dia_facturacion),
      aviso_dias_antes: String(c.aviso_dias_antes ?? 5),
      estado: c.estado, notas: c.notas ?? "",
    };
    setForm(f); setFormIni(f); setCorrigiendo(false); setEditId(c.id);
  }
  const set = (k: keyof FormState, v: string | boolean) => setForm((s) => ({ ...s, [k]: v }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(formIni), [form, formIni]);
  // Un contrato ya guardado abre en SOLO LECTURA; "Corregir" lo habilita (como el modal de recibo).
  const ro = editId !== "nuevo" && !corrigiendo;
  function pedirCorregir() {
    if (window.confirm("Vas a modificar un contrato ya guardado. Hazlo solo para corregir errores. ¿Continuar?")) setCorrigiendo(true);
  }
  // Día de facturación: "primero" (1) · "ultimo" (31, el backend lo ajusta a fin de mes) · "concreto".
  const diaSel = form.dia_facturacion === "1" ? "primero" : form.dia_facturacion === "31" ? "ultimo" : "concreto";

  async function guardar() {
    if (!form.productor_id) return setError("Elige el cliente (productor).");
    if (!form.importe) return setError("Indica el importe por cobro.");
    if (!form.indefinido && !form.duracion_meses) return setError("Indica la duración en meses (o marca indefinido).");
    setError(null); setSaving(true);
    const payload = {
      productor_id: Number(form.productor_id),
      concepto: form.concepto.trim() || null,
      fecha_inicio: form.fecha_inicio,
      duracion_meses: form.indefinido ? null : Number(form.duracion_meses),
      frecuencia: form.frecuencia,
      importe: num(form.importe),
      sujeto_impuestos: form.sujeto_impuestos,
      impuestos_porc: form.sujeto_impuestos ? num(form.impuestos_porc) : 0,
      cuenta_bancaria_id: form.cuenta_bancaria_id ? Number(form.cuenta_bancaria_id) : null,
      dia_facturacion: form.dia_facturacion ? Number(form.dia_facturacion) : null,
      aviso_dias_antes: Number(form.aviso_dias_antes) || 5,
      estado: form.estado,
      notas: form.notas.trim() || null,
    };
    try {
      if (editId === "nuevo") await consultoriaApi.crear(payload);
      else if (typeof editId === "number") await consultoriaApi.editar(editId, payload);
      setEditId(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function borrar() {
    if (typeof editId !== "number") return;
    setSaving(true);
    try {
      await consultoriaApi.borrar(editId);
      setEditId(null);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function abrirCobros(c: ConsultoriaContrato) {
    setCobrosDe(c);
    try {
      setCobros((await consultoriaApi.cobros(c.id)).cobros);
    } catch (e) { setError((e as Error).message); }
  }
  async function generar(periodo: string) {
    if (!cobrosDe) return;
    setBusyCobro(periodo);
    try {
      await consultoriaApi.generarCobro(cobrosDe.id, periodo);
      setCobros((await consultoriaApi.cobros(cobrosDe.id)).cobros);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setBusyCobro(null); }
  }
  const [facturaMsg, setFacturaMsg] = useState<string | null>(null);
  async function generarFactura(periodo: string) {
    if (!cobrosDe) return;
    setBusyCobro(periodo); setFacturaMsg(null);
    try {
      const res = await consultoriaApi.generarFactura(cobrosDe.id, periodo);
      setFacturaMsg(`Factura ${res.numero} generada: ${res.archivo}`);
      setCobros((await consultoriaApi.cobros(cobrosDe.id)).cobros);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setBusyCobro(null); }
  }

  return (
    <div className="container lista-page">
      <PageHeader emoji="💼" title="Consultoría" />
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button className="btn-primary" onClick={abrirNuevo}>＋ Nuevo contrato</button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="lista-scroll">
        <table className="compacto bdx-tabla">
          <thead>
            <tr>
              <th>Cliente</th><th>Concepto</th><th>Frecuencia</th>
              <th className="num">Importe</th><th className="num">IVA</th>
              <th>Duración</th><th>Estado</th><th>Próximo cobro</th><th className="num">Cobros</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.productor_nombre ?? "—"}</td>
                <td>{c.concepto ?? "—"}</td>
                <td>{c.frecuencia}</td>
                <td className="num">{eur(c.importe)}</td>
                <td className="num">{c.sujeto_impuestos ? `${fmtMiles(c.impuestos_porc)} %` : "—"}</td>
                <td>{c.duracion_meses == null ? "Indefinido" : `${c.duracion_meses} meses`}</td>
                <td>{c.estado}</td>
                <td>{c.proximo_cobro ? fmtFechaES(c.proximo_cobro) : "—"}</td>
                <td className="num">{c.n_generados}/{c.n_cobros}</td>
                <td className="acciones" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-link" onClick={() => abrirEdicion(c)}>Editar</button>
                  {" · "}
                  <button className="btn-link" onClick={() => abrirCobros(c)}>Cobros</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={10} className="empty">No hay contratos de consultoría todavía.</td></tr>}
          </tbody>
        </table>
      </div>

      {editId !== null && (
        <FormPanel
          title={editId === "nuevo" ? "Nuevo contrato de consultoría" : "Contrato de consultoría"}
          dirty={dirty}
          saving={saving}
          readOnly={ro}
          saveLabel={corrigiendo ? "Guardar corrección" : "Guardar"}
          onSave={guardar}
          onClose={() => setEditId(null)}
          onDelete={!ro && typeof editId === "number" ? borrar : undefined}
        >
          {ro && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button className="btn-sm btn-corregir" onClick={pedirCorregir}>✏️ Corregir</button>
            </div>
          )}
          <div className="field">
            <label>Cliente (productor) *</label>
            <select value={form.productor_id} onChange={(e) => set("productor_id", e.target.value)} disabled={ro}>
              <option value="">— elegir —</option>
              {productores.map((p) => <option key={p.id} value={p.id}>{p.alias || p.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Concepto</label>
            <input type="text" value={form.concepto} onChange={(e) => set("concepto", e.target.value)} placeholder="p. ej. Asesoría mensual" disabled={ro} />
          </div>
          <div className="field">
            <label>Fecha de inicio *</label>
            <input type="date" value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} disabled={ro} />
          </div>
          <div className="field check">
            <input type="checkbox" checked={form.indefinido} onChange={(e) => set("indefinido", e.target.checked)} disabled={ro} />
            <label>Indefinido (sin fecha de fin)</label>
          </div>
          {!form.indefinido && (
            <div className="field">
              <label>Duración (meses) *</label>
              <input type="number" min={1} value={form.duracion_meses} onChange={(e) => set("duracion_meses", e.target.value)} disabled={ro} />
            </div>
          )}
          <div className="field">
            <label>Frecuencia de cobro *</label>
            <select value={form.frecuencia} onChange={(e) => set("frecuencia", e.target.value)} disabled={ro}>
              {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Importe por cobro (€) *</label>
            <input type="number" step="0.01" value={form.importe} onChange={(e) => set("importe", e.target.value)} disabled={ro} />
          </div>
          <div className="field check">
            <input type="checkbox" checked={form.sujeto_impuestos} onChange={(e) => set("sujeto_impuestos", e.target.checked)} disabled={ro} />
            <label>Sujeto a impuestos (IVA)</label>
          </div>
          {form.sujeto_impuestos && (
            <div className="field">
              <label>IVA (%)</label>
              <input type="number" step="0.01" value={form.impuestos_porc} onChange={(e) => set("impuestos_porc", e.target.value)} disabled={ro} />
            </div>
          )}
          <div className="field">
            <label>Cuenta bancaria</label>
            <select value={form.cuenta_bancaria_id} onChange={(e) => set("cuenta_bancaria_id", e.target.value)} disabled={ro}>
              <option value="">— ninguna —</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Día de facturación (del mes)</label>
            <select
              value={diaSel}
              onChange={(e) => {
                const v = e.target.value;
                set("dia_facturacion", v === "primero" ? "1" : v === "ultimo" ? "31" : "15");
              }}
              disabled={ro}
            >
              <option value="primero">Primer día del mes</option>
              <option value="ultimo">Último día del mes</option>
              <option value="concreto">El día… del mes</option>
            </select>
          </div>
          {diaSel === "concreto" && (
            <div className="field">
              <label>Día del mes (1–31) *</label>
              <input type="number" min={1} max={31} value={form.dia_facturacion}
                     onChange={(e) => set("dia_facturacion", e.target.value)} disabled={ro} />
            </div>
          )}
          <div className="field">
            <label>Avisar (días antes de facturar)</label>
            <input type="number" min={0} max={60} value={form.aviso_dias_antes}
                   onChange={(e) => set("aviso_dias_antes", e.target.value)} disabled={ro} />
          </div>
          {typeof editId === "number" && (
            <div className="field">
              <label>Estado</label>
              <select value={form.estado} onChange={(e) => set("estado", e.target.value)} disabled={ro}>
                <option value="Activo">Activo</option>
                <option value="Finalizado">Finalizado</option>
              </select>
            </div>
          )}
          <div className="field">
            <label>Notas</label>
            <textarea value={form.notas} onChange={(e) => set("notas", e.target.value)} rows={2} disabled={ro} />
          </div>
        </FormPanel>
      )}

      {cobrosDe && (
        <FormPanel
          title={`Cobros — ${cobrosDe.productor_nombre ?? ""} (${cobrosDe.concepto ?? cobrosDe.frecuencia})`}
          dirty={false}
          saving={false}
          saveLabel="Cerrar"
          wide
          onSave={() => setCobrosDe(null)}
          onClose={() => setCobrosDe(null)}
        >
          <p className="hint" style={{ marginBottom: 10 }}>
            Genera el recibo de cada cobro cuando toque (tipo «Consultoría», Base + IVA). «Factura»
            crea el recibo si falta y deja el Word listo para enviar en la carpeta de Facturas Emitidas.
          </p>
          {facturaMsg && <div className="ok" style={{ marginBottom: 8, wordBreak: "break-all" }}>📄 {facturaMsg}</div>}
          <table className="compacto" style={{ width: "100%" }}>
            <thead>
              <tr><th>Periodo</th><th>Fecha</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Total</th><th>Recibo</th><th></th></tr>
            </thead>
            <tbody>
              {[...cobros].reverse().map((co) => (
                <tr key={co.periodo}>
                  <td>{co.periodo}</td>
                  <td>{fmtFechaES(co.fecha)}</td>
                  <td className="num">{eur(co.base)}</td>
                  <td className="num">{eur(co.iva)}</td>
                  <td className="num">{eur(co.total)}</td>
                  <td>{co.recibo_numero ?? "—"}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {co.recibo_id
                      ? <span className={`pill ${co.recibo_cobrado ? "pill-cobrado" : "pill-parcial"}`}>
                          {co.recibo_cobrado ? "Cobrado" : "Pendiente de Cobro"}
                        </span>
                      : <button className="btn-primary btn-sm" disabled={busyCobro === co.periodo} onClick={() => generar(co.periodo)}>
                          {busyCobro === co.periodo ? "…" : "Generar"}
                        </button>}
                    {" "}
                    <button className="btn-link btn-sm" disabled={busyCobro === co.periodo} onClick={() => generarFactura(co.periodo)}>
                      📄 Factura
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </FormPanel>
      )}
    </div>
  );
}
