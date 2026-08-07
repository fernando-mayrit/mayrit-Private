"""
Tareas recurrentes MANUALES enganchadas a un binder. La recurrencia se ajusta a la VIGENCIA del
binder: arranca en `fecha_inicio` (o la fecha de efecto del binder) y se repite con su frecuencia
hasta el vencimiento del binder. Cada ocurrencia se marca 'Hecha' (registro en `tareas_hechas`).
Saltan como aviso en la campana `aviso_dias_antes` antes de cada ocurrencia.
"""
from __future__ import annotations

import calendar
import datetime as dt
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models.maestras import (
    Bdx, BdxLinea, Binder, ClaimsPresentacion, Lpan, Recibo, Tarea, TareaColumna, TareaColumnaBinder,
    TareaHecha, TareaMatrizManual, TareaPaso, TareaPasoHecho,
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


# Las tareas AUTO (Risk/Premium/Claims) arrancan sus entregas en el MES DE EFECTO del binder (IGUAL que la
# parrilla) y RUEDAN mes a mes hacia delante hasta hoy + `_LOOKAHEAD_MESES` (las futuras se ocultan hasta su
# fecha, vía _es_futura). Se acotan a los últimos `_MESES_ATRAS` meses (tope rodante) para no generar
# entregas antiquísimas en binders viejos — mismo criterio que el tope de la parrilla. No se atan al
# `fecha_inicio` guardado. (Antes había un suelo FIJO 01/07/2026 que se saltaba los primeros meses de los
# binders de 2026 y chocaba con la parrilla.)
_LOOKAHEAD_MESES = 2   # cuántos meses por delante del actual se generan (los futuros salen al llegar su fecha)
_MESES_ATRAS = 36      # tope rodante hacia atrás (no se muestran periodos anteriores a hoy − 36 meses)


def _suelo_entregas() -> dt.date:
    """Periodo (mes) más antiguo que se muestra: hoy − `_MESES_ATRAS` meses (día 1). Rueda con el tiempo."""
    return _add_months(dt.date.today().replace(day=1), -_MESES_ATRAS)


_VENC = "__venc__"   # sentinela de `hasta_m`: usar el vencimiento del binder (comportamiento por defecto)


def _tope_hasta(cfgs_cat: list[TareaColumnaBinder], n_cols: int, venc: dt.date | None) -> str | None:
    """Tope superior (YYYY-MM) de UNA categoría (Risk/Premium/Claims) según su config de fases. LAS FASES
    MANDAN sobre el vencimiento del binder:
    - None      = VIVA (run-off, sin tope): alguna fase aplica con 'Hasta' en blanco (o una columna por
                  defecto en un binder aún sin vencimiento).
    - ''        = ninguna fase aplica (todas en 'No aplica') → categoría TERMINADA.
    - 'YYYY-MM' = aplica hasta ese mes (el mayor entre los 'Hasta' fijados y el vto de las columnas por defecto).
    Las columnas SIN override aplican por defecto hasta el vencimiento del binder."""
    venc_m = venc.strftime("%Y-%m") if venc else None
    aplica = [cb for cb in cfgs_cat if cb.aplica]
    hay_default = len(cfgs_cat) < n_cols          # columnas sin override → aplican hasta el vto
    if any(cb.hasta is None for cb in aplica) or (hay_default and venc_m is None):
        return None                               # vivo
    cand = [cb.hasta for cb in aplica if cb.hasta]
    if hay_default and venc_m:
        cand.append(venc_m)
    return max(cand) if cand else ""              # sin candidatos = ninguna fase aplica (terminada)


def _topes(db: Session, binder_ids: set[int]) -> dict[tuple[int, str], str | None]:
    """Por (binder, categoría), el tope superior (YYYY-MM) de sus fases. None=vivo, ''=terminada. Ver
    `_tope_hasta`. El tope es POR CATEGORÍA: p.ej. Risk 'No aplica' no arrastra a Premium 'vivo'."""
    out: dict[tuple[int, str], str | None] = {}
    if not binder_ids:
        return out
    cols = db.scalars(select(TareaColumna).where(TareaColumna.activa.is_(True))).all()
    grupo_de = {c.id: c.grupo for c in cols}
    n_cols = Counter(c.grupo for c in cols)
    cfgs: dict[tuple[int, str], list] = defaultdict(list)
    for cb in db.scalars(select(TareaColumnaBinder).where(TareaColumnaBinder.binder_id.in_(binder_ids))).all():
        cat = grupo_de.get(cb.columna_id)
        if cat:
            cfgs[(cb.binder_id, cat)].append(cb)
    for bid in binder_ids:
        b = db.get(Binder, bid)
        venc = b.fecha_vencimiento if b else None
        for cat in n_cols:
            out[(bid, cat)] = _tope_hasta(cfgs.get((bid, cat), []), n_cols[cat], venc)
    return out


def _hasta_binder(topes: dict, bid: int, cats: set[str]) -> str | None:
    """Tope de FILA para la parrilla del binder = el más amplio entre las categorías que hace: None si
    alguna está viva; el mayor 'Hasta' si todas están acotadas; '' si ninguna aplica."""
    vals = [topes[(bid, cat)] for cat in cats if (bid, cat) in topes]
    if not vals:
        return ""
    if any(v is None for v in vals):
        return None
    caps = [v for v in vals if v]
    return max(caps) if caps else ""


def _cat_terminada(hasta_m: str | None) -> bool:
    """¿La categoría está TERMINADA ahora? '' (ninguna fase aplica) o su 'Hasta' ya pasó (anterior al mes
    de dato en curso = el mes anterior al actual). None (viva) nunca está terminada."""
    if hasta_m is None:
        return False
    if hasta_m == "":
        return True
    return hasta_m < _add_months(dt.date.today().replace(day=1), -1).strftime("%Y-%m")


def _ocurrencias(t: Tarea, binder: Binder, hasta_m: str | None = _VENC) -> list[dt.date]:
    """Fechas (límite) de las entregas de la tarea.

    - AUTO (Risk/Premium/Claims): mensuales (o su intervalo) DESDE el mes de EFECTO del binder (arranque
      natural `efecto+intervalo+plazo`), rodando hasta hoy + margen y acotadas a los últimos `_MESES_ATRAS`
      meses. No se atan al `fecha_inicio` guardado.
    - Manuales: desde `fecha_inicio` (o efecto) hasta `fecha_fin`/vencimiento (con run-off tras el vto)."""
    if t.estado == "Pausada":            # tarea pausada: sin entregas en ningún sitio (detalle/agenda/parrilla/cierre)
        return []
    paso = _paso(t)
    if t.origen == "auto" and binder and binder.fecha_efecto and paso > 0:
        attr = _CAT_PLAZO.get(t.categoria)
        plazo = int(getattr(binder, attr, 0) or 0) if attr else 0
        natural = _add_months(binder.fecha_efecto, paso) + dt.timedelta(days=plazo)   # 1ª fecha límite (periodo=efecto)
        tope = _add_months(dt.date.today(), _LOOKAHEAD_MESES)
        suelo, ef1 = _suelo_entregas(), binder.fecha_efecto.replace(day=1)
        # Tope superior por MES DEL DATO (por categoría): el vencimiento del binder por defecto, o el que
        # diga la config de fases de esa categoría (None = viva → sin tope; '' = ninguna fase aplica →
        # sin entregas). Así 'Hasta = vivo' extiende más allá del vto y 'No aplica' termina la categoría.
        if hasta_m == "":
            return []
        if hasta_m == _VENC:
            venc_mes = binder.fecha_vencimiento.replace(day=1) if binder.fecha_vencimiento else None
        elif hasta_m is None:
            venc_mes = None
        else:
            venc_mes = dt.date(int(hasta_m[:4]), int(hasta_m[5:7]), 1)
        # `fecha_inicio` de la tarea (si el usuario la puso) = PRIMER MES a mostrar; vacía = desde el efecto.
        piso_tarea = t.fecha_inicio.replace(day=1) if t.fecha_inicio else None
        out, k = [], 0
        while k < 600:
            f = _add_months(natural, k * paso)         # fecha límite de la entrega k (sobre la rejilla natural)
            if f > tope:
                break
            per_mes = _add_months(ef1, k * paso)       # PERIODO (mes del dato) de la entrega k
            if venc_mes and per_mes > venc_mes:        # no pasar del vencimiento (igual que la parrilla)
                break
            if per_mes >= suelo and (piso_tarea is None or per_mes >= piso_tarea):   # tope rodante + fecha_inicio
                out.append(f)
            k += 1
        return out
    # ── Tareas manuales ──
    inicio = t.fecha_inicio or (binder.fecha_efecto if binder else None)
    if not inicio:
        return []
    if paso <= 0:
        out = [inicio]
    elif t.fecha_fin and t.fecha_fin >= inicio:        # tope explícito por fecha_fin
        out, k = [], 0
        while k < 1200:
            f = _add_months(inicio, k * paso)
            if f > t.fecha_fin:
                break
            out.append(f)
            k += 1
    else:
        ef, venc = (binder.fecha_efecto, binder.fecha_vencimiento) if binder else (None, None)
        if not ef or not venc:
            out = [_add_months(inicio, k * paso) for k in range(120)]
        else:
            n = 0
            while n < 1200 and _add_months(ef, n * paso) <= venc:
                n += 1
            out = [_add_months(inicio, k * paso) for k in range(max(n, 1))]
    # `fecha_inicio` = PRIMER PERIODO a mostrar (igual que en las auto): descarta las entregas cuyo PERIODO
    # (mes del dato = fecha límite − intervalo) sea anterior. Vacía = desde el efecto. No cambia las fechas
    # límite (las marcas por ocurrencia se conservan), solo oculta las entregas de periodos previos.
    if t.fecha_inicio and paso > 0:
        piso = t.fecha_inicio.strftime("%Y-%m")
        out = [f for f in out if (_periodo_de(binder, t, f, paso) or "9999-99") >= piso]
    return out


def _debida(t: Tarea, f: dt.date, hoy: dt.date, hecha: bool) -> bool:
    """Una ocurrencia 'cuenta' si ya está hecha o su aviso ya ha saltado (aviso_dias_antes antes)."""
    return hecha or (f - dt.timedelta(days=int(t.aviso_dias_antes or 0)) <= hoy)


def _es_futura(t: Tarea, binder: Binder | None, f: dt.date, hoy: dt.date) -> bool:
    """¿La entrega aún no toca (se oculta por defecto)? Para tareas AUTO va por el MES DE TRABAJO: el dato
    del periodo P se recibe/procesa el mes SIGUIENTE, así que la entrega es actionable en cuanto el mes
    actual pasa de P (futura si su periodo >= mes actual). Igual que la parrilla (que llega hasta el mes
    anterior al actual). Para las manuales, por la fecha límite (aviso). Nota: usa _periodo_de, definida
    más abajo (resolución en tiempo de llamada)."""
    if t.origen == "auto" and binder:
        periodo = _periodo_de(binder, t, f, _paso(t))
        if periodo:
            return periodo >= hoy.strftime("%Y-%m")
    return not _debida(t, f, hoy, False)


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


def _fechas_carga(db: Session, binder_ids: set[int]) -> dict[str, dict[int, dict[str, dt.date]]]:
    """Por binder y regla, la FECHA DE CARGA (created_at más antiguo) del dato de cada periodo 'YYYY-MM'.
    Sirve para poner sola la fecha de los pasos AUTO ('cuándo se realizó' = cuándo se cargó el dato)."""
    out: dict[str, dict[int, dict[str, dt.date]]] = {r: defaultdict(dict) for r in REGLAS_AUTO}
    if not binder_ids:
        return out

    def _acc(regla: str, bid: int, per: str | None, ts) -> None:
        if not per or ts is None:
            return
        d = ts.date() if hasattr(ts, "date") else ts
        cur = out[regla][bid].get(per)
        if cur is None or d < cur:
            out[regla][bid][per] = d

    # Risk/Premium: agrupamos por la FECHA del dato (min created_at) y pasamos a mes en Python.
    for bid, d, ts in db.execute(
        select(Bdx.binder_id, BdxLinea.reporting_period_start, func.min(Bdx.created_at))
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.tipo == "Risk", Bdx.binder_id.in_(binder_ids), BdxLinea.reporting_period_start.is_not(None))
        .group_by(Bdx.binder_id, BdxLinea.reporting_period_start)
    ).all():
        _acc("risk", bid, d.strftime("%Y-%m"), ts)
    for bid, d, ts in db.execute(
        select(Bdx.binder_id, BdxLinea.premium_bdx, func.min(Bdx.created_at))
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id.in_(binder_ids), BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
        .group_by(Bdx.binder_id, BdxLinea.premium_bdx)
    ).all():
        _acc("premium", bid, d.strftime("%Y-%m"), ts)
    for bid, per, ts in db.execute(
        select(Lpan.binder_id, Lpan.periodo, func.min(Lpan.created_at))
        .where(Lpan.binder_id.in_(binder_ids), Lpan.periodo.is_not(None))
        .group_by(Lpan.binder_id, Lpan.periodo)
    ).all():
        _acc("lpan", bid, per, ts)
    for bid, per, ts in db.execute(
        select(ClaimsPresentacion.binder_id, ClaimsPresentacion.periodo, func.min(ClaimsPresentacion.created_at))
        .where(ClaimsPresentacion.binder_id.in_(binder_ids), ClaimsPresentacion.periodo.is_not(None))
        .group_by(ClaimsPresentacion.binder_id, ClaimsPresentacion.periodo)
    ).all():
        _acc("claims", bid, per, ts)
    return out


