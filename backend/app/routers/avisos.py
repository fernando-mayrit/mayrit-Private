"""
Avisos / tareas pendientes de la app. Se calculan AL VUELO desde los datos (no hay estado que
mantener), así nunca se desincronizan. Cada generador añade avisos a la lista.

Primer aviso: 'risk_sin_recibo' — periodos con Risk BDX (líneas cuyo reporting_period_start cae en
ese mes) cuyo Recibo aún no se ha generado. Si un mes no tiene Risk BDX, no se espera recibo.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models.maestras import (
    AvisoNivel, Bdx, BdxLinea, Binder, ComisionLiquidacion, ConsultoriaContrato, Lpan, LpanExencion,
    Poliza, Productor, Recibo, Tarea, TareaPaso,
)

router = APIRouter(tags=["Avisos"])

# Productores que NO generan Recibo del Risk porque facturan por honorarios (módulo Consultoría),
# no por comisión. Sus binders no deben avisar de "recibo pendiente".
PRODUCTORES_SIN_RECIBO = {"insurart"}

# Catálogo de tipos de aviso: etiqueta + nivel (semáforo) por defecto. El usuario puede cambiar
# el nivel por tipo (tabla aviso_niveles). Orden del semáforo: alto > medio > bajo.
NIVELES = ("alto", "medio", "bajo")
_ORDEN_NIVEL = {"alto": 0, "medio": 1, "bajo": 2}
# Cada tipo tiene además una 'categoria': 'alerta' (temas gordos: dinero/incumplimiento) o
# 'dia' (rutina operativa del día, sobre todo tareas). Define en qué cubo cae el aviso.
TIPOS_AVISO: dict[str, dict] = {
    "factura_consultoria": {"etiqueta": "Factura de consultoría por emitir", "defecto": "alto", "categoria": "alerta"},
    "binder_sin_renovar":  {"etiqueta": "Binder por vencer sin renovar", "defecto": "alto", "categoria": "alerta"},
    "limite_sin_notificar": {"etiqueta": "Límite de primas excedido sin notificar", "defecto": "alto", "categoria": "alerta"},
    "risk_sin_recibo":     {"etiqueta": "Recibo pendiente de generar", "defecto": "medio", "categoria": "alerta"},
    "poliza_sin_renovar":  {"etiqueta": "Póliza por vencer sin renovar", "defecto": "medio", "categoria": "alerta"},
    "lpan_mes_incompleto": {"etiqueta": "Mes con LPAN a medias", "defecto": "alto", "categoria": "alerta"},
    "tarea_pendiente":     {"etiqueta": "Tarea de binder pendiente", "defecto": "medio", "categoria": "dia"},
    "lpan_sin_procesar":   {"etiqueta": "LPAN sin WP/Procesado", "defecto": "bajo", "categoria": "dia"},
    "comision_sin_reparto": {"etiqueta": "Comisión pendiente de reparto", "defecto": "bajo", "categoria": "dia"},
}


class Aviso(BaseModel):
    tipo: str                       # 'premium_sin_recibo', …
    severidad: str = "warning"      # info | warning | danger
    nivel: str = "medio"            # alto | medio | bajo (semáforo). Se rellena al listar.
    categoria: str = "alerta"       # alerta (gordos) | dia (rutina). Se rellena al listar.
    titulo: str
    detalle: str
    binder_id: int | None = None
    limite_id: int | None = None    # grupo de límite de primas (aviso 'limite_sin_notificar')
    contrato_id: int | None = None  # para avisos de consultoría
    periodo: str | None = None      # 'YYYY-MM' del cobro/factura (consultoría)
    umr: str | None = None
    periodos: list[str] = []
    pagina: str | None = None       # a dónde ir para resolverlo (p. ej. 'binders')


def _risk_sin_recibo(db: Session, binders: dict[int, Binder], prods: dict[int, str]) -> list[Aviso]:
    # Periodos de Risk BDX por binder: distinct (binder, mes) agregado en SQL (no traer todas las líneas).
    risk: dict[int, set[str]] = defaultdict(set)
    for bid, mes in db.execute(
        select(Bdx.binder_id, func.date_trunc("month", BdxLinea.reporting_period_start))
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.tipo == "Risk", BdxLinea.reporting_period_start.is_not(None))
        .distinct()
    ).all():
        risk[bid].add(mes.strftime("%Y-%m"))
    # Periodos con Recibo generado por binder (el recibo se indexa por reporting period).
    rec: dict[int, set[str]] = defaultdict(set)
    for bid, per in db.execute(
        select(Recibo.binder_id, Recibo.periodo).where(Recibo.binder_id.is_not(None), Recibo.periodo.is_not(None))
    ).all():
        rec[bid].add(per)

    avisos: list[Aviso] = []
    for bid, periodos in risk.items():
        b = binders.get(bid)
        # Saltar productores de honorarios (no generan recibo del Risk).
        nombre_prod = prods.get(b.productor_id, "") if b else ""
        if any(x in nombre_prod for x in PRODUCTORES_SIN_RECIBO):
            continue
        pendientes = sorted(periodos - rec.get(bid, set()))
        if not pendientes:
            continue
        avisos.append(Aviso(
            tipo="risk_sin_recibo", severidad="warning",
            titulo="Recibo pendiente de generar",
            detalle=f"Hay Risk BDX sin recibo en {', '.join(pendientes)}",
            binder_id=bid, umr=b.umr if b else None, periodos=pendientes, pagina="binders",
        ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


def _mas_un_mes(d: dt.date) -> dt.date:
    """d + 1 mes (ajustando fin de mes)."""
    m = d.month % 12 + 1
    y = d.year + (1 if d.month == 12 else 0)
    import calendar
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def _es_anual(efecto: dt.date | None, venc: dt.date | None) -> bool:
    """Duración ~anual. Acepta las dos convenciones de fin de término que conviven en los datos:
    venc = efecto+1año-1día (efecto+1año == venc+1día) o venc = efecto+1año (mismo día)."""
    if not efecto or not venc:
        return False
    try:
        mas = efecto.replace(year=efecto.year + 1)
    except ValueError:       # 29-feb
        mas = efecto.replace(year=efecto.year + 1, day=28)
    return mas == venc + dt.timedelta(days=1) or mas == venc


def _vencimientos_sin_renovar(db: Session, binders: dict[int, Binder]) -> list[Aviso]:
    """Binders y pólizas que vencen en ≤1 mes (o ya vencidos) en vigor y sin renovación generada."""
    hoy = dt.date.today()
    limite = _mas_un_mes(hoy)
    avisos: list[Aviso] = []

    # ── Binders: el último de cada programa (sin otro posterior) que venza pronto ──
    # Pre-índice: máxima fecha_efecto por programa → detectar renovación en O(1) (antes O(n²)).
    max_efecto: dict[int, dt.date] = {}
    for b in binders.values():
        if b.programa_id and b.fecha_efecto:
            cur = max_efecto.get(b.programa_id)
            if cur is None or b.fecha_efecto > cur:
                max_efecto[b.programa_id] = b.fecha_efecto
    for b in binders.values():
        if (b.estado or "") != "En Vigor" or b.no_renovar or not b.fecha_vencimiento or b.fecha_vencimiento > limite:
            continue
        ult = max_efecto.get(b.programa_id) if b.programa_id else None
        renovado = ult is not None and b.fecha_efecto is not None and ult > b.fecha_efecto
        if renovado:
            continue
        avisos.append(Aviso(
            tipo="binder_sin_renovar", severidad="warning",
            titulo="Binder por vencer sin renovar",
            detalle=f"Vence el {b.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
            binder_id=b.id, umr=b.umr, pagina="binders",
        ))

    # ── Pólizas anuales en vigor que vencen pronto y no tienen renovación (mismo asegurado+ramo) ──
    polizas = list(db.scalars(select(Poliza)).all())
    def _k(s):
        return (str(s).strip().lower() if s else "")
    # Pre-índice: fecha_efecto por (asegurado, ramo) → renovación en O(1) (antes O(n²)).
    efectos_por_key: dict[tuple[str, str], set[dt.date]] = defaultdict(set)
    for x in polizas:
        efectos_por_key[(_k(x.asegurado), _k(x.ramo))].add(x.fecha_efecto)
    for p in polizas:
        if (p.estado or "") != "En Vigor" or not p.fecha_vencimiento or p.fecha_vencimiento > limite:
            continue
        if not _es_anual(p.fecha_efecto, p.fecha_vencimiento):
            continue
        # La renovación empieza el día siguiente al vencimiento o el mismo día (según convención).
        objetivo = p.fecha_vencimiento + dt.timedelta(days=1)
        renovada = bool({p.fecha_vencimiento, objetivo} & efectos_por_key[(_k(p.asegurado), _k(p.ramo))])
        if renovada:
            continue
        avisos.append(Aviso(
            tipo="poliza_sin_renovar", severidad="warning",
            titulo="Póliza por vencer sin renovar",
            detalle=f"{p.asegurado + ': ' if p.asegurado else ''}vence el {p.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
            umr=p.numero_poliza, pagina="polizas",
        ))
    return avisos


MESES_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
            "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _fecha_facturacion(c: ConsultoriaContrato, f: dt.date) -> dt.date:
    """Fecha real de facturación de un cobro: el mes del cobro `f` con el día `dia_facturacion`
    del contrato (o el día de fecha_inicio si no se indicó), ajustando fin de mes."""
    import calendar
    dia = c.dia_facturacion or c.fecha_inicio.day
    return dt.date(f.year, f.month, min(dia, calendar.monthrange(f.year, f.month)[1]))


def _facturas_consultoria(db: Session) -> list[Aviso]:
    """Contratos de consultoría activos cuyo próximo cobro toca facturar pronto (≤ aviso_dias_antes
    días antes de la fecha de facturación) y aún no tiene recibo."""
    from .consultoria import _fechas_cobro      # lazy: evita import circular
    hoy = dt.date.today()
    avisos: list[Aviso] = []
    contratos = db.scalars(select(ConsultoriaContrato).where(ConsultoriaContrato.estado == "Activo")
                           .options(selectinload(ConsultoriaContrato.productor))).all()
    # Recibos generados por contrato, en UNA query (evita N+1 por contrato).
    gen_por: dict[int, set] = defaultdict(set)
    ids = [c.id for c in contratos]
    if ids:
        for cid, per in db.execute(select(Recibo.consultoria_id, Recibo.periodo)
                                   .where(Recibo.consultoria_id.in_(ids), Recibo.periodo.is_not(None))).all():
            gen_por[cid].add(per)
    for c in contratos:
        generados = gen_por.get(c.id, set())
        prox = next((f for f in _fechas_cobro(c) if f.strftime("%Y-%m") not in generados), None)
        if prox is None:
            continue
        fact = _fecha_facturacion(c, prox)
        if hoy < fact - dt.timedelta(days=c.aviso_dias_antes or 5):
            continue   # aún no toca avisar
        cliente = c.productor.nombre if c.productor else f"contrato {c.id}"
        per = prox.strftime("%Y-%m")
        avisos.append(Aviso(
            tipo="factura_consultoria",
            titulo="Factura de consultoría por emitir",
            detalle=f"{cliente}: factura de {MESES_ES[prox.month]} {prox.year} (a emitir el {fact.strftime('%d/%m/%Y')}).",
            contrato_id=c.id, periodo=per, pagina="consultoria",
        ))
    return avisos


def _lpan_mes_incompleto(db: Session, binders: dict[int, Binder]) -> list[Aviso]:
    """ROJO: meses (binder+periodo) con ALGÚN LPAN generado pero con grupos (prima our line > 0)
    todavía SIN LPAN, ni exentos, ni cubiertos por un LPAN histórico. El mes está a medias.
    Los grupos se distinguen por (sección, risk_code, comisión total %): el desdoble por comisión."""
    def _q2(x) -> Decimal:
        return Decimal(str(x or 0)).quantize(Decimal("0.01"))

    # LPAN por comisión concreta, LPAN histórico (sin comisión = cubre el rc entero), y periodos con LPAN.
    lpan_exact: dict[int, set] = defaultdict(set)       # bid -> {(per, sec, rc, comm)}
    lpan_rc_hist: dict[int, set] = defaultdict(set)     # bid -> {(per, sec, rc)} con LPAN lumped (comm NULL)
    lpan_periodos: dict[int, set] = defaultdict(set)
    for bid, per, sec, rc, comm in db.execute(
        select(Lpan.binder_id, Lpan.periodo, Lpan.section, Lpan.risk_code, Lpan.comision_pct)
        .where(Lpan.binder_id.is_not(None))
    ).all():
        k = (per, int(sec or 0), (rc or "").strip())
        lpan_periodos[bid].add(per)
        if comm is None:
            lpan_rc_hist[bid].add(k)
        else:
            lpan_exact[bid].add((*k, _q2(comm)))
    if not lpan_periodos:
        return []

    # Grupos exentos (no requieren LPAN), por (binder, per, sec, rc, comm).
    exento: set = set()
    for e in db.scalars(select(LpanExencion)).all():
        exento.add((e.binder_id, e.periodo, int(e.section or 0), (e.risk_code or "").strip(), _q2(e.comision_pct)))

    # Prima (our line) por (binder, periodo, sección, risk_code, comisión total %).
    comm_expr = func.round(func.coalesce(BdxLinea.commission_coverholder_pct, 0)
                           + func.coalesce(BdxLinea.brokerage_pct, 0), 2)
    need: dict[tuple[int, str], set] = defaultdict(set)
    for bid, pbdx, sec, rc, comm, g in db.execute(
        select(Bdx.binder_id, BdxLinea.premium_bdx, BdxLinea.section_no, BdxLinea.risk_code, comm_expr,
               func.sum(BdxLinea.total_gwp_our_line))
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
        .group_by(Bdx.binder_id, BdxLinea.premium_bdx, BdxLinea.section_no, BdxLinea.risk_code, comm_expr)
    ).all():
        if bid not in lpan_periodos or float(g or 0) <= 0:
            continue
        per = pbdx.strftime("%Y-%m"); s = int(sec or 0); r = (rc or "").strip(); c = _q2(comm)
        if (per, s, r) in lpan_rc_hist[bid]:        # cubierto por LPAN histórico lumped
            continue
        if (per, s, r, c) in lpan_exact[bid]:       # ya tiene su LPAN de esa comisión
            continue
        if (bid, per, s, r, c) in exento:           # marcado exento (no requiere LPAN)
            continue
        need[(bid, per)].add((s, r, c))

    parciales: dict[int, list[str]] = defaultdict(list)
    for (bid, per), grupos in need.items():
        if per in lpan_periodos[bid] and grupos:   # algún LPAN hecho y otros grupos sin resolver
            parciales[bid].append(per)

    avisos: list[Aviso] = []
    for bid, pers in parciales.items():
        b = binders.get(bid)
        if not b:
            continue
        pers.sort()
        avisos.append(Aviso(
            tipo="lpan_mes_incompleto", severidad="danger",
            titulo="Mes con LPAN a medias",
            detalle=f"LPAN generados solo en parte en {', '.join(pers)}.",
            binder_id=bid, umr=b.umr, periodos=pers, pagina="binders",
        ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


def _lpan_sin_procesar(db: Session, binders: dict[int, Binder]) -> list[Aviso]:
    """VERDE: LPANs generados con el WP (work_package) y/o Procesado (fecha) sin rellenar."""
    por_binder: dict[int, set] = defaultdict(set)
    n_por_binder: dict[int, int] = defaultdict(int)
    for lp in db.scalars(select(Lpan).where(Lpan.binder_id.is_not(None))).all():
        if not (lp.work_package or "").strip() or lp.fecha is None:
            por_binder[lp.binder_id].add(lp.periodo)
            n_por_binder[lp.binder_id] += 1
    avisos: list[Aviso] = []
    for bid, periodos in por_binder.items():
        b = binders.get(bid)
        if not b:
            continue
        pers = sorted(periodos)
        n = n_por_binder[bid]
        avisos.append(Aviso(
            tipo="lpan_sin_procesar", severidad="info",
            titulo="LPAN sin WP/Procesado",
            detalle=f"{n} LPAN sin WP y/o Procesado ({', '.join(pers)}).",
            binder_id=bid, umr=b.umr, periodos=pers, pagina="binders",
        ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


def _fmt_importe(v) -> str:
    """Importe con separador de miles (es-ES), sin decimales si es entero."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return ""
    return f"{n:,.0f}".replace(",", ".")


