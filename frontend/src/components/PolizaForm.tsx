import { useEffect, useState } from "react";
import { polizasApi, recibosApi, crud } from "../api";
import type {
  Poliza, PolizaWrite, PolizaEmitir, EmisionPreview, Recibo,
  Tomador, TomadorWrite, Productor, ProductorWrite, Mercado, MercadoWrite, Ramo,
} from "../types";
import FormPanel from "./FormPanel";
import NumberInput from "./NumberInput";
import OptionButtons from "./OptionButtons";
import SelectConAlta from "./SelectConAlta";
import ConfirmDialog from "./ConfirmDialog";
import TomadorForm from "./TomadorForm";
import ProductorForm from "./ProductorForm";
import MercadoForm from "./MercadoForm";
import { fmtMiles, fmtFechaES } from "../format";

const tomadoresApi = crud<Tomador, TomadorWrite>("/tomadores");
const productoresApi = crud<Productor, ProductorWrite>("/productores");
const mercadosApi = crud<Mercado, MercadoWrite>("/mercados");
const ramosApi = crud<Ramo, { nombre: string }>("/ramos");

const PAGOS = ["", "Único", "Semestral", "Trimestral"];
const MONEDAS = ["EUR", "USD", "GBP"];
const PRODUCCIONES = ["Nueva Producción", "Cartera"];
const ESTADOS = ["En Vigor", "Cancelada", "Renovada", "No Renovada", "Temporal-Vencida"];

// Pago → nº de plazos al año (para la emisión de recibos).
const PLAZOS_DE: Record<string, number> = { Único: 1, Semestral: 2, Trimestral: 4 };