# Campo de plazo (días) del binder según la categoría de la tarea auto.
_CAT_PLAZO = {"Risk": "risk_bdx_plazo", "Premium": "premium_bdx_plazo", "Claims": "claims_bdx_plazo"}


def _periodo_de(binder: Binder, t: Tarea, f: dt.date, paso_meses: int) -> str | None:
    """Periodo (YYYY-MM) del DATO que cubre la entrega con fecha límite `f`. Para las tareas AUTO se ANCLA
    AL EFECTO, igual que se generan las fechas límite en `_ocurrencias` (efecto + intervalo + plazo): la
    entrega nº k comprueba el periodo `efecto + k·intervalo`. Así la 1ª entrega cubre el mes de EFECTO y
    coincide con la parrilla (antes se saltaba un mes porque el cálculo no descontaba el plazo → el
    checklist empezaba un mes tarde). Para tareas manuales se mantiene el mes de la entrega − intervalo."""
    if not binder or not f or paso_meses <= 0:
        return None
    if t.origen == "auto" and binder.fecha_efecto:
        attr = _CAT_PLAZO.get(t.categoria)
        plazo = int(getattr(binder, attr, 0) or 0) if attr else 0
        inicio = _add_months(binder.fecha_efecto, paso_meses) + dt.timedelta(days=plazo)   # 1ª fecha límite (idem _ocurrencias)
        k = round(((f.year - inicio.year) * 12 + (f.month - inicio.month)) / paso_meses)
        return _add_months(binder.fecha_efecto, k * paso_meses).strftime("%Y-%m")
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


def _sinmov_manual(t: Tarea, f: dt.date) -> bool:
    """El usuario marcó A MANO esta entrega (mes) como 'sin movimiento' (no hubo dato ese mes)."""
    return any(h.fecha_ocurrencia == f and h.sin_movimiento for h in t.hechas)


def _datos_del_periodo(t: Tarea, binder: Binder | None, f: dt.date, datos: dict) -> bool:
    """El dato real de esta entrega YA está cargado (tareas auto Risk/Premium/Claims). Si es así, la entrega
    está de verdad hecha (verde), y ninguna marca 'sin movimiento' (manual o automática) debe taparlo."""
    regla = _CAT_REGLA.get(t.categoria)
    if not regla or not binder or t.origen != "auto":
        return False
    periodo = _periodo_de(binder, t, f, _paso(t))
    return bool(periodo) and periodo in datos.get(regla, {}).get(binder.id, set())


