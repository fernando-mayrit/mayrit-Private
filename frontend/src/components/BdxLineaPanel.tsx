import { useRef, useState } from "react";
import { bdxApi } from "../api";
import type { BdxLinea, BdxLineaWrite } from "../types";
import FormPanel from "./FormPanel";
import LineaLpan from "./LineaLpan";
import NumberInput from "./NumberInput";

type Tipo = "text" | "num" | "int" | "date" | "bool" | "area";
type Campo = { key: string; label: string; tipo: Tipo };

// ── Catálogo de TODOS los campos editables de una línea (con su etiqueta por defecto y tipo) ──
function impuesto(n: 1 | 2 | 3 | 4): Campo[] {
  const p = `tax${n}`;
  return [
    { key: `${p}_jurisdiction`, label: `Imp. ${n} — Jurisdicción`, tipo: "text" },
    { key: `${p}_type`, label: `Imp. ${n} — Tipo`, tipo: "text" },
    { key: `${p}_taxable_premium`, label: `Imp. ${n} — Base imponible`, tipo: "num" },
    { key: `${p}_pct`, label: `Imp. ${n} — %`, tipo: "num" },
    { key: `${p}_amount`, label: `Imp. ${n} — Importe`, tipo: "num" },
    { key: `${p}_administered_by`, label: `Imp. ${n} — Administrado por`, tipo: "text" },
    { key: `${p}_payable_by`, label: `Imp. ${n} — Pagadero por`, tipo: "text" },
  ];
}

