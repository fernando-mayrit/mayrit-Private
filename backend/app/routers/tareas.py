"""
Tareas recurrentes MANUALES enganchadas a un binder. La recurrencia se ajusta a la VIGENCIA del
binder: arranca en `fecha_inicio` (o la fecha de efecto del binder) y se repite con su frecuencia
hasta el vencimiento del binder. Cada ocurrencia se marca 'Hecha' (registro en `tareas_hechas`).
Saltan como aviso en la campana `aviso_dias_antes` antes de cada ocurrencia.
"""
from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models.maestras import (
    Bdx, BdxLinea, Binder, ClaimsPresentacion, Lpan, Tarea, TareaHecha, TareaPaso, TareaPasoHecho,
)

router = APIRouter(tags=["Tareas"])

# Eager-load para los listados de tareas: evita N+1 (pasos+hechos, hechas, binder→productor/programa).
def _opc_tarea():
    return (
        selectinload(Tarea.pasos).selectinload(TareaPaso.hechos),
        selectinload(Tarea.hechas),
        selectinload(Tarea.binder).selectinload(Binder.productor),
        selectinload(Tarea.binder).selectinload(Binder.programa),
    )

PASO_MESES = {"Mensual": 1, "Trimestral": 3, "Semestral": 6, "Anual": 12}


def _add_months(d: dt.date, n: int) -> dt.date:
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return dt.date(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def _paso(t: Tarea) -> int:
    """Paso en meses de la recurrencia. 0 = Única."""
    if t.frecuencia == "Personalizada":
        return int(t.intervalo_meses or 1)
    return PASO_MESES.get(t.frecuencia, 0)


# Las tareas AUTO (Risk/Premium/Claims) arrancan sus entregas el 01/07/2026 para TODOS los binders (con
# independencia del efecto/YOA) y RUEDAN mes a mes hacia delante: se genera hasta hoy + `_LOOKAHEAD_MESES`
# (las siguientes se ocultan hasta su fecha, vía _debida). No hay entregas anteriores al suelo: no se van a
# cumplir retroactivamente. No se atan a la cobertura del binder (un binder de 2025 en vigor sigue teniendo
# su checklist mensual desde jul-2026). También se filtra el suelo en la agenda global por si acaso.
SUELO_ENTREGAS = dt.date(2026, 7, 1)
_LOOKAHEAD_MESES = 2   # cuántos meses por delante del actual se generan (los futuros salen al llegar su fecha)


def _ocurrencias(t: Tarea, binder: Binder) -> list[dt.date]:
    """Fechas (límite) de las entregas de la tarea.

    - AUTO (Risk/Premium/Claims): mensuales (o su intervalo) DESDE el 01/07/2026 —o su arranque natural
      `efecto+intervalo+plazo` si es POSTERIOR (binders futuros)—, rodando hasta hoy + margen. No se atan a
      la cobertura del binder ni al `fecha_inicio` guardado.
    - Manuales: desde `fecha_inicio` (o efecto) hasta `fecha_fin`/vencimiento (con run-off tras el vto)."""
    paso = _paso(t)
    if t.origen == "auto" and binder and binder.fecha_efecto and paso > 0:
        attr = _CAT_PLAZO.get(t.categoria)
        plazo = int(getattr(binder, attr, 0) or 0) if attr else 0
        natural = _add_months(binder.fecha_efecto, paso) + dt.timedelta(days=plazo)
        inicio = max(SUELO_ENTREGAS, natural)          # nunca antes de jul-2026; respeta binders futuros
        tope = _add_months(dt.date.today(), _LOOKAHEAD_MESES)
        out, k = [], 0
        while k < 600:
            f = _add_months(inicio, k * paso)
            if f > tope:
                break
            out.append(f)
            k += 1
        return out
    # ── Tareas manuales ──
    inicio = t.fecha_inicio or (binder.fecha_efecto if binder else None)
    if not inicio:
        return []
    if paso <= 0:
        return [inicio]
    if t.fecha_fin and t.fecha_fin >= inicio:          # tope explícito por fecha_fin
        out, k = [], 0
        while k < 1200:
            f = _add_months(inicio, k * paso)
            if f > t.fecha_fin:
                break
            out.append(f)
            k += 1
        return out
    ef, venc = (binder.fecha_efecto, binder.fecha_vencimiento) if binder else (None, None)
    if not ef or not venc:
        return [_add_months(inicio, k * paso) for k in range(120)]
    n = 0
    while n < 1200 and _add_months(ef, n * paso) <= venc:
        n += 1
    return [_add_months(inicio, k * paso) for k in range(max(n, 1))]


def _debida(t: Tarea, f: dt.date, hoy: dt.date, hecha: bool) -> bool:
    """Una ocurrencia 'cuenta' si ya está hecha o su aviso ya ha saltado (aviso_dias_antes antes)."""
    return hecha or (f - dt.timedelta(days=int(t.aviso_dias_antes or 0)) <= hoy)


# ── Auto-marcado de pasos: reglas y detección por dato ─────────────────────────────────────────
# Cada regla mira si el DATO de un periodo (YYYY-MM) ya existe en la app, por binder.
REGLAS_AUTO = {"risk", "premium", "lpan", "claims"}   # 'claims' = Claims procesado / Snapshot


def _periodos_datos(db: Session, binder_ids: set[int]) -> dict[str, dict[int, set[str]]]:
    """Por binder, los periodos (YYYY-MM) en los que CADA dato ya está cargado:
    risk (Risk BDX), premium (líneas incluidas en Premium), lpan (LPAN generado), claims (presentado)."""
    out: dict[str, dict[int, set[str]]] = {r: defaultdict(set) for r in REGLAS_AUTO}
    if not binder_ids:
        return out
    # Risk: meses del reporting_period_start de las líneas de Risk BDX.
    for bid, rp in db.execute(
        select(Bdx.binder_id, BdxLinea.reporting_period_start)
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.tipo == "Risk", Bdx.binder_id.in_(binder_ids), BdxLinea.reporting_period_start.is_not(None))
    ).all():
        out["risk"][bid].add(rp.strftime("%Y-%m"))
    # Premium: meses de premium_bdx de las líneas incluidas en Premium.
    for bid, pb in db.execute(
        select(Bdx.binder_id, BdxLinea.premium_bdx)
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id.in_(binder_ids), BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
    ).all():
        out["premium"][bid].add(pb.strftime("%Y-%m"))
    # LPAN: periodos con algún LPAN generado.
    for bid, per in db.execute(
        select(Lpan.binder_id, Lpan.periodo).where(Lpan.binder_id.in_(binder_ids), Lpan.periodo.is_not(None))
    ).all():
        out["lpan"][bid].add(per)
    # Claims/Snapshot: periodos con presentación de Claims.
    for bid, per in db.execute(
        select(ClaimsPresentacion.binder_id, ClaimsPresentacion.periodo)
        .where(ClaimsPresentacion.binder_id.in_(binder_ids), ClaimsPresentacion.periodo.is_not(None))
    ).all():
        out["claims"][bid].add(per)
    return out