def _limite_sin_notificar(db: Session) -> list[Aviso]:
    """ROJO: grupos de Límite de Primas cuyo consumo ha alcanzado el umbral de notificación
    (estado 'rojo' en la ficha del binder) y AÚN no se ha registrado la fecha de notificación
    al mercado. Reutiliza el cálculo de consumo/estado de la ficha de binders (misma definición)."""
    from .binders import _metricas_binders   # lazy: evita import circular

    binders = list(db.scalars(
        select(Binder).options(selectinload(Binder.limites), selectinload(Binder.secciones))).all())
    met = _metricas_binders(db, binders)
    avisos: list[Aviso] = []
    for b in binders:
        por_limite = met.get(b.id, {}).get("por_limite", {})
        for lim in b.limites:
            estado = por_limite.get(lim.id, {}).get("estado")
            if estado != "rojo" or lim.fecha_notificacion is not None:
                continue
            pct = por_limite.get(lim.id, {}).get("consumo_pct")
            tope = _fmt_importe(lim.limite_primas)
            detalle = f"Producción al {pct}% del límite"
            if tope:
                detalle += f" ({tope})"
            detalle += " — pendiente de notificar al mercado."
            avisos.append(Aviso(
                tipo="limite_sin_notificar", severidad="danger",
                titulo="Límite de primas excedido sin notificar",
                detalle=detalle,
                binder_id=b.id, limite_id=lim.id, umr=b.umr, pagina="binders",
            ))
    avisos.sort(key=lambda a: a.umr or "")
    return avisos


