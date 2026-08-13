import { useCallback, useEffect, useRef, useState } from "react";
import { pcApi, type PcValoracion } from "../api";
import type { Binder, BdxLinea, Siniestro } from "../types";
import NumberInput from "./NumberInput";
import { fmtMiles } from "../format";

// Coerción numérica y formato (mismos que la pestaña).
const n = (v: unknown): number => { const x = Number(String(v ?? "").replace(",", ".")); return isNaN(x) ? 0 : x; };
const imp = (v: unknown): string => fmtMiles(v) || "—";
const pct = (v: number): string => `${fmtMiles(v, 2)} %`;
const hoyISO = (): string => new Date().toISOString().slice(0, 10);

export interface CifrasPC {
  gwp: number; comCoverAmt: number; comCoverPct: number; comMayritAmt: number; comMayritPct: number;
  comTotal: number; netToUws: number; indemPaidR: number; indemResR: number; feesPaidR: number; feesResR: number;
  claims: number; ibnrPct: number; ibnr: number; uwPct: number; uwAmt: number; totalOutcome: number;
  lossRatio: number; resultado: number; pcPct: number; pc: number; nombresPC: string;
}

// Cálculo de la PC (idéntico al de la pestaña), extraído para repetirlo por valoración.
export function calcPC(binder: Binder, lineas: BdxLinea[], siniestros: Siniestro[], ibnrPct: number): CifrasPC {
  const secs = binder.secciones ?? [];
  const seccionesPC = new Set(secs.map((s, i) => (s.sujeto_pc ? i + 1 : 0)).filter((x) => x > 0));
  const nombresPC = secs.map((s, i) => (s.sujeto_pc ? `Sección ${i + 1}${s.ramo ? ` (${s.ramo})` : ""}` : null)).filter(Boolean).join(", ");
  const ls = lineas.filter((l) => seccionesPC.has(l.section_no ?? 0));
  const gwp = ls.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
  const comCoverAmt = ls.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
  const comCoverPct = gwp > 0 ? (comCoverAmt / gwp) * 100 : 0;
  const comMayritAmt = ls.reduce((a, l) => a + n(l.brokerage_amount), 0);
  const comMayritPct = gwp > 0 ? (comMayritAmt / gwp) * 100 : 0;
  const comTotal = comCoverAmt + comMayritAmt;
  const netToUws = gwp - comTotal;
  const sinPC = siniestros.filter((s) => seccionesPC.has(s.section ?? 0));
  const indemPaidR = sinPC.reduce((a, s) => a + (n(s.paid_indemnity) - n(s.paid_this_month_indemnity)), 0);
  const indemResR = sinPC.reduce((a, s) => a + n(s.reserves_indemnity), 0);
  const feesPaidR = sinPC.reduce((a, s) => a + (n(s.paid_fees) - n(s.paid_this_month_fees)), 0);
  const feesResR = sinPC.reduce((a, s) => a + n(s.reserves_fees), 0);
  const claims = indemPaidR + indemResR + feesPaidR + feesResR;
  const ibnr = (gwp * ibnrPct) / 100;
  const uwPct = n(binder.pc_gastos);
  const uwAmt = (gwp * uwPct) / 100;
  const totalOutcome = comTotal + claims + ibnr + uwAmt;
  const lossRatio = netToUws > 0 ? (claims / netToUws) * 100 : 0;
  const resultado = gwp - totalOutcome;
  const pcPct = n(binder.pc_porcentaje);
  const pc = (resultado * pcPct) / 100;
  return { gwp, comCoverAmt, comCoverPct, comMayritAmt, comMayritPct, comTotal, netToUws, indemPaidR, indemResR,
           feesPaidR, feesResR, claims, ibnrPct, ibnr, uwPct, uwAmt, totalOutcome, lossRatio, resultado, pcPct, pc, nombresPC };
}

const cifrasDe = (binder: Binder, lineas: BdxLinea[], siniestros: Siniestro[], v: PcValoracion): CifrasPC =>
  v.bloqueado && v.snapshot ? (v.snapshot as unknown as CifrasPC) : calcPC(binder, lineas, siniestros, n(v.ibnr_pct));

