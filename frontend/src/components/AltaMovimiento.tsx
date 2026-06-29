import { useEffect, useMemo, useState } from "react";
import { contabilidadApi, type ContaCategoria, type BaseAlta, type MovimientoBancario, type ReciboJustif } from "../api";
import { fmtMiles, fmtFechaES } from "../format";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";

// Alta/edición de movimiento al estilo Access. En ALTA los campos van apareciendo a medida que
// completas el anterior (cascada Tipo→Grupo→Concepto). En EDICIÓN abre bloqueado (solo consulta) y el
// botón «Corregir» desbloquea los campos.
const num = (v: string | number | null | undefined) => Number(v ?? 0);
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function AltaMovimiento({ cuenta, cats, movimiento, onClose, onSaved }: {
  cuenta: string;
  cats: ContaCategoria[];
  movimiento?: MovimientoBancario | null;   // si viene → modo edición
  onClose: () => void;
  onSaved: () => void;
}) {
  const edicion = !!movimiento;
  const [bloqueado, setBloqueado] = useState(edicion);   // edición abre bloqueada; alta no

  const [fecha, setFecha] = useState(movimiento?.fecha?.slice(0, 10) ?? "");
  const [devengo, setDevengo] = useState(movimiento?.devengo?.slice(0, 7) ?? "");
  const [devengoTocado, setDevengoTocado] = useState(edicion);
  const [tipo, setTipo] = useState(movimiento?.tipo ?? "");
  const [grupo, setGrupo] = useState(movimiento?.grupo ?? "");
  const [concepto, setConcepto] = useState(movimiento?.concepto ?? "");
  const [importe, setImporte] = useState(movimiento ? String(num(num(movimiento.gasto) ? movimiento.gasto : movimiento.ingreso)) : "");
  const [saldo, setSaldo] = useState(movimiento?.saldo != null ? String(num(movimiento.saldo)) : "");
  const [descripcion, setDescripcion] = useState(movimiento?.descripcion ?? "");
  const [movBanc, setMovBanc] = useState(movimiento?.movimiento_bancario ?? true);
  const [factura, setFactura] = useState(movimiento?.factura ?? false);
  const [tarjeta, setTarjeta] = useState(movimiento?.tarjeta ?? false);
  const [base, setBase] = useState<BaseAlta | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Justificante: TRANSFERENCIAS (del ledger) que componen este apunte (para el PDF).
  const [transfIds, setTransfIds] = useState<number[]>(movimiento?.transferencia_ids ?? []);
  const [candidatos, setCandidatos] = useState<ReciboJustif[]>([]);   // una fila por recibo
  // Filtro por la fecha del apunte (no editable en la UI; el cuadre es automático por esa fecha).
  const [fechaFiltro] = useState(movimiento?.fecha?.slice(0, 10) ?? "");
  const [impById, setImpById] = useState<Map<number, number>>(new Map());  // importe por transferencia (acumula)
  const [genJustif, setGenJustif] = useState(false);

  // ¿Hay cambios sin guardar? Compara los campos editables con su estado al abrir; así el aviso de
  // "Cambios sin guardar" solo salta si de verdad se tocó algo (antes `dirty` iba fijo a true).
  const snapshot = JSON.stringify({ fecha, devengo, tipo, grupo, concepto, importe, saldo, descripcion, movBanc, factura, tarjeta, transfIds });
  const [inicialSnap] = useState(snapshot);
  const dirty = snapshot !== inicialSnap;

  const grupos = useMemo(() => [...new Set(cats.filter((c) => c.tipo === tipo).map((c) => c.grupo).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [cats, tipo]);
  const conceptos = useMemo(() => cats.filter((c) => c.tipo === tipo && c.grupo === grupo).map((c) => c.concepto).sort((a, b) => a.localeCompare(b)), [cats, tipo, grupo]);
  const cuentaContable = useMemo(() => cats.find((c) => c.concepto === concepto)?.cuenta_contable ?? null, [cats, concepto]);
  // Identificación contable pedida: Cuenta Contable + "." + Concepto (p. ej. "62300.Asesoría").
  const cuentaContableConcepto = cuentaContable && concepto ? `${cuentaContable}.${concepto}` : null;

  // Justificante: la "clase" (qué importe del recibo se usa) se deduce del concepto del apunte.
  const claseJustif = /liquid/i.test(concepto) ? "liquidacion" : /traspas/i.test(concepto) ? "traspaso" : /cobro/i.test(concepto) ? "cobro" : null;
  // El "ámbito" acota el tipo de transferencia (un «Cobro Primas» no mezcla Siniestros).
  const ambitoJustif = /primas/i.test(concepto) ? "Primas" : /siniestros/i.test(concepto) ? "Siniestros" : /comisiones/i.test(concepto) ? "Comisiones" : /honorarios/i.test(concepto) ? "Honorarios" : undefined;
  // Carga las transferencias de la clase, filtradas por la FECHA del movimiento, ocultando las ya
  // usadas en otro apunte. CUADRE AUTOMÁTICO: si aún no hay selección, se marcan todas (su suma debe
  // cuadrar con el importe del apunte). Acumula importes en `impById` para la suma en vivo.
  useEffect(() => {
    if (!claseJustif) { setCandidatos([]); return; }
    let vivo = true;
    contabilidadApi.transferenciasJustificante(claseJustif, { fecha: fechaFiltro || undefined, ambito: ambitoJustif, excluirMid: movimiento?.id })
      .then((r) => {
        if (!vivo) return;
        setCandidatos(r);
        // El cuadre es POR TRANSFERENCIA (importe real movido), aunque se muestre desglosado por recibo.
        setImpById((prev) => { const m = new Map(prev); r.forEach((c) => m.set(c.transferencia_id, num(c.importe_transferencia))); return m; });
        setTransfIds((prev) => (prev.length ? prev : [...new Set(r.map((c) => c.transferencia_id))]));   // autoselección
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claseJustif, ambitoJustif, fechaFiltro]);
  const sumaSel = useMemo(() => transfIds.reduce((a, id) => a + (impById.get(id) ?? 0), 0), [transfIds, impById]);
  const restante = num(importe) - sumaSel;
  const toggleTransf = (id: number) => setTransfIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const marcarTodos = () => setTransfIds([...new Set(candidatos.map((c) => c.transferencia_id))]);
  const quitarTodos = () => setTransfIds([]);

  async function generarJustificante() {
    if (!movimiento) return;
    setGenJustif(true); setError(null);
    try {
      await contabilidadApi.actualizar(movimiento.id, { transferencia_ids: transfIds });  // persistir selección
      const { blob, filename } = await contabilidadApi.justificantePdf(movimiento.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setGenJustif(false); }
  }

  // El devengo sigue a la fecha (mismo mes y año) mientras no lo cambies a mano; y se trae el saldo
  // de partida + siguiente Id de la cuenta (solo relevante en alta).
  useEffect(() => {
    if (!fecha) return;
    if (!devengoTocado) setDevengo(fecha.slice(0, 7));
    contabilidadApi.base(cuenta, Number(fecha.slice(0, 4))).then(setBase).catch(() => setBase(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  // Saldo automático = saldo anterior ± importe (solo en ALTA). El saldo NO es editable a mano: es un
  // cálculo, así que siempre se rellena solo.
  const saldoAuto = useMemo(() => {
    if (!base) return 0;
    return tipo === "Ingreso" ? num(base.ultimo_saldo) + num(importe) : num(base.ultimo_saldo) - num(importe);
  }, [base, importe, tipo]);
  useEffect(() => { if (!edicion) setSaldo(saldoAuto ? saldoAuto.toFixed(2) : ""); }, [saldoAuto, edicion]);

  const idPreview = edicion ? (movimiento?.identificador ?? "—") : (base && devengo ? `${String(base.next_iden).padStart(3, "0")}.${devengo.slice(5, 7)}` : "—");

  // En edición se ven todos los campos; en alta van apareciendo en cascada.
  const verDevengo = edicion || !!fecha;
  const verTipo = edicion || (verDevengo && !!devengo);
  const verGrupo = edicion || (verTipo && !!tipo);
  const verConcepto = edicion || (verGrupo && !!grupo);
  const verImporte = edicion || (verConcepto && !!concepto);
  const verResto = edicion || (verImporte && num(importe) > 0);
  const dis = bloqueado;

  async function guardar() {
    if (!fecha || !tipo || !grupo || !concepto || num(importe) <= 0) return setError("Completa fecha, tipo, grupo, concepto e importe.");
    setSaving(true); setError(null);
    try {
      const datos = {
        fecha, devengo: devengo ? `${devengo}-01` : null, tipo, grupo: grupo || null, concepto,
        importe: num(importe), saldo: saldo !== "" ? num(saldo) : null, descripcion: descripcion || null,
        movimiento_bancario: movBanc, factura, tarjeta,
        transferencia_ids: claseJustif ? transfIds : null,
      };
      if (edicion && movimiento) await contabilidadApi.actualizar(movimiento.id, datos);
      else await contabilidadApi.crear({ cuenta, ...datos });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  const [dy, dm] = (devengo || fecha.slice(0, 7) || "").split("-");
  const yBase = Number(fecha.slice(0, 4)) || new Date().getFullYear();
  const anios: number[] = [];
  for (let a = yBase + 1; a >= 2017; a--) anios.push(a);

  return (
    <FormPanel
      title={edicion ? <>Movimiento · <span style={{ color: "var(--naranja-osc)" }}>{movimiento?.identificador ?? movimiento?.id}</span></> : "Alta de movimiento"}
      dirty={dirty} saving={saving} saveLabel={edicion ? "Guardar" : "Crear movimiento"} error={error}
      onSave={guardar} onClose={onClose} readOnly={bloqueado}
    >
      {edicion && (
        <div className="recibo-acciones-top">
          <span className="hint">{cuenta} · {tipo}{concepto ? ` · ${concepto}` : ""}</span>
          {bloqueado ? (
            <button className="btn-sm btn-corregir" style={{ marginLeft: "auto" }} onClick={() => setBloqueado(false)}>✏️ Corregir</button>
          ) : (
            <span className="hint" style={{ marginLeft: "auto" }}>✏️ Edición habilitada</span>
          )}
        </div>
      )}

      <div className="alta-mov">
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>Cuenta</label><input type="text" value={cuenta} disabled /></div>

        {/* Fecha y Devengo (mes + año) en la misma línea */}
        <div className="field"><label>Fecha <span className="required">*</span></label>
          <input type="date" className="inp-fecha" value={fecha} disabled={dis} onChange={(e) => setFecha(e.target.value)} autoFocus={!edicion} />
        </div>

        {verDevengo && (
          <div className="field"><label>Devengo</label>
            <div className="dev-row">
              <select value={dm || ""} disabled={dis} onChange={(e) => { setDevengoTocado(true); setDevengo(`${dy || yBase}-${e.target.value}`); }} title="Mes">
                {MESES.map((nom, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{nom}</option>)}
              </select>
              <select value={dy || ""} disabled={dis} onChange={(e) => { setDevengoTocado(true); setDevengo(`${e.target.value}-${dm || "01"}`); }} title="Año">
                {anios.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Tipo y Grupo (ambos obligatorios) en la misma línea */}
        {verTipo && (
          <div className="field"><label>Tipo <span className="required">*</span></label>
            <select value={tipo} disabled={dis} onChange={(e) => { setTipo(e.target.value); setGrupo(""); setConcepto(""); }}>
              <option value="">— Elige —</option>
              <option value="Gasto">Gasto</option>
              <option value="Ingreso">Ingreso</option>
            </select>
          </div>
        )}

        {verGrupo && (
          <div className="field"><label>Grupo <span className="required">*</span></label>
            <select value={grupo} disabled={dis} onChange={(e) => { setGrupo(e.target.value); setConcepto(""); }}>
              <option value="">— Elige —</option>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}

        {verConcepto && (
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>Concepto <span className="required">*</span></label>
            <select value={concepto} disabled={dis} onChange={(e) => setConcepto(e.target.value)}>
              <option value="">— Elige —</option>
              {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Nº de movimiento (Id) + Cuenta Contable + Concepto → "245.06. 62900001. Consumos Oficina" */}
        {cuentaContableConcepto && (
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>Cuenta contable</label>
            <div className="ci-val" style={{ fontWeight: 600 }}>{idPreview}. {cuentaContable}. {concepto}</div>
          </div>
        )}

        {/* Importe y Saldo en la misma línea; el Saldo es un cálculo (no editable) */}
        {verImporte && (
          <>
            <div className="field"><label>Importe <span className="required">*</span></label>
              <NumberInput value={importe} onChange={setImporte} decimals={2} suffix="€" disabled={dis} className={tipo === "Gasto" ? "importe-gasto" : undefined} />
            </div>
            <div className="field"><label>Saldo <span className="hint">(cálculo)</span></label>
              <NumberInput value={saldo} onChange={() => {}} decimals={2} suffix="€" disabled />
            </div>
          </>
        )}

        {verResto && (
          <>
            <div className="field full-w" style={{ gridColumn: "1 / -1" }}><label>Descripción</label>
              <textarea rows={2} value={descripcion} disabled={dis} onChange={(e) => setDescripcion(e.target.value)} />
            </div>
            <div className="field full-w" style={{ gridColumn: "1 / -1", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 18, flexWrap: "wrap" }}>
              <label className="check-inline"><input type="checkbox" checked={movBanc} disabled={dis} onChange={(e) => setMovBanc(e.target.checked)} /> Movimiento Bancario</label>
              <label className="check-inline"><input type="checkbox" checked={factura} disabled={dis} onChange={(e) => setFactura(e.target.checked)} /> Justificante</label>
              <label className="check-inline"><input type="checkbox" checked={tarjeta} disabled={dis} onChange={(e) => setTarjeta(e.target.checked)} /> Tarjeta</label>
            </div>
            {!edicion && (
              <div className="hint" style={{ gridColumn: "1 / -1" }}>
                Nuevo saldo de <b>{cuenta}</b>: {fmtMiles(saldo)} € · Id <b>{idPreview}</b>
              </div>
            )}
          </>
        )}
      </div>

      {/* Justificante: recibos que componen este apunte (solo al EDITAR un apunte de seguros ya
          existente; en el alta no aplica, el movimiento aún no está guardado). */}
      {claseJustif && verResto && edicion && (
        <div className="justif-sec">
          <div className="justif-head">
            <b>Justificante</b>
            <span className="hint">transferencias que componen este {claseJustif === "liquidacion" ? "pago" : claseJustif === "traspaso" ? "traspaso" : "cobro"}</span>
            <span className={"justif-restante" + (Math.abs(restante) < 0.01 && transfIds.length > 0 ? " ok" : "")}>
              {Math.abs(restante) < 0.01 && transfIds.length > 0
                ? <>✓ Cuadra · {fmtMiles(sumaSel)} €</>
                : <>Restante para cuadrar: <b>{fmtMiles(restante)} €</b> <span className="hint">(sel. {fmtMiles(sumaSel)} de {fmtMiles(num(importe))} €)</span></>}
            </span>
          </div>
          <div className="justif-filtros">
            <button type="button" className="btn-link btn-sm" onClick={marcarTodos} disabled={candidatos.length === 0}>Marcar todos</button>
            <button type="button" className="btn-link btn-sm" onClick={quitarTodos} disabled={transfIds.length === 0}>Quitar</button>
          </div>
          <div className="justif-lista">
            <div className="justif-row justif-cab">
              <span />
              <span>Recibo</span>
              <span>Fecha</span>
              <span className="jr-imp">Importe</span>
              <span>Referencia</span>
              <span>Cliente</span>
            </div>
            {candidatos.map((c, i) => (
              <label key={i} className={"justif-row" + (i > 0 && candidatos[i - 1].transferencia_id === c.transferencia_id ? " jr-cont" : "")}>
                <input type="checkbox" checked={transfIds.includes(c.transferencia_id)} onChange={() => toggleTransf(c.transferencia_id)} />
                <span className="jr-num">{c.recibo ?? "—"}</span>
                <span className="jr-fec">{c.fecha ? fmtFechaES(c.fecha) : ""}</span>
                <span className="jr-imp">{fmtMiles(c.importe)} €</span>
                <span className="jr-ref">{c.referencia}</span>
                <span className="jr-cli">{c.cliente ?? c.mercado}</span>
              </label>
            ))}
            {candidatos.length === 0 && <div className="hint" style={{ padding: 8 }}>No hay transferencias sin justificar para la fecha de este apunte.</div>}
          </div>
          <div className="hint" style={{ marginBottom: 6 }}>{transfIds.length} transferencia(s) seleccionada(s). Se autoseleccionan las de la fecha del apunte; las ya usadas en otro apunte no aparecen.</div>
          {edicion && (
            <button className="btn-secondary btn-sm" onClick={generarJustificante} disabled={genJustif || transfIds.length === 0}>
              {genJustif ? "Generando…" : "📄 Generar justificante (PDF)"}
            </button>
          )}
        </div>
      )}
    </FormPanel>
  );
}