def _aplicar_niveles(db: Session, avisos: list[Aviso]) -> list[Aviso]:
    """Rellena el nivel (semáforo) de cada aviso: override del usuario por tipo, o el de defecto."""
    filas = {f.tipo: f for f in db.scalars(select(AvisoNivel)).all()}
    for a in avisos:
        info = TIPOS_AVISO.get(a.tipo, {})
        f = filas.get(a.tipo)
        a.nivel = (f.nivel if f else None) or info.get("defecto", "medio")
        a.categoria = (f.categoria if f and f.categoria else None) or info.get("categoria", "alerta")
    avisos.sort(key=lambda a: (_ORDEN_NIVEL.get(a.nivel, 1), a.tipo, a.umr or ""))
    return avisos


def _tareas_pendientes(db: Session, binders: dict[int, Binder]) -> list[Aviso]:
    """Tareas (recurrentes manuales) activas con alguna ocurrencia pendiente cuyo aviso ya saltó."""
    # lazy: evita import circular
    from .tareas import _ocurrencias, _debida, _fechas_hechas, _periodos_datos, _pasos_de_ocurrencia

    hoy = dt.date.today()
    tareas = db.scalars(select(Tarea).where(Tarea.estado == "Activa").options(
        selectinload(Tarea.pasos).selectinload(TareaPaso.hechos), selectinload(Tarea.hechas))).all()
    datos = _periodos_datos(db, {t.binder_id for t in tareas})
    avisos: list[Aviso] = []
    for t in tareas:
        b = binders.get(t.binder_id)
        if not b:
            continue
        ocs = _ocurrencias(t, b)
        hechas = _fechas_hechas(t, b, datos)
        pend = [f for f in ocs if f not in hechas and _debida(t, f, hoy, False)]
        if not pend:
            continue
        f0 = min(pend)
        # Si la tarea tiene checklist, el aviso muestra el PASO concreto pendiente (el primero no hecho
        # y no bloqueado, p. ej. "Envío a Ana"), con la tarea como contexto. Si no, el título de la tarea.
        titulo, contexto = t.titulo, ""
        if t.pasos:
            manual = {(ph.paso_id, ph.fecha_ocurrencia): ph for p in t.pasos for ph in p.hechos}
            pasos, _completa = _pasos_de_ocurrencia(t, b, f0, ocs.index(f0), datos, manual)
            pend_pasos = [p for p in pasos if not p.hecho]
            accionable = next((p for p in pend_pasos if not p.bloqueado), pend_pasos[0] if pend_pasos else None)
            if accionable:
                titulo, contexto = accionable.titulo, f"{t.titulo} · "
        desde = f"pendiente desde {f0.strftime('%d/%m/%Y')}" + (f" (+{len(pend) - 1} más)" if len(pend) > 1 else "")
        avisos.append(Aviso(
            tipo="tarea_pendiente", severidad="warning",
            titulo=titulo,
            detalle=(contexto + desde) if contexto else (desde[0].upper() + desde[1:]),
            binder_id=b.id, umr=b.umr, periodos=[f.strftime('%Y-%m') for f in pend], pagina="binders",
        ))
    return avisos