function Celda({ v }: { v: number }) { return <td className="num">{imp(v)}</td>; }

// Una valoración (columna).
function PcCard({ binder, lineas, siniestros, v, yaPagado, esUltima, hayVarias, busy,
                  onEditar, onBloquear, onDesbloquear, onBorrar, onDuplicar }: {
  binder: Binder; lineas: BdxLinea[]; siniestros: Siniestro[]; v: PcValoracion; yaPagado: number;
  esUltima: boolean; hayVarias: boolean; busy: boolean;
  onEditar: (v: PcValoracion, cambios: { fecha?: string | null; ibnr_pct?: string }) => void;
  onBloquear: (v: PcValoracion, snapshot: CifrasPC, ibnr: string, fecha: string) => void;
  onDesbloquear: (v: PcValoracion) => void;
  onBorrar: (v: PcValoracion) => void;
  onDuplicar: () => void;
}) {
  const [ibnr, setIbnr] = useState<string>(String(v.ibnr_pct ?? "0"));
  const [fecha, setFecha] = useState<string>(v.fecha ?? "");
  useEffect(() => { setIbnr(String(v.ibnr_pct ?? "0")); setFecha(v.fecha ?? ""); }, [v.id, v.bloqueado, v.ibnr_pct, v.fecha]);

  const c: CifrasPC = v.bloqueado && v.snapshot ? (v.snapshot as unknown as CifrasPC)
                                                : calcPC(binder, lineas, siniestros, n(ibnr));
  const aPagar = c.pc - yaPagado;

  return (
    <div className={"pc-card" + (v.bloqueado ? " bloqueada" : "")}>
      <div className="pc-card-cab">
        <label className="pc-lock" title={v.bloqueado ? "Desbloquear para recalcular en vivo" : "Bloquear y congelar estas cifras"}>
          <input type="checkbox" checked={v.bloqueado} disabled={busy}
            onChange={(e) => e.target.checked
              ? onBloquear(v, calcPC(binder, lineas, siniestros, n(ibnr)), ibnr, fecha || hoyISO())
              : onDesbloquear(v)} />
          {v.bloqueado ? "🔒 Bloqueada" : "Bloquear"}
        </label>
        <input type="date" className="inp-fecha" value={fecha} disabled={v.bloqueado || busy}
          onChange={(e) => { setFecha(e.target.value); onEditar(v, { fecha: e.target.value || null }); }} />
        {esUltima && !v.bloqueado && hayVarias && (
          <button className="btn-icono" title="Borrar esta valoración" disabled={busy} onClick={() => onBorrar(v)}>🗑️</button>
        )}
      </div>
      <table className="compacto pc-tabla">
        <tbody>
          <tr className="pc-fuerte"><td>GWP (our line)</td><Celda v={c.gwp} /></tr>
          <tr className="pc-seccion"><td colSpan={2}>Comisiones</td></tr>
          <tr><td>Coverholder ({pct(c.comCoverPct)})</td><Celda v={c.comCoverAmt} /></tr>
          <tr><td>Mayrit ({pct(c.comMayritPct)})</td><Celda v={c.comMayritAmt} /></tr>
          <tr className="pc-subtotal"><td>Total comisiones</td><Celda v={c.comTotal} /></tr>
          <tr className="pc-fuerte"><td>Net to UWs</td><Celda v={c.netToUws} /></tr>
          <tr className="pc-seccion"><td colSpan={2}>Siniestralidad</td></tr>
          <tr><td>Indemnización — Pagado</td><Celda v={c.indemPaidR} /></tr>
          <tr><td>Indemnización — Reservas</td><Celda v={c.indemResR} /></tr>
          <tr><td>Fees — Pagado</td><Celda v={c.feesPaidR} /></tr>
          <tr><td>Fees — Reservas</td><Celda v={c.feesResR} /></tr>
          <tr className="pc-subtotal"><td>Total siniestralidad</td><Celda v={c.claims} /></tr>
          <tr>
            <td>IBNR (
              {v.bloqueado
                ? <b>{pct(c.ibnrPct)}</b>
                : <span className="pc-ibnr" onBlur={() => onEditar(v, { ibnr_pct: ibnr })}>
                    <NumberInput value={ibnr} onChange={setIbnr} suffix="%" thousands={false} className="input-completar" />
                  </span>}
              {" "}s/ GWP)</td>
            <Celda v={c.ibnr} />
          </tr>
          <tr><td>UW Expenses ({pct(c.uwPct)} s/ GWP)</td><Celda v={c.uwAmt} /></tr>
          <tr className="pc-subtotal"><td>Total Outcome</td><Celda v={c.totalOutcome} /></tr>
          <tr><td className="hint">Siniestralidad / Net to UWs</td><td className="num hint">{pct(c.lossRatio)}</td></tr>
          <tr className="pc-fuerte" style={{ borderTop: "2px solid var(--borde)" }}><td>Resultado (GWP − Outcome)</td><Celda v={c.resultado} /></tr>
          <tr className="pc-fuerte"><td>Profit Commission ({pct(c.pcPct)})</td>
            <td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(c.pc)}</td></tr>
          <tr><td className="hint">Ya pagado (valoración anterior)</td><td className="num hint">{imp(yaPagado)}</td></tr>
          <tr className="pc-fuerte"><td>A pagar ahora</td>
            <td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(aPagar)}</td></tr>
        </tbody>
      </table>
      {esUltima && v.bloqueado && (
        <button className="btn-primary btn-sm pc-dup" disabled={busy} onClick={onDuplicar}>＋ Duplicar (siguiente año)</button>
      )}
    </div>
  );
}

