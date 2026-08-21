import { useEffect, useMemo, useState } from "react";
import { contabilidadApi, type ConcPreview, type ConcApunte, type ReciboJustif, type EspejoCandidato } from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import FormPanel from "./FormPanel";

// Conciliación (Fase B): la app PROPONE, tú revisas y confirmas. Nada se enlaza sin que lo veas.
// Por cada apunte de seguros sin conciliar: transferencias candidatas (marcables), suma y residual en
// vivo, y una etiqueta de confianza. Solo al pulsar "Conciliar" se persiste lo marcado.
// A MANO (cuando el automático no llega): 🔍 buscar cualquier transferencia libre (sin ventana de días
// ni clase), ⇄ justificar por espejo del apunte de la otra cuenta, y una tolerancia para que una
// diferencia de céntimos no obligue a repasar el apunte (se guarda como línea de ajuste del PDF).
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const hoy = () => new Date().toISOString().slice(0, 10);

export default function ConciliarExtracto({ cuenta, onClose, onSaved }: {
  cuenta: string; onClose: () => void; onSaved: () => void;
}) {
  const [prev, setPrev] = useState<ConcPreview | null>(null);
  const [dias, setDias] = useState(15);
  const [tol, setTol] = useState(0.1);
  const [sel, setSel] = useState<Record<number, Set<number>>>({});     // mid → transferencia_ids marcadas
  const [incluir, setIncluir] = useState<Record<number, boolean>>({}); // mid → conciliar este apunte
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ conciliados: number; conflictos: number[] } | null>(null);

  // Panel de BÚSQUEDA manual (abierto en un apunte cada vez).
  const [buscaMid, setBuscaMid] = useState<number | null>(null);
  const [bq, setBq] = useState("");
  const [bImp, setBImp] = useState("");
  const [bTol, setBTol] = useState("1");
  const [bDesde, setBDesde] = useState("");
  const [bHasta, setBHasta] = useState("");
  const [bLibre, setBLibre] = useState(false);      // ignorar clase/ámbito del apunte
  const [bRes, setBRes] = useState<ReciboJustif[] | null>(null);
  // Panel de ESPEJO (justificar con las transferencias del apunte de la otra cuenta).
  const [espejoMid, setEspejoMid] = useState<number | null>(null);
  const [espejoCands, setEspejoCands] = useState<EspejoCandidato[]>([]);
  const [espejoSel, setEspejoSel] = useState<number | "">("");

  async function cargar(d = dias, t = tol) {
    setBusy(true); setError(null);
    try {
      const p = await contabilidadApi.conciliarPreview(cuenta, d, t);
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
  const residualDe = (a: ConcApunte) => n(a.importe) - sumaDe(a);
  const cuadraDe = (a: ConcApunte) => Math.abs(residualDe(a)) <= tol && (sel[a.mid]?.size ?? 0) > 0;

  function toggleTr(mid: number, tid: number) {
    setSel((s) => { const cur = new Set(s[mid]); cur.has(tid) ? cur.delete(tid) : cur.add(tid); return { ...s, [mid]: cur }; });
  }
  const totalConciliar = useMemo(() => (prev?.apuntes ?? []).filter((a) => incluir[a.mid] && (sel[a.mid]?.size ?? 0) > 0).length, [prev, incluir, sel]);

  // Lo que se manda al servidor por apunte: transferencias marcadas + (si la hay) la diferencia, que
  // se guarda como línea de ajuste del justificante para que el PDF siga cuadrando con el apunte.
  const itemDe = (a: ConcApunte) => {
    const r = residualDe(a);
    return {
      mid: a.mid, transferencia_ids: [...(sel[a.mid] ?? [])],
      ajuste: Math.abs(r) >= 0.01 ? Number(r.toFixed(2)) : null,
      ajuste_texto: Math.abs(r) <= tol ? "Diferencia de redondeo" : "Diferencia",
    };
  };

  async function aplicar() {
    if (!prev) return;
    const items = prev.apuntes.filter((a) => incluir[a.mid] && (sel[a.mid]?.size ?? 0) > 0).map(itemDe);
    if (!items.length) { setError("No hay ningún apunte marcado para conciliar."); return; }
    setBusy(true); setError(null);
    try { setRes(await contabilidadApi.conciliarAplicar(items)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  // Conciliar SOLO este apunte (una a una): al aplicarlo, desaparece del listado.
  const [hechos, setHechos] = useState(0);
  const [confirmar, setConfirmar] = useState<number | null>(null);   // mid pendiente de confirmar la diferencia
  const quitar = (mid: number) => setPrev((p) => (p ? { ...p, apuntes: p.apuntes.filter((x) => x.mid !== mid) } : p));
  async function conciliarUno(a: ConcApunte) {
    const tids = [...(sel[a.mid] ?? [])];
    if (!tids.length) { setError("Marca al menos una transferencia en este apunte."); return; }
    setBusy(true); setError(null);
    try {
      const r = await contabilidadApi.conciliarAplicar([itemDe(a)]);
      if (r.conflictos.length) { setError("Alguna transferencia ya está usada en otra conciliación."); }
      else { setHechos((h) => h + 1); quitar(a.mid); setConfirmar(null); if (buscaMid === a.mid) setBuscaMid(null); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  // ── Búsqueda manual: abre el panel con el importe que falta y una ventana de ±2 meses ──
  function abrirBusqueda(a: ConcApunte) {
    if (buscaMid === a.mid) { setBuscaMid(null); return; }
    const falta = Math.abs(residualDe(a));
    setBuscaMid(a.mid); setEspejoMid(null); setBRes(null); setBq(""); setBLibre(false); setBTol("1");
    setBImp((falta >= 1 ? falta : Math.abs(n(a.importe))).toFixed(2));
    const base = new Date(a.fecha ? a.fecha.slice(0, 10) : hoy());
    const desde = new Date(base); desde.setMonth(desde.getMonth() - 2);
    const hasta = new Date(base); hasta.setMonth(hasta.getMonth() + 2);
    setBDesde(desde.toISOString().slice(0, 10)); setBHasta(hasta.toISOString().slice(0, 10));
  }
  async function buscar(a: ConcApunte) {
    setBusy(true); setError(null);
    try {
      const r = await contabilidadApi.conciliarBuscar({
        q: bq.trim() || undefined,
        importe: bImp.trim() ? Number(bImp.replace(",", ".")) : undefined,
        tol: bTol.trim() ? Number(bTol.replace(",", ".")) : undefined,
        desde: bDesde || undefined, hasta: bHasta || undefined,
        clase: bLibre ? undefined : a.clase, ambito: bLibre ? undefined : (a.ambito ?? undefined),
        excluirMid: a.mid,
      });
      const yaPuestas = new Set(a.filas.map((f) => f.transferencia_id));
      setBRes(r.filter((f) => !yaPuestas.has(f.transferencia_id)));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  // Añade al apunte la transferencia encontrada y la deja MARCADA.
  function agregar(a: ConcApunte, tid: number) {
    const filas = (bRes ?? []).filter((f) => f.transferencia_id === tid);
    if (!filas.length) return;
    setPrev((p) => (p ? { ...p, apuntes: p.apuntes.map((x) => (x.mid === a.mid ? { ...x, filas: [...x.filas, ...filas] } : x)) } : p));
    setSel((s) => ({ ...s, [a.mid]: new Set([...(s[a.mid] ?? []), tid]) }));
    setIncluir((s) => ({ ...s, [a.mid]: true }));
    setBRes((r) => (r ?? []).filter((f) => f.transferencia_id !== tid));
  }

  // ── Espejo: este apunte es la otra pata de un traspaso entre cuentas propias ──
  async function abrirEspejo(a: ConcApunte) {
    if (espejoMid === a.mid) { setEspejoMid(null); return; }
    setEspejoMid(a.mid); setBuscaMid(null); setEspejoSel(""); setEspejoCands([]);
    setBusy(true); setError(null);
    try { setEspejoCands(await contabilidadApi.espejoCandidatos(a.mid)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function aplicarEspejo(a: ConcApunte) {
    if (!espejoSel) return;
    setBusy(true); setError(null);
    try {
      await contabilidadApi.actualizar(a.mid, { espejo_mid: Number(espejoSel) });
      setHechos((h) => h + 1); quitar(a.mid); setEspejoMid(null);
    } catch (e) { setError((e as Error).message); }
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
      onClose={() => (hechos > 0 ? onSaved() : onClose())}
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
            <label className="hint">Da por bueno hasta
              <select value={tol} disabled={busy} onChange={(e) => { const t = Number(e.target.value); setTol(t); cargar(dias, t); }} style={{ margin: "0 4px" }}>
                {[0.01, 0.1, 1, 2, 5].map((t) => <option key={t} value={t}>{t.toFixed(2).replace(".", ",")} €</option>)}
              </select> de diferencia</label>
            <label className="hint">Ventana ±
              <select value={dias} disabled={busy} onChange={(e) => { const d = Number(e.target.value); setDias(d); cargar(d, tol); }} style={{ margin: "0 4px" }}>
                {[3, 5, 7, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d}</option>)}
              </select> días</label>
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>
            Nada se enlaza hasta que lo confirmes. Concilia <b>una a una</b> con el botón <b>🔗</b> de cada
            cuadro (desaparece al hacerlo){hechos > 0 ? <> · <b style={{ color: "#0a0" }}>{hechos} ya hecha{hechos !== 1 ? "s" : ""}</b></> : null},
            o varias de golpe con el botón de abajo. Si un apunte no encuentra su transferencia, pulsa
            <b> 🔍</b> y búscala tú (por importe, por póliza o por fechas); si es la otra pata de un traspaso
            entre cuentas propias, pulsa <b>⇄</b>. La diferencia que aceptes sale como línea de ajuste en el justificante.
          </div>

          {prev.apuntes.length === 0 ? (
            <div className="empty">No hay apuntes de seguros pendientes de conciliar en {cuenta}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "56vh", overflowY: "auto" }}>
              {prev.apuntes.map((a) => {
                const suma = sumaDe(a);
                const residual = residualDe(a);
                const cuadra = cuadraDe(a);
                const marcadas = sel[a.mid]?.size ?? 0;
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
                        {cuadra
                          ? <b style={{ color: "#0a0" }}>✓ cuadra ({fmtMiles(suma)} €){Math.abs(residual) >= 0.01 ? ` · dif. ${fmtMiles(residual)} €` : ""}</b>
                          : <>sel. {fmtMiles(suma)} de {fmtMiles(a.importe)} · falta <b style={{ color: "#b00" }}>{fmtMiles(residual)} €</b></>}
                      </span>
                      <button className="btn-link btn-sm" disabled={busy} title="Buscar a mano la transferencia (sin ventana de días)"
                        onClick={() => abrirBusqueda(a)}>🔍</button>
                      <button className="btn-link btn-sm" disabled={busy} title="Justificar por espejo del apunte de la otra cuenta"
                        onClick={() => abrirEspejo(a)}>⇄</button>
                      <button className="btn-primary btn-sm" disabled={busy || marcadas === 0}
                        title={cuadra ? "Conciliar solo este apunte" : `Conciliar dejando una diferencia de ${fmtMiles(residual)} €`}
                        style={{ whiteSpace: "nowrap" }}
                        onClick={() => (cuadra || confirmar === a.mid ? conciliarUno(a) : setConfirmar(a.mid))}>
                        {confirmar === a.mid && !cuadra ? `¿Conciliar con ${fmtMiles(residual)} € de diferencia?` : "🔗 Conciliar"}
                      </button>
                    </div>

                    {a.filas.length === 0 ? (
                      <div className="hint" style={{ padding: "4px 0 0 26px" }}>Sin transferencias candidatas en la ventana. Amplía los días, búscala a mano con 🔍 o, si es la otra pata de un traspaso entre cuentas propias, justifícala con ⇄.</div>
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

                    {buscaMid === a.mid && (
                      <div style={{ marginTop: 8, marginLeft: 22, padding: 8, background: "#f6f6f6", borderRadius: 6 }}>
                        <div className="toolbar" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <input placeholder="Póliza, recibo, mercado, notas…" value={bq} onChange={(e) => setBq(e.target.value)} style={{ flex: "1 1 190px" }} />
                          <label className="hint">Importe <input value={bImp} onChange={(e) => setBImp(e.target.value)} style={{ width: 100 }} /></label>
                          <label className="hint">± <input value={bTol} onChange={(e) => setBTol(e.target.value)} style={{ width: 55 }} /> €</label>
                          <label className="hint">Del <input type="date" value={bDesde} onChange={(e) => setBDesde(e.target.value)} /></label>
                          <label className="hint">al <input type="date" value={bHasta} onChange={(e) => setBHasta(e.target.value)} /></label>
                          <label className="hint" title="Buscar también en otros tipos (primas, siniestros, comisiones…) y en cobros/liquidaciones/traspasos">
                            <input type="checkbox" checked={bLibre} onChange={(e) => setBLibre(e.target.checked)} /> buscar en todo
                          </label>
                          <button className="btn-primary btn-sm" disabled={busy} onClick={() => buscar(a)}>Buscar</button>
                        </div>
                        {bRes && (bRes.length === 0
                          ? <div className="hint" style={{ marginTop: 6 }}>Ninguna transferencia libre con esos datos. Vacía el importe, amplía las fechas o marca «buscar en todo».</div>
                          : <div style={{ marginTop: 6 }}>
                              <div className="hint" style={{ marginBottom: 2 }}>{new Set(bRes.map((f) => f.transferencia_id)).size} libre(s) · pulsa ➕ para añadirla a este apunte</div>
                              {[...new Map(bRes.map((f) => [f.transferencia_id, f])).values()].map((f) => (
                                <div key={f.transferencia_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
                                  <button type="button" className="btn-link btn-sm" title="Añadir a este apunte" onClick={() => agregar(a, f.transferencia_id)}>➕</button>
                                  <span className="num" style={{ width: 90, textAlign: "right", fontWeight: 600 }}>{fmtMiles(f.importe_transferencia)} €</span>
                                  <span className="hint" style={{ width: 78 }}>{f.fecha ? fmtFechaES(f.fecha) : ""}</span>
                                  <span style={{ flex: 1, fontSize: 12 }}>{f.recibo ?? f.referencia ?? "—"}{f.cliente ? ` (${f.cliente})` : ""}</span>
                                </div>
                              ))}
                            </div>)}
                      </div>
                    )}

                    {espejoMid === a.mid && (
                      <div style={{ marginTop: 8, marginLeft: 22, padding: 8, background: "#f6f6f6", borderRadius: 6 }}>
                        {espejoCands.length === 0 ? (
                          <div className="hint">No hay ningún apunte ya justificado en otra cuenta con este mismo importe y fecha cercana. Concilia primero la otra pata del traspaso y vuelve aquí.</div>
                        ) : (
                          <div className="toolbar" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="hint">Es la otra pata de:</span>
                            <select value={espejoSel} onChange={(e) => setEspejoSel(e.target.value ? Number(e.target.value) : "")} style={{ flex: "1 1 320px" }}>
                              <option value="">— elige el apunte —</option>
                              {espejoCands.map((c) => (
                                <option key={c.mid} value={c.mid}>
                                  {c.fecha ? fmtFechaES(c.fecha) : ""} · {c.cuenta} · {c.concepto} · {fmtMiles(c.importe)} € ({c.n_transferencias} transf.)
                                </option>
                              ))}
                            </select>
                            <button className="btn-primary btn-sm" disabled={busy || !espejoSel} onClick={() => aplicarEspejo(a)}>⇄ Justificar por espejo</button>
                          </div>
                        )}
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
