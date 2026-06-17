import { useState } from "react";
import type { Recibo, ReciboPreview, ReciboUpdate } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import OptionButtons from "./OptionButtons";
import { fmtMiles } from "../format";

// Modal de emisión/edición de un recibo, con el layout del Access:
//  · columna izquierda: identificación + prima/impuestos + comisiones + pagador/cuenta
//  · 3 cajas a la derecha: Cobro de primas · Liquidación a la Cía · Comisiones
// El recibo puede venir de un Recibo (edición) o de un ReciboPreview (emisión).

const PAGADORES = ["Agencia de Suscripción", "Mercado", "Tomador", "Corredor"];
const ESTADOS = ["Emitido", "Anulado"];

// Campos por tipo (para convertir recibo ↔ formulario y formulario ↔ payload).
const NUM = [
  "prima_neta_poliza", "participacion", "prima_neta_recibo", "impuestos_porc",
  "impuestos_sobre_total_porc", "impuestos_sobre_recibo_porc", "otros_impuestos", "impuestos_recibo",
  "prima_bruta_recibo", "deduccion_total_porc", "deduccion_total", "honorarios",
  "comision_cedida_porc", "comision_cedida", "comision_retenida_porc", "comision_retenida",
  "prima_adeudada", "prima_cobrada", "comision_retenida_cobrada", "comision_retenida_traspasada",
  "liquidar", "liquidar_cobrado", "liquidar_liquidado", "comision_cedida_a_pagar", "comision_cedida_pagada",
] as const;
const INT = ["recibo_num", "yoa"] as const;
const DATE = [
  "fecha_efecto", "fecha_vencimiento", "fecha_efecto_recibo", "fecha_vcto_recibo",
  "prima_fecha_cobro", "comision_fecha_traspaso", "liquidar_fecha_liquidacion",
  "comision_cedida_fecha_pago", "fecha_contable",
] as const;
const TEXT = [
  "estado", "referencia", "nombre_mercado", "mercado", "numero_poliza", "asegurado", "corredor",
  "ramo", "tipo_poliza", "produccion", "pago", "moneda", "recibos_totales", "pagador", "cuenta", "notas",
] as const;

type Form = Record<string, string> & { impuestos_sobre_recibo: boolean };

function aForm(r: Partial<Recibo>): Form {
  const f = { impuestos_sobre_recibo: !!r.impuestos_sobre_recibo } as Form;
  for (const k of [...NUM, ...INT, ...DATE, ...TEXT]) {
    const v = (r as Record<string, unknown>)[k];
    f[k] = v == null ? "" : String(v);
  }
  return f;
}

function aPayload(f: Form): ReciboUpdate {
  const out: Record<string, unknown> = { impuestos_sobre_recibo: f.impuestos_sobre_recibo };
  for (const k of [...NUM, ...DATE, ...TEXT]) out[k] = f[k] === "" ? null : f[k];
  for (const k of INT) out[k] = f[k] === "" ? null : Math.trunc(Number(f[k]));
  return out as ReciboUpdate;
}

const n = (s: string) => {
  const x = Number(s);
  return isNaN(x) ? 0 : x;
};

