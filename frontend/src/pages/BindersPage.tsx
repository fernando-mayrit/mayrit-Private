import { useEffect, useState } from "react";
import { crud, listarSuplementos, crearSuplemento } from "../api";
import type { Binder, BinderWrite, CuentaBancaria, Mercado, Productor, Ramo, Suplemento } from "../types";
import FormPanel from "../components/FormPanel";
import PageHeader from "../components/PageHeader";
import NumberInput from "../components/NumberInput";
import OptionButtons from "../components/OptionButtons";
import BinderDetalle from "./BinderDetalle";
import { fmtMiles } from "../format";

const api = crud<Binder, BinderWrite>("/binders");
const apiProductores = crud<Productor, unknown>("/productores");
const apiMercados = crud<Mercado, unknown>("/mercados");
const apiRamos = crud<Ramo, { nombre: string }>("/ramos");
const apiCuentas = crud<CuentaBancaria, unknown>("/cuentas-bancarias");

const ESTADOS = ["En Vigor", "Cancelado", "Renovado", "No Renovado", "Cerrado Producción", "Cerrado"];
const INTERVALOS = ["Mensual", "Trimestral", "Semestral", "Anual"];
const PREFIJO_UMR = "B1634";

// Ámbito del Límite de Primas: genérico para todo el binder, uno por sección, o por grupos.
type LimiteAmbito = "binder" | "seccion" | "grupos";
const AMBITO_LABEL: Record<LimiteAmbito, string> = {
  binder: "Todo el binder",
  seccion: "Por sección",
  grupos: "Por grupos",
};
const AMBITO_POR_LABEL: Record<string, LimiteAmbito> = {
  "Todo el binder": "binder",
  "Por sección": "seccion",
  "Por grupos": "grupos",
};

type LineaForm = { mercado_id: string; participacion: string };
type LimiteGrupo = {
  limite_primas: string;
  notificacion: string;
  fecha_notificacion: string;
  // Consumo de este límite (solo lectura, viene del backend; no se envía en el payload).
  estado?: "verde" | "ambar" | "rojo" | null;
  consumo_pct?: number | null;
};
type RiskCodeForm = { codigo: string; comision_mayrit: string };
type SeccionForm = {
  ramo: string;
  risk_codes: RiskCodeForm[];
  limite_grupo: number; // índice en form.limites
  comision: string;
  comision_mayrit: string;  // override de la comisión Mayrit del binder (a nivel sección)
  sujeto_pc: boolean;
  mercados: LineaForm[];
};
type FormState = {
  id?: number;
  agreement_number: string;
  umr: string;
  productor_id: string;
  fecha_efecto: string;
  fecha_vencimiento: string;
  yoa: string;
  estado: string;
  moneda: string;
  // Datos comunes del binder (debajo de las secciones)
  profit_commission: boolean;
  pc_porcentaje: string;
  pc_gastos: string;
  risk_bdx_intervalo: string;
  risk_bdx_plazo: string;
  premium_bdx_intervalo: string;
  premium_bdx_plazo: string;
  claims_bdx_intervalo: string;
  claims_bdx_plazo: string;
  comision_mayrit: string;
  cuenta_bancaria_id: string;
  notas: string;
  // Límite de Primas: grupos (cada uno límite + %) y el modo de ámbito elegido.
  limite_ambito: LimiteAmbito;
  limites: LimiteGrupo[];
  secciones: SeccionForm[];
};

const LIMITE_VACIO: LimiteGrupo = {
  limite_primas: "",
  notificacion: "",
  fecha_notificacion: "",
  estado: null,
  consumo_pct: null,
};

const SECCION_VACIA: SeccionForm = {
  ramo: "",
  risk_codes: [],
  limite_grupo: 0,
  comision: "",
  comision_mayrit: "",
  sujeto_pc: false,
  mercados: [{ mercado_id: "", participacion: "" }],
};

const VACIO: FormState = {
  agreement_number: "",
  umr: "",
  productor_id: "",
  fecha_efecto: "",
  fecha_vencimiento: "",
  yoa: "",
  estado: "En Vigor",
  moneda: "EUR",
  profit_commission: false,
  pc_porcentaje: "",
  pc_gastos: "",
  risk_bdx_intervalo: "",
  risk_bdx_plazo: "",
  premium_bdx_intervalo: "",
  premium_bdx_plazo: "",
  claims_bdx_intervalo: "",
  claims_bdx_plazo: "",
  comision_mayrit: "",
  cuenta_bancaria_id: "",
  notas: "",
  limite_ambito: "seccion",
  limites: [{ ...LIMITE_VACIO }],
  secciones: [JSON.parse(JSON.stringify(SECCION_VACIA))],
};

// Vista de solo lectura del snapshot de un suplemento (los términos congelados).
type SnapSeccionView = {
  ramo: string | null;
  risk_codes?: (string | { codigo: string; comision_mayrit: number | null })[];
  limite_grupo?: number | null;
  comision: number | null;
  comision_mayrit?: number | null;
  sujeto_pc?: boolean;
  mercados?: { mercado_id: number; participacion: number | null }[];
};
type SnapView = {
  productor_id?: number | null;
  fecha_efecto?: string | null;
  fecha_vencimiento?: string | null;
  estado?: string | null;
  moneda?: string | null;
  yoa?: string | null;
  profit_commission?: boolean;
  pc_porcentaje?: number | null;
  pc_gastos?: number | null;
  risk_bdx_intervalo?: string | null;
  risk_bdx_plazo?: number | null;
  premium_bdx_intervalo?: string | null;
  premium_bdx_plazo?: number | null;
  claims_bdx_intervalo?: string | null;
  claims_bdx_plazo?: number | null;
  comision_mayrit?: number | null;
  cuenta_bancaria_id?: number | null;
  notas?: string | null;
  limites?: { limite_primas: number | null; notificacion: number | null }[];
  secciones?: SnapSeccionView[];
};

// Importe en euros (formato único de la app: miles con punto, 2 decimales con coma).
function eur(n: number | null | undefined): string {
  if (n == null) return "—";
  return fmtMiles(n) || "—";
}

