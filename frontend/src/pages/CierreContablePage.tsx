import { useEffect, useState } from "react";
import { cierresApi, type CierreMes } from "../api";
import PageHeader from "../components/PageHeader";
import FormPanel from "../components/FormPanel";
import ConfirmDialog from "../components/ConfirmDialog";
import { fmtFechaES } from "../format";

const USUARIO_KEY = "mayrit.usuario";
const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function CierreContablePage() {
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [meses, setMeses] = useState<CierreMes[]>([]);
  const [anioCerrado, setAnioCerrado] = useState(false);
  const [puedeCerrarAnio, setPuedeCerrarAnio] = useState(false);
  const [anioFecha, setAnioFecha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cierre: modal con la fecha de envío a contabilidad. Reabrir: confirmación simple.
  const [cerrarMes, setCerrarMes] = useState<CierreMes | null>(null);
  const [fechaEnvio, setFechaEnvio] = useState<string>(hoyISO());
  const [reabrirMes, setReabrirMes] = useState<CierreMes | null>(null);
  // Cierre/reapertura ANUAL.
  const [cerrarAnioOpen, setCerrarAnioOpen] = useState(false);
  const [reabrirAnioOpen, setReabrirAnioOpen] = useState(false);

  const anios = Array.from({ length: new Date().getFullYear() - 2017 + 1 }, (_, i) => new Date().getFullYear() - i);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const r = await cierresApi.resumen(anio);
      setMeses(r.meses);
      setAnioCerrado(r.anio_cerrado);
      setPuedeCerrarAnio(r.puede_cerrar_anio);
      setAnioFecha(r.anio_fecha);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio]);

  // Descarga el Excel acumulado del año hasta ese mes (el que se envía a contabilidad).
  async function descargar(m: CierreMes) {
    setError(null);
    try {
      const blob = await cierresApi.excel(anio, m.mes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TRecibos Total ${m.nombre} ${anio}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function cerrar() {
    if (!cerrarMes) return;
    if (!fechaEnvio) return setError("Indica la fecha de envío a contabilidad.");
    const m = cerrarMes;
    setBusy(true);
    setError(null);
    try {
      await cierresApi.cerrar(anio, m.mes, fechaEnvio, localStorage.getItem(USUARIO_KEY) ?? undefined);
      setCerrarMes(null);
      await cargar();
      // No se descarga automáticamente: el Excel se obtiene aparte con el botón «⬇️ Excel».
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reabrir() {
    if (!reabrirMes) return;
    setBusy(true);
    setError(null);
    try {
      await cierresApi.reabrir(anio, reabrirMes.mes);
      setReabrirMes(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cerrarAnio() {
    if (!fechaEnvio) return setError("Indica la fecha de cierre del año.");
    setBusy(true);
    setError(null);
    try {
      await cierresApi.cerrarAnio(anio, fechaEnvio, localStorage.getItem(USUARIO_KEY) ?? undefined);
      setCerrarAnioOpen(false);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reabrirAnio() {
    setBusy(true);
    setError(null);
    try {
      await cierresApi.reabrirAnio(anio);
      setReabrirAnioOpen(false);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <PageHeader emoji="🔒" title="Cierre Contable" />
      <div className="toolbar">
        <select className="filtro" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {anios.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="hint">
          Cerrar un mes envía sus recibos a contabilidad (pasan a <b>Contabilizado</b>, no editables, y no se podrán emitir nuevos en ese mes). El Excel acumulado se descarga aparte con «⬇️ Excel».
        </span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : meses.filter((m) => m.recibos > 0 || m.cerrado).length === 0 ? (
        <div className="empty">No hay recibos con fecha contable en {anio}.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Recibos del mes</th>
              <th className="num">Acumulado año</th>
              <th>Estado</th>
              <th>Enviado el</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {meses.filter((m) => m.recibos > 0 || m.cerrado).map((m) => (
              <tr key={m.mes} style={m.cerrado ? { background: "#f3f4f6" } : undefined}>
                <td>{m.nombre}</td>
                <td className="num">{m.recibos}</td>
                <td className="num">{m.acumulado}</td>
                <td>
                  {m.cerrado ? (
                    <span className="pill pill-anulado">🔒 Cerrado</span>
                  ) : (
                    <span className="pill pill-cobrado">Abierto</span>
                  )}
                </td>
                <td>{m.cerrado ? fmtFechaES(m.fecha) : "—"}</td>
                <td className="acciones">
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button className="btn-link" title="Descargar el Excel acumulado para contabilidad" onClick={() => descargar(m)}>
                      ⬇️ Excel
                    </button>
                    {m.cerrado ? (
                      // Año cerrado: ya no se pueden reabrir meses → el botón desaparece.
                      anioCerrado ? null : (
                        <button className="btn-link" onClick={() => setReabrirMes(m)}>
                          Reabrir
                        </button>
                      )
                    ) : (
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy || m.recibos === 0}
                        onClick={() => { setFechaEnvio(hoyISO()); setCerrarMes(m); }}
                      >
                        Cerrar mes
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Cierre anual: abajo del todo, cuando todos los meses con recibos están cerrados. */}
      {!loading && (anioCerrado || puedeCerrarAnio) && (
        <div className={"cierre-anual" + (anioCerrado ? " cerrado" : "")}>
          {anioCerrado ? (
            <>
              <span className="pill pill-anulado">🔒 Año {anio} cerrado{anioFecha ? ` · ${fmtFechaES(anioFecha)}` : ""}</span>
              <span className="hint" style={{ flex: 1 }}>
                El año está cerrado: no se pueden reabrir sus meses. Para poder reabrirlos, reabre antes el año.
              </span>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setReabrirAnioOpen(true)}>
                Reabrir año
              </button>
            </>
          ) : (
            <>
              <span className="hint" style={{ flex: 1 }}>
                Todos los meses con recibos de {anio} están cerrados. Puedes <b>cerrar el año</b>: una vez cerrado, ya no se podrán reabrir sus meses.
              </span>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => { setFechaEnvio(hoyISO()); setCerrarAnioOpen(true); }}>
                🔒 Cerrar año {anio}
              </button>
            </>
          )}
        </div>
      )}

      {cerrarMes && (
        <FormPanel
          title={`Cerrar ${cerrarMes.nombre} ${anio}`}
          dirty={false}
          saving={busy}
          saveLabel="Cerrar mes"
          error={error}
          onSave={cerrar}
          onClose={() => setCerrarMes(null)}
        >
          <p className="hint" style={{ marginBottom: 12 }}>
            Se enviarán a contabilidad los <b>{cerrarMes.recibos}</b> recibo(s) de {cerrarMes.nombre} {anio}: pasarán a
            <b> Contabilizado</b> (no editables) y no se podrán emitir nuevos recibos en ese mes. El Excel acumulado se
            descarga después con «⬇️ Excel».
          </p>
          <div className="field">
            <label>
              Fecha de envío a contabilidad <span className="required">*</span>
            </label>
            <input
              type="date"
              className="inp-fecha"
              value={fechaEnvio}
              autoFocus
              onChange={(e) => setFechaEnvio(e.target.value)}
            />
          </div>
        </FormPanel>
      )}

      {reabrirMes && (
        <ConfirmDialog
          titulo={`Reabrir ${reabrirMes.nombre} ${anio}`}
          mensaje={`Vas a reabrir ${reabrirMes.nombre} ${anio}: sus recibos volverán a editables y se podrán emitir nuevos en ese mes.`}
          confirmLabel="Reabrir"
          onConfirm={reabrir}
          onClose={() => setReabrirMes(null)}
        />
      )}

      {cerrarAnioOpen && (
        <FormPanel
          title={`Cerrar año ${anio}`}
          dirty={false}
          saving={busy}
          saveLabel="Cerrar año"
          error={error}
          onSave={cerrarAnio}
          onClose={() => setCerrarAnioOpen(false)}
        >
          <p className="hint" style={{ marginBottom: 12 }}>
            Vas a <b>cerrar el año {anio}</b>. Todos sus meses con recibos están ya cerrados. Una vez cerrado el año,
            <b> ya no se podrán reabrir sus meses</b> (habría que reabrir antes el año).
          </p>
          <div className="field">
            <label>
              Fecha de cierre del año <span className="required">*</span>
            </label>
            <input
              type="date"
              className="inp-fecha"
              value={fechaEnvio}
              autoFocus
              onChange={(e) => setFechaEnvio(e.target.value)}
            />
          </div>
        </FormPanel>
      )}

      {reabrirAnioOpen && (
        <ConfirmDialog
          titulo={`Reabrir año ${anio}`}
          mensaje={`Vas a reabrir el año ${anio}: volverás a poder reabrir sus meses cerrados.`}
          confirmLabel="Reabrir año"
          onConfirm={reabrirAnio}
          onClose={() => setReabrirAnioOpen(false)}
        />
      )}
    </div>
  );
}
