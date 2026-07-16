import { useEffect, useState } from "react";
import { bdxApi } from "../api";
import { fmtMiles } from "../format";

type Par = { certificate_ref: string; insured_name: string | null; importe: number; linea_ids: number[]; periodos: string[] };

// Panel de la pestaña BDX: pares de líneas de Risk que se ANULAN entre sí (mismo certificado, prima a
// Mayrit opuesta) y siguen pendientes de Premium → candidatas a cerrar «sin premium (cancelada)».
export default function CancelacionesSugeridas({ binderId, onMarcado }: { binderId: number; onMarcado: () => void }) {
  const [pares, setPares] = useState<Par[]>([]);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState(false);

  async function cargar() {
    try { setPares((await bdxApi.cancelacionesSugeridas(binderId)).pares); } catch { /* silencioso */ }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [binderId]);

  async function marcar(ids: number[]) {
    setBusy(true);
    try { await bdxApi.marcarSinPremium(ids, "Cancelada"); await cargar(); onMarcado(); }
    finally { setBusy(false); }
  }

  if (pares.length === 0) return null;
  return (
    <div className="import-aviso" style={{ marginBottom: 10 }}>
      <b>♻️ Cancelaciones sugeridas ({pares.length})</b> — pares de líneas que se anulan (mismo certificado,
      prima opuesta) y siguen pendientes de Premium.{" "}
      <button type="button" className="btn-link" onClick={() => setAbierto((a) => !a)}>{abierto ? "ocultar" : "ver"}</button>
      {" · "}
      <button type="button" className="btn-sm btn-primary" disabled={busy}
        onClick={() => marcar(pares.flatMap((p) => p.linea_ids))}>
        Marcar todas como «sin premium (cancelada)»
      </button>
      {abierto && (
        <table className="compacto" style={{ marginTop: 8 }}>
          <thead><tr><th>Certificado</th><th>Asegurado</th><th className="num">Importe</th><th>Periodos</th><th /></tr></thead>
          <tbody>
            {pares.map((p, i) => (
              <tr key={i}>
                <td>{p.certificate_ref}</td>
                <td>{p.insured_name ?? "—"}</td>
                <td className="num">{fmtMiles(p.importe)} €</td>
                <td>{p.periodos.map((s) => s.slice(0, 7)).join(" ↔ ")}</td>
                <td><button type="button" className="btn-sm btn-primary" disabled={busy} onClick={() => marcar(p.linea_ids)}>✅ Marcar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
