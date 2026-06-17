import { useEffect, useState } from "react";
import { recibosApi } from "../api";
import type { Recibo, ReciboUpdate } from "../types";
import PageHeader from "../components/PageHeader";
import ReciboModal from "../components/ReciboModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { fmtMiles, fmtFechaES, estadoCobro } from "../format";

const eur = (v: unknown) => `${fmtMiles(v)} €`;
const num = (v: unknown) => Number(v) || 0;
// 'YYYY-MM' → 'MM/YYYY'
const periodoFmt = (p: string) => {
  const [y, m] = p.split("-");
  return m && y ? `${m}/${y}` : p;
};

export default function RecibosPage() {
  const [items, setItems] = useState<Recibo[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sel, setSel] = useState<Recibo | null>(null);
  const [saving, setSaving] = useState(false);
  const [confBorrar, setConfBorrar] = useState(false);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await recibosApi.listar(search ? { q: search } : undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Búsqueda en vivo (pequeño retardo).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function guardar(payload: ReciboUpdate) {
    if (!sel) return;
    setSaving(true);
    setError(null);
    try {
      await recibosApi.editar(sel.id, payload);
      setSel(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrar() {
    if (!sel) return;
    setSaving(true);
    try {
      await recibosApi.borrar(sel.id);
      setSel(null);
      setConfBorrar(false);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const totalComision = items.reduce((a, r) => a + num(r.comision_retenida), 0);
  const totalCobrada = items.reduce((a, r) => a + num(r.comision_retenida_cobrada), 0);

  return (
    <div className="container">
      <PageHeader emoji="🧾" title="Recibos" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por número, mercado o asegurado…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="hint">
          {items.length} recibo(s) · Comisión: <b>{eur(totalComision)}</b> · Cobrada: <b>{eur(totalCobrada)}</b>
        </span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          No hay recibos. Se emiten desde la ficha del binder (pestaña Datos → «Generar recibo» de un Risk BDX).
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Binder (UMR)</th>
              <th>Risk BDX</th>
              <th>Mercado</th>
              <th className="num">Comisión</th>
              <th className="num">Cobrada</th>
              <th className="num">Pendiente</th>
              <th>Cobro</th>
              <th>Contable</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const ec = estadoCobro(r.comision_retenida, r.comision_retenida_cobrada, r.estado);
              return (
                <tr key={r.id}>
                  <td><b>{r.numero}</b></td>
                  <td>{r.binder_umr ?? `Binder ${r.binder_id}`}</td>
                  <td>{periodoFmt(r.periodo)}</td>
                  <td>{r.nombre_mercado ?? "—"}</td>
                  <td className="num">{eur(r.comision_retenida)}</td>
                  <td className="num">{eur(r.comision_retenida_cobrada)}</td>
                  <td className="num">{eur(r.comision_pendiente_cobro)}</td>
                  <td><span className={`pill pill-${ec.clase}`}>{ec.label}</span></td>
                  <td>{fmtFechaES(r.fecha_contable)}</td>
                  <td className="acciones">
                    <button className="btn-link" onClick={() => setSel(r)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {sel && (
        <ReciboModal
          titulo={`Recibo ${sel.numero}`}
          saveLabel="Guardar"
          recibo={sel}
          saving={saving}
          error={error}
          onSave={guardar}
          onClose={() => setSel(null)}
          onDelete={() => setConfBorrar(true)}
        />
      )}

      {confBorrar && sel && (
        <ConfirmDialog
          titulo="BORRAR recibo"
          mensaje={<>Vas a <b>borrar</b> el recibo <b>{sel.numero}</b>.</>}
          detalle="Se desenlazarán sus líneas del BDX y se perderá el registro contable de este recibo."
          confirmLabel="Continuar"
          doble
          onConfirm={borrar}
          onClose={() => setConfBorrar(false)}
        />
      )}
    </div>
  );
}