# Campo de plazo (días) del binder según la categoría de la tarea auto.
_CAT_PLAZO = {"Risk": "risk_bdx_plazo", "Premium": "premium_bdx_plazo", "Claims": "claims_bdx_plazo"}


def _periodo_de(binder: Binder, t: Tarea, f: dt.date, paso_meses: int) -> str | None:
    """Periodo (YYYY-MM) que comprueba la entrega con fecha límite `f`: el mes de `f` retrocedido
    `intervalo` meses. En julio se carga el Risk de JUNIO (mes anterior), así que la entrega cuyo límite
    cae en julio comprueba junio. El PLAZO NO entra aquí: solo desplaza dónde cae la fecha límite (fin de
    periodo + plazo días, para el aviso), no qué periodo se comprueba —restarlo otra vez retrocedía un mes
    de más (mostraba mayo en julio). Se deriva del MES de la entrega, no del efecto — coherente con el
    arranque rodante desde 01/07/2026."""
    if not binder or not f or paso_meses <= 0:
        return None
    return _add_months(f.replace(day=1), -paso_meses).strftime("%Y-%m")


def _auto_ok(paso: TareaPaso, periodo: str | None, datos: dict, binder_id: int) -> bool:
    """¿El paso (con regla auto) está satisfecho por los datos del periodo?"""
    if not paso.regla_auto or periodo is None:
        return False
    return periodo in datos.get(paso.regla_auto, {}).get(binder_id, set())


# Meses seguidos sin un dato (Risk/Premium/Claims/LPAN) tras los que su ausencia deja de ser un
# PENDIENTE (rojo) y pasa a "sin movimiento" (gris): en el run-off de un binder los datos llegan a
# saltos y no sabemos si un flujo se acabó del todo (puede volver un mes suelto). Cada flujo va por
# su cuenta. Si el dato vuelve a llegar, el flujo se "re-arma" solo (el auto-marcado lo pone en verde).
_MESES_DORMIDO = 6


def _dato_dormido(datos: dict, regla: str | None, binder: Binder | None, periodo: str | None) -> bool:
    """El flujo `regla` está DORMIDO para `periodo`: no ha traído dato en los `_MESES_DORMIDO` meses
    anteriores. Solo se considera dormido si ANTES sí hubo dato (un flujo que se apagó) o el binder ya
    está vencido — así un binder nuevo que todavía no ha cargado ese dato sigue saliendo pendiente."""
    if not regla or not periodo or not binder:
        return False
    meses = datos.get(regla, {}).get(binder.id, set())
    y, m = int(periodo[:4]), int(periodo[5:7])
    base = dt.date(y, m, 1)
    for k in range(1, _MESES_DORMIDO + 1):
        if _add_months(base, -k).strftime("%Y-%m") in meses:
            return False                                   # llegó dato hace <6 meses → sigue vigilándose
    hubo_antes = any(pm < periodo for pm in meses)         # el flujo estuvo activo y se apagó
    vencido = bool(binder.fecha_vencimiento and base > binder.fecha_vencimiento)
    return hubo_antes or vencido


# Categoría de la tarea AUTO → flujo de dato que la alimenta (para la dormancia a nivel de ENTREGA).
_CAT_REGLA = {"Risk": "risk", "Premium": "premium", "Claims": "claims"}


def _ocurrencia_dormida(t: Tarea, binder: Binder | None, f: dt.date, datos: dict) -> bool:
    """La ENTREGA (mes) de una tarea AUTO está 'sin movimiento': su flujo de dato (por la categoría de
    la tarea) lleva ≥6 meses dormido. Entonces toda la entrega es moot (nada que recibir/procesar/enviar
    ese mes), no solo el paso del dato. Solo aplica a tareas auto (Risk/Premium/Claims)."""
    if not binder or t.origen != "auto":
        return False
    regla = _CAT_REGLA.get(t.categoria)
    if not regla:
        return False
    periodo = _periodo_de(binder, t, f, _paso(t))
    return _dato_dormido(datos, regla, binder, periodo)