def _entrega_sin_mov(t: Tarea, binder: Binder | None, f: dt.date, datos: dict) -> bool:
    """La entrega (mes) es 'sin movimiento': marcada a mano O flujo dormido ≥6 meses (automático). Pero si
    el DATO real de ese mes acaba llegando, deja de serlo (el auto-marcado la pone en verde). Solo afecta a
    ESE mes; los demás siguen normales."""
    if _datos_del_periodo(t, binder, f, datos):
        return False
    return _sinmov_manual(t, f) or _ocurrencia_dormida(t, binder, f, datos)


def _fechas_hechas(t: Tarea, binder: Binder | None, datos: dict, hasta_m: str | None = _VENC) -> set[dt.date]:
    """Conjunto de fechas de ocurrencia que cuentan como HECHAS (en vivo):
    - Sin pasos: las que tengan TareaHecha (marcado manual).
    - Con pasos: las entregas en las que TODOS los pasos están hechos (manual o por regla auto)."""
    if not binder:
        return set()
    ocs = _ocurrencias(t, binder, hasta_m)
    # Entregas "sin movimiento" (dormido ≥6 meses O marcado a mano): cuentan como hechas (no bloquean).
    dormidas = {f for f in ocs if _entrega_sin_mov(t, binder, f, datos)}
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
    topes = _topes(db, {binder.id})
    out: list[str] = []
    ts = db.scalars(select(Tarea).where(
        Tarea.binder_id == binder.id, Tarea.estado == "Activa")).all()
    for t in ts:
        relevante = (t.categoria in categorias) or any(p.regla_auto in reglas for p in t.pasos)
        if not relevante:
            continue
        hasta_m = topes.get((t.binder_id, t.categoria), _VENC)
        done = _fechas_hechas(t, binder, datos, hasta_m)
        if any(f not in done and _debida(t, f, hoy, False) for f in _ocurrencias(t, binder, hasta_m)):
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
    _FLAG = {"Risk": "hace_risk", "Premium": "hace_premium", "Claims": "hace_claims"}
    creadas = actualizadas = 0
    for categoria, c_int, c_plazo, titulo in _BDX_AUTO:
        if getattr(binder, _FLAG[categoria]) is False:   # el binder NO hace esta línea -> no generar
            continue
        frecuencia = getattr(binder, c_int, None)
        if frecuencia not in PASO_MESES:        # sin intervalo válido -> no se genera esa categoría
            continue
        if getattr(binder, _FLAG[categoria]) is None:    # aún no fijado -> queda marcado que sí la hace
            setattr(binder, _FLAG[categoria], True)
        plazo = int(getattr(binder, c_plazo, None) or 0)
        # `fecha_inicio` NO la fija la sincronización: vacía = desde el efecto (arranque natural). El
        # usuario puede ponerla a mano como "primer mes a mostrar" de esa tarea, y no se la pisamos.
        # `fecha_fin` tampoco: el nº de entregas lo calcula _ocurrencias (efecto→vencimiento).
        t = db.scalar(select(Tarea).where(
            Tarea.binder_id == binder.id, Tarea.origen == "auto", Tarea.categoria == categoria))
        if t:
            t.titulo, t.frecuencia = titulo, frecuencia
            actualizadas += 1
        else:
            db.add(Tarea(
                binder_id=binder.id, titulo=titulo, categoria=categoria, origen="auto",
                descripcion=f"Generada del BDX del binder. Fecha límite = fin de periodo + {plazo} días.",
                frecuencia=frecuencia, fecha_inicio=None, fecha_fin=None,
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
    proxima: dt.date | None = None   # próxima ocurrencia pendiente y debida (fecha límite; uso interno)
    proxima_periodo: str | None = None   # MES DEL DATO de esa próxima pendiente ('YYYY-MM') → lo que se muestra
    terminada: bool = False     # sus fases ya vencieron (Hasta pasado) o están en 'No aplica' → sin nuevas entregas


def _serializar(db: Session, t: Tarea, datos: dict | None = None, topes: dict | None = None) -> TareaRead:
    binder = db.get(Binder, t.binder_id)
    if datos is None:
        datos = _periodos_datos(db, {t.binder_id})
    hasta_m = (topes if topes is not None else _topes(db, {t.binder_id})).get((t.binder_id, t.categoria), _VENC)
    d = TareaRead.model_validate(t)
    d.binder_umr = (binder.umr or binder.agreement_number) if binder else None
    d.agencia = (binder.productor.nombre if binder and binder.productor else None)
    d.programa = (binder.programa.nombre if binder and binder.programa else None)
    ocs = _ocurrencias(t, binder, hasta_m) if binder else []
    hechas = _fechas_hechas(t, binder, datos, hasta_m)
    hoy = dt.date.today()
    # Una entrega solo "existe" cuando su plazo (con su aviso) ha llegado. Las futuras NO cuentan,
    # aunque el dato del periodo ya esté cargado (auto-marcado): aparecen al cumplirse su fecha.
    activas = [f for f in ocs if _debida(t, f, hoy, False)]
    d.n_ocurrencias = len(activas)
    d.n_hechas = len([f for f in activas if f in hechas])
    d.n_pasos = len(t.pasos)
    d.proxima = next((f for f in activas if f not in hechas), None)
    d.proxima_periodo = _periodo_de(binder, t, d.proxima, _paso(t)) if (binder and d.proxima) else None
    d.terminada = (t.origen == "auto") and _cat_terminada(hasta_m)
    return d


@router.get("/tareas", response_model=list[TareaRead])
def listar_todas(db: Session = Depends(get_db)):
    """Todas las tareas de todos los binders (página global). Mismos datos que la pestaña del binder."""
    ts = db.scalars(select(Tarea).options(*_opc_tarea()).order_by(Tarea.id)).all()
    ids = {t.binder_id for t in ts}
    datos = _periodos_datos(db, ids)
    topes = _topes(db, ids)
    return [_serializar(db, t, datos, topes) for t in ts]


class PasoEstado(BaseModel):
    paso_id: int
    titulo: str
    orden: int
    regla_auto: str | None = None    # risk | premium | lpan | claims | None
    auto: bool = False               # el paso se marcó por la regla (dato presente), no a mano
    sin_movimiento: bool = False     # el flujo lleva ≥6 meses sin dato: cuenta como hecho pero en gris
    periodo: str | None = None       # periodo (YYYY-MM) que comprueba la regla en esta entrega
    hecho: bool
    fecha_hecha: dt.date | None = None   # cuándo se hizo (manual: a mano; auto: fecha de carga del dato)
    bloqueado: bool = False          # tarea secuencial: hay un paso anterior sin completar (no marcable aún)
    avisar_orden: bool = False       # paso pendiente cuando un paso POSTERIOR ya está hecho (marcar con fecha)


def _pasos_de_ocurrencia(t: Tarea, binder: Binder | None, f: dt.date, k: int,
                         datos: dict, manual: dict, fechas_carga: dict | None = None) -> tuple[list[PasoEstado], bool]:
    """Estado de los pasos de UNA ocurrencia (fecha f, índice k) + si la entrega está completa.
    `manual` = {(paso_id, fecha): TareaPasoHecho}. Un paso está hecho si está marcado a mano o si su
    regla auto se cumple para el periodo de esa entrega. `fechas_carga` (opcional) pone la fecha de los
    pasos auto = cuándo se cargó el dato."""
    periodo = _periodo_de(binder, t, f, _paso(t)) if binder else None
    # Entrega "sin movimiento": dormido ≥6 meses (auto) o marcado a mano → toda la entrega es moot.
    # Todos sus pasos salen en gris (satisfechos, no marcables como pendientes).
    if _entrega_sin_mov(t, binder, f, datos):
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
    # consecutivos. El bloqueo solo afecta a los pasos MANUALES; los AUTO se marcan con el dato (ver abajo).
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
        # Un paso AUTO lo gobierna el DATO: si está cargado, está hecho — el orden secuencial NO lo bloquea
        # (el dato es un hecho). El bloqueo secuencial solo afecta a los pasos MANUALES. El paso anterior que
        # falte sale con "avisar_orden" (⚠) más abajo, no bloqueando el auto.
        if p.regla_auto:
            hecho = auto_done or (ph is not None)
        else:
            hecho = (ph is not None) and not bloqueado
        if not hecho:
            completa = False
            grupo_completo = False
        # Fecha: manual = la marcada a mano; auto (hecho por dato) = la fecha de CARGA del dato del periodo.
        f_hecha = ph.fecha_hecha if ph else None
        if f_hecha is None and p.regla_auto and auto_done and fechas_carga and binder:
            f_hecha = fechas_carga.get(p.regla_auto, {}).get(binder.id, {}).get(periodo)
        pasos.append(PasoEstado(
            paso_id=p.id, titulo=p.titulo, orden=p.orden,
            regla_auto=p.regla_auto, auto=(auto_done and ph is None),
            periodo=periodo if p.regla_auto else None,
            hecho=hecho, fecha_hecha=f_hecha,
            bloqueado=(False if p.regla_auto else bloqueado),
        ))
    # Aviso de orden: un paso pendiente cuando un paso POSTERIOR (mayor orden) ya está hecho → hay que
    # marcarlo (con su fecha). En tareas secuenciales no se da (el orden ya está garantizado).
    max_hecho = max((p.orden for p in pasos if p.hecho), default=None)
    if max_hecho is not None:
        for p in pasos:
            if not p.hecho and p.orden < max_hecho:
                p.avisar_orden = True
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
    periodo: str | None = None   # MES DEL DATO (BDX) que cubre la entrega, 'YYYY-MM' (igual que la parrilla)
    estado: str               # hecha | pendiente | futura | sin_movimiento (no hay 'vencida')
    fecha_hecha: dt.date | None = None
    sin_mov_manual: bool = False   # 'sin movimiento' puesto A MANO (se puede deshacer; el auto no)
    pasos: list[PasoEstado] = []   # checklist de esta entrega (vacío si la tarea no tiene pasos)
    n_pasos: int = 0
    n_pasos_hechos: int = 0


@router.get("/tareas/agenda", response_model=list[AgendaItem])
def agenda(binder_id: int | None = None, solo_pendientes: bool = False, db: Session = Depends(get_db)):
    """Todas las ocurrencias (fechas límite) de las tareas activas, APLANADAS y con su estado, para la
    vista por mes. 'pendiente' = no hecha y ya debida (su mes ya toca)."""
    hoy = dt.date.today()
    q = select(Tarea).where(Tarea.estado != "Pausada")
    if binder_id is not None:
        q = q.where(Tarea.binder_id == binder_id)
    tareas = db.scalars(q.options(*_opc_tarea()).order_by(Tarea.id)).all()
    ids = {t.binder_id for t in tareas}
    datos = _periodos_datos(db, ids)
    fechas_carga = _fechas_carga(db, ids)
    topes = _topes(db, ids)
    out: list[AgendaItem] = []
    for t in tareas:
        binder = db.get(Binder, t.binder_id)
        if not binder:
            continue
        hasta_m = topes.get((t.binder_id, t.categoria), _VENC)
        hechas = {h.fecha_ocurrencia: h for h in t.hechas}
        manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
        done = _fechas_hechas(t, binder, datos, hasta_m)
        for k, f in enumerate(_ocurrencias(t, binder, hasta_m)):
            if f < _suelo_entregas():          # tope rodante (para manuales; las auto ya vienen acotadas)
                continue
            h = hechas.get(f)
            pasos, _ = _pasos_de_ocurrencia(t, binder, f, k, datos, manual, fechas_carga)
            if _es_futura(t, binder, f, hoy):
                estado = "futura"      # su mes de trabajo aún no ha llegado (igual que la parrilla)
            elif f in done:
                # Completa por dato/mano = "hecha" (verde). Completa SOLO porque el flujo lleva ≥6 meses
                # dormido (nada real hecho) = "sin_movimiento" (gris): informa pero no es pendiente.
                hay_real = (h is not None and not h.sin_movimiento) or any(p.hecho and not p.sin_movimiento for p in pasos)
                estado = "hecha" if hay_real else "sin_movimiento"
            else:
                estado = "pendiente"   # ya toca y no está hecha → pendiente (no hay 'vencida': no aporta)
            if solo_pendientes and estado != "pendiente":
                continue
            out.append(AgendaItem(
                tarea_id=t.id, titulo=t.titulo, categoria=t.categoria, origen=t.origen,
                binder_id=t.binder_id, binder_umr=(binder.umr or binder.agreement_number),
                agencia=(binder.productor.nombre if binder.productor else None),
                programa=(binder.programa.nombre if binder.programa else None),
                fecha=f, periodo=_periodo_de(binder, t, f, _paso(t)), estado=estado, fecha_hecha=(h.fecha_hecha if h else None),
                sin_mov_manual=(h is not None and h.sin_movimiento),
                pasos=pasos, n_pasos=len(pasos), n_pasos_hechos=sum(1 for p in pasos if p.hecho),
            ))
    out.sort(key=lambda x: (x.fecha, x.binder_umr or "", x.categoria))
    return out


# ══════════ CUADRÍCULA (binders × fases del pipeline, pastillas del dato) ══════════
class CuadriculaColumna(BaseModel):
    id: int
    grupo: str
    nombre: str
    tipo: str                       # auto | manual
    regla: str | None = None


class CuadriculaFila(BaseModel):
    binder_id: int
    umr: str
    agencia: str | None = None
    programa: str | None = None
    celdas: dict[int, str]          # columna_id -> 'ok' | 'pend' | 'na'
    n_pend: int = 0
    enlazadas: list[int] = []       # columnas cuya pastilla la gobierna un paso del checklist (no clicable)


class Cuadricula(BaseModel):
    periodo: str
    columnas: list[CuadriculaColumna]
    filas: list[CuadriculaFila]


def _cobro_por_periodo(db: Session, binder_ids: set[int]) -> dict[int, set[str]]:
    """Meses (YYYY-MM) con al menos un recibo del binder cobrado (prima_fecha_cobro)."""
    out: dict[int, set[str]] = defaultdict(set)
    if not binder_ids:
        return out
    for bid, per in db.execute(
        select(Recibo.binder_id, Recibo.periodo).where(
            Recibo.binder_id.in_(binder_ids), Recibo.periodo.is_not(None),
            Recibo.prima_fecha_cobro.is_not(None), Recibo.estado != "Anulado")
    ).all():
        out[bid].add(per)
    return out


def _enlaces_hechos(db: Session, binder_ids: set[int], datos: dict, topes: dict | None = None):
    """Pasos del checklist ENLAZADOS a una fase (columna) de la parrilla. Devuelve:
    - enlazadas: {(binder_id, columna_id)} con ≥1 paso enlazado (la pastilla la gobierna el checklist).
    - hechos: {(binder_id, columna_id): set(periodos 'YYYY-MM') en los que ese paso está hecho}.
    Un paso está 'hecho' en un periodo si su ocurrencia de ese mes está marcada a mano o su regla auto se cumple."""
    enlazadas: set[tuple[int, int]] = set()
    hechos: dict[tuple[int, int], set[str]] = defaultdict(set)
    if not binder_ids:
        return enlazadas, hechos
    if topes is None:
        topes = _topes(db, binder_ids)
    pasos = db.scalars(select(TareaPaso).where(TareaPaso.columna_id.is_not(None))
                       .options(selectinload(TareaPaso.hechos), selectinload(TareaPaso.tarea))).all()
    for p in pasos:
        t = p.tarea
        if not t or t.binder_id not in binder_ids or t.estado == "Pausada":
            continue
        binder = db.get(Binder, t.binder_id)
        if not binder:
            continue
        enlazadas.add((t.binder_id, p.columna_id))
        marcadas = {ph.fecha_ocurrencia for ph in p.hechos}
        paso_m = _paso(t)
        for f in _ocurrencias(t, binder, topes.get((t.binder_id, t.categoria), _VENC)):
            periodo = _periodo_de(binder, t, f, paso_m)
            if periodo and (f in marcadas or _auto_ok(p, periodo, datos, binder.id)):
                hechos[(t.binder_id, p.columna_id)].add(periodo)
    return enlazadas, hechos


def _sinmov_periodos(db: Session, binder_ids: set[int], datos: dict, topes: dict | None = None):
    """Meses 'sin movimiento' por (binder, categoría) → set de periodos 'YYYY-MM'. Devuelve dos dicts:
    - `todos`: manual O flujo dormido ≥6 meses → la parrilla los pinta 'na' (no pendientes).
    - `manual`: solo los marcados A MANO → el mes NO se oculta aunque quede todo 'na' (que se vea en gris)."""
    todos: dict[tuple[int, str], set[str]] = defaultdict(set)
    manual: dict[tuple[int, str], set[str]] = defaultdict(set)
    if not binder_ids:
        return todos, manual
    if topes is None:
        topes = _topes(db, binder_ids)
    tareas = db.scalars(select(Tarea).where(Tarea.binder_id.in_(binder_ids), Tarea.estado != "Pausada")
                        .options(selectinload(Tarea.hechas))).all()
    for t in tareas:
        binder = db.get(Binder, t.binder_id)
        if not binder:
            continue
        paso_m = _paso(t)
        for f in _ocurrencias(t, binder, topes.get((t.binder_id, t.categoria), _VENC)):
            if _entrega_sin_mov(t, binder, f, datos):
                periodo = _periodo_de(binder, t, f, paso_m)
                if periodo:
                    todos[(t.binder_id, t.categoria)].add(periodo)
                    if _sinmov_manual(t, f):
                        manual[(t.binder_id, t.categoria)].add(periodo)
    return todos, manual


def _estado_celda(c, per: str, b: Binder, cfg, cats: set[str], datos, cobro, manual_map,
                  enlazadas: set | None = None, hechos: dict | None = None, inicios: dict | None = None,
                  sinmov: dict | None = None) -> str:
    """Estado de una celda (columna c, mes per) para el binder b: 'ok' | 'pend' | 'na'. ÚNICA fuente de
    verdad, compartida por la cuadrícula global (un mes × todos los binders) y la del binder (un binder ×
    todos los meses), para que coincidan exactamente."""
    enlazadas = enlazadas or set()
    hechos = hechos or {}
    sinmov = sinmov or {}
    def existe() -> bool:
        if c.regla == "cobro":
            return per in cobro.get(b.id, set())
        return per in datos.get(c.regla, {}).get(b.id, set())
    def activo(con_dormido: bool) -> str:
        """Estado cuando la fase APLICA (ya descartados los 'na' por efecto/rango/vto/categoría)."""
        # Enlazada a un paso del checklist → MANDA el paso, sea la columna AUTO o MANUAL (un solo sitio
        # donde marcar, y la parrilla lo refleja). Esto también cubre columnas auto como Cobrado/LPANs.
        if (b.id, c.id) in enlazadas:
            return "ok" if per in hechos.get((b.id, c.id), set()) else "pend"
        if c.tipo == "auto":
            if con_dormido and not existe():
                regla = "premium" if c.regla == "cobro" else c.regla
                return "na" if _dato_dormido(datos, regla, b, per) else "pend"
            return "ok" if existe() else "pend"
        m = manual_map.get((b.id, c.id))
        if m and m.hecho:
            return "ok"
        if con_dormido and _dato_dormido(datos, _CAT_REGLA.get(c.grupo), b, per):
            return "na"
        return "pend"
    inicios = inicios or {}
    efecto_m = b.fecha_efecto.strftime("%Y-%m") if b.fecha_efecto else None
    venc_m = b.fecha_vencimiento.strftime("%Y-%m") if b.fecha_vencimiento else None
    if c.grupo not in cats:                          # el binder no hace esa fase (o está pausada) → antes que todo
        return "na"
    if efecto_m and per < efecto_m:                  # antes del efecto: el binder no existe
        return "na"
    ini_cat = inicios.get(c.grupo)                   # 'fecha_inicio' de la tarea de esa categoría (primer mes)
    if ini_cat and per < ini_cat:                    # antes del arranque de esa tarea → no aplica
        return "na"
    es_sinmov = per in sinmov.get((b.id, c.grupo), ())   # mes 'sin movimiento' (manual o dormido) → no pendiente
    if cfg is not None:                              # config manual del binder → manda (sin grisear por dormido)
        if (not cfg.aplica) or (cfg.hasta and per > cfg.hasta) or (cfg.desde and per < cfg.desde):
            return "na"
        if es_sinmov:
            return "na"
        return activo(con_dormido=False)
    if venc_m and per > venc_m:                       # sin override: por defecto aplica hasta el vencimiento
        return "na"
    if es_sinmov:
        return "na"
    return activo(con_dormido=True)


def _meses_binder(b: Binder, hasta_m: str | None = _VENC, tope: int = 36) -> list[str]:
    """Meses YYYY-MM del binder para su cuadrícula. Cada fila = MES DEL DATO (el periodo del BDX), NO el
    mes en que se trabaja: el BDX de un mes se recibe/procesa el mes siguiente. Por eso el último periodo
    visible es el mes ANTERIOR al actual (su BDX ya vence); el del mes en curso aún no toca. Del efecto a
    ese tope (o al vencimiento si ya pasó, salvo que la config de fases lo extienda: `hasta_m` None = vivo).
    MÁS RECIENTE primero."""
    if not b.fecha_efecto:
        return []
    if hasta_m == "":       # ninguna categoría aplica (todas terminadas / No aplica) → sin filas
        return []
    tope_mes = _add_months(dt.date.today().replace(day=1), -1)   # el dato del mes actual aún no vence
    ini = b.fecha_efecto.replace(day=1)
    if hasta_m == _VENC:
        fin = b.fecha_vencimiento.replace(day=1) if b.fecha_vencimiento else tope_mes
    elif hasta_m is None:
        fin = tope_mes      # fase viva (Hasta en blanco): run-off hasta el mes anterior al actual
    else:
        fin = dt.date(int(hasta_m[:4]), int(hasta_m[5:7]), 1)
    if fin > tope_mes:      # binder en vigor: no mostrar el mes en curso (su BDX no vence hasta el siguiente)
        fin = tope_mes
    # Si el efecto es POSTERIOR al tope (binder que arranca este mes o más adelante), aún no hay ningún
    # periodo que tocar: se devuelve vacío (igual que el detalle, que oculta ese mes como 'futuro').
    out: list[str] = []
    y, m = fin.year, fin.month
    while (y, m) >= (ini.year, ini.month) and len(out) < tope:
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


@router.get("/tareas/cuadricula", response_model=Cuadricula)
def cuadricula(mes: str | None = None, db: Session = Depends(get_db)):
    """Matriz binders × columnas (fases del pipeline). Celda: 'ok' (verde, hecho) · 'pend' (rojo,
    pendiente) · 'na' (gris, no aplica). Auto = del DATO (risk/premium/claims/lpan/cobro); manual = a
    mano. 'na' cuando el binder no hace esa fase (no tiene tarea de esa categoría) o el flujo está dormido.
    Por defecto el mes = el ANTERIOR al actual (la fila es el mes del dato, y el del mes en curso aún no
    vence: su BDX se recibe/procesa el mes siguiente)."""
    per = (mes or _add_months(dt.date.today().replace(day=1), -1).strftime("%Y-%m")).strip()
    columnas = db.scalars(select(TareaColumna).where(TareaColumna.activa.is_(True))
                          .order_by(TareaColumna.orden, TareaColumna.id)).all()
    # Qué categorías hace cada binder = de sus flags DURABLES (no de que existan tareas auto, que se pueden
    # borrar). Un binder participa si hace ≥1 categoría.
    activas_c: dict[int, set[str]] = defaultdict(set)      # categorías con tarea ACTIVA (auto o MANUAL)
    fi_cat: dict[tuple[int, str], list] = defaultdict(list)   # (binder, cat) -> fecha_inicio de sus tareas activas
    for t in db.scalars(select(Tarea)).all():             # TODAS (auto o manual)
        if t.estado != "Pausada":
            activas_c[t.binder_id].add(t.categoria)
            fi_cat[(t.binder_id, t.categoria)].append(t.fecha_inicio)
    # Suelo de la parrilla por (binder, categoría): solo si TODAS las tareas activas de esa categoría (auto
    # o manual) tienen fecha_inicio (si alguna arranca en el efecto, la categoría se ve desde el efecto).
    inicios_binder: dict[int, dict[str, str]] = defaultdict(dict)
    for (bid, cat), fis in fi_cat.items():
        if fis and all(fi is not None for fi in fis):
            inicios_binder[bid][cat] = min(fi.strftime("%Y-%m") for fi in fis)
    cats_binder: dict[int, set[str]] = {}
    binders: dict[int, Binder] = {}
    for b in db.scalars(select(Binder).where(Binder.fecha_efecto.is_not(None))
                        .options(selectinload(Binder.productor), selectinload(Binder.programa))).all():
        # La parrilla la MANDAN las tareas: una categoría sale solo si tiene una tarea ACTIVA (auto o manual).
        # Sin tarea (aunque el flag durable diga que sí, o haya datos sueltos) → no aplica. Pausada → oculta.
        cats = activas_c.get(b.id, set())
        if cats:
            cats_binder[b.id] = cats
            binders[b.id] = b
    binder_ids = set(cats_binder)
    datos = _periodos_datos(db, binder_ids)
    cobro = _cobro_por_periodo(db, binder_ids)
    manual = {(m.binder_id, m.columna_id): m for m in db.scalars(select(TareaMatrizManual).where(
        TareaMatrizManual.periodo == per, TareaMatrizManual.binder_id.in_(binder_ids))).all()}
    # Config por binder (aplica + desde/hasta): si existe, MANDA ella (anula la adivinación por dormido).
    cfgs = {(cb.binder_id, cb.columna_id): cb for cb in db.scalars(select(TareaColumnaBinder).where(
        TareaColumnaBinder.binder_id.in_(binder_ids))).all()}
    enlazadas, hechos = _enlaces_hechos(db, binder_ids, datos)
    sinmov, _sinmov_manual_ = _sinmov_periodos(db, binder_ids, datos)

    filas: list[CuadriculaFila] = []
    for bid in binder_ids:
        b = binders.get(bid)
        if not b:
            continue
        celdas: dict[int, str] = {}
        n_pend = 0
        for c in columnas:
            estado = _estado_celda(c, per, b, cfgs.get((bid, c.id)), cats_binder[bid], datos, cobro, manual, enlazadas, hechos, inicios_binder.get(bid), sinmov)
            celdas[c.id] = estado
            if estado == "pend":
                n_pend += 1
        if all(v == "na" for v in celdas.values()):      # nada aplica este mes → no se muestra el binder
            continue
        filas.append(CuadriculaFila(
            binder_id=bid, umr=(b.umr or b.agreement_number or f"#{bid}"),
            agencia=(b.productor.nombre if b.productor else None),
            programa=(b.programa.nombre if b.programa else None), celdas=celdas, n_pend=n_pend,
            enlazadas=[c.id for c in columnas if (bid, c.id) in enlazadas]))
    filas.sort(key=lambda f: (-f.n_pend, f.umr))
    return Cuadricula(
        periodo=per,
        columnas=[CuadriculaColumna(id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo, regla=c.regla) for c in columnas],
        filas=filas)


class BinderCuadriculaMes(BaseModel):
    periodo: str
    celdas: dict[int, str]          # columna_id -> 'ok' | 'pend' | 'na'


class BinderCuadricula(BaseModel):
    columnas: list[CuadriculaColumna]
    meses: list[BinderCuadriculaMes]
    enlazadas: list[int] = []       # columnas cuya pastilla la gobierna un paso del checklist (no clicable)


@router.get("/binders/{binder_id}/cuadricula", response_model=BinderCuadricula)
def binder_cuadricula(binder_id: int, db: Session = Depends(get_db)):
    """La fila del pipeline de ESTE binder, mes a mes: las MISMAS fases y la MISMA lógica de celda que la
    cuadrícula global, para que coincidan exactamente. Meses del efecto al vencimiento, reciente primero."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    columnas = db.scalars(select(TareaColumna).where(TareaColumna.activa.is_(True))
                          .order_by(TareaColumna.orden, TareaColumna.id)).all()
    all_ts = db.scalars(select(Tarea).where(Tarea.binder_id == binder_id)).all()
    # Suelo por categoría (auto o MANUAL): solo si TODAS las tareas activas de la categoría tienen
    # fecha_inicio (si alguna arranca en el efecto, la categoría se ve desde el efecto).
    fi_cat: dict[str, list] = {}
    for t in all_ts:
        if t.estado != "Pausada":
            fi_cat.setdefault(t.categoria, []).append(t.fecha_inicio)
    inicios = {cat: min(fi.strftime("%Y-%m") for fi in fis)
               for cat, fis in fi_cat.items() if fis and all(fi is not None for fi in fis)}
    # La parrilla la MANDAN las tareas: una categoría sale solo si tiene una tarea ACTIVA (auto o manual).
    # Sin tarea (aunque el flag durable diga que sí, o haya datos sueltos) → no aplica. Pausada → oculta.
    cats = {t.categoria for t in all_ts if t.estado != "Pausada"}
    datos = _periodos_datos(db, {binder_id})
    cobro = _cobro_por_periodo(db, {binder_id})
    manual_map = {(m.binder_id, m.columna_id): m for m in db.scalars(select(TareaMatrizManual).where(
        TareaMatrizManual.binder_id == binder_id)).all()}
    cfgs = {(cb.binder_id, cb.columna_id): cb for cb in db.scalars(select(TareaColumnaBinder).where(
        TareaColumnaBinder.binder_id == binder_id)).all()}
    topes = _topes(db, {binder_id})
    hasta_fila = _hasta_binder(topes, binder_id, cats)
    enlazadas, hechos = _enlaces_hechos(db, {binder_id}, datos, topes)
    sinmov, sinmov_manual = _sinmov_periodos(db, {binder_id}, datos, topes)
    meses_manual = {p for ps in sinmov_manual.values() for p in ps}   # marcados a mano → no ocultar
    meses: list[BinderCuadriculaMes] = []
    for per in _meses_binder(b, hasta_fila):
        celdas = {c.id: _estado_celda(c, per, b, cfgs.get((binder_id, c.id)), cats, datos, cobro, manual_map, enlazadas, hechos, inicios, sinmov)
                  for c in columnas}
        # mes todo-"na" → no se muestra, SALVO que sea un mes marcado a mano 'sin movimiento' (se ve en gris).
        if all(v == "na" for v in celdas.values()) and per not in meses_manual:
            continue
        meses.append(BinderCuadriculaMes(periodo=per, celdas=celdas))
    return BinderCuadricula(
        columnas=[CuadriculaColumna(id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo, regla=c.regla) for c in columnas],
        meses=meses, enlazadas=[c.id for c in columnas if (binder_id, c.id) in enlazadas])


# ── Cuadrícula anual: subtareas PENDIENTES por binder × mes (del dato) × categoría ──
class PendMesFila(BaseModel):
    binder_id: int
    umr: str | None = None
    agencia: str | None = None
    programa: str | None = None
    celdas: dict[str, dict[str, int | None]]   # 'YYYY-MM' -> {'Risk': n|None, 'Premium': n|None, 'Claims': n|None}


class PendMesResp(BaseModel):
    meses: list[str]
    filas: list[PendMesFila]


@router.get("/tareas/pendientes-mes", response_model=PendMesResp)
def pendientes_por_mes(desde: str = "2026-01", db: Session = Depends(get_db)):
    """Nº de subtareas PENDIENTES por binder × mes DEL DATO × categoría (Risk/Premium/Claims), de `desde`
    al mes actual. Celda = pasos sin marcar de esa entrega; None = no aplica ese mes (o aún no toca);
    0 = aplica y está hecho. Filas = binders (el front las agrupa por agencia)."""
    hoy = dt.date.today()
    y, m = int(desde[:4]), int(desde[5:7])
    meses: list[str] = []
    while (y, m) <= (hoy.year, hoy.month):
        meses.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y += 1; m = 1
    meses_set = set(meses)
    CATS = ["Risk", "Premium", "Claims"]
    tareas = db.scalars(select(Tarea).where(Tarea.estado == "Activa", Tarea.categoria.in_(CATS)).options(
        selectinload(Tarea.pasos).selectinload(TareaPaso.hechos), selectinload(Tarea.hechas))).all()
    bids = {t.binder_id for t in tareas}
    binders = {b.id: b for b in db.scalars(select(Binder).where(Binder.id.in_(bids))
               .options(selectinload(Binder.productor), selectinload(Binder.programa)))} if bids else {}
    datos = _periodos_datos(db, bids)
    topes = _topes(db, bids)
    celdas: dict[int, dict[str, dict[str, int]]] = {}
    for t in tareas:
        b = binders.get(t.binder_id)
        if not b:
            continue
        hasta_m = topes.get((t.binder_id, t.categoria), _VENC)
        ocs = _ocurrencias(t, b, hasta_m)
        hechas = _fechas_hechas(t, b, datos, hasta_m)
        manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
        bmap = celdas.setdefault(t.binder_id, {})
        for k, f in enumerate(ocs):
            per = _periodo_de(b, t, f, _paso(t))
            if per not in meses_set or _es_futura(t, b, f, hoy):
                continue                     # fuera de rango o aún no toca → queda en blanco
            if f in hechas:
                n = 0
            elif t.pasos:
                pf, _c = _pasos_de_ocurrencia(t, b, f, k, datos, manual)
                n = sum(1 for p in pf if not p.hecho)
            else:
                n = 1
            bmap.setdefault(per, {})[t.categoria] = n
    filas = []
    for bid, b in binders.items():
        bcel = celdas.get(bid, {})
        cel = {mes: {cat: bcel.get(mes, {}).get(cat) for cat in CATS} for mes in meses}
        filas.append(PendMesFila(
            binder_id=bid, umr=(b.umr or b.agreement_number),
            agencia=(b.productor.nombre if b.productor else None),
            programa=(b.programa.nombre if b.programa else None), celdas=cel))
    filas.sort(key=lambda x: ((x.agencia or "").lower(), x.umr or ""))
    return PendMesResp(meses=meses, filas=filas)


# ── Config de columnas de la cuadrícula (editable, común a todos los binders) ──
class ColumnaIn(BaseModel):
    grupo: str
    nombre: str
    tipo: str                       # auto | manual
    regla: str | None = None
    orden: int = 0
    activa: bool = True


@router.get("/tareas/columnas", response_model=list[CuadriculaColumna])
def listar_columnas(db: Session = Depends(get_db)):
    cols = db.scalars(select(TareaColumna).order_by(TareaColumna.orden, TareaColumna.id)).all()
    return [CuadriculaColumna(id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo, regla=c.regla) for c in cols]


@router.post("/tareas/columnas", response_model=CuadriculaColumna, status_code=201)
def crear_columna(payload: ColumnaIn, db: Session = Depends(get_db)):
    c = TareaColumna(grupo=payload.grupo.strip(), nombre=payload.nombre.strip(), tipo=payload.tipo,
                     regla=(payload.regla or None), orden=payload.orden, activa=payload.activa)
    db.add(c); db.commit(); db.refresh(c)
    return CuadriculaColumna(id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo, regla=c.regla)


@router.put("/tareas/columnas/{col_id}", response_model=CuadriculaColumna)
def editar_columna(col_id: int, payload: ColumnaIn, db: Session = Depends(get_db)):
    c = db.get(TareaColumna, col_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Columna no encontrada.")
    c.grupo, c.nombre, c.tipo = payload.grupo.strip(), payload.nombre.strip(), payload.tipo
    c.regla, c.orden, c.activa = (payload.regla or None), payload.orden, payload.activa
    db.commit()
    return CuadriculaColumna(id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo, regla=c.regla)


@router.delete("/tareas/columnas/{col_id}", status_code=204)
def borrar_columna(col_id: int, db: Session = Depends(get_db)):
    c = db.get(TareaColumna, col_id)
    if c is not None:
        db.delete(c); db.commit()


# ── Config de las columnas POR BINDER (aplica + hasta qué mes) — en la pestaña Tareas del binder ──
class ColumnaBinderRead(BaseModel):
    columna_id: int
    grupo: str
    nombre: str
    tipo: str
    aplica: bool = True         # False = "No aplica" siempre
    desde: str | None = None    # 'YYYY-MM' (opcional)
    hasta: str | None = None    # 'YYYY-MM' — aplica hasta ese mes inclusive
    auto: bool = True           # True = sin override (la app decide sola)


class ColumnaBinderIn(BaseModel):
    aplica: bool = True
    desde: str | None = None
    hasta: str | None = None


class ColumnasConfigResp(BaseModel):
    efecto: str | None = None        # 'YYYY-MM' del binder (default de "Desde")
    vencimiento: str | None = None   # 'YYYY-MM' del binder (default de "Hasta")
    columnas: list[ColumnaBinderRead]


@router.get("/binders/{binder_id}/columnas-config", response_model=ColumnasConfigResp)
def columnas_config(binder_id: int, db: Session = Depends(get_db)):
    """Las columnas de la cuadrícula con la config de ESTE binder (aplica + desde/hasta) y el periodo
    del binder (efecto/vencimiento) como defaults de Desde/Hasta. `auto`=True cuando no hay override."""
    b = db.get(Binder, binder_id)
    cols = db.scalars(select(TareaColumna).where(TareaColumna.activa.is_(True))
                      .order_by(TareaColumna.orden, TareaColumna.id)).all()
    cfg = {cb.columna_id: cb for cb in db.scalars(select(TareaColumnaBinder).where(
        TareaColumnaBinder.binder_id == binder_id)).all()}
    out = []
    for c in cols:
        cb = cfg.get(c.id)
        out.append(ColumnaBinderRead(columna_id=c.id, grupo=c.grupo, nombre=c.nombre, tipo=c.tipo,
            aplica=(cb.aplica if cb else True), desde=(cb.desde if cb else None),
            hasta=(cb.hasta if cb else None), auto=(cb is None)))
    return ColumnasConfigResp(
        efecto=(b.fecha_efecto.strftime("%Y-%m") if b and b.fecha_efecto else None),
        vencimiento=(b.fecha_vencimiento.strftime("%Y-%m") if b and b.fecha_vencimiento else None),
        columnas=out)


@router.put("/binders/{binder_id}/columnas-config/{columna_id}", response_model=ColumnaBinderRead)
def set_columna_config(binder_id: int, columna_id: int, payload: ColumnaBinderIn, db: Session = Depends(get_db)):
    """Fija la config de una columna para un binder (aplica + rango de meses). Si vuelve al defecto
    (aplica y sin desde/hasta) se borra el override → vuelve a AUTOMÁTICO (la app decide)."""
    col = db.get(TareaColumna, columna_id)
    if col is None:
        raise HTTPException(status_code=404, detail="Columna no encontrada.")
    desde, hasta = (payload.desde or None), (payload.hasta or None)
    cb = db.scalar(select(TareaColumnaBinder).where(
        TareaColumnaBinder.binder_id == binder_id, TareaColumnaBinder.columna_id == columna_id))
    es_defecto = payload.aplica and not desde and not hasta
    if es_defecto:
        if cb is not None:
            db.delete(cb); db.commit()
        return ColumnaBinderRead(columna_id=columna_id, grupo=col.grupo, nombre=col.nombre, tipo=col.tipo, auto=True)
    if cb is None:
        cb = TareaColumnaBinder(binder_id=binder_id, columna_id=columna_id)
        db.add(cb)
    cb.aplica, cb.desde, cb.hasta = payload.aplica, desde, hasta
    db.commit()
    return ColumnaBinderRead(columna_id=columna_id, grupo=col.grupo, nombre=col.nombre, tipo=col.tipo,
        aplica=cb.aplica, desde=cb.desde, hasta=cb.hasta, auto=False)


@router.get("/binders/{binder_id}/tareas", response_model=list[TareaRead])
def listar(binder_id: int, db: Session = Depends(get_db)):
    ts = db.scalars(select(Tarea).where(Tarea.binder_id == binder_id).options(*_opc_tarea()).order_by(Tarea.id)).all()
    datos = _periodos_datos(db, {binder_id})
    topes = _topes(db, {binder_id})
    return [_serializar(db, t, datos, topes) for t in ts]


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
        # Se copia también `columna_id` (el enlace del paso a la fase de la parrilla): la columna es
        # global, así que el enlace vale igual en el binder nuevo.
        destino.pasos.append(TareaPaso(titulo=p.titulo, orden=p.orden, regla_auto=p.regla_auto,
                                       columna_id=p.columna_id))
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
    # Copiar el "No aplica" de las fases (config de la cuadrícula, aplica=False): así el binder nuevo
    # hereda qué fases no van, sin re-marcarlas a mano. Las fechas (desde/hasta) son propias de cada
    # binder → no se copian. No pisa una config ya puesta en el destino.
    ya_cfg = {cb.columna_id for cb in db.scalars(select(TareaColumnaBinder).where(
        TareaColumnaBinder.binder_id == binder_id)).all()}
    config_copiada = 0
    for cb in db.scalars(select(TareaColumnaBinder).where(
            TareaColumnaBinder.binder_id == prev.id, TareaColumnaBinder.aplica.is_(False))).all():
        if cb.columna_id in ya_cfg:
            continue
        db.add(TareaColumnaBinder(binder_id=binder_id, columna_id=cb.columna_id, aplica=False))
        config_copiada += 1
    db.commit()
    return {"tareas": tareas_creadas, "pasos": pasos_copiados, "config": config_copiada,
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
    fecha: dt.date                 # FECHA LÍMITE de la entrega (fin de periodo + plazo)
    periodo: str | None = None     # MES DEL DATO (BDX) que cubre esta entrega, 'YYYY-MM' (igual que la parrilla)
    hecha: bool
    fecha_hecha: dt.date | None = None
    notas: str | None = None
    estado: str   # 'hecha' | 'pendiente' | 'futura' | 'sin_movimiento' (no hay 'vencida')
    sin_mov_manual: bool = False   # 'sin movimiento' puesto A MANO (se puede deshacer; el auto ≥6 meses no)
    pasos: list[PasoEstado] = []   # checklist de esta ocurrencia (vacío si la tarea no tiene pasos)


@router.get("/tareas/{tarea_id}/ocurrencias")
def ocurrencias(tarea_id: int, incluir_futuras: bool = False, db: Session = Depends(get_db)):
    """Por defecto solo las ocurrencias ya 'generadas' (hechas o pendientes según su aviso);
    las futuras se ocultan hasta que toquen. `incluir_futuras=true` las muestra todas."""
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    binder = db.get(Binder, t.binder_id)
    datos = _periodos_datos(db, {t.binder_id})
    fechas_carga = _fechas_carga(db, {t.binder_id})
    hasta_m = _topes(db, {t.binder_id}).get((t.binder_id, t.categoria), _VENC)
    hechas = {h.fecha_ocurrencia: h for h in t.hechas}    # TareaHecha (tareas sin pasos / notas)
    manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
    hoy = dt.date.today()
    out: list[OcurrenciaOut] = []
    for k, f in enumerate(_ocurrencias(t, binder, hasta_m) if binder else []):
        pasos, completa = _pasos_de_ocurrencia(t, binder, f, k, datos, manual, fechas_carga)
        h = hechas.get(f)
        hecha = completa if t.pasos else (h is not None)
        moot = _entrega_sin_mov(t, binder, f, datos)
        hay_real = (h is not None and not h.sin_movimiento) or (bool(t.pasos) and any(p.hecho and not p.sin_movimiento for p in pasos))
        if _es_futura(t, binder, f, hoy):
            estado = "futura"          # su mes de trabajo aún no ha llegado (igual que la parrilla)
        elif moot and not hay_real:
            estado = "sin_movimiento"  # dormido ≥6 meses o marcado a mano: no pendiente
        elif hecha:
            estado = "hecha"
        else:
            estado = "pendiente"   # ya toca y no está hecha → pendiente (sin 'vencida': no aporta)
        if estado == "futura" and not incluir_futuras:
            continue
        out.append(OcurrenciaOut(
            fecha=f, periodo=(_periodo_de(binder, t, f, _paso(t)) if binder else None), hecha=hecha,
            fecha_hecha=(h.fecha_hecha if h else None), notas=(h.notas if h else None),
            estado=estado, sin_mov_manual=_sinmov_manual(t, f), pasos=pasos,
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
        hasta_m = _topes(db, {t.binder_id}).get((t.binder_id, t.categoria), _VENC)
        hecha = payload.fecha_ocurrencia in _fechas_hechas(t, binder, datos, hasta_m)
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
        h.sin_movimiento = False   # marcar hecha (real) anula una marca 'sin movimiento' previa
    db.commit()
    return {"ok": True, "hecha": True}


class SinMovIn(BaseModel):
    fecha_ocurrencia: dt.date
    sin_movimiento: bool = True   # True = marcar 'sin movimiento este mes'; False = deshacer


@router.post("/tareas/{tarea_id}/sin-movimiento", status_code=200)
def marcar_sin_movimiento(tarea_id: int, payload: SinMovIn, db: Session = Depends(get_db)):
    """Marca (o deshace) A MANO una entrega concreta (mes) como 'sin movimiento': confirma que ese mes no
    hubo dato (p. ej. no hay Premium ese mes en un binder activo). Deja de estar pendiente y no bloquea el
    cierre, pero SOLO ese mes — los siguientes siguen saliendo normales. Reversible; y si el dato acaba
    llegando, el auto-marcado la pone en verde igualmente."""
    t = db.get(Tarea, tarea_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Tarea {tarea_id} no encontrada")
    h = db.scalar(select(TareaHecha).where(
        TareaHecha.tarea_id == tarea_id, TareaHecha.fecha_ocurrencia == payload.fecha_ocurrencia))
    if payload.sin_movimiento:
        if h is None:
            h = TareaHecha(tarea_id=tarea_id, fecha_ocurrencia=payload.fecha_ocurrencia,
                           fecha_hecha=dt.date.today(), sin_movimiento=True)
            db.add(h)
        else:
            h.sin_movimiento = True
        db.commit()
        return {"ok": True, "sin_movimiento": True}
    # Deshacer: solo borra si la marca ERA 'sin movimiento' (no toca un 'hecha' real).
    if h is not None and h.sin_movimiento:
        db.delete(h)
        db.commit()
    return {"ok": True, "sin_movimiento": False}


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
    columna_id: int | None = None   # enlace a una fase de la parrilla (None = sin enlace)


class PasoUpdate(BaseModel):
    titulo: str | None = None
    orden: int | None = None
    regla_auto: str | None = None
    columna_id: int | None = None


class PasoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tarea_id: int
    orden: int
    titulo: str
    regla_auto: str | None = None
    columna_id: int | None = None


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
                  regla_auto=_valida_regla(payload.regla_auto), columna_id=payload.columna_id)
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
        hasta_m = _topes(db, {t.binder_id}).get((t.binder_id, t.categoria), _VENC)
        ocs = _ocurrencias(t, binder, hasta_m) if binder else []
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
    hasta_m = _topes(db, {t.binder_id}).get((t.binder_id, t.categoria), _VENC)
    hecha = payload.fecha_ocurrencia in _fechas_hechas(t, binder, datos, hasta_m)
    db.commit()
    return {"ok": True, "paso_hecho": not payload.deshacer, "ocurrencia_hecha": hecha}