export default function ReciboModal({
  titulo,
  saveLabel,
  recibo,
  numeroProvisional = false,
  soloLectura = false,
  saving,
  error,
  onSave,
  onClose,
  onDelete,
}: {
  titulo: string;
  saveLabel: string;
  recibo: Partial<Recibo> | ReciboPreview;
  numeroProvisional?: boolean;
  soloLectura?: boolean; // emisión: todo viene del Risk BDX, ningún campo editable
  saving: boolean;
  error: string | null;
  onSave: (payload: ReciboUpdate) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [f, setF] = useState<Form>(() => aForm(recibo as Partial<Recibo>));
  const [inicial] = useState<Form>(() => aForm(recibo as Partial<Recibo>));
  const dirty = JSON.stringify(f) !== JSON.stringify(inicial);

  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v as never }));

  // Derivados (read-only), igual que en el Access.
  const primaPdteCobro = n(f.prima_adeudada) - n(f.prima_cobrada);
  const liqPdteCobro = n(f.liquidar) - n(f.liquidar_cobrado);
  const liqPdteLiquidacion = n(f.liquidar_cobrado) - n(f.liquidar_liquidado);
  const comPdteCobro = n(f.comision_retenida) - n(f.comision_retenida_cobrada);
  const comPdteTraspaso = n(f.comision_retenida_cobrada) - n(f.comision_retenida_traspasada);

  // Campos reutilizables (en emisión, soloLectura → todos deshabilitados)
  const Money = ({ k, label, full }: { k: string; label: string; full?: boolean }) => (
    <div className="field">
      <label>{label}</label>
      <NumberInput value={f[k] ?? ""} onChange={(v) => set(k, v)} suffix="€" disabled={soloLectura} className={full ? "full-w" : undefined} />
    </div>
  );
  const Pct = ({ k, label }: { k: string; label: string }) => (
    <div className="field">
      <label>{label}</label>
      <NumberInput value={f[k] ?? ""} onChange={(v) => set(k, v)} suffix="%" thousands={false} disabled={soloLectura} />
    </div>
  );
  const Fecha = ({ k, label }: { k: string; label: string }) => (
    <div className="field">
      <label>{label}</label>
      <input type="date" className="inp-fecha" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} disabled={soloLectura} />
    </div>
  );
  const Texto = ({ k, label }: { k: string; label: string }) => (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} disabled={soloLectura} />
    </div>
  );
  // Solo lectura, con el MISMO formato que NumberInput (cifra a la derecha, € como sufijo fuera).
  const RO = ({ label, v, full }: { label: string; v: number; full?: boolean }) => (
    <div className="field">
      <label>{label}</label>
      <div className={"num-input" + (full ? " full-w" : "")}>
        <input className="inp-num" type="text" value={fmtMiles(v)} disabled />
        <span className="num-suffix">€</span>
      </div>
    </div>
  );

  return (
    <FormPanel
      title={titulo}
      dirty={dirty}
      saving={saving}
      saveLabel={saveLabel}
      error={error}
      onSave={() => onSave(aPayload(f))}
      onClose={onClose}
      onDelete={onDelete}
      wide
    >
      <div className="recibo-modal">
        {/* ── Columna izquierda: identificación + prima + comisiones ── */}
        <div className="recibo-col">
          <div className="field">
            <label>Número de Recibo {numeroProvisional && <span className="hint">(provisional)</span>}</label>
            <input type="text" value={(recibo as Recibo).numero ?? ""} disabled />
          </div>
          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Recibo Número</label>
              <NumberInput value={f.recibo_num ?? ""} onChange={(v) => set("recibo_num", v)} decimals={0} thousands={false} disabled={soloLectura} />
            </div>
            <Texto k="recibos_totales" label="de (nº total)" />
          </div>

          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Fecha k="fecha_efecto_recibo" label="Fecha Efecto Recibo" />
            <Fecha k="fecha_vcto_recibo" label="Fecha Vto. Recibo" />
          </div>

          <Money k="prima_neta_recibo" label="Prima Neta Bordereau" />
          <Money k="impuestos_recibo" label="Impuestos" />
          <Money k="prima_bruta_recibo" label="Prima Total Bordereau" />

          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Pct k="deduccion_total_porc" label="Deducción Total %" />
            <Money k="deduccion_total" label="Deducción Total" />
          </div>
          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Pct k="comision_cedida_porc" label="Comisión Cedida %" />
            <Money k="comision_cedida" label="Comisión Cedida" />
          </div>
          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Pct k="comision_retenida_porc" label="Comisión Retenida %" />
            <Money k="comision_retenida" label="Comisión Retenida" />
          </div>

          <Money k="honorarios" label="Honorarios" />

          <div className="field">
            <label>Pagador</label>
            <OptionButtons value={f.pagador ?? ""} options={PAGADORES} onChange={(v) => set("pagador", v)} vertical disabled={soloLectura} />
          </div>
          <Texto k="cuenta" label="Cuenta" />

          <details className="recibo-mas">
            <summary>Más datos (contexto / contable)</summary>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Texto k="nombre_mercado" label="Mercado" />
              <Texto k="referencia" label="Referencia" />
              <Texto k="numero_poliza" label="Nº Póliza" />
              <Texto k="asegurado" label="Asegurado" />
              <Texto k="ramo" label="Ramo" />
              <Texto k="pago" label="Pago" />
              <Texto k="moneda" label="Moneda" />
              <Fecha k="fecha_contable" label="Fecha Contable" />
            </div>
            <div className="field">
              <label>Estado</label>
              <OptionButtons value={f.estado ?? ""} options={ESTADOS} onChange={(v) => set("estado", v)} disabled={soloLectura} />
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea rows={2} value={f.notas ?? ""} onChange={(e) => set("notas", e.target.value)} disabled={soloLectura} />
            </div>
          </details>
        </div>

        {/* ── Columna derecha: 3 cajas ── */}
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>Cobro de primas</h4>
            <Money k="prima_adeudada" label="Prima Adeudada" full />
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="prima_cobrada" label="Prima Cobrada" />
              <RO label="Pendiente de Cobro" v={primaPdteCobro} />
            </div>
          </div>

          <div className="recibo-box">
            <h4>Liquidación a la Cía</h4>
            <Money k="liquidar" label="A Liquidar" full />
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="liquidar_cobrado" label="A Liquidar Cobrado" />
              <RO label="A Liquidar Pdte. Cobro" v={liqPdteCobro} />
            </div>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="liquidar_liquidado" label="Liquidado" />
              <RO label="Pdte. Liquidación" v={liqPdteLiquidacion} />
            </div>
          </div>

          <div className="recibo-box">
            <h4>Comisiones</h4>
            <RO label="Retenida" v={n(f.comision_retenida)} full />
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="comision_retenida_cobrada" label="Cobrada" />
              <RO label="Pdte. Cobro" v={comPdteCobro} />
            </div>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="comision_retenida_traspasada" label="Traspasada" />
              <RO label="Pdte. Traspaso" v={comPdteTraspaso} />
            </div>
          </div>
        </div>
      </div>
    </FormPanel>
  );
}