def _comision_sin_reparto(db: Session) -> list[Aviso]:
    """Comisiones cuyo recibo ya se generó pero aún no tienen el desglose Iberian/Hauora (la fuente lo
    envía más tarde). Aviso informativo (verde): el recibo está bien, solo falta repartir el 85% cedido."""
    avisos: list[Aviso] = []
    for liq in db.scalars(select(ComisionLiquidacion).where(
            ComisionLiquidacion.estado == "Pendiente Reparto")).all():
        y, m = liq.periodo.split("-")
        avisos.append(Aviso(
            tipo="comision_sin_reparto", severidad="info",
            titulo="Comisión pendiente de reparto",
            detalle=f"{liq.fuente} · {m}/{y}: recibo generado, falta el desglose entre sociedades.",
            periodo=liq.periodo, pagina="comisiones",
        ))
    return avisos


@router.get("/avisos", response_model=list[Aviso])
def listar_avisos(db: Session = Depends(get_db)):
    """Lista de avisos/tareas pendientes (calculados al vuelo), ordenados por importancia."""
    # Binders y productores se cargan UNA vez y se comparten (antes cada generador hacía su propio
    # SELECT * FROM binders → ~6 round-trips contra la BD de producción).
    binders = {b.id: b for b in db.scalars(select(Binder)).all()}
    prods = {p.id: (p.nombre or "").lower() for p in db.scalars(select(Productor)).all()}
    avisos: list[Aviso] = []
    avisos += _facturas_consultoria(db)
    avisos += _limite_sin_notificar(db)
    avisos += _risk_sin_recibo(db, binders, prods)
    avisos += _vencimientos_sin_renovar(db, binders)
    avisos += _tareas_pendientes(db, binders)
    avisos += _lpan_mes_incompleto(db, binders)
    avisos += _lpan_sin_procesar(db, binders)
    avisos += _comision_sin_reparto(db)
    return _aplicar_niveles(db, avisos)