const CAMPOS: Campo[] = [
  { key: "reporting_period_start", label: "Risk Bdx (Reporting Start)", tipo: "date" },
  { key: "reporting_period_end", label: "Reporting End", tipo: "date" },
  { key: "section_no", label: "Section No", tipo: "int" },
  { key: "class_of_business", label: "Class of Business", tipo: "text" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "type_of_insurance", label: "Type of Insurance", tipo: "text" },
  { key: "certificate_ref", label: "Certificado", tipo: "text" },
  { key: "insured_name", label: "Asegurado (nombre/razón social)", tipo: "text" },
  { key: "insured_id", label: "ID Asegurado / Tomador", tipo: "text" },
  { key: "insured_address", label: "Dirección", tipo: "text" },
  { key: "insured_province", label: "Provincia", tipo: "text" },
  { key: "insured_postcode", label: "Código postal", tipo: "text" },
  { key: "insured_country", label: "País", tipo: "text" },
  { key: "risk_inception_date", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry_date", label: "Vto. riesgo", tipo: "date" },
  { key: "location_risk_province", label: "Localización riesgo — Provincia", tipo: "text" },
  { key: "location_risk_country", label: "Localización riesgo — País", tipo: "text" },
  { key: "risk_transaction_type", label: "Risk Transaction Type", tipo: "text" },
  { key: "transaction_type", label: "Transaction Type", tipo: "text" },
  { key: "effective_date_transaction", label: "Efecto transacción", tipo: "date" },
  { key: "expiry_date_transaction", label: "Vto. transacción", tipo: "date" },
  { key: "original_currency", label: "Moneda", tipo: "text" },
  { key: "gross_written_premium", label: "GWP", tipo: "num" },
  { key: "written_line_pct", label: "Written Line %", tipo: "num" },
  { key: "total_gwp_our_line", label: "GWP (our line)", tipo: "num" },
  { key: "fees", label: "Fees", tipo: "num" },
  { key: "commission_coverholder_pct", label: "Comisión %", tipo: "num" },
  { key: "commission_coverholder_amount", label: "Comisión (importe)", tipo: "num" },
  { key: "total_taxes_levies", label: "Impuestos y tasas", tipo: "num" },
  { key: "total_gwp_including_tax", label: "GWP c/impuestos", tipo: "num" },
  { key: "net_premium_to_broker", label: "Prima a Mayrit", tipo: "num" },
  { key: "sum_insured_total", label: "Suma asegurada (100%)", tipo: "num" },
  { key: "sum_insured_our_line", label: "Suma asegurada (our line)", tipo: "num" },
  { key: "deductible_amount", label: "Deducible", tipo: "num" },
  { key: "deductible_basis", label: "Base deducible", tipo: "text" },
  { key: "incluido_en_premium", label: "Incluido en Premium", tipo: "bool" },
  { key: "premium_bdx", label: "Premium Bdx", tipo: "date" },
  ...impuesto(1),
  ...impuesto(2),
  ...impuesto(3),
  ...impuesto(4),
  { key: "instalment_number", label: "Instalment Number", tipo: "int" },
  { key: "number_of_instalments", label: "Number of Instalments", tipo: "int" },
  { key: "referred_to_london", label: "Referred to London", tipo: "text" },
  { key: "pct_for_lloyds", label: "% for Lloyd's", tipo: "num" },
  { key: "policy_issuance_date", label: "Policy issuance date", tipo: "date" },
  { key: "policy_number_reinsured", label: "Policy Number Reinsured", tipo: "text" },
  { key: "brokerage_pct", label: "Brokerage %", tipo: "num" },
  { key: "brokerage_amount", label: "Brokerage (importe)", tipo: "num" },
  { key: "final_net_premium_uw", label: "Final Net Premium to UW", tipo: "num" },
  { key: "coverholder_name", label: "Coverholder", tipo: "text" },
  { key: "broker_name", label: "Broker", tipo: "text" },
  { key: "broker_id", label: "Broker ID", tipo: "text" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "umr", label: "UMR", tipo: "text" },
  { key: "invoice_number", label: "Nº factura", tipo: "text" },
  { key: "prima_cobrada", label: "Cobrado (sí/no)", tipo: "bool" },
  { key: "ingresado", label: "Cobrado (importe)", tipo: "num" },
  { key: "premium_payment_date", label: "Fecha de cobro", tipo: "date" },
  { key: "traspaso", label: "Traspaso (sí/no)", tipo: "bool" },
  { key: "traspasado", label: "Traspasado (importe)", tipo: "num" },
  { key: "fecha_traspaso", label: "Fecha traspaso", tipo: "date" },
  { key: "liquidado", label: "Liquidado (sí/no)", tipo: "bool" },
  { key: "liquidado_uw", label: "Liquidado (importe)", tipo: "num" },
  { key: "fecha_liquidacion", label: "Fecha liquidación", tipo: "date" },
  { key: "recibo", label: "Recibo", tipo: "text" },
  { key: "notas", label: "Notas", tipo: "area" },
];
const TIPO_DE: Record<string, Tipo> = Object.fromEntries(CAMPOS.map((c) => [c.key, c.tipo]));
const LABEL_DE: Record<string, string> = Object.fromEntries(CAMPOS.map((c) => [c.key, c.label]));

// ── Layout (maquetación): grupos con nº de columnas y campos ordenados ──
type LCampo = { key: string; label: string };
type LGrupo = { id: string; titulo: string; cols: number; campos: LCampo[] };

function g(id: string, titulo: string, cols: number, keys: string[]): LGrupo {
  return { id, titulo, cols, campos: keys.map((k) => ({ key: k, label: LABEL_DE[k] })) };
}
const DEFAULT_LAYOUT: LGrupo[] = [
  g("ident", "Identificación", 3, ["reporting_period_start", "reporting_period_end", "section_no", "class_of_business", "risk_code", "type_of_insurance", "certificate_ref"]),
  g("aseg", "Asegurado", 3, ["insured_name", "insured_id", "insured_address", "insured_province", "insured_postcode", "insured_country"]),
  g("riesgo", "Riesgo", 3, ["risk_inception_date", "risk_expiry_date", "location_risk_province", "location_risk_country", "risk_transaction_type", "transaction_type", "effective_date_transaction", "expiry_date_transaction"]),
  g("prima", "Prima", 3, ["original_currency", "gross_written_premium", "written_line_pct", "total_gwp_our_line", "fees", "commission_coverholder_pct", "commission_coverholder_amount", "total_taxes_levies", "total_gwp_including_tax", "net_premium_to_broker"]),
  g("suma", "Suma asegurada / deducible", 2, ["sum_insured_total", "sum_insured_our_line", "deductible_amount", "deductible_basis"]),
  g("premium", "Premium", 2, ["incluido_en_premium", "premium_bdx"]),
  g("imp1", "Impuesto 1", 3, ["tax1_jurisdiction", "tax1_type", "tax1_taxable_premium", "tax1_pct", "tax1_amount", "tax1_administered_by", "tax1_payable_by"]),
  g("imp2", "Impuesto 2", 3, ["tax2_jurisdiction", "tax2_type", "tax2_taxable_premium", "tax2_pct", "tax2_amount", "tax2_administered_by", "tax2_payable_by"]),
  g("imp3", "Impuesto 3", 3, ["tax3_jurisdiction", "tax3_type", "tax3_taxable_premium", "tax3_pct", "tax3_amount", "tax3_administered_by", "tax3_payable_by"]),
  g("imp4", "Impuesto 4", 3, ["tax4_jurisdiction", "tax4_type", "tax4_taxable_premium", "tax4_pct", "tax4_amount", "tax4_administered_by", "tax4_payable_by"]),
  g("plazos", "Plazos / Lloyd's / brokerage", 3, ["instalment_number", "number_of_instalments", "referred_to_london", "pct_for_lloyds", "policy_issuance_date", "policy_number_reinsured", "brokerage_pct", "brokerage_amount", "final_net_premium_uw"]),
  g("identadd", "Identificación adicional", 3, ["coverholder_name", "broker_name", "broker_id", "yoa", "umr", "invoice_number"]),
  g("control", "Control interno (cobro / pago)", 3, ["prima_cobrada", "ingresado", "premium_payment_date", "traspaso", "traspasado", "fecha_traspaso", "liquidado", "liquidado_uw", "fecha_liquidacion", "recibo", "notas"]),
];

// v3: grupos grandes a 3 columnas por defecto (el modal ya es ancho) → menos scroll. Sube la versión
// para que a todos les entre el nuevo layout (los que tuvieran uno guardado v2 lo pierden, no los datos).
const LAYOUT_KEY = "mayrit.bdxlinea.layout.v3";

function cargarLayout(): LGrupo[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const lay = JSON.parse(raw) as LGrupo[];
      // Filtra campos que ya no existan en el catálogo.
      const limpio = lay.map((gr) => ({ ...gr, campos: gr.campos.filter((c) => TIPO_DE[c.key]) }));
      if (limpio.length) return limpio;
    }
  } catch {
    /* ignora */
  }
  return DEFAULT_LAYOUT;
}

