import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { pcApi, type PcValoracion } from "../api";
import type { Binder, BdxLinea, Siniestro } from "../types";
import NumberInput from "./NumberInput";
import { fmtMiles } from "../format";

const n = (v: unknown): number => { const x = Number(String(v ?? "").replace(",", ".")); return isNaN(x) ? 0 : x; };
const imp = (v: unknown): string => fmtMiles(v) || "—";
const pct = (v: number): string => `${fmtMiles(v, 2)} %`;
const hoyISO = (): string => new Date().toISOString().slice(0, 10);

// Cifras BASE de una valoración (las que se teclean en modo manual; el resto se DERIVAN).
interface BasePC {
  gwp: number;
  comCover: number; brokerage: number; uwExp: number; taxes: number;   // Outgo
  paidFees: number; resFees: number; paidIndem: number; resIndem: number;  // Claims
  ibnrPct: number; deficit: number; pcPct: number;
}

// Base calculada EN VIVO desde los datos del binder (secciones sujetas a PC).
function baseLive(binder: Binder, lineas: BdxLinea[], siniestros: Siniestro[], ibnrPct: number, deficit: number): BasePC {
  const secs = binder.secciones ?? [];
  const set = new Set(secs.map((s, i) => (s.sujeto_pc ? i + 1 : 0)).filter((x) => x > 0));
  const ls = lineas.filter((l) => set.has(l.section_no ?? 0));
  const gwp = ls.reduce((a, l) => a + n(l.total_gwp_our_line), 0);
  const comCover = ls.reduce((a, l) => a + n(l.commission_coverholder_amount), 0);
  const brokerage = ls.reduce((a, l) => a + n(l.brokerage_amount), 0);
  const taxes = ls.reduce((a, l) => a + n(l.total_taxes_levies), 0);
  const sin = siniestros.filter((s) => set.has(s.section ?? 0));
  const paidFees = sin.reduce((a, s) => a + (n(s.paid_fees) - n(s.paid_this_month_fees)), 0);
  const resFees = sin.reduce((a, s) => a + n(s.reserves_fees), 0);
  const paidIndem = sin.reduce((a, s) => a + (n(s.paid_indemnity) - n(s.paid_this_month_indemnity)), 0);
  const resIndem = sin.reduce((a, s) => a + n(s.reserves_indemnity), 0);
  const uwExp = gwp * n(binder.pc_gastos) / 100;
  return { gwp, comCover, brokerage, uwExp, taxes, paidFees, resFees, paidIndem, resIndem, ibnrPct, deficit, pcPct: n(binder.pc_porcentaje) };
}

// Deriva todas las cifras (totales, result, PC…) desde la base. `previouslyPaid` = PC de la anterior.
function derivar(b: BasePC, previouslyPaid: number) {
  const ibnr = b.gwp * b.ibnrPct / 100;
  const outgoTotal = b.comCover + b.brokerage + b.uwExp + b.taxes;
  const claimsTotal = b.paidFees + b.resFees + b.paidIndem + b.resIndem + ibnr;
  const result = b.gwp - outgoTotal - claimsTotal - b.deficit;
  const pc = result * b.pcPct / 100;
  const totalDue = pc - previouslyPaid;
  const p = (x: number) => (b.gwp > 0 ? x / b.gwp * 100 : 0);
  return { ibnr, outgoTotal, claimsTotal, result, pc, totalDue, previouslyPaid,
    comCoverPct: p(b.comCover), brokeragePct: p(b.brokerage), uwPct: p(b.uwExp), taxesPct: p(b.taxes),
    outgoPct: p(outgoTotal), claimsPct: p(claimsTotal) };
}

// Base "persistida" de una valoración (para la cadena de "previously paid"): snapshot si manual/bloqueada, si no en vivo.
function baseDe(binder: Binder, lineas: BdxLinea[], siniestros: Siniestro[], v: PcValoracion): BasePC {
  return (v.manual || v.bloqueado) && v.snapshot
    ? (v.snapshot as unknown as BasePC)
    : baseLive(binder, lineas, siniestros, n(v.ibnr_pct), n(v.deficit));
}

