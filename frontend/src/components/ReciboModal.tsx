import { useState, type ReactNode } from "react";
import type { Recibo, ReciboPreview, ReciboUpdate } from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import { fmtMiles } from "../format";

// Modal de emisión/edición de un recibo, con el layout del Access:
//  · columna izquierda: identificación + prima/impuestos + comisiones + cuenta + notas
//  · 3 cajas a la derecha: Cobro de primas · Liquidación a la Cía · Comisiones
// El recibo puede venir de un Recibo (edición) o de un ReciboPreview (emisión).

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
  bloqueado = false,
  saving,
  error,
  onSave,
  onClose,
  onDelete,
  onDescontabilizar,
}: {
  titulo: ReactNode;
  saveLabel: string;
  recibo: Partial<Recibo> | ReciboPreview;
  numeroProvisional?: boolean;
  soloLectura?: boolean; // emisión: todo viene del Risk BDX, ningún campo editable
  bloqueado?: boolean;   // edición: recibo contabilizado → no se puede corregir hasta reabrir
  saving: boolean;
  error: string | null;
  onSave: (payload: ReciboUpdate) => void;
  onClose: () => void;
  onDelete?: () => void;
  onDescontabilizar?: () => void; // reabrir un recibo contabilizado (la remesa a contabilidad va aparte)
}) {
  const [f, setF] = useState<Form>(() => aForm(recibo as Partial<Recibo>));
  const [inicial] = useState<Form>(() => aForm(recibo as Partial<Recibo>));
  const dirty = JSON.stringify(f) !== JSON.stringify(inicial);

  // Edición de un recibo ya emitido: abre en SOLO LECTURA; "Corregir" la habilita
  // (solo si no está contabilizado). En emisión (soloLectura) no aplica.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const ro = soloLectura || bloqueado || (!soloLectura && !corrigiendo);
  // El panel oculta "Guardar" salvo en emisión o cuando se está corrigiendo.
  const formReadOnly = !soloLectura && !corrigiendo;

  function pedirCorregir() {
    if (window.confirm("Vas a modificar un recibo ya emitido. Hazlo solo para corregir errores y antes de enviarlo a contabilidad. ¿Continuar?")) {
      setCorrigiendo(true);
    }
  }
  function pedirReabrir() {
    if (onDescontabilizar && window.confirm("Vas a reabrir un recibo contabilizado para corregir un error. ¿Continuar?")) {
      onDescontabilizar();
    }
  }

  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v as never }));

  // Derivados (read-only), igual que en el Access.
  const primaPdteCobro = n(f.prima_adeudada) - n(f.prima_cobrada);
  const liqPdteCobro = n(f.liquidar) - n(f.liquidar_cobrado);
  const liqPdteLiquidacion = n(f.liquidar_cobrado) - n(f.liquidar_liquidado);
  const comPdteCobro = n(f.comision_retenida) - n(f.comision_retenida_cobrada);
  const comPdteTraspaso = n(f.comision_retenida_cobrada) - n(f.comision_retenida_traspasada);
  const cedidaPdtePago = n(f.comision_cedida_a_pagar) - n(f.comision_cedida_pagada);

  // En un recibo de BINDER no hay figura de pagador (Tomador/Corredor) ni pago de comisión
  // cedida al corredor: la cedida es la de la agencia (coverholder) y va descontada en la prima.
  // Por eso se oculta la caja de "Comisión cedida (corredor)" en binders.
  const esBinder = (recibo as Partial<Recibo>).binder_id != null;

  // Recibo de Comisiones (p. ej. Iberian): no hay prima ni liquidación a la compañía. Lo que
  // "nos tienen que pagar" es la COMISIÓN (deduccion_total), que es lo que se cobra. Por eso en
  // estos recibos la caja "Cobro de primas" muestra la comisión y la de "Liquidación" no aplica.
  const esComisiones = (recibo as Partial<Recibo>).tipo_poliza === "Comisiones";
  const comisionCobrarPdte = n(f.deduccion_total) - n(f.prima_cobrada);

  // Campos reutilizables (en emisión, soloLectura → todos deshabilitados)
  const Money = ({ k, label, full }: { k: string; label: string; full?: boolean }) => (
    <div className="field">
      <label>{label}</label>
      <NumberInput value={f[k] ?? ""} onChange={(v) => set(k, v)} suffix="€" disabled={ro} className={full ? "full-w" : undefined} />
    </div>
  );
  // Fila tipo Access: etiqueta · % (opcional) · € — con los importes alineados en columna.
  const Linea = ({ label, kEur, kPct }: { label: string; kEur: string; kPct?: string }) => (
    <div className="recibo-linea">
      <span className="recibo-linea-lbl">{label}</span>
      {kPct ? (
        <NumberInput value={f[kPct] ?? ""} onChange={(v) => set(kPct, v)} suffix="%" thousands={false} disabled={ro} />
      ) : (
        <span />
      )}
      <NumberInput value={f[kEur] ?? ""} onChange={(v) => set(kEur, v)} suffix="€" disabled={ro} />
    </div>
  );
  const Fecha = ({ k, label }: { k: string; label: string }) => (
    <div className="field">
      <label>{label}</label>
      <input type="date" className="inp-fecha" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} disabled={ro} />
    </div>
  );
  const Texto = ({ k, label }: { k: string; label: string }) => (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} disabled={ro} />
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
      readOnly={formReadOnly}
      error={error}
      onSave={() => onSave(aPayload(f))}
      onClose={onClose}
      onDelete={corrigiendo ? onDelete : undefined}
      wide
    >
      {/* Barra de estado/acciones (solo en edición, no en emisión) */}
      {!soloLectura && (
        <div className="recibo-acciones-top">
          {bloqueado ? (
            <>
              <span className="pill pill-anulado pill-estado-lg">🔒 Contabilizado — no editable</span>
              {onDescontabilizar && (
                <button className="btn-secondary btn-sm" onClick={pedirReabrir}>Reabrir para corregir</button>
              )}
            </>
          ) : corrigiendo ? (
            <span className="hint">✏️ Modo corrección — solo para corregir errores antes de enviar a contabilidad.</span>
          ) : (
            <>
              <span className="pill pill-cobrado pill-estado-lg">Emitido</span>
              <button className="btn-sm btn-corregir" onClick={pedirCorregir}>✏️ Corregir</button>
            </>
          )}
        </div>
      )}

      <div className="recibo-modal">
        {/* ── Columna izquierda: identificación + prima + comisiones ── */}
        <div className="recibo-col">
          <div className="recibo-num-row">
            {/* En edición el nº va en el título; aquí solo se muestra en emisión (provisional). */}
            {numeroProvisional && (
              <div className="field">
                <label>Número de Recibo <span className="hint">(provisional)</span></label>
                <input type="text" value={(recibo as Recibo).numero ?? ""} disabled style={{ textAlign: "center", maxWidth: "100%", width: "100%", color: "var(--naranja-osc)", fontWeight: 700 }} />
              </div>
            )}
            <div className="field recibo-mini">
              <label>Recibo</label>
              <NumberInput value={f.recibo_num ?? ""} onChange={(v) => set("recibo_num", v)} decimals={0} thousands={false} disabled={ro} />
            </div>
            <div className="field recibo-mini">
              <label>de</label>
              <input type="text" value={f.recibos_totales ?? ""} onChange={(e) => set("recibos_totales", e.target.value)} disabled={ro} />
            </div>
          </div>

          <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Fecha k="fecha_efecto_recibo" label="Fecha Efecto Recibo" />
            <Fecha k="fecha_vcto_recibo" label="Fecha Vto. Recibo" />
          </div>

          <Linea label="Prima Neta Bordereau" kEur="prima_neta_recibo" />
          <Linea label="Impuestos" kEur="impuestos_recibo" />
          <Linea label="Prima Total Bordereau" kEur="prima_bruta_recibo" />
          <Linea label="Deducción Total" kPct="deduccion_total_porc" kEur="deduccion_total" />
          <Linea label="Comisión Cedida" kPct="comision_cedida_porc" kEur="comision_cedida" />
          <Linea label="Comisión Retenida" kPct="comision_retenida_porc" kEur="comision_retenida" />
          <Linea label="Honorarios" kEur="honorarios" />

          <Texto k="cuenta" label="Cuenta" />

          <div className="field">
            <label>Notas</label>
            <textarea rows={5} value={f.notas ?? ""} onChange={(e) => set("notas", e.target.value)} disabled={ro} />
          </div>
        </div>

        {/* ── Columna derecha: 3 cajas ── */}
        <div className="recibo-col">
          <div className="recibo-box">
            <h4>{esComisiones ? "Cobro de la comisión" : "Cobro de primas"}</h4>
            {esComisiones ? (
              <>
                {/* En comisiones lo que nos tienen que pagar es la comisión (deduccion_total). */}
                <RO label="Comisión a cobrar" v={n(f.deduccion_total)} full />
                <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <Money k="prima_cobrada" label="Cobrada" />
                  <RO label="Pendiente de Cobro" v={comisionCobrarPdte} />
                </div>
                <Fecha k="prima_fecha_cobro" label="Fecha de Cobro" />
              </>
            ) : (
              <>
                <Money k="prima_adeudada" label="Prima Adeudada" full />
                <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <Money k="prima_cobrada" label="Prima Cobrada" />
                  <RO label="Pendiente de Cobro" v={primaPdteCobro} />
                </div>
                <Fecha k="prima_fecha_cobro" label="Fecha de Cobro" />
              </>
            )}
          </div>

          {esComisiones ? (
            <div className="recibo-box recibo-box-na">
              <h4>Liquidación a la Cía</h4>
              <span className="pill pill-anulado">No aplica</span>
            </div>
          ) : (
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
              <Fecha k="liquidar_fecha_liquidacion" label="Fecha de Liquidación" />
            </div>
          )}

          <div className="recibo-box">
            <h4>Comisión retenida (Mayrit)</h4>
            <RO label="Retenida" v={n(f.comision_retenida)} full />
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="comision_retenida_cobrada" label="Cobrada" />
              <RO label="Pdte. Cobro" v={comPdteCobro} />
            </div>
            <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Money k="comision_retenida_traspasada" label="Traspasada" />
              <RO label="Pdte. Traspaso" v={comPdteTraspaso} />
            </div>
            <Fecha k="comision_fecha_traspaso" label="Fecha de Traspaso" />
          </div>

          {!esBinder && (
            <div className="recibo-box">
              <h4>Comisión cedida (corredor)</h4>
              {f.pagador && (
                <div className="hint" style={{ marginBottom: 6 }}>
                  {f.pagador === "Corredor"
                    ? "Paga el corredor: descuenta su comisión; se salda al cobrar la prima."
                    : "Paga el tomador: la comisión cedida se paga al corredor."}
                </div>
              )}
              <RO label="Cedida" v={n(f.comision_cedida)} full />
              <div className="campos-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Money k="comision_cedida_pagada" label="Pagada" />
                <RO label="Pdte. Pago" v={cedidaPdtePago} />
              </div>
            </div>
          )}
        </div>
      </div>
    </FormPanel>
  );
}