class NivelTipo(BaseModel):
    tipo: str
    etiqueta: str
    nivel: str
    categoria: str = "alerta"


class NivelUpdate(BaseModel):
    nivel: str   # alto | medio | bajo


class CategoriaUpdate(BaseModel):
    categoria: str   # alerta | dia


def _cat_efectiva(tipo: str, fila: AvisoNivel | None) -> str:
    return (fila.categoria if fila and fila.categoria else None) or TIPOS_AVISO[tipo].get("categoria", "alerta")


@router.get("/avisos/niveles", response_model=list[NivelTipo])
def listar_niveles(db: Session = Depends(get_db)):
    """Catálogo de tipos de aviso con su nivel actual (override del usuario o el de defecto)."""
    filas = {f.tipo: f for f in db.scalars(select(AvisoNivel)).all()}
    return [
        NivelTipo(
            tipo=t, etiqueta=info["etiqueta"],
            nivel=(filas[t].nivel if t in filas else None) or info["defecto"],
            categoria=(filas[t].categoria if t in filas and filas[t].categoria else None)
                      or info.get("categoria", "alerta"),
        )
        for t, info in TIPOS_AVISO.items()
    ]


@router.put("/avisos/niveles/{tipo}", response_model=NivelTipo)
def fijar_nivel(tipo: str, payload: NivelUpdate, db: Session = Depends(get_db)):
    if tipo not in TIPOS_AVISO:
        raise HTTPException(status_code=404, detail=f"Tipo de aviso desconocido: {tipo}")
    if payload.nivel not in NIVELES:
        raise HTTPException(status_code=422, detail=f"Nivel inválido: {payload.nivel}")
    fila = db.get(AvisoNivel, tipo)
    if fila is None:
        fila = AvisoNivel(tipo=tipo, nivel=payload.nivel)
        db.add(fila)
    else:
        fila.nivel = payload.nivel
    db.commit()
    return NivelTipo(tipo=tipo, etiqueta=TIPOS_AVISO[tipo]["etiqueta"], nivel=payload.nivel,
                     categoria=_cat_efectiva(tipo, fila))


@router.put("/avisos/niveles/{tipo}/categoria", response_model=NivelTipo)
def fijar_categoria(tipo: str, payload: CategoriaUpdate, db: Session = Depends(get_db)):
    """Mueve un tipo de aviso entre cubos: 'alerta' (campana Alertas) o 'dia' (campana Avisos)."""
    if tipo not in TIPOS_AVISO:
        raise HTTPException(status_code=404, detail=f"Tipo de aviso desconocido: {tipo}")
    if payload.categoria not in ("alerta", "dia"):
        raise HTTPException(status_code=422, detail=f"Categoría inválida: {payload.categoria}")
    fila = db.get(AvisoNivel, tipo)
    if fila is None:
        fila = AvisoNivel(tipo=tipo, nivel=TIPOS_AVISO[tipo]["defecto"], categoria=payload.categoria)
        db.add(fila)
    else:
        fila.categoria = payload.categoria
    db.commit()
    return NivelTipo(tipo=tipo, etiqueta=TIPOS_AVISO[tipo]["etiqueta"], nivel=fila.nivel,
                     categoria=payload.categoria)
