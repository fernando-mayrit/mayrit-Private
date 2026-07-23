import { useEffect, useMemo, useState } from "react";
import { ucrApi, type RiskCodeFdo, type UcrRegistro, type UcrWrite } from "../api";
import { signingUcrDesdeFdo } from "../format";
import FormPanel from "./FormPanel";

const OPCION_NUEVA = "__nueva__";

// Desplegable de TPA que además permite añadir uno nuevo (patrón de CredencialesPage: «➕ Añadir nuevo…»).
function SelectorTpa({ valor, opciones, onChange }: { valor: string; opciones: string[]; onChange: (v: string) => void }) {
  const [modoNuevo, setModoNuevo] = useState(valor !== "" && !opciones.includes(valor));
  if (modoNuevo) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input type="text" style={{ flex: 1 }} value={valor} placeholder="Nombre del TPA…" autoFocus onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-secondary" title="Volver a la lista" onClick={() => { setModoNuevo(false); onChange(""); }}>↩ Lista</button>
      </div>
    );
  }
  return (
    <select value={valor} onChange={(e) => { if (e.target.value === OPCION_NUEVA) { setModoNuevo(true); onChange(""); } else onChange(e.target.value); }}>
      <option value="">— (ninguno) —</option>
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={OPCION_NUEVA}>➕ Añadir nuevo…</option>
    </select>
  );
}

// Sufijo de 2 letras de un UCR = lo que sigue al UMR (o los 2 últimos caracteres si no empieza por el UMR).
function sufijoDe(ucr: string | null | undefined, umr: string | null | undefined): string {
  const u = (ucr ?? "").toUpperCase();
  const p = (umr ?? "").toUpperCase();
  return p && u.startsWith(p) ? u.slice(p.length) : u.slice(-2);
}

