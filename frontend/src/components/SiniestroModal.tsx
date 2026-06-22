import { useMemo, useState } from "react";
import { siniestrosApi } from "../api";
import type { Siniestro } from "../types";
import FormPanel from "./FormPanel";

// Modal de edición manual de un siniestro. Reutiliza el panel estándar (FormPanel).
type Tipo = "text" | "date" | "num" | "int" | "textarea";
type Campo = { key: keyof Siniestro; label: string; tipo: Tipo };

const SECCIONES: { titulo: string; campos: Campo[] }[] = [
  {
    titulo: "Identificación",
    campos: [
      { key: "certificate", label: "Certificate", tipo: "text" },
      { key: "reference", label: "Reference", tipo: "text" },
      { key: "insured", label: "Asegurado", tipo: "text" },
      { key: "section", label: "Sección", tipo: "int" },
      { key: "yoa", label: "YOA", tipo: "int" },
      { key: "risk_code", label: "Risk Code", tipo: "text" },
      { key: "currency", label: "Moneda", tipo: "text" },
      { key: "reporting_period", label: "Periodo", tipo: "text" },
      { key: "ucr", label: "UCR", tipo: "text" },
      { key: "risk_inception", label: "Inicio riesgo", tipo: "date" },
      { key: "risk_expiry", label: "Fin riesgo", tipo: "date" },
    ],
  },
  {
    titulo: "Siniestro",
    campos: [
      { key: "status", label: "Estado", tipo: "text" },
      { key: "claimant", label: "Reclamante", tipo: "text" },
      { key: "abogado", label: "Abogado", tipo: "text" },
      { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
      { key: "date_opened", label: "Abierto", tipo: "date" },
      { key: "date_closed", label: "Cerrado", tipo: "date" },
      { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
      { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
      { key: "refer", label: "Refer", tipo: "text" },
      { key: "denial", label: "Denial", tipo: "text" },
    ],
  },
  {
    titulo: "Importes",
    campos: [
      { key: "amount_claimed", label: "Reclamado", tipo: "num" },
      { key: "to_pay_indemnity", label: "A pagar ind.", tipo: "num" },
      { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
      { key: "paid_indemnity", label: "Pagado ind.", tipo: "num" },
      { key: "paid_fees", label: "Pagado fees", tipo: "num" },
      { key: "reserves_indemnity", label: "Reservas ind.", tipo: "num" },
      { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
    ],
  },
];
const TEXTAREAS: Campo[] = [
  { key: "description", label: "Descripción", tipo: "textarea" },
  { key: "informacion", label: "Información", tipo: "textarea" },
];

const TODOS = [...SECCIONES.flatMap((s) => s.campos), ...TEXTAREAS];

type Form = Record<string, string>;
function aForm(s: Siniestro): Form {
  const f: Form = {};
  for (const c of TODOS) {
    const v = s[c.key];
    f[c.key as string] = v == null ? "" : String(c.tipo === "date" ? String(v).slice(0, 10) : v);
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
  // Abre bloqueado (solo consulta) para evitar cambios accidentales; el botón "Editar" desbloquea.
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
        if (raw === "") {
          payload[c.key as string] = null;
        } else if (c.tipo === "int") {
          payload[c.key as string] = Number.parseInt(raw, 10);
        } else if (c.tipo === "num") {
          payload[c.key as string] = raw.replace(",", ".");
        } else {
          payload[c.key as string] = raw;
        }
      }
      const actualizado = await siniestrosApi.actualizar(siniestro.id, payload as Partial<Siniestro>);
      onSaved(actualizado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const campoInput = (c: Campo) => (
    <div className="field" key={c.key as string}>
      <label>{c.label}</label>
      {c.tipo === "textarea" ? (
        <textarea rows={2} value={form[c.key as string]} disabled={bloqueado} onChange={(e) => set(c.key as string, e.target.value)} />
      ) : (
        <input
          type={c.tipo === "date" ? "date" : c.tipo === "num" ? "number" : c.tipo === "int" ? "number" : "text"}
          step={c.tipo === "num" ? "0.01" : undefined}
          className={c.tipo === "date" ? "inp-fecha" : undefined}
          value={form[c.key as string]}
          disabled={bloqueado}
          onChange={(e) => set(c.key as string, e.target.value)}
        />
      )}
    </div>
  );

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
      <div className="sin-modal-barra">
        <span className="hint" style={{ margin: 0 }}>
          {siniestro.binder_umr ? `Binder ${siniestro.binder_umr}${siniestro.binder_programa ? ` · ${siniestro.binder_programa}` : ""} · ` : ""}
          {bloqueado ? "🔒 Solo consulta" : "✏️ Edición habilitada"}
        </span>
        {bloqueado && (
          <button className="btn-secondary btn-sm" onClick={() => setBloqueado(false)}>
            ✏️ Editar
          </button>
        )}
      </div>
      {SECCIONES.map((sec) => (
        <div key={sec.titulo} style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "4px 0 8px" }}>{sec.titulo}</h3>
          <div className="sin-modal-grid">{sec.campos.map(campoInput)}</div>
        </div>
      ))}
      <h3 style={{ margin: "4px 0 8px" }}>Textos</h3>
      {TEXTAREAS.map(campoInput)}
    </FormPanel>
  );
}
