import { useEffect, useMemo, useState } from "react";
import { siniestrosApi } from "../api";
import type { Siniestro } from "../types";
import PageHeader from "../components/PageHeader";
import TablaDatos, { type Col } from "../components/TablaDatos";
import { fmtMiles } from "../format";

const n = (v: unknown) => Number(v) || 0;

// Columnas del listado global. Igual que la pestaña de siniestros del binder, pero con la
// columna del Binder (UMR) al principio para identificar de cuál es cada siniestro.
const COLS: Col<Siniestro>[] = [
  { key: "binder_umr", label: "Binder", tipo: "text", width: 150 },
  { key: "certificate", label: "Certificate", tipo: "text" },
  { key: "reference", label: "Reference", tipo: "text" },
  { key: "insured", label: "Asegurado", tipo: "text", width: 180 },
  { key: "section", label: "Secc.", tipo: "int" },
  { key: "yoa", label: "YOA", tipo: "int" },
  { key: "risk_code", label: "Risk Code", tipo: "text" },
  { key: "currency", label: "Moneda", tipo: "text" },
  { key: "status", label: "Estado", tipo: "text" },
  { key: "claimant", label: "Reclamante", tipo: "text", width: 160 },
  { key: "reporting_period", label: "Periodo", tipo: "text" },
  { key: "risk_inception", label: "Inicio riesgo", tipo: "date" },
  { key: "risk_expiry", label: "Fin riesgo", tipo: "date" },
  { key: "claim_first_advised", label: "1er aviso", tipo: "date" },
  { key: "date_opened", label: "Abierto", tipo: "date" },
  { key: "date_closed", label: "Cerrado", tipo: "date" },
  { key: "amount_claimed", label: "Reclamado", tipo: "num" },
  { key: "to_pay_indemnity", label: "A pagar ind.", tipo: "num" },
  { key: "to_pay_fees", label: "A pagar fees", tipo: "num" },
  { key: "paid_indemnity", label: "Pagado ind.", tipo: "num" },
  { key: "paid_fees", label: "Pagado fees", tipo: "num" },
  { key: "reserves_indemnity", label: "Reservas ind.", tipo: "num" },
  { key: "reserves_fees", label: "Reservas fees", tipo: "num" },
  { key: "total_indemnity", label: "Total ind.", tipo: "num" },
  { key: "total_fees", label: "Total fees", tipo: "num" },
  { key: "total", label: "Total", tipo: "num", calc: (s) => n(s.total_indemnity) + n(s.total_fees) },
  { key: "ucr", label: "UCR", tipo: "text" },
  { key: "abogado", label: "Abogado", tipo: "text" },
  { key: "description", label: "Descripción", tipo: "text", width: 220 },
  { key: "refer", label: "Refer", tipo: "text" },
  { key: "denial", label: "Denial", tipo: "text" },
  { key: "last_bdx_change", label: "Últ. cambio BDX", tipo: "date" },
  { key: "ultima_revision", label: "Últ. revisión", tipo: "date" },
];
const DEFAULT_KEYS = [
  "binder_umr", "reference", "certificate", "insured", "risk_code", "claim_first_advised", "date_opened",
  "paid_fees", "paid_indemnity", "reserves_fees", "reserves_indemnity",
  "total_fees", "total_indemnity", "total", "date_closed", "status",
];

export default function SiniestrosPage() {
  const [items, setItems] = useState<Siniestro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems(await siniestrosApi.listarTodos());
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron cargar los siniestros.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tot = useMemo(() => {
    const abiertos = items.filter((s) => !s.date_closed).length;
    return {
      nSin: items.length,
      abiertos,
      cerrados: items.length - abiertos,
      reclamado: items.reduce((a, s) => a + n(s.amount_claimed), 0),
      totalIndem: items.reduce((a, s) => a + n(s.total_indemnity), 0),
      totalFees: items.reduce((a, s) => a + n(s.total_fees), 0),
      reservas: items.reduce((a, s) => a + n(s.reserves_indemnity) + n(s.reserves_fees), 0),
    };
  }, [items]);

  return (
    <div className="container lista-page">
      <PageHeader emoji="🚨" title="Siniestros" />
      <div className="hint" style={{ margin: "0 0 12px" }}>
        Todos los siniestros (Claims BDX) de todos los binders. La importación desde SharePoint se
        hace en cada binder (pestaña <b>Siniestros</b>).
      </div>

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : error ? (
        <div className="error">{error}</div>
      ) : items.length === 0 ? (
        <div className="empty">Aún no hay siniestros importados.</div>
      ) : (
        <>
          <div className="bdx-topbar">
            <div />
            <div className="bdx-totales">
              <div className="tot-col">
                <div className="tot-row"><span>Nº Siniestros</span><b>{fmtMiles(tot.nSin, 0)}</b></div>
                <div className="tot-row"><span>Abiertos</span><b>{fmtMiles(tot.abiertos, 0)}</b></div>
                <div className="tot-row"><span>Cerrados</span><b>{fmtMiles(tot.cerrados, 0)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row"><span>Cantidad Reclamada</span><b>{fmtMiles(tot.reclamado)}</b></div>
                <div className="tot-row"><span>Reservas Total</span><b>{fmtMiles(tot.reservas)}</b></div>
                <div className="tot-row tot-pdte"><span>Total Indem.</span><b>{fmtMiles(tot.totalIndem)}</b></div>
              </div>
              <div className="tot-col">
                <div className="tot-row tot-pdte"><span>Total Fees</span><b>{fmtMiles(tot.totalFees)}</b></div>
                <div className="tot-row tot-pdte"><span>Total</span><b>{fmtMiles(tot.totalIndem + tot.totalFees)}</b></div>
              </div>
            </div>
          </div>
          <TablaDatos
            filas={items}
            columnas={COLS}
            defaultKeys={DEFAULT_KEYS}
            storageKey="mayrit.siniestros.global.tabla.v2"
          />
        </>
      )}
    </div>
  );
}