// Alta/edición de un UCR. El UCR nace de un FDO: UMR y Coverholder vienen fijos del binder; del nº de UCR
// solo se editan las DOS últimas letras (el resto = UMR) y no pueden duplicar otro UCR del binder. Al elegir
// un FDO se rellenan (y bloquean) Sección, Risk Code y Signing (este invertido). En edición abre BLOQUEADO.
export default function UcrModal({
  ucr,
  umrDefault,
  fdos,
  coverholder,
  ucrsExistentes,
  onClose,
  onSaved,
}: {
  ucr: UcrRegistro | null;         // null = alta
  umrDefault?: string | null;      // UMR del binder (fijo)
  fdos: RiskCodeFdo[];             // FDO generados del binder (para vincular)
  coverholder?: string | null;     // Coverholder del binder (fijo)
  ucrsExistentes: string[];        // UCR ya existentes del binder (para no duplicar el sufijo)
  onClose: () => void;
  onSaved: () => void;
}) {
  const nuevo = ucr == null;
  const umrPrefijo = (ucr?.umr ?? umrDefault ?? "").toUpperCase();
  const [form, setForm] = useState<UcrWrite>(
    ucr
      ? { coverholder: ucr.coverholder, umr: ucr.umr, section: ucr.section, risk_code: ucr.risk_code, signing: ucr.signing, ucr: ucr.ucr, notas: ucr.notas, estado: ucr.estado, tpa: ucr.tpa }
      : { estado: "Abierto", umr: umrDefault ?? "", coverholder: coverholder ?? "" },
  );
  const [sufijo, setSufijo] = useState<string>(nuevo ? "" : sufijoDe(ucr!.ucr, ucr!.umr));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(!nuevo);   // edición abre bloqueada; alta no
  const [tpas, setTpas] = useState<string[]>([]);
  // Solo se considera "sucio" (aviso al cerrar) si el usuario edita algo de verdad; los prefills
  // automáticos (sugerencia de UCR, lista de TPA) no cuentan porque no pasan por estos handlers.
  const [tocado, setTocado] = useState(false);
  const dis = bloqueado;

  const set = (k: keyof UcrWrite, v: string) => { setTocado(true); setForm((f) => ({ ...f, [k]: v })); };

  // Opciones de TPA (desplegable con alta).
  useEffect(() => {
    ucrApi.opciones().then((o) => setTpas(o.tpas)).catch(() => {});
  }, []);

  // En alta: sugerir el siguiente sufijo libre del UMR (rellena huecos). Editable a mano después.
  useEffect(() => {
    if (!nuevo || !umrPrefijo) return;
    ucrApi.nextUcr(umrPrefijo).then((r) => {
      setSufijo((prev) => prev || r.sufijo);
      setForm((f) => (f.ucr ? f : { ...f, ucr: r.ucr }));
    }).catch(() => {});
  }, [nuevo, umrPrefijo]);

  // Sufijos ya usados en el binder (excluye el propio al editar) → para no duplicar.
  const usados = useMemo(() => {
    const propio = nuevo ? "" : sufijoDe(ucr!.ucr, ucr!.umr);
    const s = new Set<string>();
    for (const code of ucrsExistentes) {
      const suf = sufijoDe(code, umrPrefijo);
      if (suf && suf !== propio) s.add(suf);
    }
    return s;
  }, [ucrsExistentes, umrPrefijo, nuevo, ucr]);

  const sufValido = /^[A-Z]{2}$/.test(sufijo);
  const sufDuplicado = usados.has(sufijo);
  const sufError = !sufijo ? "Indica las 2 letras del UCR." : (!sufValido ? "Deben ser 2 letras (A–Z)." : (sufDuplicado ? `El UCR ${umrPrefijo}${sufijo} ya existe en este binder.` : null));

  function cambiarSufijo(v: string) {
    const s = v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    setTocado(true);
    setSufijo(s);
    setForm((f) => ({ ...f, ucr: umrPrefijo + s }));
  }

  // Al elegir un FDO: Sección + Risk Code + Signing (invertido) se ponen solos.
  function vincularFdo(key: string) {
    setTocado(true);
    const rc = fdos.find((f) => `${f.section}|${f.risk_code}` === key);
    setForm((f) => ({
      ...f,
      section: rc ? String(rc.section) : "",
      risk_code: rc ? rc.risk_code : "",
      signing: rc ? signingUcrDesdeFdo(rc.fdo?.signing_number) : "",
    }));
  }

  async function guardar() {
    if (sufError) { setError(sufError); return; }
    // Todos los campos son obligatorios salvo Notas.
    const faltan: string[] = [];
    if (!(form.coverholder ?? "").trim()) faltan.push("Coverholder");
    if (!(form.umr ?? "").trim()) faltan.push("UMR");
    if (!(form.section ?? "").trim() || !(form.risk_code ?? "").trim()) faltan.push("FDO vinculado");
    if (!(form.signing ?? "").trim()) faltan.push("Signing");
    if (!(form.tpa ?? "").trim()) faltan.push("TPA");
    if (faltan.length) { setError(`Faltan campos obligatorios: ${faltan.join(", ")}.`); return; }
    setSaving(true); setError(null);
    try {
      const datos = { ...form, ucr: umrPrefijo + sufijo };
      if (ucr) await ucrApi.actualizar(ucr.id, datos);
      else await ucrApi.crear(datos);
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

  const estado = form.estado ?? "Abierto";
  const cerrado = /cerrad/i.test(estado);
  const fdoKey = form.section && form.risk_code ? `${form.section}|${form.risk_code}` : "";
  const req = <span style={{ color: "#c0392b" }}> *</span>;   // marca de campo obligatorio

  return (
    <FormPanel
      title={nuevo ? "🔖 Nuevo UCR" : <>🔖 UCR · <span style={{ color: "var(--naranja-osc)" }}>{ucr!.ucr || ucr!.id}</span></>}
      dirty={tocado} saving={saving} error={error}
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

      <div className="field"><label>UCR{req} <span className="hint">(solo se editan las 2 últimas letras)</span></label>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{umrPrefijo}</span>
          <input type="text" value={sufijo} disabled={dis} maxLength={2}
                 style={{ width: 60, textAlign: "center", textTransform: "uppercase", fontWeight: 700, letterSpacing: 2 }}
                 onChange={(e) => cambiarSufijo(e.target.value)} placeholder="AA" />
        </div>
        {!dis && sufError && sufijo !== "" && <div className="hint" style={{ color: "var(--rojo, #c0392b)" }}>{sufError}</div>}
      </div>
      <div className="field-row" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 3 }}><label>UMR{req}</label>
          <input type="text" value={form.umr ?? ""} disabled onChange={(e) => set("umr", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}><label>Estado</label>
          <button
            type="button"
            className={`pill ${cerrado ? "pill-pendiente" : "pill-cobrado"}`}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 14, border: "1px solid transparent", cursor: dis ? "default" : "pointer" }}
            disabled={dis}
            onClick={() => set("estado", cerrado ? "Abierto" : "Cerrado")}
          >{cerrado ? "Cerrado" : "Abierto"}</button>
        </div>
      </div>
      <div className="field"><label>Coverholder{req}</label>
        <input type="text" value={form.coverholder ?? ""} disabled onChange={(e) => set("coverholder", e.target.value)} />
      </div>
      <div className="field"><label>FDO vinculado{req}</label>
        <select value={fdoKey} disabled={dis} onChange={(e) => vincularFdo(e.target.value)}>
          <option value="">— Elige un FDO —</option>
          {fdos.map((f) => (
            <option key={`${f.section}|${f.risk_code}`} value={`${f.section}|${f.risk_code}`}>
              S{f.section} · {f.risk_code}{f.broker_reference ? ` — ${f.broker_reference}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row" style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Sección{req}</label>
          <input type="text" value={form.section ?? ""} disabled readOnly />
        </div>
        <div className="field" style={{ flex: 1 }}><label>Risk Code{req}</label>
          <input type="text" value={form.risk_code ?? ""} disabled readOnly />
        </div>
        <div className="field" style={{ flex: 2 }}><label>Signing{req}</label>
          <input type="text" value={form.signing ?? ""} disabled readOnly placeholder="2020/01/14*22619" />
        </div>
      </div>
      {/* El Signing sale solo del FDO: si el FDO elegido no lo tiene (o no se puede leer), decirlo
          aquí — antes solo se veía «Faltan campos obligatorios: Signing» sin pistas de por qué. */}
      {fdoKey && !(form.signing ?? "").trim() && (
        <div className="hint" style={{ color: "var(--rojo, #c0392b)", marginTop: -4 }}>
          El FDO elegido no tiene signing number (o está en un formato que no se reconoce): ponlo en el
          FDO (pestaña LPAN del binder) y vuelve a elegirlo aquí.
        </div>
      )}
      <div className="field"><label>TPA{req}</label>
        {dis ? (
          <input type="text" value={form.tpa ?? ""} disabled />
        ) : (
          <SelectorTpa valor={form.tpa ?? ""} opciones={tpas} onChange={(v) => set("tpa", v)} />
        )}
      </div>
      <div className="field"><label>Notas</label>
        <textarea rows={2} value={form.notas ?? ""} disabled={dis} onChange={(e) => set("notas", e.target.value)} />
      </div>
    </FormPanel>
  );
}