export default function PcValoraciones({ binder, lineas, siniestros }: { binder: Binder; lineas: BdxLinea[]; siniestros: Siniestro[] }) {
  const [vals, setVals] = useState<PcValoracion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const creando = useRef(false);

  const cargar = useCallback(() => {
    pcApi.valoraciones(binder.id).then((vs) => {
      if (vs.length === 0 && !creando.current) {
        creando.current = true;
        pcApi.crear(binder.id, { ibnr_pct: "0" }).then((v) => setVals([v])).finally(() => { creando.current = false; });
      } else setVals(vs);
    }).catch(() => setVals([]));
  }, [binder.id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!vals) return <div className="loading">Cargando…</div>;

  const ordenadas = [...vals].sort((a, b) => a.orden - b.orden);
  const ultima = ordenadas[ordenadas.length - 1];

  const editar = (v: PcValoracion, cambios: { fecha?: string | null; ibnr_pct?: string | null; bloqueado?: boolean; snapshot?: unknown }) => {
    setBusy(true);
    pcApi.editar(v.id, cambios)
      .then((nv) => setVals((xs) => (xs ?? []).map((x) => (x.id === v.id ? nv : x))))
      .finally(() => setBusy(false));
  };
  const bloquear = (v: PcValoracion, snapshot: CifrasPC, ibnr: string, fecha: string) =>
    editar(v, { bloqueado: true, snapshot, ibnr_pct: ibnr, fecha });
  const desbloquear = (v: PcValoracion) => editar(v, { bloqueado: false });
  const borrar = (v: PcValoracion) => {
    setBusy(true);
    pcApi.borrar(v.id).then(() => setVals((xs) => (xs ?? []).filter((x) => x.id !== v.id))).finally(() => setBusy(false));
  };
  const duplicar = () => {
    setBusy(true);
    pcApi.crear(binder.id, { ibnr_pct: String(ultima.ibnr_pct ?? "0") })
      .then((nv) => setVals((xs) => [...(xs ?? []), nv])).finally(() => setBusy(false));
  };

  return (
    <div className="pc-valoraciones">
      {ordenadas.map((v, i) => (
        <PcCard key={v.id} binder={binder} lineas={lineas} siniestros={siniestros} v={v}
          yaPagado={i > 0 ? cifrasDe(binder, lineas, siniestros, ordenadas[i - 1]).pc : 0}
          esUltima={v.id === ultima.id} hayVarias={ordenadas.length > 1} busy={busy}
          onEditar={editar} onBloquear={bloquear} onDesbloquear={desbloquear} onBorrar={borrar} onDuplicar={duplicar} />
      ))}
    </div>
  );
}