def _fechas_hechas(t: Tarea, binder: Binder | None, datos: dict) -> set[dt.date]:
    """Conjunto de fechas de ocurrencia que cuentan como HECHAS (en vivo):
    - Sin pasos: las que tengan TareaHecha (marcado manual).
    - Con pasos: las entregas en las que TODOS los pasos están hechos (manual o por regla auto)."""
    if not binder:
        return set()
    ocs = _ocurrencias(t, binder)
    # Entregas "sin movimiento" (flujo dormido ≥6 meses): cuentan como hechas (no bloquean, no salen rojas).
    dormidas = {f for f in ocs if _ocurrencia_dormida(t, binder, f, datos)}
    if not t.pasos:
        manual = {h.fecha_ocurrencia for h in t.hechas}
        return {f for f in ocs if f in manual} | dormidas
    manual_pp: dict[dt.date, set[int]] = defaultdict(set)
    for p in t.pasos:
        for ph in p.hechos:
            manual_pp[ph.fecha_ocurrencia].add(p.id)
    paso = _paso(t)
    done: set[dt.date] = set(dormidas)
    for k, f in enumerate(ocs):
        if f in dormidas:
            continue
        periodo = _periodo_de(binder, t, f, paso)
        if all(p.id in manual_pp[f] or _auto_ok(p, periodo, datos, binder.id) for p in t.pasos):
            done.add(f)
    return done


def pendientes_para_cierre(db: Session, binder: Binder, categorias: set[str], reglas: set[str]) -> list[str]:
    """Títulos de tareas ACTIVAS del binder 'relevantes' (por categoría de la tarea o por la regla auto
    de alguno de sus pasos) que tengan ALGUNA ocurrencia pendiente (debida y no hecha). Se usa para
    bloquear el cierre del binder. Lista vacía = no hay nada pendiente que impida cerrar."""
    hoy = dt.date.today()
    datos = _periodos_datos(db, {binder.id})
    out: list[str] = []
    ts = db.scalars(select(Tarea).where(
        Tarea.binder_id == binder.id, Tarea.estado == "Activa")).all()
    for t in ts:
        relevante = (t.categoria in categorias) or any(p.regla_auto in reglas for p in t.pasos)
        if not relevante:
            continue
        done = _fechas_hechas(t, binder, datos)
        if any(f not in done and _debida(t, f, hoy, False) for f in _ocurrencias(t, binder)):
            out.append(t.titulo)
    return out


# ── Auto-creación por plazos: tareas Risk/Premium/Claims derivadas del intervalo+plazo de BDX ──
# (categoría, campo intervalo del binder, campo plazo del binder, título)
_BDX_AUTO = [
    ("Risk", "risk_bdx_intervalo", "risk_bdx_plazo", "Presentar Risk BDX"),
    ("Premium", "premium_bdx_intervalo", "premium_bdx_plazo", "Presentar Premium BDX"),
    ("Claims", "claims_bdx_intervalo", "claims_bdx_plazo", "Presentar Claims BDX"),
]


def _sincronizar_binder(db: Session, binder: Binder) -> dict:
    """Crea/actualiza las tareas AUTO (Risk/Premium/Claims) de un binder a partir de su intervalo+plazo
    de BDX. Idempotente: una tarea auto por (binder, categoría). Las fechas de cada ocurrencia son las
    FECHAS LÍMITE (fin del periodo + plazo). No pisa el aviso ni el estado que el usuario haya ajustado."""
    if not binder.fecha_efecto:
        return {"creadas": 0, "actualizadas": 0}
    creadas = actualizadas = 0
    for categoria, c_int, c_plazo, titulo in _BDX_AUTO:
        frecuencia = getattr(binder, c_int, None)
        if frecuencia not in PASO_MESES:        # sin intervalo válido -> no se genera esa categoría
            continue
        plazo = int(getattr(binder, c_plazo, None) or 0)
        paso = PASO_MESES[frecuencia]
        inicio = _add_months(binder.fecha_efecto, paso) + dt.timedelta(days=plazo)   # 1ª fecha límite
        # No fijamos fecha_fin: el nº de entregas (y el run-off tras el vto) lo calcula _ocurrencias
        # por nº de periodos de cobertura. La entrega del último periodo cae DESPUÉS del vencimiento.
        fin = None
        t = db.scalar(select(Tarea).where(
            Tarea.binder_id == binder.id, Tarea.origen == "auto", Tarea.categoria == categoria))
        if t:
            t.titulo, t.frecuencia, t.fecha_inicio, t.fecha_fin = titulo, frecuencia, inicio, fin
            actualizadas += 1
        else:
            db.add(Tarea(
                binder_id=binder.id, titulo=titulo, categoria=categoria, origen="auto",
                descripcion=f"Generada del BDX del binder. Fecha límite = fin de periodo + {plazo} días.",
                frecuencia=frecuencia, fecha_inicio=inicio, fecha_fin=fin,
                aviso_dias_antes=7, estado="Activa"))
            creadas += 1
    db.commit()
    return {"creadas": creadas, "actualizadas": actualizadas}


# ── Schemas ──
class TareaIn(BaseModel):
    titulo: str
    descripcion: str | None = None
    categoria: str = "General"             # Risk / Premium / Claims / General
    frecuencia: str = "Mensual"
    intervalo_meses: int | None = None     # para frecuencia 'Personalizada'
    fecha_inicio: dt.date | None = None    # None = fecha de efecto del binder
    aviso_dias_antes: int = 5
    estado: str = "Activa"
    secuencial: bool = False               # pasos secuenciales (cada uno se desbloquea al completar el anterior)


