import { useEffect, useState } from "react";
import { recibosApi } from "../api";
import type { Recibo } from "../types";
import PageHeader from "../components/PageHeader";
import { fmtMiles } from "../format";

const num = (v: unknown) => Number(v) || 0;
const eur = (v: number) => (Math.abs(v) < 0.005 ? "" : fmtMiles(v));

// Métricas de "pendiente" por recibo (mismas definiciones que el listado de Recibos).
const METRICAS: { titulo: string; valor: (r: Recibo) => number }[] = [
  { titulo: "Primas Pendiente de Cobro", valor: (r) => num(r.prima_adeudada) - num(r.prima_cobrada) },
  { titulo: "Primas Pendiente de Liquidación", valor: (r) => num(r.liquidar_cobrado) - num(r.liquidar_liquidado) },
  { titulo: "Comisiones Pendiente de Cobro", valor: (r) => num(r.comision_retenida) - num(r.comision_retenida_cobrada) },
  { titulo: "Comisiones Pendiente de Traspaso", valor: (r) => num(r.comision_retenida_cobrada) - num(r.comision_retenida_traspasada) },
  { titulo: "Comisiones Pendiente de Pago", valor: (r) => num(r.comision_cedida_a_pagar) - num(r.comision_cedida_pagada) },
];

// Tabla pivote: NumeroPoliza (UMR) × año, con totales. Solo filas/años con algún importe ≠ 0.
function PivotCard({ titulo, recibos, valor }: { titulo: string; recibos: Recibo[]; valor: (r: Recibo) => number }) {
  const mapa = new Map<string, Map<number, number>>();
  const anios = new Set<number>();
  for (const r of recibos) {
    const v = valor(r);
    if (Math.abs(v) < 0.005) continue;
    const ref = r.numero_poliza ?? r.binder_umr ?? "—";
    anios.add(r.anio);
    const m = mapa.get(ref) ?? new Map<number, number>();
    m.set(r.anio, (m.get(r.anio) ?? 0) + v);
    mapa.set(ref, m);
  }
  const yrs = [...anios].sort();
  const filas = [...mapa.entries()]
    .map(([ref, m]) => ({ ref, m }))
    .filter((f) => yrs.some((y) => Math.abs(f.m.get(y) ?? 0) > 0.005))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  const totalAnio = (y: number) => filas.reduce((a, f) => a + (f.m.get(y) ?? 0), 0);
  const totalGen = filas.reduce((a, f) => a + yrs.reduce((s, y) => s + (f.m.get(y) ?? 0), 0), 0);

  return (
    <div className="fin-card">
      <h3>{titulo}</h3>
      {filas.length === 0 ? (
        <div className="hint">Sin pendientes.</div>
      ) : (
        <div className="fin-scroll">
          <table className="compacto">
            <thead>
              <tr>
                <th>NumeroPoliza</th>
                {yrs.map((y) => <th key={y} className="num">{y}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const tot = yrs.reduce((s, y) => s + (f.m.get(y) ?? 0), 0);
                return (
                  <tr key={f.ref}>
                    <td>{f.ref}</td>
                    {yrs.map((y) => <td key={y} className="num">{eur(f.m.get(y) ?? 0)}</td>)}
                    <td className="num"><b>{eur(tot)}</b></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Total</b></td>
                {yrs.map((y) => <td key={y} className="num"><b>{eur(totalAnio(y))}</b></td>)}
                <td className="num"><b>{eur(totalGen)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FinancieroPage() {
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRecibos(await recibosApi.listar());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="container">
      <PageHeader emoji="💰" title="Financiero" />
      {error && <div className="error">⚠ {error}</div>}
      {loading ? (
        <div className="loading">Cargando…</div>
      ) : (
        <div className="fin-grid">
          {METRICAS.map((m) => (
            <PivotCard key={m.titulo} titulo={m.titulo} recibos={recibos} valor={m.valor} />
          ))}
          <div className="fin-card">
            <h3>LPAN Procesados</h3>
            <div className="hint">Pendiente de migrar el módulo LPAN.</div>
          </div>
        </div>
      )}
    </div>
  );
}