function PcCard({ binder, lineas, siniestros, v, previouslyPaid, esUltima, hayVarias, busy,
                  onEditar, onSnapshot, onManual, onBloquear, onDesbloquear, onBorrar, onDuplicar }: {
  binder: Binder; lineas: BdxLinea[]; siniestros: Siniestro[]; v: PcValoracion; previouslyPaid: number;
  esUltima: boolean; hayVarias: boolean; busy: boolean;
  onEditar: (v: PcValoracion, c: { fecha?: string | null; ibnr_pct?: string; deficit?: string }) => void;
  onSnapshot: (v: PcValoracion, base: BasePC) => void;
  onManual: (v: PcValoracion, manual: boolean, liveBase: BasePC) => void;
  onBloquear: (v: PcValoracion, base: BasePC, fecha: string) => void;
  onDesbloquear: (v: PcValoracion) => void;
  onBorrar: (v: PcValoracion) => void;
  onDuplicar: () => void;
}) {
  const [ibnr, setIbnr] = useState(String(v.ibnr_pct ?? "0"));
  const [deficit, setDeficit] = useState(String(v.deficit ?? "0"));
  const [fecha, setFecha] = useState(v.fecha ?? "");
  const [man, setMan] = useState<BasePC>(() => (v.snapshot as unknown as BasePC) ?? baseLive(binder, lineas, siniestros, n(v.ibnr_pct), n(v.deficit)));
  useEffect(() => {
    setIbnr(String(v.ibnr_pct ?? "0")); setDeficit(String(v.deficit ?? "0")); setFecha(v.fecha ?? "");
    if (v.snapshot) setMan(v.snapshot as unknown as BasePC);
  }, [v.id, v.bloqueado, v.manual, v.ibnr_pct, v.deficit, v.snapshot, v.fecha]);

  const editableManual = v.manual && !v.bloqueado;
  const base: BasePC = v.bloqueado
    ? ((v.snapshot as unknown as BasePC) ?? baseLive(binder, lineas, siniestros, n(ibnr), n(deficit)))
    : v.manual ? man : baseLive(binder, lineas, siniestros, n(ibnr), n(deficit));
  const f = derivar(base, previouslyPaid);

  const persist = () => {
    if (v.bloqueado) return;
    if (v.manual) onSnapshot(v, man);
    else onEditar(v, { ibnr_pct: ibnr, deficit });
  };
  const upd = (field: keyof BasePC, x: string) => setMan((m) => ({ ...m, [field]: n(x) }));

  // Celda de importe: editable (input) si es manual abierta; si no, estática.
  const amt = (field: keyof BasePC): ReactNode => editableManual
    ? <td className="num pc-edit"><NumberInput value={String(man[field] ?? 0)} onChange={(x) => upd(field, x)} className="pc-inp" /></td>
    : <td className="num">{imp(base[field])}</td>;
  const pctd = (x: number): ReactNode => <td className="num pc-pctcol">{pct(x)}</td>;

  // IBNR% y PC%: editables (input) según modo; deficit editable en auto y manual.
  const ibnrCell: ReactNode = v.bloqueado ? pct(base.ibnrPct)
    : v.manual ? <NumberInput value={String(man.ibnrPct ?? 0)} onChange={(x) => upd("ibnrPct", x)} suffix="%" thousands={false} className="pc-inp-pct" />
    : <NumberInput value={ibnr} onChange={setIbnr} suffix="%" thousands={false} className="pc-inp-pct" />;
  const pcPctCell: ReactNode = editableManual
    ? <NumberInput value={String(man.pcPct ?? 0)} onChange={(x) => upd("pcPct", x)} suffix="%" thousands={false} className="pc-inp-pct" />
    : pct(base.pcPct);
  const deficitCell: ReactNode = v.bloqueado ? <td className="num">{imp(base.deficit)}</td>
    : v.manual ? <td className="num pc-edit"><NumberInput value={String(man.deficit ?? 0)} onChange={(x) => upd("deficit", x)} className="pc-inp" /></td>
    : <td className="num pc-edit"><NumberInput value={deficit} onChange={setDeficit} className="pc-inp" /></td>;

  return (
    <div className={"pc-card" + (v.bloqueado ? " bloqueada" : "") + (v.manual ? " manual" : "")}>
      <div className="pc-card-cab">
        <label className="pc-lock" title={v.bloqueado ? "Desbloquear" : "Bloquear y congelar"}>
          <input type="checkbox" checked={v.bloqueado} disabled={busy}
            onChange={(e) => (e.target.checked ? onBloquear(v, base, fecha || hoyISO()) : onDesbloquear(v))} />
          {v.bloqueado ? "🔒" : "Bloquear"}
        </label>
        <input type="date" className="inp-fecha" value={fecha} disabled={v.bloqueado || busy}
          onChange={(e) => { setFecha(e.target.value); onEditar(v, { fecha: e.target.value || null }); }} />
        {!v.bloqueado && (
          <button className="btn-link btn-sm" disabled={busy} title="Alternar: calcular en vivo ↔ rellenar a mano"
            onClick={() => onManual(v, !v.manual, baseLive(binder, lineas, siniestros, n(ibnr), n(deficit)))}>
            {v.manual ? "Auto" : "✏️ A mano"}
          </button>
        )}
        {esUltima && !v.bloqueado && hayVarias && (
          <button className="btn-icono" title="Borrar esta valoración" disabled={busy} onClick={() => onBorrar(v)}>🗑️</button>
        )}
      </div>
      <table className="compacto pc-tabla pc-tabla3" onBlur={persist}>
        <tbody>
          <tr className="pc-hdr"><td colSpan={3}>Income</td></tr>
          <tr className="pc-fuerte"><td>GWP</td><td className="pc-pctcol"></td>{amt("gwp")}</tr>

          <tr className="pc-hdr"><td colSpan={3}>Outgo</td></tr>
          <tr><td>Comisión</td>{pctd(f.comCoverPct)}{amt("comCover")}</tr>
          <tr><td>Brokerage</td>{pctd(f.brokeragePct)}{amt("brokerage")}</tr>
          <tr><td>UW Expenses</td>{pctd(f.uwPct)}{amt("uwExp")}</tr>
          <tr><td>Taxes</td>{pctd(f.taxesPct)}{amt("taxes")}</tr>
          <tr className="pc-subtotal"><td>Total</td>{pctd(f.outgoPct)}<td className="num">{imp(f.outgoTotal)}</td></tr>

          <tr className="pc-hdr"><td colSpan={3}>Claims</td></tr>
          <tr><td>Paid Fees</td><td className="pc-pctcol"></td>{amt("paidFees")}</tr>
          <tr><td>Reserved Fees</td><td className="pc-pctcol"></td>{amt("resFees")}</tr>
          <tr><td>Paid Indemnity</td><td className="pc-pctcol"></td>{amt("paidIndem")}</tr>
          <tr><td>Reserved Indemnity</td><td className="pc-pctcol"></td>{amt("resIndem")}</tr>
          <tr><td>IBNR</td><td className="num pc-pctcol">{ibnrCell}</td><td className="num">{imp(f.ibnr)}</td></tr>
          <tr className="pc-subtotal"><td>Total</td>{pctd(f.claimsPct)}<td className="num">{imp(f.claimsTotal)}</td></tr>

          <tr className="pc-hdr"><td colSpan={3}>Deficit</td></tr>
          <tr><td>Brought from previous YOAs</td><td className="pc-pctcol"></td>{deficitCell}</tr>

          <tr className="pc-hdr"><td colSpan={3}>PC</td></tr>
          <tr className="pc-fuerte"><td>Result</td><td className="pc-pctcol"></td><td className="num">{imp(f.result)}</td></tr>
          <tr className="pc-fuerte"><td>PC</td><td className="num pc-pctcol">{pcPctCell}</td>
            <td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(f.pc)}</td></tr>
          <tr><td className="hint">PC Previously Paid</td><td className="pc-pctcol"></td><td className="num hint">{imp(f.previouslyPaid)}</td></tr>
          <tr className="pc-fuerte pc-due"><td>TOTAL PC DUE</td><td className="pc-pctcol"></td>
            <td className="num" style={{ color: "var(--naranja-osc)" }}>{imp(f.totalDue)}</td></tr>
        </tbody>
      </table>
      {esUltima && v.bloqueado && (
        <button className="btn-primary btn-sm pc-dup" disabled={busy} onClick={onDuplicar}>＋ Duplicar (siguiente)</button>
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
        pcApi.crear(binder.id, { ibnr_pct: "0", deficit: "0" }).then((v) => setVals([v])).finally(() => { creando.current = false; });
      } else setVals(vs);
    }).catch(() => setVals([]));
  }, [binder.id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!vals) return <div className="loading">Cargando…</div>;

  const ordenadas = [...vals].sort((a, b) => a.orden - b.orden);
  const ultima = ordenadas[ordenadas.length - 1];
  const reemplaza = (nv: PcValoracion) => setVals((xs) => (xs ?? []).map((x) => (x.id === nv.id ? nv : x)));

  const put = (v: PcValoracion, c: object) => { setBusy(true); pcApi.editar(v.id, c).then(reemplaza).finally(() => setBusy(false)); };
  const onEditar = (v: PcValoracion, c: { fecha?: string | null; ibnr_pct?: string; deficit?: string }) => put(v, c);
  const onSnapshot = (v: PcValoracion, base: BasePC) => put(v, { snapshot: base, ibnr_pct: String(base.ibnrPct), deficit: String(base.deficit) });
  const onManual = (v: PcValoracion, manual: boolean, liveBase: BasePC) => put(v, manual ? { manual: true, snapshot: liveBase } : { manual: false });
  const onBloquear = (v: PcValoracion, base: BasePC, fecha: string) =>
    put(v, { bloqueado: true, snapshot: base, fecha, ibnr_pct: String(base.ibnrPct), deficit: String(base.deficit) });
  const onDesbloquear = (v: PcValoracion) => put(v, { bloqueado: false });
  const onBorrar = (v: PcValoracion) => { setBusy(true); pcApi.borrar(v.id).then(() => setVals((xs) => (xs ?? []).filter((x) => x.id !== v.id))).finally(() => setBusy(false)); };
  const onDuplicar = () => { setBusy(true); pcApi.crear(binder.id, { ibnr_pct: String(ultima.ibnr_pct ?? "0"), deficit: "0" }).then((nv) => setVals((xs) => [...(xs ?? []), nv])).finally(() => setBusy(false)); };

  const pcDe = (v: PcValoracion): number => derivar(baseDe(binder, lineas, siniestros, v), 0).pc;

  return (
    <div className="pc-valoraciones">
      {ordenadas.map((v, i) => (
        <PcCard key={v.id} binder={binder} lineas={lineas} siniestros={siniestros} v={v}
          previouslyPaid={i > 0 ? pcDe(ordenadas[i - 1]) : 0}
          esUltima={v.id === ultima.id} hayVarias={ordenadas.length > 1} busy={busy}
          onEditar={onEditar} onSnapshot={onSnapshot} onManual={onManual}
          onBloquear={onBloquear} onDesbloquear={onDesbloquear} onBorrar={onBorrar} onDuplicar={onDuplicar} />
      ))}
    </div>
  );
}