class TareaUpdate(BaseModel):
    titulo: str | None = None
    descripcion: str | None = None
    categoria: str | None = None
    frecuencia: str | None = None
    intervalo_meses: int | None = None
    fecha_inicio: dt.date | None = None
    aviso_dias_antes: int | None = None
    estado: str | None = None
    secuencial: bool | None = None


class TareaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    binder_id: int
    titulo: str
    descripcion: str | None = None
    categoria: str = "General"
    origen: str = "manual"
    frecuencia: str
    intervalo_meses: int | None = None
    fecha_inicio: dt.date | None = None
    fecha_fin: dt.date | None = None
    aviso_dias_antes: int
    estado: str
    secuencial: bool = False
    binder_umr: str | None = None
    agencia: str | None = None       # coverholder (para agrupar Agencia → Programa → Binder)
    programa: str | None = None
    n_ocurrencias: int = 0      # ocurrencias debidas (hasta hoy/aviso)
    n_hechas: int = 0
    n_pasos: int = 0            # nº de pasos del checklist (0 = sin checklist)
    proxima: dt.date | None = None   # próxima ocurrencia pendiente y debida


def _serializar(db: Session, t: Tarea, datos: dict | None = None) -> TareaRead:
    binder = db.get(Binder, t.binder_id)
    if datos is None:
        datos = _periodos_datos(db, {t.binder_id})
    d = TareaRead.model_validate(t)
    d.binder_umr = (binder.umr or binder.agreement_number) if binder else None
    d.agencia = (binder.productor.nombre if binder and binder.productor else None)
    d.programa = (binder.programa.nombre if binder and binder.programa else None)
    ocs = _ocurrencias(t, binder) if binder else []
    hechas = _fechas_hechas(t, binder, datos)
    hoy = dt.date.today()
    # Una entrega solo "existe" cuando su plazo (con su aviso) ha llegado. Las futuras NO cuentan,
    # aunque el dato del periodo ya esté cargado (auto-marcado): aparecen al cumplirse su fecha.
    activas = [f for f in ocs if _debida(t, f, hoy, False)]
    d.n_ocurrencias = len(activas)
    d.n_hechas = len([f for f in activas if f in hechas])
    d.n_pasos = len(t.pasos)
    d.proxima = next((f for f in activas if f not in hechas), None)
    return d


@router.get("/tareas", response_model=list[TareaRead])
def listar_todas(db: Session = Depends(get_db)):
    """Todas las tareas de todos los binders (página global). Mismos datos que la pestaña del binder."""
    ts = db.scalars(select(Tarea).options(*_opc_tarea()).order_by(Tarea.id)).all()
    datos = _periodos_datos(db, {t.binder_id for t in ts})
    return [_serializar(db, t, datos) for t in ts]


class PasoEstado(BaseModel):
    paso_id: int
    titulo: str
    orden: int
    regla_auto: str | None = None    # risk | premium | lpan | claims | None
    auto: bool = False               # el paso se marcó por la regla (dato presente), no a mano
    sin_movimiento: bool = False     # el flujo lleva ≥6 meses sin dato: cuenta como hecho pero en gris
    periodo: str | None = None       # periodo (YYYY-MM) que comprueba la regla en esta entrega
    hecho: bool
    fecha_hecha: dt.date | None = None
    bloqueado: bool = False          # tarea secuencial: hay un paso anterior sin completar (no marcable aún)


def _pasos_de_ocurrencia(t: Tarea, binder: Binder | None, f: dt.date, k: int,
                         datos: dict, manual: dict) -> tuple[list[PasoEstado], bool]:
    """Estado de los pasos de UNA ocurrencia (fecha f, índice k) + si la entrega está completa.
    `manual` = {(paso_id, fecha): TareaPasoHecho}. Un paso está hecho si está marcado a mano o si su
    regla auto se cumple para el periodo de esa entrega."""
    periodo = _periodo_de(binder, t, f, _paso(t)) if binder else None
    # Entrega "sin movimiento": el flujo del dato lleva ≥6 meses dormido → toda la entrega es moot.
    # Todos sus pasos salen en gris (satisfechos, no marcables como pendientes).
    if binder and _ocurrencia_dormida(t, binder, f, datos):
        return [PasoEstado(
            paso_id=p.id, titulo=p.titulo, orden=p.orden, regla_auto=p.regla_auto,
            auto=False, sin_movimiento=True, periodo=periodo if p.regla_auto else None,
            hecho=True, fecha_hecha=None, bloqueado=False,
        ) for p in t.pasos], True
    pasos: list[PasoEstado] = []
    completa = True
    # Bloqueo por GRUPOS: los pasos con el MISMO `orden` forman un grupo paralelo (no se bloquean entre
    # sí). En tarea secuencial, un grupo está BLOQUEADO mientras algún grupo ANTERIOR (orden menor) tenga
    # algún paso sin hacer. `t.pasos` ya viene ordenado por (orden, id), así que los grupos son tramos
    # consecutivos. Un paso auto no cuenta como hecho si su grupo está bloqueado (no se salta el orden).
    grupos_previos_ok = True   # ¿están completos todos los grupos anteriores al actual?
    grupo_orden = None         # `orden` del grupo que estamos recorriendo
    grupo_completo = True      # ¿el grupo actual va completo hasta ahora?
    bloqueado = False          # ¿está bloqueado el grupo actual?
    for p in t.pasos:
        if p.orden != grupo_orden:                       # empieza un grupo nuevo
            if grupo_orden is not None:
                grupos_previos_ok = grupos_previos_ok and grupo_completo
            grupo_orden, grupo_completo = p.orden, True
            bloqueado = bool(t.secuencial) and not grupos_previos_ok
        ph = manual.get((p.id, f))
        auto_done = _auto_ok(p, periodo, datos, binder.id) if binder else False
        hecho = (ph is not None or auto_done) and not bloqueado
        if not hecho:
            completa = False
            grupo_completo = False
        pasos.append(PasoEstado(
            paso_id=p.id, titulo=p.titulo, orden=p.orden,
            regla_auto=p.regla_auto, auto=(auto_done and ph is None and not bloqueado),
            periodo=periodo if p.regla_auto else None,
            hecho=hecho, fecha_hecha=(ph.fecha_hecha if ph else None),
            bloqueado=bloqueado,
        ))
    return pasos, completa


