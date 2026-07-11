import { useEffect, useMemo, useState } from "react";
import { contabilidadApi, type ConcPreview, type ConcApunte } from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import FormPanel from "./FormPanel";

// Conciliación (Fase B): la app PROPONE, tú revisas y confirmas. Nada se enlaza sin que lo veas.
// Por cada apunte de seguros sin conciliar: transferencias candidatas (marcables), suma y residual en
// vivo, y una etiqueta de confianza. Solo al pulsar "Conciliar" se persiste lo marcado.
const n = (v: number | string | null | undefined) => Number(v ?? 0);

export default function ConciliarExtracto({ cuenta, onClose, onSaved }: {
  cuenta: string; onClose: () => void; onSaved: () => void;
}) {
  const [prev, setPrev] = useState<ConcPreview | null>(null);
  const [dias, setDias] = useState(7);
  const [sel, setSel] = useState<Record<number, Set<number>>>({});     // mid → transferencia_ids marcadas
  const [incluir, setIncluir] = useState<Record<number, boolean>>({}); // mid → conciliar este apunte
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ conciliados: number; conflictos: number[] } | null>(null);

  async function cargar(d = dias) {
    setBusy(true); setError(null);
    try {
      const p = await contabilidadApi.conciliarPreview(cuenta, d);
      setPrev(p);
      const s: Record<number, Set<number>> = {}; const inc: Record<number, boolean> = {};
      for (const a of p.apuntes) { s[a.mid] = new Set(a.preseleccion); inc[a.mid] = a.confianza === "exacta"; }
      setSel(s); setIncluir(inc);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Transferencias (agrupadas) de un apunte: [tid, {imp, fecha, filas[]}].
  const transfsDe = (a: ConcApunte) => {
    const m = new Map<number, { imp: number; fecha: string | null; filas: typeof a.filas }>();
    for (const f of a.filas) {
      if (!m.has(f.transferencia_id)) m.set(f.transferencia_id, { imp: n(f.importe_transferencia), fecha: f.fecha, filas: [] });
      m.get(f.transferencia_id)!.filas.push(f);
    }
    return [...m.entries()];
  };
  const sumaDe = (a: ConcApunte) => transfsDe(a).reduce((acc, [tid, t]) => acc + (sel[a.mid]?.has(tid) ? t.imp : 0), 0);

  function toggleTr(mid: number, tid: number) {
    setSel((s) => { const cur = new Set(s[mid]); cur.has(tid) ? cur.delete(tid) : cur.add(tid); return { ...s, [mid]: cur }; });
  }
  const totalConciliar = useMemo(() => (prev?.apuntes ?? []).filter((a) => incluir[a.mid] && (sel[a.mid]?.size ?? 0) > 0).length, [prev, incluir, sel]);

  async function aplicar() {
    if (!prev) return;
    const items = prev.apuntes
      .filter((a) => incluir[a.mid] && (sel[a.mid]?.size ?? 0) > 0)
      .map((a) => ({ mid: a.mid, transferencia_ids: [...(sel[a.mid] ?? [])] }));
    if (!items.length) { setError("No hay ningún apunte marcado para conciliar."); return; }
    setBusy(true); setError(null);
    try { setRes(await contabilidadApi.conciliarAplicar(items)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const conf = (c: string) => c === "exacta"
    ? <span className="pill pill-cobrado">✅ Exacta</span>
    : c === "revisar" ? <span className="pill pill-pendiente">🟡 Revisar</span>
    : <span className="pill pill-anulado">⚪ Sin candidatas</span>;

  return (
    <FormPanel
      title={`Conciliar · ${cuenta}`}
      dirty={false} saving={busy}
      saveLabel={res ? "Cerrar" : `Conciliar seleccionados (${totalConciliar})`}
      saveDisabled={!res && (!prev || totalConciliar === 0)}
      error={error}
      onSave={res ? onSaved : aplicar}
      onClose={onClose}
      wide
    >
      {!prev ? (
        <div className="loading">Buscando cuadres…</div>
      ) : res ? (
        <div>
          <div className="hint" style={{ marginBottom: 8 }}>✅ Conciliación aplicada.</div>
          <table className="compacto"><tbody>
            <tr><td>Apuntes conciliados</td><td className="num"><b>{res.conciliados}</b></td></tr>
            {res.conflictos.length > 0 && <tr><td>⚠️ Con conflicto (transferencia ya usada)</td><td className="num">{res.conflictos.length}</td></tr>}
          </tbody></table>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ gap: 10, marginBottom: 8, flexWrap: "wrap", fontSize: 13, alignItems: "center" }}>
            <span className="pill pill-cobrado">Exactas: {prev.n_exactas}</span>
            <span className="pill pill-pendiente">A revisar: {prev.n_revisar}</span>
            <span className="pill pill-anulado">Sin candidatas: {prev.n_sin}</span>
            <span style={{ marginLeft: "auto" }} />
            <label className="hint">Ventana ±
              <select value={dias} disabled={busy} onChange={(e) => { const d = Number(e.target.value); setDias(d); cargar(d); }} style={{ margin: "0 4px" }}>
                {[3, 5, 7, 10, 15].map((d) => <option key={d} value={d}>{d}</option>)}
              </select> días</label>
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>
            Nada se enlaza hasta que pulses <b>Conciliar</b>. Las <b>exactas</b> vienen marcadas; las de
            <b> revisar</b> muéstranse con su residual para que tú decidas (desmarca lo que no cuadre).
          </div>

          {prev.apuntes.length === 0 ? (
            <div className="empty">No hay apuntes de seguros pendientes de conciliar en {cuenta}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "56vh", overflowY: "auto" }}>
              {prev.apuntes.map((a) => {
                const suma = sumaDe(a);
                const residual = n(a.importe) - suma;
                const cuadra = Math.abs(residual) < 0.01 && (sel[a.mid]?.size ?? 0) > 0;
                return (
                  <div key={a.mid} className="conc-apunte" style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: "8px 10px", opacity: incluir[a.mid] ? 1 : 0.6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!incluir[a.mid]} onChange={(e) => setIncluir((s) => ({ ...s, [a.mid]: e.target.checked }))} />
                        <b>{a.fecha ? fmtFechaES(a.fecha) : "—"}</b>
                      </label>
                      <span>{a.concepto}</span>
                      <span className="num" style={{ fontWeight: 600 }}>{fmtMiles(a.importe)} €</span>
                      {conf(a.confianza)}
                      <span style={{ marginLeft: "auto", fontSize: 12 }} className={cuadra ? "" : "hint"}>
                        {cuadra ? <b style={{ color: "#0a0" }}>✓ cuadra ({fmtMiles(suma)} €)</b>
                          : <>sel. {fmtMiles(suma)} de {fmtMiles(a.importe)} · residual <b style={{ color: Math.abs(residual) < 0.01 ? "#0a0" : "#b00" }}>{fmtMiles(residual)} €</b></>}
                      </span>
                    </div>
                    {a.filas.length === 0 ? (
                      <div className="hint" style={{ padding: "4px 0 0 26px" }}>Sin transferencias candidatas en la ventana. Amplía los días o concílialo a mano.</div>
                    ) : (
                      <div style={{ marginTop: 6, marginLeft: 22 }}>
                        {transfsDe(a).map(([tid, t]) => (
                          <div key={tid} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "1px 0" }}>
                            <input type="checkbox" checked={!!sel[a.mid]?.has(tid)} disabled={!incluir[a.mid]} onChange={() => toggleTr(a.mid, tid)} />
                            <span className="num" style={{ width: 90, textAlign: "right", fontWeight: 600 }}>{fmtMiles(t.imp)} €</span>
                            <span className="hint" style={{ width: 78 }}>{t.fecha ? fmtFechaES(t.fecha) : ""}</span>
                            <span style={{ flex: 1, fontSize: 12 }}>
                              {t.filas.map((f, k) => (
                                <span key={k}>{k > 0 ? " · " : ""}{f.recibo ?? f.referencia ?? "—"}{f.cliente ? ` (${f.cliente})` : ""}</span>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </FormPanel>
  );
}
