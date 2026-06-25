import { useEffect, useMemo, useState } from "react";
import { siniestrosApi } from "../api";
import type { Siniestro } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import { estadoSiniestroClase, fmtMiles } from "../format";

// Póliza del Risk BDX del binder, para el alta de un siniestro: al elegir asegurado/certificate
// se rellenan solos certificate, sección, risk code e inicio/fin de riesgo.
export type PolizaBinder = {
  clave: string;        // identificador único de la combinación (certificate + sección + risk code)
  insured: string;
  certificate: string;
  section: number | null;
  risk_code: string | null;
  risk_inception: string | null;
  risk_expiry: string | null;
};
// Campos que en el alta se autocompletan desde la póliza y NO son editables.
const AUTO_KEYS = new Set(["certificate", "section", "risk_code", "risk_inception", "risk_expiry"]);

// Modal de edición de un siniestro, con el mismo formato que el de Recibos:
//  · pastilla de estado + botón "Editar" (en color) bajo el título
//  · abre BLOQUEADO (solo consulta); "Editar" desbloquea los campos
//  · maqueta: izquierda Identificación · derecha Siniestro + Importes · abajo Textos

type Tipo = "text" | "date" | "num" | "int" | "yesno" | "estado";
type Campo = { key: keyof Siniestro; label: string; tipo: Tipo; full?: boolean; center?: boolean };

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
  { key: "status", label: "Estado", tipo: "estado" },
  { key: "claimant", label: "Reclamante", tipo: "text", full: true },
  { key: "abogado", label: "Abogado", tipo: "text", full: true },
  { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
  { key: "date_opened", label: "Abierto", tipo: "date" },
  { key: "date_closed", label: "Cerrado", tipo: "date" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
  { key: "refer", label: "Refer", tipo: "yesno" },
  { key: "denial", label: "Denial", tipo: "yesno" },
];
const IMPORTES: Campo[] = [
  { key: "amount_claimed", label: "Reclamado", tipo: "num", full: true },
  { key: "to_pay_indemnity", label: "A pagar indemnización", tipo: "num" },
  { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
  { key: "paid_indemnity", label: "Pagado indemnización", tipo: "num" },
  { key: "paid_fees", label: "Pagado fees", tipo: "num" },
  { key: "reserves_indemnity", label: "Reservas indemnización", tipo: "num" },
  { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
];
const TEXTOS: Campo[] = [
  { key: "description", label: "Descripción", tipo: "text", full: true },
  { key: "informacion", label: "Información", tipo: "text", full: true },
];
const TODOS = [...IDENT, ...DETALLE, ...IMPORTES, ...TEXTOS];
const identCampo = (k: keyof Siniestro) => IDENT.find((c) => c.key === k)!;
const detCampo = (k: keyof Siniestro) => DETALLE.find((c) => c.key === k)!;
// Detalle sin los 4 campos que se colocan a mano arriba (Estado/Cerrado y debajo 1er aviso/Abierto).
const DETALLE_COLOCADOS = ["status", "date_closed", "claim_first_advised", "date_opened"];
const DETALLE_RESTO = DETALLE.filter((c) => !DETALLE_COLOCADOS.includes(c.key as string));

type Form = Record<string, string>;
// Normaliza los valores heredados (1/2/YES/N…) a "Sí"/"No"/"" para los campos Sí/No.
function siNo(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (["1", "sí", "si", "s", "yes", "y", "true"].includes(s)) return "Sí";
  if (["2", "no", "n", "false"].includes(s)) return "No";
  return "";
}
function aForm(s: Siniestro): Form {
  const f: Form = {};
  for (const c of TODOS) {
    const v = s[c.key];
    f[c.key as string] =
      c.tipo === "yesno"
        ? siNo(v)
        : c.tipo === "estado"
          ? (estadoSiniestroClase(v as string) === "cerrado" ? "Closed" : estadoSiniestroClase(v as string) === "abierto" ? "Open" : "")
          : v == null
            ? ""
            : c.tipo === "date"
              ? String(v).slice(0, 10)
              : String(v);
  }
  return f;
}
// Formulario vacío para el alta de un siniestro nuevo.
function formVacio(): Form {
  const f: Form = {};
  for (const c of TODOS) f[c.key as string] = "";
  return f;
}

export default function SiniestroModal({
  siniestro,
  binderId,
  binderUmr,
  polizas = [],
  onClose,
  onSaved,
}: {
  siniestro: Siniestro | null;   // null = alta de un siniestro nuevo
  binderId: number;
  binderUmr?: string;
  polizas?: PolizaBinder[];      // pólizas del Risk BDX (solo para el alta)
  onClose: () => void;
  onSaved: (s: Siniestro) => void;
}) {
  const nuevo = siniestro == null;
  const tienePolizas = nuevo && polizas.length > 0;
  const inicial = useMemo(() => (siniestro ? aForm(siniestro) : formVacio()), [siniestro]);
  const [form, setForm] = useState<Form>(inicial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // En edición abre BLOQUEADO (solo consulta) para evitar cambios accidentales; "Editar" desbloquea.
  // En alta abre desbloqueado para poder rellenar directamente.
  const [bloqueado, setBloqueado] = useState(!nuevo);

  // ── Alta: selección de asegurado → (póliza/sección/risk code) → autocompletado ──
  const [selAseg, setSelAseg] = useState("");
  const [selClave, setSelClave] = useState("");
  const asegurados = useMemo(
    () => [...new Set(polizas.map((p) => p.insured).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [polizas],
  );
  // Combinaciones (certificate · sección · risk code) del asegurado elegido.
  const polizasAseg = useMemo(() => polizas.filter((p) => p.insured === selAseg), [polizas, selAseg]);
  // Al cambiar de asegurado, autoselecciona si solo hay una combinación; si hay varias, exige elegir.
  useEffect(() => {
    if (!tienePolizas) return;
    setSelClave(polizasAseg.length === 1 ? polizasAseg[0].clave : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAseg]);
  // Al resolver la combinación, vuelca sus datos en los campos automáticos.
  useEffect(() => {
    if (!tienePolizas) return;
    const pol = polizas.find((p) => p.insured === selAseg && p.clave === selClave);
    setForm((f) => ({
      ...f,
      insured: selAseg,
      certificate: pol?.certificate ?? "",
      section: pol?.section != null ? String(pol.section) : "",
      risk_code: pol?.risk_code ?? "",
      risk_inception: pol?.risk_inception ? String(pol.risk_inception).slice(0, 10) : "",
      risk_expiry: pol?.risk_expiry ? String(pol.risk_expiry).slice(0, 10) : "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAseg, selClave]);

  const dirty = useMemo(() => TODOS.some((c) => form[c.key as string] !== inicial[c.key as string]), [form, inicial]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Totales = incurrido (pagado + reservas), mismo criterio que el resto de la app (sin "a pagar").
  const n = (k: string) => Number(form[k]) || 0;
  const totIndem = n("paid_indemnity") + n("reserves_indemnity");
  const totFees = n("paid_fees") + n("reserves_fees");
  const totGlobal = totIndem + totFees;

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
      const guardado = nuevo
        ? await siniestrosApi.crear(binderId, payload as Partial<Siniestro>)
        : await siniestrosApi.actualizar(siniestro!.id, payload as Partial<Siniestro>);
      onSaved(guardado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Campo según su tipo. El bloque Información (campos de IDENT) NO es editable nunca: solo se
  // habilita el resto al pulsar "Editar".
  const Campo = (c: Campo) => {
    // · En edición: el bloque Identificación no se edita nunca.
    // · En alta con pólizas: los campos autocompletados (certificate, sección, risk code, fechas)
    //   no se editan (vienen de la póliza); el resto sí.
    // · En alta sin pólizas (no hay Risk BDX): Identificación editable a mano.
    const dis =
      bloqueado ||
      (!nuevo && IDENT.some((x) => x.key === c.key)) ||
      (tienePolizas && AUTO_KEYS.has(c.key as string));
    return (
      <div className={"field" + (c.full ? " full-w" : "")} key={c.key as string} style={c.full ? { gridColumn: "1 / -1" } : undefined}>
        <label>{c.label}</label>
        {c.tipo === "num" ? (
          <NumberInput value={form[c.key as string] ?? ""} onChange={(v) => set(c.key as string, v)} suffix="€" disabled={dis} />
        ) : c.tipo === "date" ? (
          <input type="date" className="inp-fecha" value={form[c.key as string]} disabled={dis} style={c.center ? { textAlign: "center" } : undefined} onChange={(e) => set(c.key as string, e.target.value)} />
        ) : c.tipo === "int" ? (
          <NumberInput value={form[c.key as string] ?? ""} onChange={(v) => set(c.key as string, v)} decimals={0} thousands={false} disabled={dis} className={c.center ? "center" : undefined} />
        ) : c.tipo === "estado" ? (
          <select value={form[c.key as string]} disabled={dis} onChange={(e) => set(c.key as string, e.target.value)}>
            <option value="">—</option>
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>
        ) : c.tipo === "yesno" ? (
          <div className="radio-sino">
            {["Sí", "No"].map((opt) => (
              <label key={opt}>
                <input
                  type="radio"
                  name={`yn-${c.key as string}`}
                  checked={form[c.key as string] === opt}
                  disabled={dis}
                  onChange={() => set(c.key as string, opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        ) : (
          <input type="text" value={form[c.key as string]} disabled={dis} style={c.center ? { textAlign: "center" } : undefined} onChange={(e) => set(c.key as string, e.target.value)} />
        )}
      </div>
    );
  };

  const claseEstado = siniestro?.status ? estadoSiniestroClase(siniestro.status) : null;
  const umr = siniestro?.binder_umr ?? binderUmr;

  return (
    <FormPanel
      title={
        nuevo ? (
          "Nuevo siniestro"
        ) : (
          <>
            Siniestro ·{" "}
            <span style={{ color: "var(--naranja-osc)" }}>
              {siniestro!.reference || siniestro!.certificate || siniestro!.id}
            </span>
          </>
        )
      }
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
        {siniestro?.status ? (
          <span className={`pill pill-sin-${claseEstado} pill-estado-lg`}>{siniestro.status}</span>
        ) : (
          <span className="pill pill-estado-lg">{nuevo ? "Alta nueva" : "Sin estado"}</span>
        )}
        {umr && (
          <span className="hint">{umr}{siniestro?.binder_programa ? ` · ${siniestro.binder_programa}` : ""}</span>
        )}
        {nuevo ? (
          <span className="hint" style={{ marginLeft: "auto" }}>✏️ Rellena los datos del siniestro</span>
        ) : bloqueado ? (
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
        {/* Asegurado arriba del todo. En el alta (con pólizas del Risk BDX) es un selector con
            búsqueda; al elegir póliza se rellenan certificate/sección/risk code/fechas. */}
        {tienePolizas ? (
          <>
            <div className="field full-w" style={{ gridColumn: "1 / -1" }}>
              <label>Asegurado</label>
              <input
                type="text"
                list="sin-aseg-list"
                value={selAseg}
                placeholder="Escribe para buscar o elige un asegurado…"
                onChange={(e) => setSelAseg(e.target.value)}
              />
              <datalist id="sin-aseg-list">
                {asegurados.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
            {polizasAseg.length > 1 && (
              <div className="field full-w" style={{ gridColumn: "1 / -1" }}>
                <label>Póliza · {polizasAseg.length} combinaciones (certificate / sección / risk code), elige una</label>
                <select value={selClave} onChange={(e) => setSelClave(e.target.value)}>
                  <option value="">— Elige certificate / sección / risk code —</option>
                  {polizasAseg.map((p) => (
                    <option key={p.clave} value={p.clave}>
                      {p.certificate || "(sin certificate)"}
                      {p.section != null ? ` · Secc. ${p.section}` : ""}
                      {p.risk_code ? ` · ${p.risk_code}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          Campo(identCampo("insured"))
        )}
        {/* Certificate (estrecho) + Sección + Risk Code (centrados) + Inicio/Fin riesgo,
            cada caja ajustada a su contenido y empujadas a la izquierda */}
        <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 52px 60px max-content max-content" }}>
          {Campo({ ...identCampo("certificate"), full: false })}
          {Campo({ ...identCampo("section"), center: true })}
          {Campo({ ...identCampo("risk_code"), center: true })}
          {Campo(identCampo("risk_inception"))}
          {Campo(identCampo("risk_expiry"))}
        </div>
        {/* Resto de identificación (YOA oculto) */}
        <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {[identCampo("ucr"), identCampo("reporting_period")].map(Campo)}
        </div>
      </div>

      {/* ── Debajo, dos columnas: Siniestro · (Importes + Notas) ── */}
      <div className="recibo-modal sin-cols" style={{ marginTop: 12 }}>
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>Siniestro</h4>
            <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {/* Fila 1: Estado | Cerrado (solo si el estado es cerrado; si no, hueco) */}
              {Campo(detCampo("status"))}
              {estadoSiniestroClase(form.status) === "cerrado"
                ? Campo({ ...detCampo("date_closed"), center: true })
                : <div key="sp-cerrado" />}
              {/* Fila 2: 1er aviso (bajo Estado) | Abierto (bajo Cerrado) */}
              {Campo({ ...detCampo("claim_first_advised"), center: true })}
              {Campo({ ...detCampo("date_opened"), center: true })}
              {/* Descripción: ancho completo y más alta, debajo del 1er aviso */}
              <div className="field" key="description" style={{ gridColumn: "1 / -1" }}>
                <label>Descripción</label>
                <textarea rows={5} value={form.description} disabled={bloqueado} onChange={(e) => set("description", e.target.value)} />
              </div>
              {DETALLE_RESTO.map(Campo)}
            </div>
          </div>
        </div>
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>Importes</h4>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {IMPORTES.map(Campo)}
            </div>
            {/* Totales (incurrido = pagado + reservas) */}
            <div className="sin-totales">
              <div className="sin-total-fila">
                <div><span>Total indemnización</span><b>{fmtMiles(totIndem)} €</b></div>
                <div><span>Total fees</span><b>{fmtMiles(totFees)} €</b></div>
              </div>
              <div className="sin-total-fila sin-total-grande">
                <div><span>TOTAL</span><b>{fmtMiles(totGlobal)} €</b></div>
              </div>
            </div>
          </div>
          {/* Notas: bajo Importes, se estira hasta igualar el borde inferior del bloque Siniestro */}
          <div className="recibo-box sin-notas">
            <h4>Notas</h4>
            <div className="field">
              <textarea value={form.informacion} disabled={bloqueado} onChange={(e) => set("informacion", e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </FormPanel>
  );
}
