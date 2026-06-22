import { useMemo, useState } from "react";
import { siniestrosApi } from "../api";
import type { Siniestro } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import { estadoSiniestroClase } from "../format";

// Modal de edición de un siniestro, con el mismo formato que el de Recibos:
//  · pastilla de estado + botón "Editar" (en color) bajo el título
//  · abre BLOQUEADO (solo consulta); "Editar" desbloquea los campos
//  · maqueta: izquierda Identificación · derecha Siniestro + Importes · abajo Textos

type Tipo = "text" | "date" | "num" | "int";
type Campo = { key: keyof Siniestro; label: string; tipo: Tipo; full?: boolean };

const IDENT: Campo[] = [
  { key: "certificate", label: "Certificate", tipo: "text", full: true },
  { key: "ucr", label: "UCR", tipo: "text" },
  { key: "insured", label: "Asegurado", tipo: "text", full: true },
  { key: "section", label: "Sección", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "reporting_period", label: "Periodo", tipo: "date" },
  { key: "risk_inception", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry", label: "Fin riesgo", tipo: "date" },
];
const DETALLE: Campo[] = [
  { key: "status", label: "Estado", tipo: "text" },
  { key: "claimant", label: "Reclamante", tipo: "text", full: true },
  { key: "abogado", label: "Abogado", tipo: "text", full: true },
  { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
  { key: "date_opened", label: "Abierto", tipo: "date" },
  { key: "date_closed", label: "Cerrado", tipo: "date" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
  { key: "refer", label: "Refer", tipo: "text" },
  { key: "denial", label: "Denial", tipo: "text" },
];
const IMPORTES: Campo[] = [
  { key: "amount_claimed", label: "Reclamado", tipo: "num", full: true },
  { key: "to_pay_indemnity", label: "A pagar ind.", tipo: "num" },
  { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
  { key: "paid_indemnity", label: "Pagado ind.", tipo: "num" },
  { key: "paid_fees", label: "Pagado fees", tipo: "num" },
  { key: "reserves_indemnity", label: "Reservas ind.", tipo: "num" },
  { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
];
const TEXTOS: Campo[] = [
  { key: "description", label: "Descripción", tipo: "text", full: true },
  { key: "informacion", label: "Información", tipo: "text", full: true },
];
const TODOS = [...IDENT, ...DETALLE, ...IMPORTES, ...TEXTOS];

type Form = Record<string, string>;
function aForm(s: Siniestro): Form {
  const f: Form = {};
  for (const c of TODOS) {
    const v = s[c.key];
    f[c.key as string] = v == null ? "" : c.tipo === "date" ? String(v).slice(0, 10) : String(v);
  }
  return f;
}

export default function SiniestroModal({
  siniestro,
  onClose,
  onSaved,
}: {
  siniestro: Siniestro;
  onClose: () => void;
  onSaved: (s: Siniestro) => void;
}) {
  const inicial = useMemo(() => aForm(siniestro), [siniestro]);
  const [form, setForm] = useState<Form>(inicial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Abre bloqueado (solo consulta) para evitar cambios accidentales; "Editar" desbloquea.
  const [bloqueado, setBloqueado] = useState(true);

  const dirty = useMemo(() => TODOS.some((c) => form[c.key as string] !== inicial[c.key as string]), [form, inicial]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const c of TODOS) {
        const raw = (form[c.key as string] ?? "").trim();
        if (raw === "") payload[c.key as string] = null;
        else if (c.tipo === "int") payload[c.key as string] = Number.parseInt(raw, 10);
        else if (c.tipo === "num") payload[c.key as string] = raw.replace(",", ".");
        else payload[c.key as string] = raw;
      }
      const actualizado = await siniestrosApi.actualizar(siniestro.id, payload as Partial<Siniestro>);
      onSaved(actualizado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Campo según su tipo (deshabilitado mientras está bloqueado).
  const Campo = (c: Campo) => (
    <div className={"field" + (c.full ? " full-w" : "")} key={c.key as string} style={c.full ? { gridColumn: "1 / -1" } : undefined}>
      <label>{c.label}</label>
      {c.tipo === "num" ? (
        <NumberInput value={form[c.key as string] ?? ""} onChange={(v) => set(c.key as string, v)} suffix="€" disabled={bloqueado} />
      ) : c.tipo === "date" ? (
        <input type="date" className="inp-fecha" value={form[c.key as string]} disabled={bloqueado} onChange={(e) => set(c.key as string, e.target.value)} />
      ) : c.tipo === "int" ? (
        <NumberInput value={form[c.key as string] ?? ""} onChange={(v) => set(c.key as string, v)} decimals={0} thousands={false} disabled={bloqueado} />
      ) : (
        <input type="text" value={form[c.key as string]} disabled={bloqueado} onChange={(e) => set(c.key as string, e.target.value)} />
      )}
    </div>
  );

  const claseEstado = siniestro.status ? estadoSiniestroClase(siniestro.status) : null;

  return (
    <FormPanel
      title={`Siniestro · ${siniestro.reference || siniestro.certificate || siniestro.id}`}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      readOnly={bloqueado}
      wide
    >
      {/* Barra de estado/acciones bajo el título (mismo patrón que el modal de Recibos) */}
      <div className="recibo-acciones-top">
        {siniestro.status ? (
          <span className={`pill pill-sin-${claseEstado} pill-estado-lg`}>{siniestro.status}</span>
        ) : (
          <span className="pill pill-estado-lg">Sin estado</span>
        )}
        {siniestro.binder_umr && (
          <span className="hint">{siniestro.binder_umr}{siniestro.binder_programa ? ` · ${siniestro.binder_programa}` : ""}</span>
        )}
        {bloqueado ? (
          <button className="btn-sm btn-corregir" style={{ marginLeft: "auto" }} onClick={() => setBloqueado(false)}>
            ✏️ Editar
          </button>
        ) : (
          <span className="hint" style={{ marginLeft: "auto" }}>✏️ Edición habilitada</span>
        )}
      </div>

      {/* ── Bloque Información: ancho completo ── */}
      <div className="recibo-box">
        <h4>Información</h4>
        <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {IDENT.map(Campo)}
        </div>
        {TEXTOS.map((c) => (
          <div className="field" key={c.key as string}>
            <label>{c.label}</label>
            <textarea rows={2} value={form[c.key as string]} disabled={bloqueado} onChange={(e) => set(c.key as string, e.target.value)} />
          </div>
        ))}
      </div>

      {/* ── Debajo, dos columnas: Siniestro · Importes ── */}
      <div className="recibo-modal" style={{ marginTop: 12 }}>
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>Siniestro</h4>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {DETALLE.map(Campo)}
            </div>
          </div>
        </div>
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>Importes</h4>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {IMPORTES.map(Campo)}
            </div>
          </div>
        </div>
      </div>
    </FormPanel>
  );
}