type FormState = {
  numero_poliza: string;
  asegurado: string;
  corredor: string;
  ramo: string;
  mercado: string;
  produccion: string;
  estado: string;
  seguro: string; // "1" directo / "2" reaseguro
  pago: string;
  pagador: string; // "Corredor" | "Tomador" (quién nos paga)
  moneda: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  renovacion_automatica: boolean;
  coaseguro: boolean;
  coaseguro_lineas: { mercado: string; participacion: string }[];
  limite: string;
  franquicia: string;
  capacidad: string;
  prima_neta: string;
  impuestos_porc: string;
  recargos: string;
  comision_porc: string;          // modo ficha (sin recibos)
  comision_cedida_porc: string;   // modo emisión (al corredor)
  comision_retenida_porc: string; // modo emisión (de Mayrit)
  notas: string;
};

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function s(v: unknown): string {
  return v == null ? "" : String(v);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Consecutividad / renovación de pólizas (mismo criterio que los binders) ---
// +1 año a una fecha ISO (mismo día y mes). "" si no es válida.
function masUnAnio(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${Number(y) + 1}-${m}-${d}` : "";
}
// Día siguiente a una fecha ISO (en UTC, sin desfases de zona).
function diaSiguiente(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
// Duración exactamente anual: el efecto +1 año coincide con el día siguiente al vencimiento.
// Solo estas pólizas se renuevan; las temporales (plazos cortos o > 1 año) no.
function esAnual(efecto?: string | null, vencimiento?: string | null): boolean {
  if (!efecto || !vencimiento) return false;
  return masUnAnio(s(efecto)) === diaSiguiente(s(vencimiento)) && masUnAnio(s(efecto)) !== "";
}
// La póliza que renueva a `p`: mismo asegurado y ramo, con efecto = día siguiente a su vencimiento.
function renovacionDe(p: Poliza, todas: Poliza[]): Poliza | undefined {
  const objetivo = diaSiguiente(s(p.fecha_vencimiento));
  if (!objetivo) return undefined;
  return todas.find(
    (x) =>
      x.id !== p.id &&
      s(x.asegurado) === s(p.asegurado) &&
      s(x.ramo) === s(p.ramo) &&
      s(x.fecha_efecto).slice(0, 10) === objetivo
  );
}
// Estado inicial de una renovación: copia la póliza, la fecha al año siguiente y limpia lo propio del alta.
function desdeRenovacion(p: Poliza): FormState {
  return {
    ...desde(p),
    numero_poliza: "",
    estado: "En Vigor",
    produccion: "Cartera",
    fecha_efecto: diaSiguiente(s(p.fecha_vencimiento)),
    fecha_vencimiento: masUnAnio(s(p.fecha_vencimiento)),
  };
}

function desde(p: Poliza | null): FormState {
  return {
    numero_poliza: s(p?.numero_poliza),
    asegurado: s(p?.asegurado),
    corredor: s(p?.corredor),
    ramo: s(p?.ramo),
    mercado: s(p?.mercado),
    produccion: s(p?.produccion),
    estado: s(p?.estado),
    seguro: s(p?.seguro) || "1",
    pago: s(p?.pago),
    pagador: s(p?.pagador) || "Corredor",
    moneda: s(p?.moneda) || "EUR",
    fecha_efecto: s(p?.fecha_efecto).slice(0, 10),
    fecha_vencimiento: s(p?.fecha_vencimiento).slice(0, 10),
    renovacion_automatica: !!p?.renovacion_automatica,
    coaseguro: !!p?.coaseguro,
    coaseguro_lineas: (p?.coaseguro_lineas ?? []).map((l) => ({ mercado: s(l.mercado), participacion: s(l.participacion) })),
    limite: s(p?.limite),
    franquicia: s(p?.franquicia),
    capacidad: p?.capacidad != null ? String(num(s(p.capacidad)) * 100) : "100",
    prima_neta: s(p?.prima_neta),
    impuestos_porc: s(p?.impuestos_porc),
    recargos: s(p?.recargos),
    comision_porc: s(p?.comision_porc),
    comision_cedida_porc: s(p?.comision_cedida_porc),
    comision_retenida_porc: "",
    notas: s(p?.notas),
  };
}

const eur = (v: unknown) => fmtMiles(v);

export default function PolizaForm({
  poliza,
  onSaved,
  onClose,
  onDeleted,
  polizas = [],
  renovarDe = null,
  onRenovar,
}: {
  poliza: Poliza | null;
  onSaved: () => void;
  onClose: () => void;
  onDeleted: () => void;
  polizas?: Poliza[];           // lista completa (para detectar renovación ya existente)
  renovarDe?: Poliza | null;    // si es un alta de renovación, la póliza de origen
  onRenovar?: () => void;       // abre un alta nueva prerrellenada con la renovación
}) {
  const inicio = (): FormState => (poliza ? desde(poliza) : renovarDe ? desdeRenovacion(renovarDe) : desde(null));
  const [form, setForm] = useState<FormState>(inicio);
  const [inicial] = useState<FormState>(inicio);
  // Generar recibos al guardar: SIEMPRE desactivado por defecto (la emisión nunca es
  // automática; hay que activarlo y revisar la vista previa antes de pulsar "Emitir").
  const [genRecibos, setGenRecibos] = useState(false);
  const [genInicial] = useState(false);
  const [preview, setPreview] = useState<EmisionPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listas para los desplegables. Tomadores: todos. Corredores/Mercados: solo activos.
  const [tomadores, setTomadores] = useState<Tomador[]>([]);
  const [corredores, setCorredores] = useState<Productor[]>([]);
  const [mercados, setMercados] = useState<Mercado[]>([]);
  const [ramos, setRamos] = useState<Ramo[]>([]);
  // Nº de póliza: manual (se escribe) o automático (lo genera el sistema). Solo en altas nuevas.
  const [numeroAuto, setNumeroAuto] = useState(!!renovarDe);
  // Alta rápida apilada encima (sin cerrar la póliza).
  const [alta, setAlta] = useState<null | "tomador" | "corredor" | "mercado">(null);
  const [confirmSinRecibos, setConfirmSinRecibos] = useState(false);
  // Al editar una póliza existente se abre en SOLO LECTURA; "Corregir" libera la edición.
  const [bloqueado, setBloqueado] = useState(!!poliza);
  // Recibos enlazados a esta póliza (al editar).
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [recibosCargados, setRecibosCargados] = useState(false);

  useEffect(() => {
    if (!poliza) return;
    recibosApi
      .listar({ poliza_id: poliza.id })
      .then(setRecibos)
      .catch(() => {})
      .finally(() => setRecibosCargados(true));
  }, [poliza]);

  useEffect(() => {
    // limit alto para traerlas todas (el endpoint pagina a 100 por defecto).
    tomadoresApi.list(undefined, 5000).then(setTomadores).catch(() => {});
    productoresApi.list(undefined, 5000).then((ps) => setCorredores(ps.filter((p) => p.activa))).catch(() => {});
    mercadosApi.list(undefined, 5000).then((ms) => setMercados(ms.filter((m) => m.activa))).catch(() => {});
    ramosApi.list(undefined, 5000).then(setRamos).catch(() => {});
  }, []);

  // Alta de ramo: un ramo es solo un nombre (los risk codes se añaden en Ramos). Igual que en binders.
  async function nuevoRamo() {
    const nombre = window.prompt("Nuevo ramo:");
    if (!nombre || !nombre.trim()) return;
    const n = nombre.trim();
    try {
      const creado = await ramosApi.create({ nombre: n });
      setRamos((prev) => [creado, ...prev]);
      set("ramo", creado.nombre);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty =
    JSON.stringify(form) !== JSON.stringify(inicial) || genRecibos !== genInicial;

  // Nº automático: B1634 + AA (año de la fecha de efecto) + correlativo. Recalcula al activar
  // el modo automático o al cambiar el año de efecto. Solo en altas nuevas.
  useEffect(() => {
    if (poliza || !numeroAuto) return;
    const yy = form.fecha_efecto.slice(0, 4);
    if (!/^\d{4}$/.test(yy)) {
      setForm((f) => ({ ...f, numero_poliza: "" }));
      return;
    }
    polizasApi
      .siguienteNumero(Number(yy))
      .then((r) => setForm((f) => ({ ...f, numero_poliza: r.numero_poliza })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroAuto, form.fecha_efecto, poliza]);

  // Modo emisión: DESACTIVADO de momento. El check "Generar recibos" no cambia el formulario
  // ni emite (pendiente de retomar). Se conserva todo el código de emisión más abajo.
  const esEmision = false; // antes: !poliza && genRecibos
  const listoParaEmitir = !!form.fecha_efecto && num(form.prima_neta) > 0;

  // Campos calculados (en gris), sobre la Prima Participación (modo ficha).
  const primaPart = num(form.prima_neta) * (num(form.capacidad) / 100);
  const impuestos = (primaPart * num(form.impuestos_porc)) / 100;
  const primaTotal = primaPart + impuestos + num(form.recargos);
  const comisionTotal = (primaPart * num(form.comision_porc)) / 100;
  // Reparto: % del corredor (cedida) lo introduce el usuario; el de Mayrit (retenida) se calcula.
  const comisionRetenidaPct = num(form.comision_porc) - num(form.comision_cedida_porc);
  const comisionTotalPct = num(form.comision_cedida_porc) + num(form.comision_retenida_porc);
  const nPlazos = PLAZOS_DE[form.pago] ?? 1; // nº de recibos a emitir según el Pago

  // Coaseguro nuestro: compañías que comparten nuestra capacidad. La suma de sus % debe = Capacidad.
  const sumaCoaseguro = form.coaseguro_lineas.reduce((a, l) => a + num(l.participacion), 0);
  // Mercados filtrados por el ramo elegido: si hay ramo, solo los que lo trabajan (o los que
  // aún no tienen ramos configurados, para no romper datos existentes).
  const mercadosFiltrados = mercados.filter(
    (m) => !form.ramo || !m.ramos?.length || m.ramos.includes(form.ramo)
  );
  const addCoaLinea = () =>
    setForm((f) => ({ ...f, coaseguro_lineas: [...f.coaseguro_lineas, { mercado: "", participacion: "" }] }));
  const setCoaLinea = (i: number, k: "mercado" | "participacion", v: string) =>
    setForm((f) => ({ ...f, coaseguro_lineas: f.coaseguro_lineas.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) }));
  const delCoaLinea = (i: number) =>
    setForm((f) => ({ ...f, coaseguro_lineas: f.coaseguro_lineas.filter((_, idx) => idx !== i) }));
  // Al activar coaseguro: la 1ª compañía es el Mercado de la póliza + una 2ª línea vacía (mín. 2).
  const toggleCoaseguro = (on: boolean) =>
    setForm((f) => ({
      ...f,
      coaseguro: on,
      coaseguro_lineas: on
        ? f.coaseguro_lineas.length
          ? f.coaseguro_lineas
          : [{ mercado: f.mercado, participacion: "" }, { mercado: "", participacion: "" }]
        : [],
    }));

  // Payload de emisión: la ficha completa + el nº de plazos (derivado del Pago).
  // El backend genera los recibos = plazos × compañías (coaseguro).
  function emitPayload(): PolizaEmitir {
    return { ...recordPayload(), n_plazos: nPlazos };
  }

  // Payload de ficha (sin recibos): incluye los totales ya calculados.
  function recordPayload(): PolizaWrite {
    return {
      numero_poliza: form.numero_poliza.trim() || null,
      asegurado: form.asegurado.trim() || null,
      corredor: form.corredor.trim() || null,
      ramo: form.ramo.trim() || null,
      mercado: form.mercado.trim() || null,
      produccion: form.produccion.trim() || null,
      estado: form.estado.trim() || null,
      seguro: form.seguro || null,
      pago: form.pago || null,
      pagador: form.pagador || null,
      moneda: form.moneda || null,
      fecha_efecto: form.fecha_efecto || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      renovacion_automatica: form.renovacion_automatica,
      coaseguro: form.coaseguro,
      coaseguro_lineas: form.coaseguro
        ? form.coaseguro_lineas.map((l) => ({ mercado: l.mercado, participacion: num(l.participacion) }))
        : [],
      limite: form.limite ? num(form.limite) : null,
      franquicia: form.franquicia ? num(form.franquicia) : null,
      capacidad: form.capacidad ? num(form.capacidad) / 100 : null,
      prima_neta: form.prima_neta ? num(form.prima_neta) : null,
      impuestos_porc: form.impuestos_porc ? num(form.impuestos_porc) : null,
      recargos: form.recargos ? num(form.recargos) : null,
      comision_porc: form.comision_porc ? num(form.comision_porc) : null,
      comision_cedida_porc: form.comision_cedida_porc ? num(form.comision_cedida_porc) : null,
      // calculados
      prima_participacion: round2(primaPart),
      impuestos: round2(impuestos),
      prima_total: round2(primaTotal),
      comision_total: round2(comisionTotal),
      notas: form.notas.trim() || null,
    };
  }

  // Vista previa en vivo de los recibos (con pequeño retardo) en modo emisión.
  useEffect(() => {
    if (!esEmision || !listoParaEmitir) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setPreview(await polizasApi.emitirPreview(emitPayload()));
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    esEmision, listoParaEmitir,
    form.prima_neta, form.capacidad, form.impuestos_porc, form.recargos,
    form.comision_cedida_porc, form.comision_retenida_porc, form.pago,
    form.fecha_efecto, form.fecha_vencimiento,
  ]);

  // Todos los campos son obligatorios menos Notas (los checkboxes siempre tienen valor).
  function campoFaltante(): string | null {
    const req: [string, string][] = [
      [form.asegurado, "El asegurado es obligatorio."],
      [form.corredor, "El corredor es obligatorio."],
      [form.ramo, "El ramo es obligatorio."],
      [form.mercado, "El mercado es obligatorio."],
      [form.produccion, "La producción es obligatoria."],
      [form.estado, "El estado es obligatorio."],
      [form.seguro, "El tipo de seguro es obligatorio."],
      [form.fecha_efecto, "La fecha de efecto es obligatoria."],
      [form.fecha_vencimiento, "La fecha de vencimiento es obligatoria."],
      [form.moneda, "La moneda es obligatoria."],
      [form.limite, "El límite es obligatorio."],
      [form.franquicia, "La franquicia es obligatoria."],
      [form.capacidad, "La capacidad es obligatoria."],
      [form.prima_neta, "La prima neta es obligatoria."],
      [form.impuestos_porc, "Los impuestos % son obligatorios."],
      [form.recargos, "Los recargos son obligatorios."],
    ];
    // El nº de póliza es obligatorio salvo en automático (se deriva de la fecha de efecto).
    if (!numeroAuto || poliza) req.unshift([form.numero_poliza, "El nº de póliza es obligatorio."]);
    if (esEmision) {
      req.push([form.comision_cedida_porc, "La comisión cedida % es obligatoria."]);
      req.push([form.comision_retenida_porc, "La comisión retenida % es obligatoria."]);
    } else {
      req.push([form.pago, "El pago es obligatorio."]);
      req.push([form.comision_porc, "La comisión % es obligatoria."]);
      req.push([form.comision_cedida_porc, "La comisión del corredor (cedida) es obligatoria."]);
    }
    for (const [v, msg] of req) if (!String(v ?? "").trim()) return msg;
    if (num(form.comision_cedida_porc) > num(form.comision_porc))
      return "La comisión del corredor (cedida) no puede superar la comisión total.";
    if (!poliza && genRecibos && num(form.prima_neta) <= 0) return "La prima neta debe ser mayor que 0 para emitir.";
    if (form.coaseguro) {
      if (form.coaseguro_lineas.length < 2)
        return "El coaseguro necesita al menos 2 compañías (con una sola al 100% no sería coaseguro).";
      for (const l of form.coaseguro_lineas) {
        if (!l.mercado.trim()) return "Falta el mercado en una línea de coaseguro.";
        if (!String(l.participacion).trim()) return "Falta el % en una línea de coaseguro.";
        if (num(l.participacion) >= num(form.capacidad))
          return `Cada compañía debe participar menos que la Capacidad (${num(form.capacidad)}%); con una sola al total no sería coaseguro.`;
      }
      if (Math.abs(sumaCoaseguro - num(form.capacidad)) > 0.0001)
        return `La suma de participaciones de coaseguro (${sumaCoaseguro}%) debe ser igual a la Capacidad (${num(form.capacidad)}%).`;
    }
    return null;
  }

  async function guardar() {
    const falta = campoFaltante();
    if (falta) return setError(falta);
    // Póliza nueva sin generar recibos → avisar antes de guardar.
    if (!poliza && !genRecibos) {
      setConfirmSinRecibos(true);
      return;
    }
    await doGuardar();
  }

  async function doGuardar() {
    setSaving(true);
    setError(null);
    try {
      if (!poliza && genRecibos) await polizasApi.emitir(emitPayload());
      else if (poliza) await polizasApi.editar(poliza.id, recordPayload());
      else await polizasApi.crear(recordPayload());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Emitir los recibos de una póliza YA existente que no los tiene (mismos criterios).
  async function emitirRecibosExistente() {
    if (!poliza) return;
    const falta = campoFaltante();
    if (falta) return setError(falta);
    if (num(form.prima_neta) <= 0) return setError("La prima neta debe ser mayor que 0 para emitir.");
    if (!confirm(`Se generarán los recibos de esta póliza (pago ${form.pago || "Único"}${form.coaseguro ? ", coaseguro" : ""}). ¿Continuar?`))
      return;
    setSaving(true);
    setError(null);
    try {
      if (dirty) await polizasApi.editar(poliza.id, recordPayload()); // guarda los datos en pantalla
      await polizasApi.emitirRecibos(poliza.id);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function borrar() {
    if (!poliza) return;
    if (!confirm(`¿Borrar la póliza ${poliza.numero_poliza ?? poliza.asegurado ?? ""}?`)) return;
    setSaving(true);
    try {
      await polizasApi.borrar(poliza.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const titulo = poliza
    ? `Editar Póliza · ${poliza.numero_poliza ?? ""}`
    : esEmision
    ? "Emitir Póliza"
    : "Nueva Póliza";

  return (
    <>
    <FormPanel
      title={titulo}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={guardar}
      saveLabel={esEmision ? "Emitir" : undefined}
      saveDisabled={esEmision && !listoParaEmitir}
      onClose={onClose}
      onDelete={poliza && !bloqueado ? borrar : undefined}
      wide
      readOnly={bloqueado}
      escEnabled={alta === null && !confirmSinRecibos}
    >
      {poliza && (
        <div className="ro-banner">
          <span>{bloqueado ? "🔒 Solo lectura" : "✏️ Editando"}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {recibosCargados && recibos.length === 0 && (
              <button type="button" className="btn-primary" onClick={emitirRecibosExistente} disabled={saving}>
                ⚡ Emitir recibos
              </button>
            )}
            {poliza && esAnual(poliza.fecha_efecto, poliza.fecha_vencimiento) && onRenovar && (() => {
              const yaRenov = renovacionDe(poliza, polizas);
              return (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onRenovar}
                  disabled={!!yaRenov || saving}
                  title={
                    yaRenov
                      ? `Ya renovada por ${yaRenov.numero_poliza || "otra póliza"} (efecto ${s(yaRenov.fecha_efecto).slice(0, 10)})`
                      : "Crear la póliza del año siguiente (consecutiva)"
                  }
                >
                  🔄 Renovar
                </button>
              );
            })()}
            {bloqueado && (
              <button type="button" className="btn-primary" onClick={() => setBloqueado(false)}>
                ✏️ Corregir
              </button>
            )}
          </div>
        </div>
      )}
      <fieldset className="ro-fieldset" disabled={bloqueado}>
      <div className="dos-columnas">
        {/* IZQUIERDA: datos generales + Importes al 100% */}
        <div className="col bloque">
          <SelectConAlta
            label="Asegurado"
            required
            value={form.asegurado}
            options={[...tomadores].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((t) => ({ value: t.nombre, label: t.nombre }))}
            onChange={(v) => set("asegurado", v)}
            onAdd={() => setAlta("tomador")}
            addTitle="Nuevo tomador"
          />
          <SelectConAlta
            label="Corredor"
            required
            value={form.corredor}
            options={corredores.filter((c) => c.tipo === "Corredor").map((c) => ({ value: c.nombre, label: c.alias ? `${c.nombre} (${c.alias})` : c.nombre }))}
            onChange={(v) => set("corredor", v)}
            onAdd={() => setAlta("corredor")}
            addTitle="Nuevo corredor"
          />
          <div className="field">
            <label>Nº Póliza <span className="required">*</span></label>
            {!poliza && (
              <OptionButtons
                value={numeroAuto ? "Automático" : "Manual"}
                options={["Manual", "Automático"]}
                onChange={(v) => setNumeroAuto(v === "Automático")}
              />
            )}
            {!poliza && numeroAuto ? (
              <input
                type="text"
                value={form.numero_poliza}
                readOnly
                placeholder="Indica la fecha de efecto para generar el número"
                title="Se asigna automáticamente"
              />
            ) : (
              <input type="text" value={form.numero_poliza} onChange={(e) => set("numero_poliza", e.target.value)} />
            )}
          </div>
          <SelectConAlta
            label="Ramo"
            required
            value={form.ramo}
            options={ramos.map((r) => ({ value: r.nombre, label: r.nombre }))}
            onChange={(v) => set("ramo", v)}
            onAdd={nuevoRamo}
            addTitle="Nuevo ramo"
          />
          <SelectConAlta
            label="Mercado"
            required
            value={form.mercado}
            options={mercadosFiltrados.map((m) => ({ value: m.nombre, label: m.alias ? `${m.nombre} (${m.alias})` : m.nombre }))}
            onChange={(v) => set("mercado", v)}
            onAdd={() => setAlta("mercado")}
            addTitle="Nuevo mercado"
          />
          <div className="field-row">
            <div className="field">
              <label>Producción <span className="required">*</span></label>
              <select value={form.produccion} onChange={(e) => set("produccion", e.target.value)}>
                <option value="">— Elige —</option>
                {[...new Set([...(form.produccion ? [form.produccion] : []), ...PRODUCCIONES])].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Estado <span className="required">*</span></label>
              <select value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                <option value="">— Elige —</option>
                {[...new Set([...(form.estado ? [form.estado] : []), ...ESTADOS])].map((s2) => (
                  <option key={s2} value={s2}>{s2}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Seguro <span className="required">*</span></label>
            <OptionButtons
              value={form.seguro === "2" ? "Reaseguro" : "Seguro Directo"}
              options={["Seguro Directo", "Reaseguro"]}
              onChange={(v) => set("seguro", v === "Reaseguro" ? "2" : "1")}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Fecha Efecto <span className="required">*</span></label>
              <input type="date" className="inp-fecha" value={form.fecha_efecto} onChange={(e) => set("fecha_efecto", e.target.value)} />
            </div>
            <div className="field">
              <label>Fecha Vto. <span className="required">*</span></label>
              <input type="date" className="inp-fecha" value={form.fecha_vencimiento} onChange={(e) => set("fecha_vencimiento", e.target.value)} />
            </div>
          </div>
          <label className="field check" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={form.renovacion_automatica} onChange={(e) => set("renovacion_automatica", e.target.checked)} />
            Renovación automática
          </label>

          <h3 style={{ marginTop: 18, marginBottom: 8 }}>Importes al 100%</h3>
          <div className="field">
            <label>Límite <span className="required">*</span></label>
            <NumberInput value={form.limite} onChange={(v) => set("limite", v)} />
          </div>
          <div className="field">
            <label>Franquicia <span className="required">*</span></label>
            <NumberInput value={form.franquicia} onChange={(v) => set("franquicia", v)} />
          </div>
          <div className="field">
            <label>Prima Neta <span className="required">*</span></label>
            <NumberInput value={form.prima_neta} onChange={(v) => set("prima_neta", v)} />
          </div>
        </div>

        {/* DERECHA: Participación → abajo + Pago/Moneda */}
        <div className="col bloque">
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Participación</h3>
          <div className="field-row">
            <div className="field">
              <label>Capacidad sobre el Total <span className="required">*</span></label>
              <NumberInput value={form.capacidad} onChange={(v) => set("capacidad", v)} suffix="%" decimals={4} thousands={false} />
            </div>
            <label className="field check" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={form.coaseguro} onChange={(e) => toggleCoaseguro(e.target.checked)} />
              Coaseguro Nuestro
            </label>
          </div>

          {esEmision ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label>Impuestos % <span className="required">*</span></label>
                  <NumberInput value={form.impuestos_porc} onChange={(v) => set("impuestos_porc", v)} suffix="%" thousands={false} />
                </div>
                <div className="field">
                  <label>Recargos <span className="required">*</span></label>
                  <NumberInput value={form.recargos} onChange={(v) => set("recargos", v)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Comisión cedida % (corredor) <span className="required">*</span></label>
                  <NumberInput value={form.comision_cedida_porc} onChange={(v) => set("comision_cedida_porc", v)} suffix="%" thousands={false} />
                </div>
                <div className="field">
                  <label>Comisión retenida % (Mayrit) <span className="required">*</span></label>
                  <NumberInput value={form.comision_retenida_porc} onChange={(v) => set("comision_retenida_porc", v)} suffix="%" thousands={false} />
                </div>
              </div>
              <div className="field">
                <label>Comisión total %</label>
                <div className="calc-box">{fmtMiles(comisionTotalPct, 4, false)} %</div>
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Prima Participación</label>
                <div className="calc-box">{fmtMiles(primaPart)}</div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Impuestos % <span className="required">*</span></label>
                  <NumberInput value={form.impuestos_porc} onChange={(v) => set("impuestos_porc", v)} suffix="%" thousands={false} />
                </div>
                <div className="field">
                  <label>Impuestos</label>
                  <div className="calc-box">{fmtMiles(impuestos)}</div>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Recargos <span className="required">*</span></label>
                  <NumberInput value={form.recargos} onChange={(v) => set("recargos", v)} />
                </div>
                <div className="field">
                  <label>Prima Total</label>
                  <div className="calc-box">{fmtMiles(primaTotal)}</div>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Comisión % (total) <span className="required">*</span></label>
                  <NumberInput value={form.comision_porc} onChange={(v) => set("comision_porc", v)} suffix="%" thousands={false} />
                </div>
                <div className="field">
                  <label>Comisión corredor % (cedida) <span className="required">*</span></label>
                  <NumberInput value={form.comision_cedida_porc} onChange={(v) => set("comision_cedida_porc", v)} suffix="%" thousands={false} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Comisión Mayrit % (retenida)</label>
                  <div className="calc-box">{fmtMiles(comisionRetenidaPct, 4, false)} %</div>
                </div>
                <div className="field">
                  <label>Comisión Total</label>
                  <div className="calc-box">{fmtMiles(comisionTotal)}</div>
                </div>
              </div>
            </>
          )}

          <div className="field-row">
            <div className="field">
              <label>Pago <span className="required">*</span></label>
              <select value={form.pago} onChange={(e) => set("pago", e.target.value)}>
                {PAGOS.map((p) => <option key={p} value={p}>{p || "—"}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Moneda <span className="required">*</span></label>
              <select value={form.moneda} onChange={(e) => set("moneda", e.target.value)}>
                {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>¿Quién nos paga? <span className="required">*</span></label>
              <select value={form.pagador} onChange={(e) => set("pagador", e.target.value)}>
                <option value="Corredor">Corredor (paga neto, descuenta su comisión)</option>
                <option value="Tomador">Tomador (paga el 100%; pagamos la comisión al corredor)</option>
              </select>
            </div>
            <div className="field" />
          </div>

          {form.coaseguro && (
            <div style={{ marginTop: 10, borderTop: "1px dashed var(--borde)", paddingTop: 8 }}>
              <h4 style={{ margin: "4px 0 6px" }}>Coaseguro — sobre el Total</h4>
              {form.coaseguro_lineas.map((l, i) => (
                <div className="field-row" key={i} style={{ alignItems: "flex-end" }}>
                  <div className="field" style={{ flex: 2 }}>
                    {i === 0 && <label>Compañía (mercado) <span className="required">*</span></label>}
                    <select value={l.mercado} onChange={(e) => setCoaLinea(i, "mercado", e.target.value)}>
                      <option value="">— Elige —</option>
                      {[
                        ...new Set([
                          ...(l.mercado ? [l.mercado] : []),
                          // Excluir las compañías ya elegidas en OTRAS líneas.
                          ...mercadosFiltrados
                            .map((m) => m.nombre)
                            .filter((nom) => !form.coaseguro_lineas.some((x, idx) => idx !== i && x.mercado === nom)),
                        ]),
                      ].map((nom) => (
                        <option key={nom} value={nom}>{nom}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    {i === 0 && <label>% Participación <span className="required">*</span></label>}
                    <NumberInput value={l.participacion} onChange={(v) => setCoaLinea(i, "participacion", v)} suffix="%" thousands={false} />
                  </div>
                  <button
                    type="button"
                    title="Quitar"
                    onClick={() => delCoaLinea(i)}
                    style={{
                      background: "none", border: "none", color: "var(--rojo)", cursor: "pointer",
                      fontSize: 11, lineHeight: 1, padding: 2, marginBottom: 22,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="btn-secondary" style={{ marginTop: 4 }} onClick={addCoaLinea}>
                + Añadir compañía
              </button>
              <div
                className="hint"
                style={{ marginTop: 6, color: Math.abs(sumaCoaseguro - num(form.capacidad)) > 0.0001 ? "var(--rojo)" : undefined }}
              >
                Suma participaciones: <b>{fmtMiles(sumaCoaseguro, 2, false)}%</b> / Capacidad: <b>{fmtMiles(num(form.capacidad), 2, false)}%</b>
                {Math.abs(sumaCoaseguro - num(form.capacidad)) > 0.0001 ? " — deben coincidir" : " ✓"}
              </div>
              {form.coaseguro_lineas.some((l) => l.participacion !== "" && num(l.participacion) >= num(form.capacidad)) && (
                <div className="hint" style={{ marginTop: 2, color: "var(--rojo)" }}>
                  Cada compañía debe participar menos que la Capacidad ({fmtMiles(num(form.capacidad), 2, false)}%).
                </div>
              )}
            </div>
          )}

          {!poliza && (
            <label
              className="field check"
              style={{ margin: "10px 0", padding: "10px 0", borderTop: "1px solid var(--borde)", borderBottom: "1px solid var(--borde)" }}
            >
              <input type="checkbox" checked={genRecibos} onChange={(e) => setGenRecibos(e.target.checked)} />
              ⚡ Generar recibos al guardar (emisión)
            </label>
          )}

          <div className="field" style={{ marginTop: 6 }}>
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => set("notas", e.target.value)} />
          </div>
        </div>
      </div>

      {esEmision && (
        <>
          <h3 style={{ marginTop: 18, marginBottom: 8 }}>Emisión de recibos</h3>
          {!listoParaEmitir ? (
            <div className="hint" style={{ marginTop: 8 }}>
              Indica <b>fecha de efecto</b> y <b>prima neta</b> para ver los recibos a generar.
            </div>
          ) : preview ? (
            <div className="emision-preview">
              <table className="compacto">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th className="num">Prima Neta</th>
                    <th className="num">Impuestos</th>
                    <th className="num">Prima Bruta</th>
                    <th className="num">Cedida</th>
                    <th className="num">Retenida</th>
                    <th className="num">Adeudada</th>
                    <th className="num">A liquidar</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lineas.map((l) => (
                    <tr key={l.recibo_num}>
                      <td>{l.recibo_num}/{l.recibos_totales}</td>
                      <td>{fmtFechaES(l.fecha_efecto_recibo)}</td>
                      <td className="num">{eur(l.prima_neta_recibo)}</td>
                      <td className="num">{eur(l.impuestos_recibo)}</td>
                      <td className="num">{eur(l.prima_bruta_recibo)}</td>
                      <td className="num">{eur(l.comision_cedida)}</td>
                      <td className="num">{eur(l.comision_retenida)}</td>
                      <td className="num">{eur(l.prima_adeudada)}</td>
                      <td className="num">{eur(l.liquidar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><b>Total</b></td>
                    <td className="num"><b>{eur(preview.prima_participacion)}</b></td>
                    <td className="num"><b>{eur(preview.impuestos)}</b></td>
                    <td className="num"><b>{eur(preview.prima_total)}</b></td>
                    <td className="num" colSpan={2}><b>{eur(preview.comision_total)}</b></td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div className="hint" style={{ marginTop: 6 }}>
                Se generarán <b>{preview.lineas.length}</b> recibo(s) ({preview.pago}) al emitir.
              </div>
            </div>
          ) : (
            <div className="loading">Calculando recibos…</div>
          )}
        </>
      )}
      </fieldset>

      {poliza && recibos.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Recibos de esta póliza ({recibos.length})</h3>
          <div className="emision-preview">
            <table className="compacto">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Mercado</th>
                  <th>F. Efecto</th>
                  <th>F. Vto.</th>
                  <th className="num">Prima Neta</th>
                  <th className="num">Comisión Mayrit</th>
                </tr>
              </thead>
              <tbody>
                {recibos.map((r) => (
                  <tr key={r.id}>
                    <td>{r.numero}</td>
                    <td>{r.nombre_mercado ?? r.mercado ?? "—"}</td>
                    <td>{fmtFechaES(r.fecha_efecto_recibo)}</td>
                    <td>{fmtFechaES(r.fecha_vcto_recibo)}</td>
                    <td className="num">{fmtMiles(r.prima_neta_recibo)}</td>
                    <td className="num">{fmtMiles(r.comision_retenida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </FormPanel>

    {confirmSinRecibos && (
      <ConfirmDialog
        titulo="Póliza sin recibos"
        mensaje="Vas a guardar la póliza SIN generar recibos."
        detalle="Quedará marcada como «Sin recibo» en el listado. Podrás generarlos más adelante."
        confirmLabel="Guardar sin recibos"
        onConfirm={() => { setConfirmSinRecibos(false); doGuardar(); }}
        onClose={() => setConfirmSinRecibos(false)}
      />
    )}

    {/* Alta rápida apilada encima (no cierra la póliza; al guardar, selecciona el nuevo). */}
    {alta === "tomador" && (
      <TomadorForm
        initial={null}
        onSaved={(t) => { setTomadores((prev) => [t, ...prev]); set("asegurado", t.nombre); setAlta(null); }}
        onClose={() => setAlta(null)}
      />
    )}
    {alta === "corredor" && (
      <ProductorForm
        initial={null}
        onSaved={(p) => { setCorredores((prev) => [p, ...prev]); set("corredor", p.nombre); setAlta(null); }}
        onClose={() => setAlta(null)}
      />
    )}
    {alta === "mercado" && (
      <MercadoForm
        initial={null}
        onSaved={(m) => { setMercados((prev) => [m, ...prev]); set("mercado", m.nombre); setAlta(null); }}
        onClose={() => setAlta(null)}
      />
    )}
    </>
  );
}
