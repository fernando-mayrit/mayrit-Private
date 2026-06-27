import { useEffect, useMemo, useState } from "react";
import { contabilidadApi, type ContaCategoria, type BaseAlta } from "../api";
import { fmtMiles } from "../format";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";

// Alta de movimiento al estilo Access: los campos van apareciendo a medida que completas el anterior.
// Cascada Tipo → Grupo → Concepto (catálogo Categorias). Saldo e Id se calculan solos.
const num = (v: string | number | null | undefined) => Number(v ?? 0);

export default function AltaMovimiento({ cuenta, cats, onClose, onSaved }: {
  cuenta: string;
  cats: ContaCategoria[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fecha, setFecha] = useState("");
  const [devengo, setDevengo] = useState("");       // YYYY-MM
  const [tipo, setTipo] = useState("");
  const [grupo, setGrupo] = useState("");
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [saldo, setSaldo] = useState("");
  const [saldoTocado, setSaldoTocado] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [movBanc, setMovBanc] = useState(true);
  const [factura, setFactura] = useState(false);
  const [tarjeta, setTarjeta] = useState(false);
  const [base, setBase] = useState<BaseAlta | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cascada desde el catálogo.
  const grupos = useMemo(() => [...new Set(cats.filter((c) => c.tipo === tipo).map((c) => c.grupo).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [cats, tipo]);
  const conceptos = useMemo(() => cats.filter((c) => c.tipo === tipo && c.grupo === grupo).map((c) => c.concepto).sort((a, b) => a.localeCompare(b)), [cats, tipo, grupo]);
  const cuentaContable = useMemo(() => cats.find((c) => c.concepto === concepto)?.cuenta_contable ?? null, [cats, concepto]);

  // Al fijar la fecha: devengo por defecto = su mes; y traer saldo de partida + siguiente Id.
  useEffect(() => {
    if (!fecha) return;
    if (!devengo) setDevengo(fecha.slice(0, 7));
    contabilidadApi.base(cuenta, Number(fecha.slice(0, 4))).then(setBase).catch(() => setBase(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  // Saldo automático = saldo anterior ± importe (mientras no lo toques a mano).
  const saldoAuto = useMemo(() => {
    if (!base) return 0;
    const u = num(base.ultimo_saldo);
    const imp = num(importe);
    return tipo === "Ingreso" ? u + imp : u - imp;
  }, [base, importe, tipo]);
  useEffect(() => { if (!saldoTocado) setSaldo(saldoAuto ? saldoAuto.toFixed(2) : ""); }, [saldoAuto, saldoTocado]);

  const idPreview = base && devengo ? `${base.next_iden}.${devengo.slice(5, 7)}` : "—";

  const verDevengo = !!fecha;
  const verTipo = verDevengo && !!devengo;
  const verGrupo = verTipo && !!tipo;
  const verConcepto = verGrupo && !!grupo;
  const verImporte = verConcepto && !!concepto;
  const verResto = verImporte && num(importe) > 0;

  async function guardar() {
    if (!fecha || !tipo || !concepto || num(importe) <= 0) return setError("Completa fecha, tipo, concepto e importe.");
    setSaving(true); setError(null);
    try {
      await contabilidadApi.crear({
        cuenta, fecha, devengo: devengo ? `${devengo}-01` : null, tipo, grupo: grupo || null, concepto,
        importe: num(importe), saldo: saldo !== "" ? num(saldo) : null, descripcion: descripcion || null,
        movimiento_bancario: movBanc, factura, tarjeta,
      });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <FormPanel title={`Alta de movimiento — ${cuenta}`} dirty saving={saving} saveLabel="Crear movimiento" error={error} onSave={guardar} onClose={onClose}>
      <div className="alta-mov">
        <div className="field"><label>Cuenta</label><input type="text" value={cuenta} disabled /></div>

        <div className="field"><label>Fecha <span className="required">*</span></label>
          <input type="date" className="inp-fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} autoFocus />
        </div>

        {verDevengo && (
          <div className="field"><label>Devengo (mes)</label>
            <input type="month" value={devengo} onChange={(e) => setDevengo(e.target.value)} />
          </div>
        )}

        {verTipo && (
          <div className="field"><label>Tipo <span className="required">*</span></label>
            <select value={tipo} onChange={(e) => { setTipo(e.target.value); setGrupo(""); setConcepto(""); }}>
              <option value="">— Elige —</option>
              <option value="Gasto">Gasto</option>
              <option value="Ingreso">Ingreso</option>
            </select>
          </div>
        )}

        {verGrupo && (
          <div className="field"><label>Grupo</label>
            <select value={grupo} onChange={(e) => { setGrupo(e.target.value); setConcepto(""); }}>
              <option value="">— Elige —</option>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}

        {verConcepto && (
          <div className="field"><label>Concepto <span className="required">*</span></label>
            <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
              <option value="">— Elige —</option>
              {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {cuentaContable && <span className="hint">Cuenta contable: <b>{cuentaContable}</b></span>}
          </div>
        )}

        {verImporte && (
          <div className="field"><label>Importe <span className="required">*</span></label>
            <NumberInput value={importe} onChange={setImporte} decimals={2} suffix="€" className={tipo === "Gasto" ? "importe-gasto" : undefined} />
          </div>
        )}

        {verResto && (
          <>
            <div className="field"><label>Saldo <span className="hint">(auto, editable)</span></label>
              <NumberInput value={saldo} onChange={(v) => { setSaldo(v); setSaldoTocado(true); }} decimals={2} suffix="€" />
            </div>
            <div className="field"><label>Id</label>
              <div className="ci-val" style={{ fontWeight: 600 }}>{idPreview}</div>
            </div>
            <div className="field full-w" style={{ gridColumn: "1 / -1" }}><label>Descripción</label>
              <textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </div>
            <div className="field full-w" style={{ gridColumn: "1 / -1", display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label className="check-inline"><input type="checkbox" checked={movBanc} onChange={(e) => setMovBanc(e.target.checked)} /> Movimiento Bancario</label>
              <label className="check-inline"><input type="checkbox" checked={factura} onChange={(e) => setFactura(e.target.checked)} /> Justificante</label>
              <label className="check-inline"><input type="checkbox" checked={tarjeta} onChange={(e) => setTarjeta(e.target.checked)} /> Tarjeta</label>
            </div>
            <div className="hint" style={{ gridColumn: "1 / -1" }}>
              Nuevo saldo de <b>{cuenta}</b>: {fmtMiles(saldo)} € · Id <b>{idPreview}</b>
            </div>
          </>
        )}
      </div>
    </FormPanel>
  );
}
