import { useState } from "react";
import { ucrApi, type UcrRegistro, type UcrWrite } from "../api";
import FormPanel from "./FormPanel";

const ESTADOS = ["Abierto", "Cerrado"];

// Alta/edición de un UCR. Se usa desde la pestaña UCR de un binder (el UMR viene por defecto del binder).
// En edición abre BLOQUEADO (solo consulta); «Editar» desbloquea. En alta abre desbloqueado.
export default function UcrModal({
  ucr,
  umrDefault,
  onClose,
  onSaved,
}: {
  ucr: UcrRegistro | null;      // null = alta
  umrDefault?: string | null;   // UMR del binder (para el alta)
  onClose: () => void;
  onSaved: () => void;
}) {
  const nuevo = ucr == null;
  const [form, setForm] = useState<UcrWrite>(
    ucr
      ? { coverholder: ucr.coverholder, umr: ucr.umr, section: ucr.section, risk_code: ucr.risk_code, signing: ucr.signing, ucr: ucr.ucr, notas: ucr.notas, estado: ucr.estado, tpa: ucr.tpa }
      : { estado: "Abierto", umr: umrDefault ?? "" },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(!nuevo);   // edición abre bloqueada; alta no
  const dis = bloqueado;
  const set = (k: keyof UcrWrite, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    setSaving(true); setError(null);
    try {
      if (ucr) await ucrApi.actualizar(ucr.id, form);
      else await ucrApi.crear(form);
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function borrar() {
    if (!ucr) return;
    if (!confirm("¿Borrar este UCR?")) return;
    setSaving(true); setError(null);
    try { await ucrApi.borrar(ucr.id); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <FormPanel
      title={nuevo ? "Nuevo UCR" : <>UCR · <span style={{ color: "var(--naranja-osc)" }}>{ucr!.ucr || ucr!.id}</span></>}
      dirty saving={saving} error={error}
      saveLabel={nuevo ? "Crear UCR" : "Guardar"}
      onSave={guardar} onClose={onClose}
      onDelete={ucr ? borrar : undefined}
      readOnly={bloqueado}
    >
      {!nuevo && (
        <div className="recibo-acciones-top">
          <span className="hint">{ucr!.umr}{ucr!.estado ? ` · ${ucr!.estado}` : ""}</span>
          {bloqueado ? (
            <button className="btn-sm btn-corregir" style={{ marginLeft: "auto" }} onClick={() => setBloqueado(false)}>✏️ Editar</button>
          ) : (
            <span className="hint" style={{ marginLeft: "auto" }}>✏️ Edición habilitada</span>
          )}
        </div>
      )}

      <div className="field-row" style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 2 }}><label>UCR</label>
          <input type="text" value={form.ucr ?? ""} disabled={dis} onChange={(e) => set("ucr", e.target.value)} placeholder="B1634…AA" />
        </div>
        <div className="field" style={{ flex: 2 }}><label>UMR</label>
          <input type="text" value={form.umr ?? ""} disabled={dis} onChange={(e) => set("umr", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}><label>Estado</label>
          <select value={form.estado ?? "Abierto"} disabled={dis} onChange={(e) => set("estado", e.target.value)}>
            {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Coverholder</label>
        <input type="text" value={form.coverholder ?? ""} disabled={dis} onChange={(e) => set("coverholder", e.target.value)} />
      </div>
      <div className="field-row" style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Sección</label>
          <input type="text" value={form.section ?? ""} disabled={dis} onChange={(e) => set("section", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}><label>Risk Code</label>
          <input type="text" value={form.risk_code ?? ""} disabled={dis} onChange={(e) => set("risk_code", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 2 }}><label>Signing</label>
          <input type="text" value={form.signing ?? ""} disabled={dis} onChange={(e) => set("signing", e.target.value)} placeholder="22619*14/01/2020" />
        </div>
      </div>
      <div className="field"><label>TPA</label>
        <input type="text" value={form.tpa ?? ""} disabled={dis} onChange={(e) => set("tpa", e.target.value)} />
      </div>
      <div className="field"><label>Notas</label>
        <textarea rows={2} value={form.notas ?? ""} disabled={dis} onChange={(e) => set("notas", e.target.value)} />
      </div>
    </FormPanel>
  );
}