class AgendaItem(BaseModel):
    tarea_id: int
    titulo: str
    categoria: str
    origen: str
    binder_id: int
    binder_umr: str | None = None
    agencia: str | None = None
    programa: str | None = None
    fecha: dt.date            # fecha (límite) de la ocurrencia
    estado: str               # hecha | vencida | pendiente | futura
    fecha_hecha: dt.date | None = None
    pasos: list[PasoEstado] = []   # checklist de esta entrega (vacío si la tarea no tiene pasos)
    n_pasos: int = 0
    n_pasos_hechos: int = 0


@router.get("/tareas/agenda", response_model=list[AgendaItem])
def agenda(binder_id: int | None = None, solo_pendientes: bool = False, db: Session = Depends(get_db)):
    """Todas las ocurrencias (fechas límite) de las tareas activas, APLANADAS y con su estado, para la
    vista por mes. 'pendiente' a efectos de filtro = no hecha y ya debida (vencida o pendiente)."""
    hoy = dt.date.today()
    q = select(Tarea).where(Tarea.estado != "Pausada")
    if binder_id is not None:
        q = q.where(Tarea.binder_id == binder_id)
    tareas = db.scalars(q.options(*_opc_tarea()).order_by(Tarea.id)).all()
    datos = _periodos_datos(db, {t.binder_id for t in tareas})
    out: list[AgendaItem] = []
    for t in tareas:
        binder = db.get(Binder, t.binder_id)
        if not binder:
            continue
        hechas = {h.fecha_ocurrencia: h for h in t.hechas}
        manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
        done = _fechas_hechas(t, binder, datos)
        for k, f in enumerate(_ocurrencias(t, binder)):
            if f < SUELO_ENTREGAS:
                continue
            h = hechas.get(f)
            pasos, _ = _pasos_de_ocurrencia(t, binder, f, k, datos, manual)
            if not _debida(t, f, hoy, False):
                estado = "futura"      # su plazo aún no ha llegado (aunque el dato ya exista)
            elif f in done:
                # Completa por dato/mano = "hecha" (verde). Completa SOLO porque el flujo lleva ≥6 meses
                # dormido (nada real hecho) = "sin_movimiento" (gris): informa pero no es pendiente.
                hay_real = (h is not None) or any(p.hecho and not p.sin_movimiento for p in pasos)
                estado = "hecha" if hay_real else "sin_movimiento"
            elif f < hoy:
                estado = "vencida"
            else:
                estado = "pendiente"
            if solo_pendientes and estado not in ("vencida", "pendiente"):
                continue
            out.append(AgendaItem(
                tarea_id=t.id, titulo=t.titulo, categoria=t.categoria, origen=t.origen,
                binder_id=t.binder_id, binder_umr=(binder.umr or binder.agreement_number),
                agencia=(binder.productor.nombre if binder.productor else None),
                programa=(binder.programa.nombre if binder.programa else None),
                fecha=f, estado=estado, fecha_hecha=(h.fecha_hecha if h else None),
                pasos=pasos, n_pasos=len(pasos), n_pasos_hechos=sum(1 for p in pasos if p.hecho),
            ))
    out.sort(key=lambda x: (x.fecha, x.binder_umr or "", x.categoria))
    return out


@router.get("/binders/{binder_id}/tareas", response_model=list[TareaRead])
def listar(binder_id: int, db: Session = Depends(get_db)):
    ts = db.scalars(select(Tarea).where(Tarea.binder_id == binder_id).options(*_opc_tarea()).order_by(Tarea.id)).all()
    datos = _periodos_datos(db, {binder_id})
    return [_serializar(db, t, datos) for t in ts]


