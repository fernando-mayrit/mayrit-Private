import { useEffect, useMemo, useState } from "react";
import { contabilidadApi, type ImportPreview, type ContaCategoria, type MovAAlta } from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import FormPanel from "./FormPanel";

// Importar un extracto bancario (Norma 43): preview → revisar (cuenta, cuadre, categorías, duplicados)
// → dar de alta en bloque los seleccionados. La categoría se aprende del histórico y se puede ajustar.
type Fila = { incluir: boolean; concepto: string | null; grupo: string | null };

export default function ImportarExtracto({
  file, cuentaActual, cats, onClose, onSaved,
}: {
  file: File;
  cuentaActual: string;
  cats: ContaCategoria[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prev, setPrev] = useState<ImportPreview | null>(null);
  const [cuenta, setCuenta] = useState<string>("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ creados: number; saltados: number } | null>(null);

  // Grupo por concepto (para autocompletar al elegir categoría en una fila).
  const grupoDe = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of cats) m.set(c.concepto, c.grupo ?? null);
    return m;
  }, [cats]);
  const conceptos = useMemo(() => [...new Set(cats.map((c) => c.concepto))].sort((a, b) => a.localeCompare(b)), [cats]);

  async function cargar(ctaForzada?: string) {
    setBusy(true); setError(null);
    try {
      const p = await contabilidadApi.importarPreview(file, ctaForzada || undefined);
      setPrev(p);
      const cta = ctaForzada || p.cuenta_sugerida || cuentaActual || (p.cuentas[0] ?? "");
      setCuenta(cta);
      // Por defecto se incluyen SOLO los nuevos (los duplicados se dejan fuera).
      setFilas(p.movimientos.map((m) => ({ incluir: m.estado === "nuevo", concepto: m.concepto, grupo: m.grupo })));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const nIncluir = filas.filter((f) => f.incluir).length;

  function setFila(i: number, patch: Partial<Fila>) {
    setFilas((s) => s.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  }
  function marcarTodos(estado: string, incluir: boolean) {
    if (!prev) return;
    setFilas((s) => s.map((f, i) => (prev.movimientos[i].estado === estado ? { ...f, incluir } : f)));
  }

  async function aplicar() {
    if (!prev || !cuenta) return;
    const movimientos: MovAAlta[] = [];
    prev.movimientos.forEach((m, i) => {
      if (!filas[i].incluir) return;
      movimientos.push({
        fecha: m.fecha!, tipo: m.tipo, concepto: filas[i].concepto, grupo: filas[i].grupo,
        importe: m.importe, saldo: m.saldo, descripcion: m.descripcion, tarjeta: m.tarjeta, huella: m.huella,
      });
    });
    if (!movimientos.length) { setError("No hay ningún movimiento seleccionado."); return; }
    setBusy(true); setError(null);
    try { setRes(await contabilidadApi.importarAplicar({ cuenta, movimientos })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const badge = (estado: string) => {
    if (estado === "nuevo") return <span className="pill pill-cobrado">Nuevo</span>;
    if (estado === "importado") return <span className="pill pill-anulado" title="Misma huella ya en la app">Ya importado</span>;
    return <span className="pill pill-pendiente" title="Mismo importe y fecha que un apunte existente">Posible dup.</span>;
  };

  return (
    <FormPanel
      title={`Importar extracto · ${file.name}`}
      dirty={false} saving={busy}
      saveLabel={res ? "Cerrar" : `Dar de alta (${nIncluir})`}
      saveDisabled={!res && (!prev || !cuenta || nIncluir === 0)}
      error={error}
      onSave={res ? onSaved : aplicar}
      onClose={onClose}
      wide
    >
      {!prev ? (
        <div className="loading">Leyendo extracto…</div>
      ) : res ? (
        <div>
          <div className="hint" style={{ marginBottom: 8 }}>✅ Importación completada.</div>
          <table className="compacto"><tbody>
            <tr><td>Movimientos dados de alta</td><td className="num"><b>{res.creados}</b></td></tr>
            {res.saltados > 0 && <tr><td>Saltados (ya importados)</td><td className="num">{res.saltados}</td></tr>}
          </tbody></table>
        </div>
      ) : (
        <>
          <div className="campos-grid campos-fill" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 8 }}>
            <div className="field">
              <label>Cuenta de destino</label>
              <select value={cuenta} onChange={(e) => { setCuenta(e.target.value); cargar(e.target.value); }} disabled={busy}>
                {!prev.cuenta_sugerida && <option value="">— elige la cuenta —</option>}
                {prev.cuentas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="hint">Banco {prev.banco} · nº {prev.cuenta_banco} · {prev.nombre_banco}
                {prev.cuenta_sugerida ? " (detectada por IBAN)" : " — no se pudo detectar, elígela"}</span>
            </div>
            <div className="field">
              <label>Periodo del extracto</label>
              <input type="text" readOnly value={`${prev.periodo_ini ? fmtFechaES(prev.periodo_ini) : "?"} — ${prev.periodo_fin ? fmtFechaES(prev.periodo_fin) : "?"}`} />
              <span className="hint">
                Saldo {fmtMiles(prev.saldo_ini)} → {fmtMiles(prev.saldo_fin)} €{" "}
                {prev.cuadra ? <b style={{ color: "#0a0" }}>· cuadra ✓</b> : <b style={{ color: "#b00" }}>· NO cuadra ⚠</b>}
              </span>
            </div>
          </div>

          {!prev.cuadra && (
            <div className="import-aviso" style={{ marginBottom: 8 }}>
              ⚠️ El extracto <b>no cuadra</b> (saldo inicial + movimientos ≠ saldo final). Revísalo antes de dar de alta;
              puede que el formato del banco no encaje del todo.
            </div>
          )}

          <div className="toolbar" style={{ gap: 8, marginBottom: 6, flexWrap: "wrap", fontSize: 13 }}>
            <span className="pill pill-cobrado">Nuevos: {prev.n_nuevos}</span>
            <span className="pill pill-pendiente">Posibles dup.: {prev.n_posibles}</span>
            <span className="pill pill-anulado">Ya importados: {prev.n_importados}</span>
            <span style={{ marginLeft: "auto" }} />
            <button type="button" className="btn-link btn-sm" onClick={() => marcarTodos("nuevo", true)}>Marcar nuevos</button>
            <button type="button" className="btn-link btn-sm" onClick={() => marcarTodos("posible", true)}>+ posibles</button>
            <button type="button" className="btn-link btn-sm" onClick={() => setFilas((s) => s.map((f) => ({ ...f, incluir: false })))}>Ninguno</button>
          </div>

          <div className="tabla-scroll" style={{ maxHeight: "48vh", overflowY: "auto" }}>
            <table className="compacto tabla-risk-preview">
              <thead><tr>
                <th style={{ width: 28 }} />
                <th>Fecha</th><th>Estado</th><th className="num">Importe</th>
                <th>Categoría (concepto)</th><th>Descripción</th>
              </tr></thead>
              <tbody>
                {prev.movimientos.map((m, i) => {
                  const esGasto = Number(m.importe) < 0;
                  return (
                    <tr key={i} style={{ opacity: filas[i].incluir ? 1 : 0.5 }}>
                      <td><input type="checkbox" checked={filas[i].incluir} onChange={(e) => setFila(i, { incluir: e.target.checked })} /></td>
                      <td>{m.fecha ? fmtFechaES(m.fecha) : "—"}</td>
                      <td>{badge(m.estado)}</td>
                      <td className="num" style={{ color: esGasto ? "#b00" : "#0a0", whiteSpace: "nowrap" }}>
                        {esGasto ? "−" : "+"}{fmtMiles(Math.abs(Number(m.importe)))}
                      </td>
                      <td>
                        <select value={filas[i].concepto ?? ""} disabled={!filas[i].incluir}
                          onChange={(e) => setFila(i, { concepto: e.target.value || null, grupo: e.target.value ? (grupoDe.get(e.target.value) ?? null) : null })}
                          style={{ fontSize: 12, maxWidth: 200 }}>
                          <option value="">— sin categoría —</option>
                          {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {filas[i].grupo && <span className="hint" style={{ marginLeft: 4 }}>{filas[i].grupo}</span>}
                      </td>
                      <td style={{ maxWidth: 260, wordBreak: "break-word" }}>{m.descripcion}{m.tarjeta && <span className="hint"> · 💳</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <span className="hint" style={{ marginTop: 6, display: "block" }}>
            Se darán de alta los <b>marcados</b> ({nIncluir}). Los "ya importados" se saltan aunque los marques.
            Lo que dejes sin categoría se puede clasificar luego desde el listado.
          </span>
        </>
      )}
    </FormPanel>
  );
}