function num(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

// Formato de % (2 decimales) para mensajes y totales en vivo.
function pct(n: number): string {
  return fmtMiles(n) + " %";
}

// Fecha ISO (aaaa-mm-dd) → dd/mm/aaaa para mostrar en tablas.
function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

// Semáforo de notificación: consumo del GWP our line frente al umbral de notificación del
// límite MÁS CRÍTICO del binder. 🟢 lejos · 🟡 a <10 puntos del umbral · 🔴 umbral alcanzado.
const NOTIF_ICONO: Record<string, string> = { verde: "🟢", ambar: "🟡", rojo: "🔴" };
function NotifCelda({ b }: { b: Binder }) {
  if (!b.notif_estado) return <>—</>;
  const umbral = b.limites?.[0]?.notificacion;
  const titulo =
    `Consumo ${fmtMiles(b.notif_consumo_pct ?? 0)} %` +
    (umbral != null ? ` · umbral de notificación ${fmtMiles(umbral)} %` : "");
  return (
    <span className={`notif notif-${b.notif_estado}`} title={titulo}>
      {NOTIF_ICONO[b.notif_estado]} {fmtMiles(b.notif_consumo_pct ?? 0)} %
    </span>
  );
}

// Ramos distintos de un binder (de sus secciones), unidos por coma.
function ramosDe(b: Binder): string {
  const set = [...new Set(b.secciones.map((s) => s.ramo).filter(Boolean))];
  return set.length ? (set.join(", ") as string) : "—";
}

function umrDe(agreement: string): string {
  return agreement.trim() ? PREFIJO_UMR + agreement.trim() : "";
}

// Clase de color de fila según el estado del binder (CSS en styles.css).
function claseEstado(estado: string | null): string {
  switch (estado) {
    case "En Vigor":
      return "estado-en-vigor";
    case "Renovado":
      return "estado-renovado";
    case "Cerrado Producción":
      return "estado-cerrado-prod";
    case "Cerrado":
      return "estado-cerrado";
    default:
      return "";
  }
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Vencimiento = efecto + 1 año − 1 día (el día anterior al aniversario).
function vencimientoDe(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return fmt(d);
}

// YOA = año de la fecha de efecto.
function yoaDe(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

export default function BindersPage() {
  const [detalle, setDetalle] = useState<Binder | null>(null); // ficha "interior" del binder
  const [items, setItems] = useState<Binder[]>([]);
  const [agencias, setAgencias] = useState<Productor[]>([]);
  const [mercados, setMercados] = useState<Mercado[]>([]);
  const [ramos, setRamos] = useState<Ramo[]>([]);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [q, setQ] = useState("");
  // Filtros de la barra (desplegables): se aplican en cliente sobre lo ya cargado.
  const [fYoa, setFYoa] = useState("");
  const [fCover, setFCover] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [inicial, setInicial] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  // modo del panel: "edicion" (alta/corrección, usa PUT/POST binder) o "suplemento" (nueva versión)
  const [modo, setModo] = useState<"edicion" | "suplemento">("edicion");
  const [supEfecto, setSupEfecto] = useState("");
  const [supMotivo, setSupMotivo] = useState("");
  // Número del suplemento que se está dando de alta (para mostrarlo en la cabecera, p. ej. -03).
  const [supNumero, setSupNumero] = useState<number | null>(null);
  // Historial de versiones (panel de solo lectura)
  const [historial, setHistorial] = useState<Suplemento[] | null>(null);
  const [histBinder, setHistBinder] = useState<Binder | null>(null);
  // Suplemento concreto que se está viendo (solo lectura), abierto desde el historial.
  const [supVer, setSupVer] = useState<Suplemento | null>(null);
  // Corrección de un error de grabación: desbloquea la ficha SIN crear suplemento (refresca la
  // versión vigente). Distinto de un cambio real de términos (eso es «+ Suplemento»).
  const [corrigiendo, setCorrigiendo] = useState(false);

  const dirty =
    !!form &&
    (JSON.stringify(form) !== JSON.stringify(inicial) ||
      (modo === "suplemento" && (!!supEfecto || !!supMotivo)));
  // Binder existente abierto para editar: documento fijo, solo el Estado es editable
  // (salvo que estemos corrigiendo un error de grabación).
  const soloEstado = !!form && modo === "edicion" && !!form.id && !corrigiendo;
  // Profit Commission del binder solo se puede activar si alguna sección tiene "Sujeto a PC?".
  const algunaPC = !!form && form.secciones.some((s) => s.sujeto_pc);

  useEffect(() => {
    if (!algunaPC) {
      setForm((f) =>
        f && f.profit_commission ? { ...f, profit_commission: false, pc_porcentaje: "", pc_gastos: "" } : f
      );
    }
  }, [algunaPC]);

  async function cargar(search = q) {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.list(search || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function cargarRefs() {
    try {
      const [prod, merc, ram, cta] = await Promise.all([
        apiProductores.list(),
        apiMercados.list(),
        apiRamos.list(),
        apiCuentas.list(),
      ]);
      setAgencias((prod as Productor[]).filter((p) => p.tipo === "Agencia de Suscripción"));
      setMercados(merc as Mercado[]);
      setRamos(ram as Ramo[]);
      setCuentas(cta as CuentaBancaria[]);
    } catch {
      /* si fallan, los selectores quedan vacíos */
    }
  }

  async function nuevoRamo(i: number) {
    const nombre = window.prompt("Nuevo ramo:");
    if (!nombre || !nombre.trim()) return;
    const n = nombre.trim();
    try {
      await apiRamos.create({ nombre: n });
      setRamos((await apiRamos.list()) as Ramo[]);
      setRamo(i, n);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargarRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Búsqueda en vivo: filtra mientras se teclea (pequeño retardo para no saturar).
  useEffect(() => {
    const t = setTimeout(() => cargar(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrir(estado: FormState) {
    setForm(estado);
    setInicial(estado);
    setError(null);
  }
  function cerrar() {
    setForm(null);
    setInicial(null);
    setModo("edicion");
    setSupEfecto("");
    setSupMotivo("");
    setSupNumero(null);
    setCorrigiendo(false);
  }
  function abrirNuevo() {
    setModo("edicion");
    setSupEfecto("");
    setSupMotivo("");
    setCorrigiendo(false);
    abrir(JSON.parse(JSON.stringify(VACIO)));
  }
  function abrirEdicion(b: Binder) {
    setModo("edicion");
    setSupEfecto("");
    setSupMotivo("");
    setCorrigiendo(false);
    abrir(formDesde(b));
  }
  function formDesde(b: Binder): FormState {
    const limites: LimiteGrupo[] =
      b.limites && b.limites.length > 0
        ? b.limites.map((l) => ({
            limite_primas: l.limite_primas != null ? String(l.limite_primas) : "",
            notificacion: l.notificacion != null ? String(l.notificacion) : "",
            fecha_notificacion: l.fecha_notificacion ?? "",
            estado: l.estado ?? null,
            consumo_pct: l.consumo_pct ?? null,
          }))
        : [{ ...LIMITE_VACIO }];
    const secciones: SeccionForm[] =
      b.secciones.length > 0
        ? b.secciones.map((s) => ({
            ramo: s.ramo ?? "",
            risk_codes: (s.risk_codes ?? []).map((rc) => ({
              codigo: rc.codigo,
              comision_mayrit: rc.comision_mayrit != null ? String(rc.comision_mayrit) : "",
            })),
            limite_grupo: s.limite_grupo != null && s.limite_grupo < limites.length ? s.limite_grupo : 0,
            comision: s.comision != null ? String(s.comision) : "",
            comision_mayrit: s.comision_mayrit != null ? String(s.comision_mayrit) : "",
            sujeto_pc: !!s.sujeto_pc,
            mercados:
              s.mercados.length > 0
                ? s.mercados.map((m) => ({
                    mercado_id: String(m.mercado_id),
                    participacion: m.participacion != null ? String(m.participacion) : "",
                  }))
                : [{ mercado_id: "", participacion: "" }],
          }))
        : [JSON.parse(JSON.stringify(SECCION_VACIA))];
    // Deducir el ámbito: 1 grupo = binder; 1 grupo por sección en orden = por sección; resto = grupos.
    let limite_ambito: LimiteAmbito;
    if (limites.length <= 1) limite_ambito = "binder";
    else if (limites.length === secciones.length && secciones.every((s, i) => s.limite_grupo === i))
      limite_ambito = "seccion";
    else limite_ambito = "grupos";
    return {
      id: b.id,
      limite_ambito,
      limites,
      secciones,
      agreement_number: b.agreement_number ?? "",
      umr: b.umr ?? "",
      productor_id: b.productor_id != null ? String(b.productor_id) : "",
      fecha_efecto: b.fecha_efecto ?? "",
      fecha_vencimiento: b.fecha_vencimiento ?? "",
      yoa: b.yoa ?? "",
      estado: b.estado ?? "",
      moneda: b.moneda ?? "",
      profit_commission: !!b.profit_commission,
      pc_porcentaje: b.pc_porcentaje != null ? String(b.pc_porcentaje) : "",
      pc_gastos: b.pc_gastos != null ? String(b.pc_gastos) : "",
      risk_bdx_intervalo: b.risk_bdx_intervalo ?? "",
      risk_bdx_plazo: b.risk_bdx_plazo != null ? String(b.risk_bdx_plazo) : "",
      premium_bdx_intervalo: b.premium_bdx_intervalo ?? "",
      premium_bdx_plazo: b.premium_bdx_plazo != null ? String(b.premium_bdx_plazo) : "",
      claims_bdx_intervalo: b.claims_bdx_intervalo ?? "",
      claims_bdx_plazo: b.claims_bdx_plazo != null ? String(b.claims_bdx_plazo) : "",
      comision_mayrit: b.comision_mayrit != null ? String(b.comision_mayrit) : "",
      cuenta_bancaria_id: b.cuenta_bancaria_id != null ? String(b.cuenta_bancaria_id) : "",
      notas: b.notas ?? "",
    };
  }

  // ── Límite de Primas (grupos) ──
  // Renormaliza los grupos y las asignaciones de las secciones según el ámbito elegido.
  function normalizaLimites(f: FormState, ambito: LimiteAmbito): FormState {
    if (ambito === "binder") {
      const g = f.limites[0] ?? { ...LIMITE_VACIO };
      return { ...f, limite_ambito: ambito, limites: [g], secciones: f.secciones.map((s) => ({ ...s, limite_grupo: 0 })) };
    }
    if (ambito === "seccion") {
      const limites = f.secciones.map((s) => f.limites[s.limite_grupo] ?? { ...LIMITE_VACIO });
      return { ...f, limite_ambito: ambito, limites, secciones: f.secciones.map((s, i) => ({ ...s, limite_grupo: i })) };
    }
    // "grupos": la asignación actual ya es válida; se mantiene tal cual.
    return { ...f, limite_ambito: ambito };
  }
  function setAmbito(label: string) {
    const a = AMBITO_POR_LABEL[label];
    if (a) setForm((f) => (f ? normalizaLimites(f, a) : f));
  }
  function setGrupoCampo(g: number, campo: keyof LimiteGrupo, valor: string) {
    setForm((f) => (f ? { ...f, limites: f.limites.map((x, idx) => (idx === g ? { ...x, [campo]: valor } : x)) } : f));
  }
  function addGrupo() {
    setForm((f) => (f ? { ...f, limites: [...f.limites, { ...LIMITE_VACIO }] } : f));
  }
  function removeGrupo(g: number) {
    setForm((f) => {
      if (!f || f.limites.length <= 1) return f;
      const limites = f.limites.filter((_, idx) => idx !== g);
      const secciones = f.secciones.map((s) => {
        let lg = s.limite_grupo;
        if (lg === g) lg = 0;
        else if (lg > g) lg -= 1;
        return { ...s, limite_grupo: lg };
      });
      return { ...f, limites, secciones };
    });
  }
  function asignarSeccionAGrupo(i: number, g: number) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, limite_grupo: g } : s)));
  }

  // ── secciones / mercados (inmutable) ──
  function setSecciones(secs: SeccionForm[]) {
    setForm((f) => (f ? { ...f, secciones: secs } : f));
  }
  function addSeccion() {
    if (!form) return;
    const nueva: SeccionForm = JSON.parse(JSON.stringify(SECCION_VACIA));
    if (form.limite_ambito === "seccion") {
      // un grupo nuevo para la sección nueva
      setForm({
        ...form,
        limites: [...form.limites, { ...LIMITE_VACIO }],
        secciones: [...form.secciones, { ...nueva, limite_grupo: form.limites.length }],
      });
    } else {
      // binder o grupos: por defecto al primer grupo
      setForm({ ...form, secciones: [...form.secciones, { ...nueva, limite_grupo: 0 }] });
    }
  }
  function removeSeccion(i: number) {
    if (!form) return;
    const secs = form.secciones.filter((_, idx) => idx !== i);
    let f: FormState = { ...form, secciones: secs };
    // En modo "por sección" cada grupo va ligado a una sección: recolocar al quitar.
    if (form.limite_ambito === "seccion") f = normalizaLimites(f, "seccion");
    setForm(f);
  }
  function setRamo(i: number, ramo: string) {
    // al cambiar de ramo se resetean los risk codes (dependen del ramo)
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, ramo, risk_codes: [] } : s)));
  }
  function setSeccionCampo(i: number, campo: "comision" | "comision_mayrit", valor: string) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function setSeccionFlag(i: number, campo: "sujeto_pc", valor: boolean) {
    if (form) setSecciones(form.secciones.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function toggleRiskCode(i: number, codigo: string) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) => {
        if (idx !== i) return s;
        const has = s.risk_codes.some((rc) => rc.codigo === codigo);
        return {
          ...s,
          risk_codes: has
            ? s.risk_codes.filter((rc) => rc.codigo !== codigo)
            : [...s.risk_codes, { codigo, comision_mayrit: "" }],
        };
      })
    );
  }
  function setRiskCodeComision(i: number, codigo: string, valor: string) {
    if (!form) return;
    setSecciones(
      form.secciones.map((s, idx) =>
        idx === i
          ? { ...s, risk_codes: s.risk_codes.map((rc) => (rc.codigo === codigo ? { ...rc, comision_mayrit: valor } : rc)) }
          : s
      )
    );
  }
  function addMercado(i: number) {
    if (form)
      setSecciones(
        form.secciones.map((s, idx) =>
          idx === i ? { ...s, mercados: [...s.mercados, { mercado_id: "", participacion: "" }] } : s
        )
      );
  }
  function removeMercado(i: number, j: number) {
    if (form)
      setSecciones(
        form.secciones.map((s, idx) =>
          idx === i ? { ...s, mercados: s.mercados.filter((_, k) => k !== j) } : s
        )
      );
  }
  function setLinea(i: number, j: number, campo: keyof LineaForm, valor: string) {
    if (form)
      setSecciones(
        form.secciones.map((s, idx) =>
          idx === i
            ? { ...s, mercados: s.mercados.map((m, k) => (k === j ? { ...m, [campo]: valor } : m)) }
            : s
        )
      );
  }

  async function guardar() {
    if (!form) return;
    // Todos los campos son obligatorios al dar de alta un binder (salvo notas).
    if (!form.agreement_number.trim()) return setError("El Agreement Number es obligatorio.");
    if (!form.productor_id) return setError("El coverholder es obligatorio.");
    if (!form.fecha_efecto) return setError("La fecha de efecto es obligatoria.");
    if (!form.fecha_vencimiento) return setError("La fecha de vencimiento es obligatoria.");
    if (!form.yoa.trim()) return setError("El YOA es obligatorio.");
    for (let i = 0; i < form.secciones.length; i++) {
      const s = form.secciones[i];
      const N = `La sección ${i + 1}`;
      if (!s.ramo.trim()) return setError(`${N} necesita un ramo.`);
      const codes = ramos.find((r) => r.nombre === s.ramo)?.risk_codes ?? [];
      if (codes.length && s.risk_codes.length === 0)
        return setError(`${N} necesita al menos un risk code.`);
      const com = num(s.comision);
      if (com == null) return setError(`${N}: la comisión es obligatoria.`);
      if (com > 100) return setError(`${N}: la comisión no puede ser mayor que 100 %.`);
      const lineas = s.mercados.filter((m) => m.mercado_id);
      if (lineas.length === 0) return setError(`${N} necesita al menos un mercado.`);
      if (lineas.some((m) => num(m.participacion) == null))
        return setError(`${N}: cada mercado necesita su participación (%).`);
      const suma = lineas.reduce((a, m) => a + (num(m.participacion) ?? 0), 0);
      if (Math.abs(suma - 100) > 0.005)
        return setError(`${N}: la suma de participaciones debe ser 100 % (ahora ${pct(suma)}).`);
    }

    // Límite de Primas: validar cada grupo USADO por alguna sección (límite + notificación).
    const gruposUsados = [...new Set(form.secciones.map((s) => s.limite_grupo))].sort((a, b) => a - b);
    for (const gi of gruposUsados) {
      const L =
        form.limite_ambito === "binder"
          ? "El binder"
          : form.limite_ambito === "seccion"
          ? `La sección ${gi + 1}`
          : `El grupo de límite ${gi + 1}`;
      const g = form.limites[gi];
      if (!g || num(g.limite_primas) == null) return setError(`${L}: el límite de primas es obligatorio.`);
      if (num(g.notificacion) == null) return setError(`${L}: la notificación es obligatoria.`);
    }

    // Datos comunes del binder (obligatorios; las notas no).
    if (form.profit_commission) {
      if (num(form.pc_porcentaje) == null) return setError("Con Profit Commission, el PC (%) es obligatorio.");
      if (num(form.pc_gastos) == null) return setError("Con Profit Commission, los Gastos (%) son obligatorios.");
    }
    const bdx: [string, string, string][] = [
      ["Risk Bdx", form.risk_bdx_intervalo, form.risk_bdx_plazo],
      ["Premium Bdx", form.premium_bdx_intervalo, form.premium_bdx_plazo],
      ["Claims Bdx", form.claims_bdx_intervalo, form.claims_bdx_plazo],
    ];
    for (const [label, intervalo, plazo] of bdx) {
      if (!intervalo) return setError(`Indica el intervalo de ${label}.`);
      if (num(plazo) == null) return setError(`Indica el plazo (días) de ${label}.`);
    }
    if (num(form.comision_mayrit) == null) return setError("La comisión Mayrit es obligatoria.");
    if (!form.cuenta_bancaria_id) return setError("La cuenta bancaria es obligatoria.");
    if (modo === "suplemento") {
      if (!supEfecto) return setError("Indica la fecha de efecto del suplemento.");
      if (!supMotivo.trim()) return setError("Indica el motivo del suplemento.");
    }

    setSaving(true);
    setError(null);
    // Solo se envían los grupos usados, reindexados a 0..N-1 (se descartan grupos sin secciones).
    const remap = new Map<number, number>();
    gruposUsados.forEach((g, i) => remap.set(g, i));
    const limitesPayload = gruposUsados.map((g) => ({
      limite_primas: num(form.limites[g].limite_primas),
      notificacion: num(form.limites[g].notificacion),
      fecha_notificacion: form.limites[g].fecha_notificacion || null,
    }));
    const payload: BinderWrite = {
      agreement_number: form.agreement_number.trim(),
      umr: umrDe(form.agreement_number) || null,
      productor_id: Number(form.productor_id),
      fecha_efecto: form.fecha_efecto || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      yoa: form.yoa.trim() || null,
      estado: form.estado || null,
      moneda: form.moneda || null,
      profit_commission: form.profit_commission,
      pc_porcentaje: form.profit_commission ? num(form.pc_porcentaje) : null,
      pc_gastos: form.profit_commission ? num(form.pc_gastos) : null,
      risk_bdx_intervalo: form.risk_bdx_intervalo || null,
      risk_bdx_plazo: num(form.risk_bdx_plazo),
      premium_bdx_intervalo: form.premium_bdx_intervalo || null,
      premium_bdx_plazo: num(form.premium_bdx_plazo),
      claims_bdx_intervalo: form.claims_bdx_intervalo || null,
      claims_bdx_plazo: num(form.claims_bdx_plazo),
      comision_mayrit: num(form.comision_mayrit),
      cuenta_bancaria_id: form.cuenta_bancaria_id ? Number(form.cuenta_bancaria_id) : null,
      notas: form.notas.trim() || null,
      limites: limitesPayload,
      secciones: form.secciones.map((s) => ({
        ramo: s.ramo.trim() || null,
        risk_codes: s.risk_codes.map((rc) => ({ codigo: rc.codigo, comision_mayrit: num(rc.comision_mayrit) })),
        limite_grupo: remap.get(s.limite_grupo) ?? 0,
        comision: num(s.comision),
        comision_mayrit: num(s.comision_mayrit),
        sujeto_pc: s.sujeto_pc,
        mercados: s.mercados
          .filter((m) => m.mercado_id)
          .map((m) => ({ mercado_id: Number(m.mercado_id), participacion: num(m.participacion) })),
      })),
    };
    try {
      if (modo === "suplemento" && form.id) {
        await crearSuplemento(form.id, { ...payload, suplemento_fecha_efecto: supEfecto || null, motivo: supMotivo.trim() });
      } else if (form.id) {
        await api.update(form.id, payload);
      } else {
        await api.create(payload);
      }
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function abrirHistorial(b: Binder) {
    setError(null);
    try {
      const sup = await listarSuplementos(b.id);
      setHistBinder(b);
      setHistorial(sup);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function borrarActual() {
    if (!form?.id) return;
    if (!confirm(`¿Borrar el binder "${form.umr || form.agreement_number}"?`)) return;
    try {
      await api.remove(form.id);
      cerrar();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Desde dentro del binder (vista de edición): pasar a "Nuevo suplemento" reutilizando los valores actuales.
  async function pasarASuplemento() {
    setModo("suplemento");
    setSupEfecto("");
    setSupMotivo("");
    setSupNumero(null);
    // El número del nuevo suplemento = mayor número existente + 1 (las versiones incluyen el 0 = alta).
    if (form?.id) {
      try {
        const sup = await listarSuplementos(form.id);
        const max = sup.reduce((m, s) => Math.max(m, s.numero), -1);
        setSupNumero(max + 1);
      } catch {
        /* si falla, la cabecera muestra solo el UMR */
      }
    }
  }
  // Abrir el historial del binder que se está viendo.
  function historialDesdeForm() {
    const b = items.find((x) => x.id === form?.id);
    if (b) abrirHistorial(b);
  }
  // Renovar: nuevo binder con los datos del actual + 1 año en las fechas/YOA; Agreement Number en blanco.
  function renovar() {
    if (!form) return;
    const masUnAnio = (iso: string) => {
      if (!iso) return "";
      const [y, m, d] = iso.slice(0, 10).split("-");
      return y && m && d ? `${Number(y) + 1}-${m}-${d}` : "";
    };
    const nuevoYoa = /^\d+$/.test(form.yoa.trim()) ? String(Number(form.yoa.trim()) + 1) : "";
    setModo("edicion");
    setCorrigiendo(false);
    setSupEfecto("");
    setSupMotivo("");
    abrir(
      JSON.parse(
        JSON.stringify({
          ...form,
          id: undefined,
          agreement_number: "",
          umr: "",
          estado: "En Vigor",
          fecha_efecto: masUnAnio(form.fecha_efecto),
          fecha_vencimiento: masUnAnio(form.fecha_vencimiento),
          yoa: nuevoYoa,
          // Binder nuevo: el consumo arranca de cero, sin fechas de notificación heredadas.
          limites: form.limites.map((l) => ({
            ...l,
            fecha_notificacion: "",
            estado: null,
            consumo_pct: null,
          })),
        })
      )
    );
  }

  // Mercado con mayor participación del binder (entre todas las secciones) → su Código (IdMercado).
  function mercadoPrincipal(b: Binder): string {
    let best: { id: number; part: number } | null = null;
    for (const s of b.secciones)
      for (const m of s.mercados) {
        const p = m.participacion ?? 0;
        if (!best || p > best.part) best = { id: m.mercado_id, part: p };
      }
    if (!best) return "—";
    const mc = mercados.find((x) => x.id === best!.id);
    return mc?.alias || mc?.nombre || "—";
  }

  // Opciones de los desplegables (de lo ya cargado) y lista visible: filtrada + ordenada por YOA ↓.
  const coverDe = (b: Binder) => b.coverholder_alias ?? b.coverholder_nombre ?? "";
  const yoasOpts = [...new Set(items.map((b) => b.yoa).filter(Boolean) as string[])].sort(
    (a, b) => Number(b) - Number(a)
  );
  const coverOpts = [...new Set(items.map(coverDe).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibles = items
    .filter((b) => !fYoa || b.yoa === fYoa)
    .filter((b) => !fCover || coverDe(b) === fCover)
    .filter((b) => !fEstado || b.estado === fEstado)
    .slice()
    .sort((a, b) => (Number(b.yoa) || 0) - (Number(a.yoa) || 0));

  // Campo "Notificado (fecha)" de un grupo de límite. Si el límite está en rojo (umbral de
  // notificación superado) y aún no tiene fecha, se DESTACA: es el que hay que rellenar.
  function campoNotificado(gi: number) {
    if (!form) return null;
    const g = form.limites[gi];
    if (!g) return null;
    const pendiente = g.estado === "rojo" && !g.fecha_notificacion;
    return (
      <div className={`field${pendiente ? " notif-pend" : ""}`}>
        <label>
          Notificado (fecha)
          {pendiente && <span className="notif-pend-badge">⚠ a notificar</span>}
        </label>
        <input
          type="date"
          className="inp-fecha"
          value={g.fecha_notificacion ?? ""}
          onChange={(e) => setGrupoCampo(gi, "fecha_notificacion", e.target.value)}
        />
        {g.consumo_pct != null && (
          <span className="hint">Consumo {fmtMiles(g.consumo_pct)} %{pendiente ? " — supera el umbral" : ""}</span>
        )}
      </div>
    );
  }

  if (detalle) {
    return (
      <BinderDetalle
        binder={detalle}
        onBack={() => {
          setDetalle(null);
          cargar();
        }}
      />
    );
  }

  return (
    <div className="container">
      <PageHeader emoji="📑" title="Binders" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por UMR o Agreement Number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar()}
        />
        <select className="filtro" value={fYoa} onChange={(e) => setFYoa(e.target.value)} title="Filtrar por YOA">
          <option value="">YOA: todos</option>
          {yoasOpts.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          className="filtro"
          value={fCover}
          onChange={(e) => setFCover(e.target.value)}
          title="Filtrar por Coverholder"
        >
          <option value="">Coverholder: todos</option>
          {coverOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="filtro"
          value={fEstado}
          onChange={(e) => setFEstado(e.target.value)}
          title="Filtrar por Estado"
        >
          <option value="">Estado: todos</option>
          {ESTADOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={abrirNuevo}>
          + Nuevo binder
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty">No hay binders. Crea el primero con «+ Nuevo binder».</div>
      ) : visibles.length === 0 ? (
        <div className="empty">Ningún binder coincide con los filtros.</div>
      ) : (
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>UMR</th>
                <th>YOA</th>
                <th>Coverholder</th>
                <th>Mercado</th>
                <th>Estado</th>
                <th>Ramo</th>
                <th>Efecto</th>
                <th>Vencimiento</th>
                <th className="num">GWP</th>
                <th className="num">Notificación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((b) => (
                <tr key={b.id} className={claseEstado(b.estado)}>
                  <td>{b.umr ?? "—"}</td>
                  <td>{b.yoa ?? "—"}</td>
                  <td>{b.coverholder_alias ?? b.coverholder_nombre ?? "—"}</td>
                  <td>{mercadoPrincipal(b)}</td>
                  <td>{b.estado ?? "—"}</td>
                  <td>{ramosDe(b)}</td>
                  <td>{fechaCorta(b.fecha_efecto)}</td>
                  <td>{fechaCorta(b.fecha_vencimiento)}</td>
                  <td className="num">{eur(b.gwp_our_line)}</td>
                  <td className="num"><NotifCelda b={b} /></td>
                  <td className="acciones">
                    <button className="btn-link" onClick={() => setDetalle(b)}>
                      Abrir
                    </button>
                    <button className="btn-link" onClick={() => abrirEdicion(b)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <FormPanel
          title={
            modo === "suplemento"
              ? `Nuevo suplemento · ${form.umr || form.agreement_number}${
                  supNumero != null ? "-" + String(supNumero).padStart(2, "0") : ""
                }`
              : corrigiendo
              ? `Corregir Binder · ${form.umr || form.agreement_number}`
              : form.id
              ? `Editar Binder · ${form.umr || form.agreement_number}`
              : "Nuevo Binder"
          }
          dirty={dirty}
          saving={saving}
          error={error}
          saveLabel={modo === "suplemento" ? "Crear suplemento" : corrigiendo ? "Guardar corrección" : "Guardar"}
          onSave={guardar}
          onClose={cerrar}
          onDelete={soloEstado || corrigiendo ? borrarActual : undefined}
        >
          {soloEstado && (
            <>
              <div className="field">
                <label>Estado</label>
                <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                  {ESTADOS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="binder-botones">
                <button
                  className="btn-secondary btn-sm"
                  onClick={pasarASuplemento}
                  disabled={(form.estado ?? "").startsWith("Cerrado")}
                  title={
                    (form.estado ?? "").startsWith("Cerrado")
                      ? "Binder cerrado: no se pueden emitir suplementos"
                      : undefined
                  }
                >
                  + Suplemento
                </button>
                <button className="btn-secondary btn-sm" onClick={historialDesdeForm}>
                  Historial
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setCorrigiendo(true)}
                  disabled={(form.estado ?? "").startsWith("Cerrado")}
                  title={
                    (form.estado ?? "").startsWith("Cerrado")
                      ? "Binder cerrado: no se puede corregir"
                      : undefined
                  }
                >
                  Corregir
                </button>
                <button className="btn-secondary btn-sm" onClick={renovar}>
                  🔄 Renovar
                </button>
              </div>
              <div className="hint" style={{ margin: "2px 0 12px" }}>
                El binder es un documento fijo: aquí solo se cambia el Estado. Para un cambio real de
                términos usa «+ Suplemento»; «Corregir» es solo para errores de grabación.
                {(form.estado ?? "").startsWith("Cerrado") &&
                  " En un binder cerrado no se pueden emitir suplementos ni corregir."}
              </div>
            </>
          )}

          {corrigiendo && (
            <div className="aviso-correccion">
              ⚠ Estás <strong>corrigiendo un error de grabación</strong>. Esto NO crea un suplemento:
              cambia la versión vigente. Para un cambio real de términos, cierra y usa «+ Suplemento».
            </div>
          )}

          <fieldset
            disabled={soloEstado}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
          {modo === "suplemento" && (
            <div className="sup-cabecera">
              <div className="hint" style={{ marginBottom: 10 }}>
                Modifica abajo lo que cambie este suplemento. La fecha de efecto puede ser retroactiva.
              </div>
              <div className="field">
                <label>
                  Fecha de efecto <span className="required">*</span>
                </label>
                <input
                  type="date"
                  className="inp-fecha"
                  value={supEfecto}
                  onChange={(e) => setSupEfecto(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  Motivo <span className="required">*</span>
                </label>
                <textarea rows={4} value={supMotivo} onChange={(e) => setSupMotivo(e.target.value)} />
              </div>
            </div>
          )}

          {/* En un suplemento, Agreement Number y UMR no se editan y ya van en la cabecera. */}
          {modo !== "suplemento" && (
            <>
              <div className="field">
                <label>
                  Agreement Number <span className="required">*</span>
                </label>
                <input
                  type="text"
                  value={form.agreement_number}
                  autoFocus
                  style={{ textTransform: "uppercase" }}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    setForm({ ...form, agreement_number: v, umr: umrDe(v) });
                  }}
                />
              </div>

              <div className="field">
                <label>UMR</label>
                <input type="text" value={form.umr} readOnly placeholder="Se genera con el Agreement Number" />
              </div>
            </>
          )}

          <div className="field">
            <label>
              Coverholder <span className="required">*</span>
            </label>
            <select value={form.productor_id} onChange={(e) => setForm({ ...form, productor_id: e.target.value })}>
              <option value="">— Elige agencia —</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Vigencia: efecto · YOA · vencimiento (vencimiento = efecto + 365, editable) */}
          <div className="field">
            <label>
              Vigencia <span className="required">*</span>
            </label>
            <div className="vigencia">
              <div className="vig-fechas">
                <div className="vig-campo">
                  <span className="sub">Efecto</span>
                  <input
                    type="date"
                    className="inp-fecha"
                    value={form.fecha_efecto}
                    onChange={(e) => {
                      const ef = e.target.value;
                      setForm({
                        ...form,
                        fecha_efecto: ef,
                        fecha_vencimiento: ef ? vencimientoDe(ef) : form.fecha_vencimiento,
                        yoa: ef ? yoaDe(ef) : form.yoa,
                      });
                    }}
                  />
                </div>
                <div className="vig-campo">
                  <span className="sub">Vencimiento</span>
                  <input
                    type="date"
                    className="inp-fecha"
                    value={form.fecha_vencimiento}
                    onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                  />
                </div>
              </div>
              <div className="vig-campo">
                <span className="sub">YOA</span>
                <input
                  type="text"
                  className="inp-yoa"
                  value={form.yoa}
                  onChange={(e) => setForm({ ...form, yoa: e.target.value })}
                />
              </div>
            </div>
          </div>

          {!soloEstado && (
            <div className="field">
              <label>Estado{modo === "suplemento" && <span className="hint"> · no se cambia en un suplemento</span>}</label>
              <select
                value={form.estado}
                disabled
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
              >
                {ESTADOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Secciones */}
          <h3 style={{ marginBottom: 8 }}>Secciones</h3>
          {form.secciones.map((s, i) => (
            <div className="seccion" key={i}>
              <div className="seccion-head">
                <strong>Sección {i + 1}</strong>
                {form.secciones.length > 1 && (
                  <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeSeccion(i)}>
                    Quitar sección
                  </button>
                )}
              </div>
              <div className="field">
                <label>
                  Ramo <span className="required">*</span>
                </label>
                <select
                  value={s.ramo}
                  onChange={(e) => (e.target.value === "__nuevo__" ? nuevoRamo(i) : setRamo(i, e.target.value))}
                >
                  <option value="">— Elige ramo —</option>
                  {[...new Set([...(s.ramo ? [s.ramo] : []), ...ramos.map((r) => r.nombre)])].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="__nuevo__">➕ Añadir ramo…</option>
                </select>
              </div>
              {(() => {
                const codes = ramos.find((r) => r.nombre === s.ramo)?.risk_codes ?? [];
                return (
                  <div className="field">
                    <label>Risk Codes</label>
                    {!s.ramo ? (
                      <span className="hint">Elige antes el ramo</span>
                    ) : codes.length === 0 ? (
                      <span className="hint">(ese ramo no tiene risk codes)</span>
                    ) : (
                      <div className="rc-checks">
                        {codes.map((c) => {
                          const rc = s.risk_codes.find((x) => x.codigo === c.codigo);
                          return (
                            <div key={c.codigo} className="rc-row">
                              <label className="rc-check">
                                <input type="checkbox" checked={!!rc} onChange={() => toggleRiskCode(i, c.codigo)} />
                                {c.descripcion ? `${c.codigo} — ${c.descripcion}` : c.codigo}
                              </label>
                              {rc && (
                                <NumberInput
                                  value={rc.comision_mayrit}
                                  onChange={(v) => setRiskCodeComision(i, c.codigo, v)}
                                  suffix="%"
                                  thousands={false}
                                  placeholder="Com. Mayrit"
                                  className="rc-com"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="field-row">
                <div className="field">
                  <label>Comisión</label>
                  <NumberInput
                    value={s.comision}
                    onChange={(v) => setSeccionCampo(i, "comision", v)}
                    suffix="%"
                    thousands={false}
                  />
                </div>
                <div className="field">
                  <label>Comisión Mayrit</label>
                  <NumberInput
                    value={s.comision_mayrit}
                    onChange={(v) => setSeccionCampo(i, "comision_mayrit", v)}
                    suffix="%"
                    thousands={false}
                    placeholder="(binder)"
                  />
                </div>
                <label className="field check pc-check">
                  <input
                    type="checkbox"
                    checked={s.sujeto_pc}
                    onChange={(e) => setSeccionFlag(i, "sujeto_pc", e.target.checked)}
                  />
                  Sujeto a PC?
                </label>
              </div>

              <label className="mini-label">Mercados y participación</label>
              {s.mercados.map((m, j) => {
                // Excluir del desplegable los mercados ya elegidos en OTRAS líneas de esta sección.
                const usados = new Set(
                  s.mercados.filter((_, k) => k !== j).map((x) => x.mercado_id).filter(Boolean)
                );
                return (
                <div className="linea-mercado" key={j}>
                  <select value={m.mercado_id} onChange={(e) => setLinea(i, j, "mercado_id", e.target.value)}>
                    <option value="">— Mercado —</option>
                    {mercados
                      .filter((mc) => !usados.has(String(mc.id)) || String(mc.id) === m.mercado_id)
                      .map((mc) => (
                        <option key={mc.id} value={mc.id}>
                          {mc.nombre}
                        </option>
                      ))}
                  </select>
                  <NumberInput
                    className="part-num"
                    value={m.participacion}
                    onChange={(v) => setLinea(i, j, "participacion", v)}
                    suffix="%"
                    thousands={false}
                  />
                  {s.mercados.length > 1 && (
                    <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeMercado(i, j)}>
                      ✕
                    </button>
                  )}
                </div>
                );
              })}
              <button className="btn-secondary btn-sm" onClick={() => addMercado(i)}>
                + Añadir mercado
              </button>
              {(() => {
                const suma = s.mercados.reduce((a, m) => a + (num(m.participacion) ?? 0), 0);
                const ok = Math.abs(suma - 100) < 0.005;
                return (
                  <div className={ok ? "part-total ok" : "part-total"}>
                    Total participación: {pct(suma)}
                    {!ok && " (debe sumar 100 %)"}
                  </div>
                );
              })()}
            </div>
          ))}
          <button className="btn-secondary" onClick={addSeccion}>
            + Añadir sección
          </button>

          {/* ── Límite de Primas: genérico / por sección / por grupos de secciones ── */}
          <h3 style={{ marginTop: 22, marginBottom: 8 }}>Límite de Primas</h3>
          <div className="field">
            <label>Ámbito</label>
            <OptionButtons
              value={AMBITO_LABEL[form.limite_ambito]}
              options={[AMBITO_LABEL.binder, AMBITO_LABEL.seccion, AMBITO_LABEL.grupos]}
              onChange={setAmbito}
            />
          </div>

          {form.limite_ambito === "binder" && (
            <div className="field-row">
              <div className="field">
                <label>
                  Límite de primas <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.limites[0]?.limite_primas ?? ""}
                  onChange={(v) => setGrupoCampo(0, "limite_primas", v)}
                />
              </div>
              <div className="field">
                <label>
                  Notificación <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.limites[0]?.notificacion ?? ""}
                  onChange={(v) => setGrupoCampo(0, "notificacion", v)}
                  suffix="%"
                  thousands={false}
                />
              </div>
              {campoNotificado(0)}
            </div>
          )}

          {form.limite_ambito === "seccion" &&
            form.secciones.map((s, i) => (
              <div className="field-row" key={i}>
                <div className="field">
                  <label>
                    Sección {i + 1}
                    {s.ramo ? ` · ${s.ramo}` : ""} — Límite <span className="required">*</span>
                  </label>
                  <NumberInput
                    value={form.limites[s.limite_grupo]?.limite_primas ?? ""}
                    onChange={(v) => setGrupoCampo(s.limite_grupo, "limite_primas", v)}
                  />
                </div>
                <div className="field">
                  <label>
                    Notificación <span className="required">*</span>
                  </label>
                  <NumberInput
                    value={form.limites[s.limite_grupo]?.notificacion ?? ""}
                    onChange={(v) => setGrupoCampo(s.limite_grupo, "notificacion", v)}
                    suffix="%"
                    thousands={false}
                  />
                </div>
                {campoNotificado(s.limite_grupo)}
              </div>
            ))}

          {form.limite_ambito === "grupos" && (
            <>
              {form.limites.map((g, gi) => (
                <div className="seccion" key={gi}>
                  <div className="seccion-head">
                    <strong>Grupo {gi + 1}</strong>
                    {form.limites.length > 1 && (
                      <button className="btn-link" style={{ color: "var(--rojo)" }} onClick={() => removeGrupo(gi)}>
                        Quitar grupo
                      </button>
                    )}
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>
                        Límite de primas <span className="required">*</span>
                      </label>
                      <NumberInput value={g.limite_primas} onChange={(v) => setGrupoCampo(gi, "limite_primas", v)} />
                    </div>
                    <div className="field">
                      <label>
                        Notificación <span className="required">*</span>
                      </label>
                      <NumberInput
                        value={g.notificacion}
                        onChange={(v) => setGrupoCampo(gi, "notificacion", v)}
                        suffix="%"
                        thousands={false}
                      />
                    </div>
                    {campoNotificado(gi)}
                  </div>
                  <label className="mini-label">Secciones de este grupo</label>
                  <div className="rc-checks">
                    {form.secciones.map((s, i) => (
                      <label key={i} className="rc-check">
                        <input
                          type="checkbox"
                          checked={s.limite_grupo === gi}
                          disabled={s.limite_grupo === gi}
                          onChange={() => asignarSeccionAGrupo(i, gi)}
                        />
                        Sección {i + 1}
                        {s.ramo ? ` · ${s.ramo}` : ""}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn-secondary btn-sm" onClick={addGrupo}>
                + Añadir grupo de límite
              </button>
              <div className="hint" style={{ marginTop: 6 }}>
                Cada sección pertenece a un único grupo. Para mover una sección, márcala en otro grupo.
              </div>
            </>
          )}

          {/* ── Datos comunes del binder (no por sección) ── */}
          <h3 style={{ marginTop: 22, marginBottom: 8 }}>Datos del binder</h3>

          <label className="field check">
            <input
              type="checkbox"
              checked={form.profit_commission}
              disabled={!algunaPC}
              onChange={(e) => setForm({ ...form, profit_commission: e.target.checked })}
            />
            Profit Commission
          </label>
          {!algunaPC && <span className="hint">Para activarlo, alguna sección debe tener «Sujeto a PC?».</span>}
          {form.profit_commission && (
            <div className="field-row">
              <div className="field">
                <label>
                  PC <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.pc_porcentaje}
                  onChange={(v) => setForm({ ...form, pc_porcentaje: v })}
                  suffix="%"
                  thousands={false}
                />
              </div>
              <div className="field">
                <label>
                  Gastos <span className="required">*</span>
                </label>
                <NumberInput
                  value={form.pc_gastos}
                  onChange={(v) => setForm({ ...form, pc_gastos: v })}
                  suffix="%"
                  thousands={false}
                />
              </div>
            </div>
          )}

          {(
            [
              ["Risk Bdx", "risk_bdx_intervalo", "risk_bdx_plazo"],
              ["Premium Bdx", "premium_bdx_intervalo", "premium_bdx_plazo"],
              ["Claims Bdx", "claims_bdx_intervalo", "claims_bdx_plazo"],
            ] as const
          ).map(([label, ik, pk]) => (
            <div className="field-row" key={ik}>
              <div className="field">
                <label>
                  {label} — Intervalo <span className="required">*</span>
                </label>
                <select value={form[ik]} onChange={(e) => setForm({ ...form, [ik]: e.target.value })}>
                  <option value="">— Intervalo —</option>
                  {INTERVALOS.map((iv) => (
                    <option key={iv} value={iv}>
                      {iv}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Plazo (días) <span className="required">*</span>
                </label>
                <NumberInput
                  value={form[pk]}
                  onChange={(v) => setForm({ ...form, [pk]: v })}
                  decimals={0}
                  thousands={false}
                />
              </div>
            </div>
          ))}

          <div className="field-row">
            <div className="field">
              <label>
                Comisión Mayrit <span className="required">*</span>
              </label>
              <NumberInput
                value={form.comision_mayrit}
                onChange={(v) => setForm({ ...form, comision_mayrit: v })}
                suffix="%"
                thousands={false}
              />
            </div>
            <div className="field" />
          </div>

          <div className="field">
            <label>
              Cuenta bancaria <span className="required">*</span>
            </label>
            <select
              value={form.cuenta_bancaria_id}
              onChange={(e) => setForm({ ...form, cuenta_bancaria_id: e.target.value })}
            >
              <option value="">— Elige cuenta —</option>
              {cuentas
                // Solo cuentas de Primas y activas; pero si el binder ya tenía otra, se mantiene.
                .filter(
                  (c) =>
                    (c.activa && c.categoria === "Primas") ||
                    String(c.id) === form.cuenta_bancaria_id
                )
                .map((c) => {
                  const noValida = !(c.activa && c.categoria === "Primas");
                  return (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {noValida ? " (no válida)" : ""}
                    </option>
                  );
                })}
            </select>
            {cuentas.filter((c) => c.activa && c.categoria === "Primas").length === 0 && (
              <span className="hint">
                No hay cuentas de Primas activas. Créalas en Configuración → Cuentas Bancarias.
              </span>
            )}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Notas</label>
            <textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
          </fieldset>
        </FormPanel>
      )}

      {historial && (
        <div className="overlay">
          <div className="panel" role="dialog" aria-modal="true" aria-label="Historial de suplementos">
            <div className="panel-head">
              <h2>Historial · {histBinder?.umr ?? histBinder?.agreement_number}</h2>
              <button className="panel-close" onClick={() => setHistorial(null)} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="panel-body">
              {historial.length === 0 ? (
                <div className="empty">Sin versiones.</div>
              ) : (
                [...historial]
                  .sort((a, b) => b.numero - a.numero)
                  .map((s) => (
                    <div
                      className="sup-item fila-click"
                      key={s.numero}
                      onClick={() => setSupVer(s)}
                      title="Ver este suplemento (solo lectura)"
                    >
                      <div className="sup-item-head">
                        <strong>{s.numero === 0 ? "Alta inicial (v0)" : `Suplemento ${s.numero}`}</strong>
                        <span className="sub">{fechaCorta(s.fecha_efecto)}</span>
                      </div>
                      {s.motivo && <div className="hint">{s.motivo}</div>}
                    </div>
                  ))
              )}
            </div>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={() => setHistorial(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vista de un suplemento concreto (solo lectura) */}
      {supVer && (
        <div className="overlay">
          <div className="panel" role="dialog" aria-modal="true" aria-label="Suplemento (solo lectura)">
            <div className="panel-head">
              <h2>
                {supVer.numero === 0 ? "Alta inicial (v0)" : `Suplemento ${supVer.numero}`}
                {" · "}
                {histBinder?.umr ?? histBinder?.agreement_number}
              </h2>
              <button className="panel-close" onClick={() => setSupVer(null)} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="panel-body">
              {(() => {
                const t = supVer.snapshot as unknown as SnapView;
                const coverName = (id: number | null | undefined) => agencias.find((a) => a.id === id)?.nombre ?? "—";
                const cuentaName = (id: number | null | undefined) => cuentas.find((c) => c.id === id)?.nombre ?? "—";
                const nombreMercado = (mid: number) => mercados.find((m) => m.id === mid)?.nombre ?? `#${mid}`;

                // Caja con la fecha del suplemento + comentarios (siempre arriba).
                const cabecera = (
                  <>
                    <div className="seccion">
                      <Campo label="Fecha de efecto" valor={fechaCorta(supVer.fecha_efecto)} />
                    </div>
                    {supVer.motivo && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>Comentarios</label>
                        <div className="dato-valor">{supVer.motivo}</div>
                      </div>
                    )}
                  </>
                );

                // Versión anterior (para comparar). El alta inicial (v0) no tiene previa.
                const prev =
                  supVer.numero > 0 && historial
                    ? historial.find((s) => s.numero === supVer.numero - 1)
                    : null;
                const a = prev ? (prev.snapshot as unknown as SnapView) : null;

                // Sin versión anterior (alta inicial): se muestran todos los términos.
                if (!a) {
                  return (
                    <>
                      {cabecera}
                      <div className="datos-grid" style={{ marginTop: 16 }}>
                        <Campo label="Coverholder" valor={coverName(t.productor_id)} />
                        <Campo label="Estado" valor={t.estado ?? "—"} />
                        <Campo label="Efecto" valor={fechaCorta(t.fecha_efecto ?? null)} />
                        <Campo label="Vencimiento" valor={fechaCorta(t.fecha_vencimiento ?? null)} />
                        <Campo label="YOA" valor={t.yoa ?? "—"} />
                        <Campo label="Moneda" valor={t.moneda ?? "—"} />
                      </div>
                      <h3 style={{ marginTop: 16, marginBottom: 8 }}>Secciones</h3>
                      <SeccionesRO secciones={t.secciones ?? []} nombreMercado={nombreMercado} />
                      <h3 style={{ marginTop: 16, marginBottom: 8 }}>Límite de Primas</h3>
                      <LimitesRO limites={t.limites ?? []} secciones={t.secciones ?? []} />
                      <h3 style={{ marginTop: 16, marginBottom: 8 }}>Datos del binder</h3>
                      <DatosBinderRO t={t} cuenta={cuentaName(t.cuenta_bancaria_id)} />
                    </>
                  );
                }

                // Diferencias respecto a la versión anterior.
                const dif = difTerminos(a, t, coverName, cuentaName);
                const stripSec = (secs?: SnapSeccionView[]) =>
                  (secs ?? []).map((s) => ({
                    ramo: s.ramo,
                    risk_codes: s.risk_codes,
                    comision: s.comision,
                    comision_mayrit: s.comision_mayrit,
                    sujeto_pc: s.sujeto_pc,
                    mercados: s.mercados,
                  }));
                const seccionesCambiaron =
                  JSON.stringify(stripSec(a.secciones)) !== JSON.stringify(stripSec(t.secciones));
                const grupos = (secs?: SnapSeccionView[]) => (secs ?? []).map((s) => s.limite_grupo ?? 0);
                const limiteCambio =
                  JSON.stringify(a.limites) !== JSON.stringify(t.limites) ||
                  JSON.stringify(grupos(a.secciones)) !== JSON.stringify(grupos(t.secciones));

                // Sin ningún cambio: solo fecha + comentarios.
                if (dif.length === 0 && !seccionesCambiaron && !limiteCambio) {
                  return (
                    <>
                      {cabecera}
                      <div className="hint" style={{ marginTop: 12 }}>
                        Este suplemento no introduce cambios respecto a la versión anterior.
                      </div>
                    </>
                  );
                }

                // Con cambios: solo lo que cambia.
                return (
                  <>
                    {cabecera}
                    <h3 style={{ marginTop: 16, marginBottom: 8 }}>Cambios de este suplemento</h3>
                    {dif.length > 0 && (
                      <div className="datos-grid">
                        {dif.map((c) => (
                          <Campo key={c.label} label={c.label} valor={`${c.antes} → ${c.ahora}`} />
                        ))}
                      </div>
                    )}
                    {seccionesCambiaron && (
                      <>
                        <h3 style={{ marginTop: 16, marginBottom: 8 }}>Secciones</h3>
                        <SeccionesRO secciones={t.secciones ?? []} nombreMercado={nombreMercado} />
                      </>
                    )}
                    {limiteCambio && (
                      <>
                        <h3 style={{ marginTop: 16, marginBottom: 8 }}>Límite de Primas</h3>
                        <LimitesRO limites={t.limites ?? []} secciones={t.secciones ?? []} />
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={() => setSupVer(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Etiqueta + valor en solo lectura (reutiliza las clases .dato de la ficha del binder).
function Campo({ label, valor }: { label: string; valor: string | number | null | undefined }) {
  return (
    <div className="dato">
      <span className="dato-label">{label}</span>
      <span className="dato-valor">{valor == null || valor === "" ? "—" : String(valor)}</span>
    </div>
  );
}

// Secciones de un snapshot en solo lectura.
function SeccionesRO({
  secciones,
  nombreMercado,
}: {
  secciones: SnapSeccionView[];
  nombreMercado: (mid: number) => string;
}) {
  return (
    <>
      {secciones.map((s, i) => (
        <div className="seccion" key={i}>
          <div className="seccion-head">
            <strong>Sección {i + 1}</strong>
            <span className="sub">{s.ramo ?? "—"}</span>
          </div>
          <Campo
            label="Risk Codes"
            valor={
              (s.risk_codes ?? [])
                .map((rc) => {
                  if (typeof rc === "string") return rc;
                  return rc.comision_mayrit != null ? `${rc.codigo} (${pct(rc.comision_mayrit)})` : rc.codigo;
                })
                .join(", ") || "—"
            }
          />
          <Campo label="Comisión" valor={s.comision != null ? pct(s.comision) : "—"} />
          <Campo label="Comisión Mayrit" valor={s.comision_mayrit != null ? pct(s.comision_mayrit) : "(del binder)"} />
          <Campo label="Sujeto a PC" valor={s.sujeto_pc ? "Sí" : "No"} />
          <label className="mini-label">Mercados</label>
          {(s.mercados ?? []).map((m, j) => (
            <div key={j} className="hint">
              {nombreMercado(m.mercado_id)} — {m.participacion != null ? pct(m.participacion) : "—"}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// Grupos de Límite de Primas de un snapshot en solo lectura.
function LimitesRO({
  limites,
  secciones,
}: {
  limites: { limite_primas: number | null; notificacion: number | null }[];
  secciones: SnapSeccionView[];
}) {
  if (limites.length === 0) return <div className="hint">—</div>;
  return (
    <>
      {limites.map((g, gi) => {
        const secs = secciones
          .map((s, i) => ({ lg: s.limite_grupo ?? 0, i }))
          .filter((s) => s.lg === gi)
          .map((s) => `Sección ${s.i + 1}`);
        return (
          <div className="seccion" key={gi}>
            <div className="seccion-head">
              <strong>Grupo {gi + 1}</strong>
            </div>
            <Campo label="Límite de primas" valor={eur(g.limite_primas)} />
            <Campo label="Notificación" valor={g.notificacion != null ? pct(g.notificacion) : "—"} />
            <Campo label="Secciones" valor={secs.join(", ") || "—"} />
          </div>
        );
      })}
    </>
  );
}

// Datos comunes del binder de un snapshot en solo lectura.
function DatosBinderRO({ t, cuenta }: { t: SnapView; cuenta: string }) {
  return (
    <>
      <div className="datos-grid">
        <Campo label="Profit Commission" valor={t.profit_commission ? "Sí" : "No"} />
        {t.profit_commission && <Campo label="PC %" valor={t.pc_porcentaje != null ? pct(t.pc_porcentaje) : "—"} />}
        {t.profit_commission && <Campo label="Gastos %" valor={t.pc_gastos != null ? pct(t.pc_gastos) : "—"} />}
        <Campo
          label="Risk Bdx"
          valor={`${t.risk_bdx_intervalo ?? "—"}${t.risk_bdx_plazo != null ? ` · ${t.risk_bdx_plazo} días` : ""}`}
        />
        <Campo
          label="Premium Bdx"
          valor={`${t.premium_bdx_intervalo ?? "—"}${t.premium_bdx_plazo != null ? ` · ${t.premium_bdx_plazo} días` : ""}`}
        />
        <Campo
          label="Claims Bdx"
          valor={`${t.claims_bdx_intervalo ?? "—"}${t.claims_bdx_plazo != null ? ` · ${t.claims_bdx_plazo} días` : ""}`}
        />
        <Campo label="Comisión Mayrit" valor={t.comision_mayrit != null ? pct(t.comision_mayrit) : "—"} />
        <Campo label="Cuenta bancaria" valor={cuenta} />
      </div>
      {t.notas && (
        <div style={{ marginTop: 12 }}>
          <Campo label="Notas" valor={t.notas} />
        </div>
      )}
    </>
  );
}

// Diferencias de los términos escalares entre dos snapshots (antes → ahora).
function difTerminos(
  a: SnapView,
  b: SnapView,
  coverName: (id: number | null | undefined) => string,
  cuentaName: (id: number | null | undefined) => string
): { label: string; antes: string; ahora: string }[] {
  const out: { label: string; antes: string; ahora: string }[] = [];
  const txt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const pctf = (v: number | null | undefined) => (v == null ? "—" : pct(v));
  const boolf = (v: unknown) => (v ? "Sí" : "No");
  const fechaf = (v: string | null | undefined) => fechaCorta(v ?? null);
  const push = (label: string, va: unknown, vb: unknown, fmt: (x: any) => string) => {
    if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) out.push({ label, antes: fmt(va), ahora: fmt(vb) });
  };
  push("Coverholder", a.productor_id, b.productor_id, (v) => coverName(v));
  push("Efecto", a.fecha_efecto, b.fecha_efecto, fechaf);
  push("Vencimiento", a.fecha_vencimiento, b.fecha_vencimiento, fechaf);
  push("Estado", a.estado, b.estado, txt);
  push("Moneda", a.moneda, b.moneda, txt);
  push("YOA", a.yoa, b.yoa, txt);
  push("Profit Commission", a.profit_commission, b.profit_commission, boolf);
  push("PC %", a.pc_porcentaje, b.pc_porcentaje, pctf);
  push("Gastos %", a.pc_gastos, b.pc_gastos, pctf);
  push("Risk Bdx — intervalo", a.risk_bdx_intervalo, b.risk_bdx_intervalo, txt);
  push("Risk Bdx — plazo (días)", a.risk_bdx_plazo, b.risk_bdx_plazo, txt);
  push("Premium Bdx — intervalo", a.premium_bdx_intervalo, b.premium_bdx_intervalo, txt);
  push("Premium Bdx — plazo (días)", a.premium_bdx_plazo, b.premium_bdx_plazo, txt);
  push("Claims Bdx — intervalo", a.claims_bdx_intervalo, b.claims_bdx_intervalo, txt);
  push("Claims Bdx — plazo (días)", a.claims_bdx_plazo, b.claims_bdx_plazo, txt);
  push("Comisión Mayrit", a.comision_mayrit, b.comision_mayrit, pctf);
  push("Cuenta bancaria", a.cuenta_bancaria_id, b.cuenta_bancaria_id, (v) => cuentaName(v));
  push("Notas", a.notas, b.notas, txt);
  return out;
}