@router.post("/binders/{binder_id}/tareas", response_model=TareaRead, status_code=201)
def crear(binder_id: int, payload: TareaIn, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    t = Tarea(binder_id=binder_id, **payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serializar(db, t)


@router.post("/tareas/sincronizar-auto")
def sincronizar_todas(db: Session = Depends(get_db)):
    """Genera/actualiza las tareas automáticas (Risk/Premium/Claims) de TODOS los binders desde su BDX."""
    binders = db.scalars(select(Binder)).all()
    creadas = actualizadas = 0
    for b in binders:
        r = _sincronizar_binder(db, b)
        creadas += r["creadas"]; actualizadas += r["actualizadas"]
    return {"binders": len(binders), "creadas": creadas, "actualizadas": actualizadas}


@router.post("/binders/{binder_id}/tareas/sincronizar-auto")
def sincronizar_binder(binder_id: int, db: Session = Depends(get_db)):
    """Genera/actualiza las tareas automáticas (Risk/Premium/Claims) de un binder desde su BDX."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return _sincronizar_binder(db, b)


# ── Copiar el esquema de tareas del binder ANTERIOR del mismo programa ──────────────────────────
def _binder_anterior(db: Session, binder: Binder) -> Binder | None:
    """El binder ANTERIOR del mismo programa: el de mayor fecha_efecto estrictamente anterior a la de
    este binder (desempate por id). Si este binder no tiene fecha_efecto, el más reciente del programa."""
    if binder.programa_id is None:
        return None
    q = select(Binder).where(
        Binder.programa_id == binder.programa_id, Binder.id != binder.id, Binder.fecha_efecto.is_not(None))
    if binder.fecha_efecto is not None:
        q = q.where(Binder.fecha_efecto < binder.fecha_efecto)
    return db.scalars(q.order_by(Binder.fecha_efecto.desc(), Binder.id.desc())).first()


def _tareas_copiables(db: Session, binder_id: int) -> list[Tarea]:
    """El 'esquema' copiable de un binder: las tareas MANUALES (siempre) y las AUTOMÁTICAS que tengan
    checklist (pasos). Las auto sin pasos no aportan esquema (se regeneran vacías del BDX)."""
    ts = db.scalars(select(Tarea).where(Tarea.binder_id == binder_id)
                    .options(selectinload(Tarea.pasos))).all()
    return [t for t in ts if t.origen == "manual" or len(t.pasos) > 0]


def _copiar_pasos(origen: Tarea, destino: Tarea) -> int:
    for p in sorted(origen.pasos, key=lambda x: (x.orden, x.id)):
        destino.pasos.append(TareaPaso(titulo=p.titulo, orden=p.orden, regla_auto=p.regla_auto))
    return len(origen.pasos)


class TareaAnteriorInfo(BaseModel):
    binder_id: int | None = None
    binder_umr: str | None = None
    n_tareas: int = 0       # nº de tareas copiables (manuales + automáticas con checklist) del anterior


@router.get("/binders/{binder_id}/tareas/anterior", response_model=TareaAnteriorInfo)
def tareas_binder_anterior(binder_id: int, db: Session = Depends(get_db)):
    """Info del binder anterior del mismo programa y cuántas tareas copiables tiene (manuales + auto con
    checklist). El frontend oculta el botón si ESTE binder ya tiene esquema (tarea manual o auto con
    pasos), para evitar duplicados."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    prev = _binder_anterior(db, b)
    if prev is None:
        return TareaAnteriorInfo()
    return TareaAnteriorInfo(
        binder_id=prev.id, binder_umr=(prev.umr or prev.agreement_number),
        n_tareas=len(_tareas_copiables(db, prev.id)))


@router.post("/binders/{binder_id}/tareas/copiar-anterior", status_code=201)
def copiar_tareas_anterior(binder_id: int, db: Session = Depends(get_db)):
    """Copia el ESQUEMA de tareas del binder anterior del mismo programa: las manuales (con su
    checklist) y los CHECKLISTS de las automáticas (Risk/Premium/Claims). No copia el histórico de
    marcado. Las manuales anclan sus fechas al nuevo binder (fecha_inicio/fin = None); en las auto, los
    pasos se meten en la tarea auto de la MISMA categoría del nuevo binder (si no existe, se crea y luego
    «Generar automáticas» le ajusta las fechas del BDX). Falla si este binder ya tiene esquema."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if _tareas_copiables(db, binder_id):
        raise HTTPException(status_code=409, detail="Este binder ya tiene esquema de tareas; no se copia para evitar duplicados.")
    prev = _binder_anterior(db, b)
    if prev is None:
        raise HTTPException(status_code=404, detail="No hay un binder anterior en este programa del que copiar.")
    fuente = _tareas_copiables(db, prev.id)
    if not fuente:
        raise HTTPException(status_code=404, detail="El binder anterior no tiene esquema de tareas que copiar.")
    # Tareas auto ya existentes en el destino, por categoría (para meterles el checklist sin duplicar).
    auto_destino = {t.categoria: t for t in db.scalars(select(Tarea).where(
        Tarea.binder_id == binder_id, Tarea.origen == "auto")).all()}
    tareas_creadas = pasos_copiados = 0
    for t in fuente:
        if t.origen == "manual":
            nueva = Tarea(
                binder_id=binder_id, titulo=t.titulo, descripcion=t.descripcion,
                categoria=t.categoria, origen="manual",
                frecuencia=t.frecuencia, intervalo_meses=t.intervalo_meses,
                fecha_inicio=None, fecha_fin=None,     # se anclan a la vigencia del nuevo binder
                aviso_dias_antes=t.aviso_dias_antes, estado="Activa", secuencial=t.secuencial,
            )
            pasos_copiados += _copiar_pasos(t, nueva)
            db.add(nueva)
            tareas_creadas += 1
        else:  # automática con checklist → mete los pasos en la auto de la misma categoría del destino
            dest = auto_destino.get(t.categoria)
            if dest is None:
                dest = Tarea(
                    binder_id=binder_id, titulo=t.titulo, descripcion=t.descripcion,
                    categoria=t.categoria, origen="auto",
                    frecuencia=t.frecuencia, intervalo_meses=t.intervalo_meses,
                    fecha_inicio=None, fecha_fin=None, aviso_dias_antes=t.aviso_dias_antes,
                    estado="Activa", secuencial=t.secuencial,
                )
                db.add(dest)
                auto_destino[t.categoria] = dest
                tareas_creadas += 1
            if not dest.pasos:                          # no pisar un checklist ya existente
                pasos_copiados += _copiar_pasos(t, dest)
    db.commit()
    return {"tareas": tareas_creadas, "pasos": pasos_copiados,
            "desde_binder_id": prev.id, "desde_binder_umr": prev.umr or prev.agreement_number}


@router.put("/tareas/{tarea_id}", response_model=TareaRead)
def editar(tarea_id: int, payload: TareaUpdate, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _serializar(db, t)


@router.delete("/tareas/{tarea_id}", status_code=204)
def borrar(tarea_id: int, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    db.delete(t)
    db.commit()


# ── Ocurrencias (calendario de la tarea) ──
class OcurrenciaOut(BaseModel):
    fecha: dt.date
    hecha: bool
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    estado: str   # 'hecha' | 'vencida' | 'pendiente' | 'futura'
    pasos: list[PasoEstado] = []   # checklist de esta ocurrencia (vacío si la tarea no tiene pasos)


@router.get("/tareas/{tarea_id}/ocurrencias")
def ocurrencias(tarea_id: int, incluir_futuras: bool = False, db: Session = Depends(get_db)):
    """Por defecto solo las ocurrencias ya 'generadas' (hechas, vencidas o pendientes según su aviso);
    las futuras se ocultan hasta que toquen. `incluir_futuras=true` las muestra todas."""
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    binder = db.get(Binder, t.binder_id)
    datos = _periodos_datos(db, {t.binder_id})
    hechas = {h.fecha_ocurrencia: h for h in t.hechas}    # TareaHecha (tareas sin pasos / notas)
    manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
    hoy = dt.date.today()
    out: list[OcurrenciaOut] = []
    for k, f in enumerate(_ocurrencias(t, binder) if binder else []):
        pasos, completa = _pasos_de_ocurrencia(t, binder, f, k, datos, manual)
        h = hechas.get(f)
        hecha = completa if t.pasos else (h is not None)
        if not _debida(t, f, hoy, False):
            estado = "futura"          # su plazo aún no ha llegado (aunque el dato del periodo ya exista)
        elif hecha:
            estado = "hecha"
        elif f < hoy:
            estado = "vencida"
        else:
            estado = "pendiente"
        if estado == "futura" and not incluir_futuras:
            continue
        out.append(OcurrenciaOut(
            fecha=f, hecha=hecha,
            fecha_hecha=(h.fecha_hecha if h else None), notas=(h.notas if h else None),
            estado=estado, pasos=pasos,
        ))
    return {"tarea_id": t.id, "titulo": t.titulo, "ocurrencias": out}


class HechaIn(BaseModel):
    fecha_ocurrencia: dt.date
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    deshacer: bool = False


def _recalcular_hecha(db: Session, t: Tarea, fecha: dt.date) -> bool:
    """Para tareas CON pasos: el TareaHecha de una ocurrencia es DERIVADO → existe cuando todos los pasos
    de esa fecha están hechos, y se borra en caso contrario. Devuelve si la ocurrencia queda hecha.
    Para tareas sin pasos no hace nada (el marcado es manual)."""
    n_pasos = db.scalar(select(func.count()).select_from(TareaPaso).where(TareaPaso.tarea_id == t.id))
    if not n_pasos:
        return False
    n_hechos = db.scalar(
        select(func.count()).select_from(TareaPasoHecho).join(TareaPaso)
        .where(TareaPaso.tarea_id == t.id, TareaPasoHecho.fecha_ocurrencia == fecha))
    h = db.scalar(select(TareaHecha).where(
        TareaHecha.tarea_id == t.id, TareaHecha.fecha_ocurrencia == fecha))
    completa = n_hechos >= n_pasos
    if completa and h is None:
        db.add(TareaHecha(tarea_id=t.id, fecha_ocurrencia=fecha, fecha_hecha=dt.date.today()))
    elif not completa and h is not None:
        db.delete(h)
    return completa


@router.post("/tareas/{tarea_id}/hecha", status_code=200)
def marcar_hecha(tarea_id: int, payload: HechaIn, db: Session = Depends(get_db)):
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    # Con checklist: marcar/deshacer la ocurrencia = marcar/deshacer los pasos MANUALES (los pasos auto
    # los gobierna el dato, no se tocan). La entrega 'hecha' se calcula en vivo (manual + auto).
    if t.pasos:
        for p in t.pasos:
            if p.regla_auto:
                continue
            ph = db.scalar(select(TareaPasoHecho).where(
                TareaPasoHecho.paso_id == p.id, TareaPasoHecho.fecha_ocurrencia == payload.fecha_ocurrencia))
            if payload.deshacer:
                if ph:
                    db.delete(ph)
            elif ph is None:
                db.add(TareaPasoHecho(paso_id=p.id, fecha_ocurrencia=payload.fecha_ocurrencia,
                                      fecha_hecha=payload.fecha_hecha or dt.date.today()))
        db.flush()
        binder = db.get(Binder, t.binder_id)
        datos = _periodos_datos(db, {t.binder_id})
        hecha = payload.fecha_ocurrencia in _fechas_hechas(t, binder, datos)
        db.commit()
        return {"ok": True, "hecha": hecha}
    h = db.scalar(select(TareaHecha).where(
        TareaHecha.tarea_id == tarea_id, TareaHecha.fecha_ocurrencia == payload.fecha_ocurrencia))
    if payload.deshacer:
        if h:
            db.delete(h)
            db.commit()
        return {"ok": True, "hecha": False}
    if h is None:
        h = TareaHecha(tarea_id=tarea_id, fecha_ocurrencia=payload.fecha_ocurrencia,
                       fecha_hecha=payload.fecha_hecha or dt.date.today(), notas=payload.notas)
        db.add(h)
    else:
        h.fecha_hecha = payload.fecha_hecha or dt.date.today()
        h.notas = payload.notas
    db.commit()
    return {"ok": True, "hecha": True}


# ── Pasos (checklist) de una tarea ──────────────────────────────────────────────────────────────
def _valida_regla(regla: str | None) -> str | None:
    if regla in (None, ""):
        return None
    if regla not in REGLAS_AUTO:
        raise HTTPException(status_code=422, detail=f"Regla auto inválida: {regla}")
    return regla


class PasoIn(BaseModel):
    titulo: str
    orden: int | None = None        # None = al final
    regla_auto: str | None = None   # risk | premium | lpan | claims | None (manual)


class PasoUpdate(BaseModel):
    titulo: str | None = None
    orden: int | None = None
    regla_auto: str | None = None


class PasoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tarea_id: int
    orden: int
    titulo: str
    regla_auto: str | None = None


@router.get("/tareas/{tarea_id}/pasos", response_model=list[PasoRead])
def listar_pasos(tarea_id: int, db: Session = Depends(get_db)):
    if db.get(Tarea, tarea_id) is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    return db.scalars(select(TareaPaso).where(TareaPaso.tarea_id == tarea_id)
                      .order_by(TareaPaso.orden, TareaPaso.id)).all()


@router.post("/tareas/{tarea_id}/pasos", response_model=PasoRead, status_code=201)
def crear_paso(tarea_id: int, payload: PasoIn, db: Session = Depends(get_db)):
    if db.get(Tarea, tarea_id) is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    if not payload.titulo.strip():
        raise HTTPException(status_code=422, detail="El título del paso es obligatorio.")
    orden = payload.orden
    if orden is None:
        ultimo = db.scalar(select(func.max(TareaPaso.orden)).where(TareaPaso.tarea_id == tarea_id))
        orden = (ultimo or 0) + 1
    p = TareaPaso(tarea_id=tarea_id, titulo=payload.titulo.strip(), orden=orden,
                  regla_auto=_valida_regla(payload.regla_auto))
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.put("/pasos/{paso_id}", response_model=PasoRead)
def editar_paso(paso_id: int, payload: PasoUpdate, db: Session = Depends(get_db)):
    p = db.get(TareaPaso, paso_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Paso {paso_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if k == "titulo" and v is not None:
            v = v.strip() or p.titulo
        if k == "regla_auto":
            v = _valida_regla(v)
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/pasos/{paso_id}", status_code=204)
def borrar_paso(paso_id: int, db: Session = Depends(get_db)):
    p = db.get(TareaPaso, paso_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Paso {paso_id} no encontrado")
    tarea_id = p.tarea_id
    # Las fechas afectadas: si al quitar un paso una ocurrencia queda completa, recalculamos su 'hecha'.
    fechas = {ph.fecha_ocurrencia for ph in p.hechos}
    db.delete(p)
    db.flush()
    t = db.get(Tarea, tarea_id)
    for f in fechas:
        _recalcular_hecha(db, t, f)
    db.commit()


class PasoHechoIn(BaseModel):
    fecha_ocurrencia: dt.date
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    deshacer: bool = False


@router.post("/pasos/{paso_id}/hecho", status_code=200)
def marcar_paso(paso_id: int, payload: PasoHechoIn, db: Session = Depends(get_db)):
    """Marca/desmarca UN paso (manual) en UNA ocurrencia. Los pasos auto los gobierna el dato."""
    p = db.get(TareaPaso, paso_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Paso {paso_id} no encontrado")
    if p.regla_auto:
        raise HTTPException(status_code=409, detail="Paso automático: se marca solo cuando el dato existe.")
    # Tarea secuencial: no se puede MARCAR un paso si algún paso anterior sigue pendiente (desmarcar sí).
    t = db.get(Tarea, p.tarea_id)
    if t and t.secuencial and not payload.deshacer:
        binder = db.get(Binder, t.binder_id)
        ocs = _ocurrencias(t, binder) if binder else []
        k = ocs.index(payload.fecha_ocurrencia) if payload.fecha_ocurrencia in ocs else 0
        manual = {(ph2.paso_id, ph2.fecha_ocurrencia): ph2 for pp in t.pasos for ph2 in pp.hechos}
        estados, _ = _pasos_de_ocurrencia(t, binder, payload.fecha_ocurrencia, k,
                                          _periodos_datos(db, {t.binder_id}), manual)
        est = next((e for e in estados if e.paso_id == paso_id), None)
        if est and est.bloqueado:
            raise HTTPException(status_code=409, detail="Paso bloqueado: completa antes los pasos anteriores.")
    ph = db.scalar(select(TareaPasoHecho).where(
        TareaPasoHecho.paso_id == paso_id, TareaPasoHecho.fecha_ocurrencia == payload.fecha_ocurrencia))
    if payload.deshacer:
        if ph:
            db.delete(ph)
    elif ph is None:
        db.add(TareaPasoHecho(paso_id=paso_id, fecha_ocurrencia=payload.fecha_ocurrencia,
                              fecha_hecha=payload.fecha_hecha or dt.date.today(), notas=payload.notas))
    else:
        ph.fecha_hecha = payload.fecha_hecha or dt.date.today()
        ph.notas = payload.notas
    db.flush()
    t = db.get(Tarea, p.tarea_id)
    binder = db.get(Binder, t.binder_id)
    datos = _periodos_datos(db, {t.binder_id})
    hecha = payload.fecha_ocurrencia in _fechas_hechas(t, binder, datos)
    db.commit()
    return {"ok": True, "paso_hecho": not payload.deshacer, "ocurrencia_hecha": hecha}