type FormVals = Record<string, string | boolean>;

function inicialDe(l: BdxLinea | null): FormVals {
  const v: FormVals = {};
  for (const c of CAMPOS) {
    const raw = l ? (l as unknown as Record<string, unknown>)[c.key] : undefined;
    v[c.key] = c.tipo === "bool" ? Boolean(raw) : raw == null ? "" : String(raw);
  }
  return v;
}
function num(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
}
function payloadDe(v: FormVals): BdxLineaWrite {
  const out: Record<string, unknown> = {};
  for (const c of CAMPOS) {
    const val = v[c.key];
    if (c.tipo === "bool") out[c.key] = Boolean(val);
    else if (c.tipo === "num") out[c.key] = num(String(val));
    else if (c.tipo === "int") {
      const n = num(String(val));
      out[c.key] = n == null ? null : Math.trunc(n);
    } else out[c.key] = String(val).trim() || null;
  }
  return out as BdxLineaWrite;
}

type Props = {
  bdxId: number;
  linea: BdxLinea | null;
  onSaved: () => void;
  onClose: () => void;
  onDeleted: () => void;
  readOnly?: boolean; // periodo bloqueado: solo consulta, sin editar/guardar/borrar
};

export default function BdxLineaPanel({ bdxId, linea, onSaved, onClose, onDeleted, readOnly = false }: Props) {
  const [vals, setVals] = useState<FormVals>(() => inicialDe(linea));
  const [inicial] = useState<FormVals>(() => inicialDe(linea));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Una línea existente abre BLOQUEADA (solo consulta); "Corregir" la habilita. Una línea nueva
  // abre ya editable. El periodo cerrado (readOnly) es un bloqueo duro que no se puede levantar aquí.
  const [bloqueado, setBloqueado] = useState(() => !!linea && !readOnly);
  const ro = readOnly || bloqueado; // solo lectura efectiva (duro o blando)

  const [layout, setLayout] = useState<LGrupo[]>(cargarLayout);
  const [diseno, setDiseno] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const nuevoId = useRef(0);

  const dirty = JSON.stringify(vals) !== JSON.stringify(inicial);

  function set(key: string, value: string | boolean) {
    setVals((v) => ({ ...v, [key]: value }));
  }
  function guardarLayout(lay: LGrupo[]) {
    setLayout(lay);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(lay));
    } catch {
      /* ignora */
    }
  }

  // Campos no colocados en ningún grupo → disponibles para arrastrar.
  const colocados = new Set(layout.flatMap((gr) => gr.campos.map((c) => c.key)));
  const disponibles = CAMPOS.filter((c) => !colocados.has(c.key));

  // Mueve un campo a un grupo (antes de beforeKey, o al final). grupoId "__avail__" = quitarlo.
  function colocar(key: string, grupoId: string, beforeKey: string | null) {
    const label =
      layout.flatMap((gr) => gr.campos).find((c) => c.key === key)?.label ?? LABEL_DE[key];
    let lay = layout.map((gr) => ({ ...gr, campos: gr.campos.filter((c) => c.key !== key) }));
    if (grupoId !== "__avail__") {
      lay = lay.map((gr) => {
        if (gr.id !== grupoId) return gr;
        const campos = [...gr.campos];
        const idx = beforeKey ? campos.findIndex((c) => c.key === beforeKey) : campos.length;
        campos.splice(idx < 0 ? campos.length : idx, 0, { key, label });
        return { ...gr, campos };
      });
    }
    guardarLayout(lay);
  }
  function setCols(grupoId: string, cols: number) {
    guardarLayout(layout.map((gr) => (gr.id === grupoId ? { ...gr, cols } : gr)));
  }
  function renombrarGrupo(grupoId: string) {
    const gr = layout.find((x) => x.id === grupoId);
    const n = window.prompt("Nombre del grupo:", gr?.titulo ?? "");
    if (n != null) guardarLayout(layout.map((x) => (x.id === grupoId ? { ...x, titulo: n } : x)));
  }
  function renombrarCampo(grupoId: string, key: string) {
    const actual = layout.find((x) => x.id === grupoId)?.campos.find((c) => c.key === key)?.label ?? "";
    const n = window.prompt("Etiqueta del campo:", actual);
    if (n != null)
      guardarLayout(
        layout.map((x) =>
          x.id === grupoId ? { ...x, campos: x.campos.map((c) => (c.key === key ? { ...c, label: n } : c)) } : x
        )
      );
  }
  function addGrupo() {
    nuevoId.current += 1;
    guardarLayout([...layout, { id: `nuevo${nuevoId.current}`, titulo: "Nuevo grupo", cols: 2, campos: [] }]);
  }
  function delGrupo(grupoId: string) {
    // Sus campos vuelven a "disponibles" (al quitarse del layout).
    guardarLayout(layout.filter((x) => x.id !== grupoId));
  }

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      const payload = payloadDe(vals);
      if (linea) await bdxApi.editarLinea(linea.id, payload);
      else await bdxApi.crearLinea(bdxId, payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function borrar() {
    if (!linea) return;
    if (!confirm("¿Borrar esta línea?")) return;
    setSaving(true);
    try {
      await bdxApi.borrarLinea(linea.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  function renderInput(key: string, tipo: Tipo, label: string) {
    if (tipo === "bool") {
      return (
        <label className="check-inline">
          <input
            type="checkbox"
            checked={Boolean(vals[key])}
            onChange={(e) => set(key, e.target.checked)}
            disabled={ro}
          />
          {label}
        </label>
      );
    }
    if (tipo === "num") {
      return (
        <>
          <label>{label}</label>
          <NumberInput value={String(vals[key] ?? "")} onChange={(v) => set(key, v)} disabled={ro} />
        </>
      );
    }
    if (tipo === "int") {
      return (
        <>
          <label>{label}</label>
          <NumberInput value={String(vals[key] ?? "")} onChange={(v) => set(key, v)} decimals={0} thousands={false} disabled={ro} />
        </>
      );
    }
    if (tipo === "area") {
      return (
        <>
          <label>{label}</label>
          <textarea rows={3} value={String(vals[key] ?? "")} onChange={(e) => set(key, e.target.value)} disabled={ro} />
        </>
      );
    }
    return (
      <>
        <label>{label}</label>
        <input
          type={tipo === "date" ? "date" : "text"}
          className={tipo === "date" ? "inp-fecha" : undefined}
          value={String(vals[key] ?? "")}
          onChange={(e) => set(key, e.target.value)}
          disabled={ro}
        />
      </>
    );
  }

  return (
    <FormPanel
      title={readOnly ? "Línea de BDX (periodo bloqueado)" : linea ? "Editar línea de BDX" : "Nueva línea de BDX"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={linea && !ro ? borrar : undefined}
      readOnly={ro}
      wide
    >
      {readOnly && (
        <div className="hint" style={{ marginBottom: 10 }}>
          🔒 Este periodo está bloqueado (BDX presentado/cerrado). Solo consulta: no se puede editar.
        </div>
      )}
      {/* Línea existente en periodo abierto: abre bloqueada; "Corregir" habilita la edición (arriba a la izquierda). */}
      {!readOnly && linea && (
        <div className="recibo-acciones-top">
          {bloqueado ? (
            <button type="button" className="btn-sm btn-corregir" onClick={() => setBloqueado(false)}>✏️ Corregir</button>
          ) : (
            <span className="hint">✏️ Edición habilitada</span>
          )}
        </div>
      )}
      <div className="diseno-barra">
        <button type="button" className={"btn-secondary btn-sm" + (diseno ? " sel" : "")} onClick={() => setDiseno((d) => !d)}>
          {diseno ? "✓ Diseñando" : "✎ Diseñar formulario"}
        </button>
        {diseno && (
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={addGrupo}>
              + Grupo
            </button>
            <button type="button" className="btn-link" onClick={() => guardarLayout(DEFAULT_LAYOUT)}>
              Restablecer
            </button>
          </>
        )}
      </div>

      {diseno && (
        <div className="hint" style={{ marginBottom: 10 }}>
          Arrastra los campos para ordenarlos o moverlos entre grupos. Suéltalos en «Campos
          disponibles» para quitarlos. ✎ renombra · cambia las columnas con 1/2/3.
        </div>
      )}

      {layout.map((gr) => (
        <div
          className={"bdx-grupo" + (diseno ? " grupo-diseno" : "")}
          key={gr.id}
          onDragOver={diseno ? (e) => e.preventDefault() : undefined}
          onDrop={diseno ? (e) => { e.preventDefault(); if (drag) colocar(drag, gr.id, null); setDrag(null); } : undefined}
        >
          <div className="grupo-cab">
            <h3 style={{ margin: 0 }}>
              {gr.titulo}
              {diseno && (
                <button type="button" className="btn-link btn-mini" onClick={() => renombrarGrupo(gr.id)} title="Renombrar grupo">
                  ✎
                </button>
              )}
            </h3>
            {diseno && (
              <div className="grupo-tools">
                {[1, 2, 3].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={"col-btn" + (gr.cols === c ? " sel" : "")}
                    onClick={() => setCols(gr.id, c)}
                    title={`${c} columna(s)`}
                  >
                    {c}
                  </button>
                ))}
                <button type="button" className="btn-link btn-mini" style={{ color: "var(--rojo)" }} onClick={() => delGrupo(gr.id)} title="Quitar grupo">
                  ✕
                </button>
              </div>
            )}
          </div>

          <div className="campos-grid" style={{ gridTemplateColumns: `repeat(${gr.cols}, minmax(0, 1fr))` }}>
            {gr.campos.map((c) => {
              const tipo = TIPO_DE[c.key];
              if (diseno) {
                return (
                  <div
                    key={c.key}
                    className={"campo-chip" + (drag === c.key ? " arrastrando" : "")}
                    draggable
                    onDragStart={(e) => { setDrag(c.key); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag) colocar(drag, gr.id, c.key); setDrag(null); }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <span className="campo-chip-label">{c.label}</span>
                    <button type="button" className="btn-link btn-mini" onClick={() => renombrarCampo(gr.id, c.key)} title="Renombrar">
                      ✎
                    </button>
                  </div>
                );
              }
              return (
                <div className={"field" + (tipo === "area" ? " campo-full" : "")} key={c.key}>
                  {renderInput(c.key, tipo, c.label)}
                </div>
              );
            })}
            {diseno && gr.campos.length === 0 && <div className="campo-vacio">Suelta campos aquí</div>}
          </div>
        </div>
      ))}

      {!diseno && linea?.extra && Object.keys(linea.extra).length > 0 && (
        <div className="bdx-grupo">
          <div className="grupo-cab">
            <h3 style={{ margin: 0 }}>
              Extra <span className="hint" style={{ fontWeight: 400 }}>· del bordereau, sin campo propio (solo lectura)</span>
            </h3>
          </div>
          <div className="campos-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {Object.entries(linea.extra).map(([k, v]) => (
              <div className="field" key={k}>
                <label>{k}</label>
                <input type="text" value={v == null ? "" : String(v)} readOnly />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LPAN al que pertenece esta línea (si lo hay): permite corregir sus fechas/estado desde aquí. */}
      {!diseno && linea && (
        <div className="bdx-grupo">
          <div className="grupo-cab">
            <h3 style={{ margin: 0 }}>LPAN</h3>
          </div>
          <LineaLpan lineId={linea.id} readOnly={ro} />
        </div>
      )}

      {diseno && (
        <div
          className="bdx-grupo grupo-diseno disponibles"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (drag) colocar(drag, "__avail__", null); setDrag(null); }}
        >
          <h3 style={{ margin: "0 0 8px" }}>Campos disponibles</h3>
          <div className="chips-wrap">
            {disponibles.length === 0 ? (
              <span className="hint">(todos los campos están colocados)</span>
            ) : (
              disponibles.map((c) => (
                <div
                  key={c.key}
                  className={"campo-chip" + (drag === c.key ? " arrastrando" : "")}
                  draggable
                  onDragStart={(e) => { setDrag(c.key); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDrag(null)}
                >
                  <span className="campo-chip-label">{c.label}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </FormPanel>
  );
}
