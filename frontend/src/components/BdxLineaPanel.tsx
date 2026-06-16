import { useState } from "react";
import { bdxApi } from "../api";
import type { BdxLinea, BdxLineaWrite } from "../types";
import FormPanel from "./FormPanel";

type Tipo = "text" | "num" | "date" | "bool";
type Campo = { key: keyof BdxLineaWrite; label: string; tipo: Tipo };
type Grupo = { titulo: string; campos: Campo[] };

// Bloque de impuestos 1–4, generado para no repetir.
function impuestos(n: 1 | 2 | 3 | 4): Grupo {
  const p = `tax${n}` as const;
  return {
    titulo: `Impuesto ${n}`,
    campos: [
      { key: `${p}_jurisdiction` as keyof BdxLineaWrite, label: "Jurisdicción", tipo: "text" },
      { key: `${p}_type` as keyof BdxLineaWrite, label: "Tipo de impuesto", tipo: "text" },
      { key: `${p}_taxable_premium` as keyof BdxLineaWrite, label: "Prima imponible", tipo: "num" },
      { key: `${p}_pct` as keyof BdxLineaWrite, label: "%", tipo: "num" },
      { key: `${p}_amount` as keyof BdxLineaWrite, label: "Importe", tipo: "num" },
      { key: `${p}_administered_by` as keyof BdxLineaWrite, label: "Administrado por", tipo: "text" },
      { key: `${p}_payable_by` as keyof BdxLineaWrite, label: "Pagadero por", tipo: "text" },
    ],
  };
}

const GRUPOS: Grupo[] = [
  {
    titulo: "Identificación",
    campos: [
      { key: "section_no", label: "Section No", tipo: "num" },
      { key: "class_of_business", label: "Class of Business", tipo: "text" },
      { key: "risk_code", label: "Risk Code", tipo: "text" },
      { key: "type_of_insurance", label: "Type of Insurance (Direct/Reinsurance)", tipo: "text" },
      { key: "certificate_ref", label: "Certificate Ref", tipo: "text" },
    ],
  },
  {
    titulo: "Asegurado",
    campos: [
      { key: "insured_name", label: "Nombre / Razón social", tipo: "text" },
      { key: "insured_id", label: "ID Asegurado / Tomador", tipo: "text" },
      { key: "insured_address", label: "Dirección", tipo: "text" },
      { key: "insured_province", label: "Provincia", tipo: "text" },
      { key: "insured_postcode", label: "Código postal", tipo: "text" },
      { key: "insured_country", label: "País", tipo: "text" },
    ],
  },
  {
    titulo: "Riesgo",
    campos: [
      { key: "risk_inception_date", label: "Risk Inception Date", tipo: "date" },
      { key: "risk_expiry_date", label: "Risk Expiry Date", tipo: "date" },
      { key: "location_risk_province", label: "Localización riesgo — Provincia", tipo: "text" },
      { key: "location_risk_country", label: "Localización riesgo — País", tipo: "text" },
      { key: "risk_transaction_type", label: "Risk Transaction Type", tipo: "text" },
      { key: "transaction_type", label: "Transaction Type", tipo: "text" },
      { key: "effective_date_transaction", label: "Effective Date of Transaction", tipo: "date" },
      { key: "expiry_date_transaction", label: "Expiry Date of Transaction", tipo: "date" },
    ],
  },
  {
    titulo: "Prima",
    campos: [
      { key: "original_currency_premium", label: "Original Currency Premium", tipo: "num" },
      { key: "gross_written_premium", label: "Gross Written Premium", tipo: "num" },
      { key: "written_line_pct", label: "Written Line (%)", tipo: "num" },
      { key: "total_gwp_our_line", label: "Total GWP (Our line)", tipo: "num" },
      { key: "fees", label: "Fees", tipo: "num" },
      { key: "commission_coverholder_pct", label: "Commission Coverholder %", tipo: "num" },
      { key: "commission_coverholder_amount", label: "Commission Coverholder Amount", tipo: "num" },
      { key: "total_taxes_levies", label: "Total Taxes and Levies", tipo: "num" },
      { key: "total_gwp_including_tax", label: "Total GWP including tax", tipo: "num" },
      { key: "net_premium_to_broker", label: "Net Premium to Lloyd's Broker", tipo: "num" },
    ],
  },
  {
    titulo: "Suma asegurada / deducible",
    campos: [
      { key: "sum_insured_currency", label: "Sum Insured Currency", tipo: "text" },
      { key: "sum_insured_our_line", label: "Sum Insured (Our Line)", tipo: "num" },
      { key: "deductible_amount", label: "Deductible Amount", tipo: "num" },
      { key: "deductible_basis", label: "Deductible Basis", tipo: "text" },
    ],
  },
  impuestos(1),
  impuestos(2),
  impuestos(3),
  impuestos(4),
  {
    titulo: "Plazos / Lloyd's / brokerage",
    campos: [
      { key: "instalment_number", label: "Instalment Number", tipo: "num" },
      { key: "number_of_instalments", label: "Number of Instalments", tipo: "num" },
      { key: "referred_to_london", label: "Referred to London (Yes/No)", tipo: "text" },
      { key: "pct_for_lloyds", label: "% for Lloyd's", tipo: "num" },
      { key: "policy_issuance_date", label: "Policy issuance date", tipo: "date" },
      { key: "policy_number_reinsured", label: "Policy Number Reinsured", tipo: "text" },
      { key: "brokerage_pct", label: "Brokerage % of gross premium", tipo: "num" },
      { key: "brokerage_amount", label: "Brokerage Amount", tipo: "num" },
      { key: "final_net_premium_uw", label: "Final Net Premium to UW", tipo: "num" },
    ],
  },
  {
    titulo: "Control interno (cobro / pago)",
    campos: [
      { key: "prima_cobrada", label: "Prima cobrada", tipo: "bool" },
      { key: "ingresado", label: "Ingresado", tipo: "num" },
      { key: "premium_payment_date", label: "Fecha de pago (coverholder)", tipo: "date" },
      { key: "traspaso", label: "Traspaso", tipo: "bool" },
      { key: "traspasado", label: "Traspasado", tipo: "num" },
      { key: "fecha_traspaso", label: "Fecha de traspaso", tipo: "date" },
      { key: "liquidado", label: "Liquidado al UW", tipo: "bool" },
      { key: "liquidado_uw", label: "Liquidado al UW (importe)", tipo: "num" },
      { key: "fecha_liquidacion", label: "Fecha de liquidación", tipo: "date" },
      { key: "recibo", label: "Recibo", tipo: "text" },
      { key: "notas", label: "Notas", tipo: "text" },
    ],
  },
];

const TODOS = GRUPOS.flatMap((g) => g.campos);

type FormVals = Record<string, string | boolean>;

function inicialDe(l: BdxLinea | null): FormVals {
  const v: FormVals = {};
  for (const c of TODOS) {
    const raw = l ? (l as unknown as Record<string, unknown>)[c.key as string] : undefined;
    v[c.key as string] = c.tipo === "bool" ? Boolean(raw) : raw == null ? "" : String(raw);
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
  for (const c of TODOS) {
    const val = v[c.key as string];
    if (c.tipo === "bool") out[c.key as string] = Boolean(val);
    else if (c.tipo === "num") out[c.key as string] = num(String(val));
    else out[c.key as string] = String(val).trim() || null;
  }
  return out as BdxLineaWrite;
}

type Props = {
  bdxId: number;
  linea: BdxLinea | null; // null = nueva
  onSaved: () => void;
  onClose: () => void;
  onDeleted: () => void;
};

export default function BdxLineaPanel({ bdxId, linea, onSaved, onClose, onDeleted }: Props) {
  const [vals, setVals] = useState<FormVals>(() => inicialDe(linea));
  const [inicial] = useState<FormVals>(() => inicialDe(linea));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(vals) !== JSON.stringify(inicial);

  function set(key: string, value: string | boolean) {
    setVals((v) => ({ ...v, [key]: value }));
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

  return (
    <FormPanel
      title={linea ? "Editar línea de BDX" : "Nueva línea de BDX"}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      onClose={onClose}
      onDelete={linea ? borrar : undefined}
    >
      {GRUPOS.map((g) => (
        <div className="bdx-grupo" key={g.titulo}>
          <h3>{g.titulo}</h3>
          {g.campos.map((c) =>
            c.tipo === "bool" ? (
              <div className="field" key={c.key as string}>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={Boolean(vals[c.key as string])}
                    onChange={(e) => set(c.key as string, e.target.checked)}
                  />
                  {c.label}
                </label>
              </div>
            ) : (
              <div className="field" key={c.key as string}>
                <label>{c.label}</label>
                <input
                  type={c.tipo === "date" ? "date" : "text"}
                  inputMode={c.tipo === "num" ? "decimal" : undefined}
                  className={c.tipo === "date" ? "inp-fecha" : undefined}
                  value={String(vals[c.key as string] ?? "")}
                  onChange={(e) => set(c.key as string, e.target.value)}
                />
              </div>
            )
          )}
        </div>
      ))}
    </FormPanel>
  );
}
