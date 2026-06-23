"""
Avisos / tareas pendientes de la app. Se calculan AL VUELO desde los datos (no hay estado que
mantener), así nunca se desincronizan. Cada generador añade avisos a la lista.

Primer aviso: 'risk_sin_recibo' — periodos con Risk BDX (líneas cuyo reporting_period_start cae en
ese mes) cuyo Recibo aún no se ha generado. Si un mes no tiene Risk BDX, no se espera recibo.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import AvisoNivel, Bdx, BdxLinea, Binder, ConsultoriaContrato, Poliza, Productor, Recibo

router = APIRouter(tags=["Avisos"])

# Productores que NO generan Recibo del Risk porque facturan por honorarios (módulo Consultoría),
# no por comisión. Sus binders no deben avisar de "recibo pendiente".
PRODUCTORES_SIN_RECIBO = {"insurart"}

# Catálogo de tipos de aviso: etiqueta + nivel (semáforo) por defecto. El usuario puede cambiar
# el nivel por tipo (tabla aviso_niveles). Orden del semáforo: alto > medio > bajo.
NIVELES = ("alto", "medio", "bajo")
_ORDEN_NIVEL = {"alto": 0, "medio": 1, "bajo": 2}
TIPOS_AVISO: dict[str, dict] = {
    "factura_consultoria": {"etiqueta": "Factura de consultoría por emitir", "defecto": "alto"},
    "binder_sin_renovar":  {"etiqueta": "Binder por vencer sin renovar", "defecto": "alto"},
    "risk_sin_recibo":     {"etiqueta": "Recibo pendiente de generar", "defecto": "medio"},
    "poliza_sin_renovar":  {"etiqueta": "Póliza por vencer sin renovar", "defecto": "medio"},
}


class Aviso(BaseModel):
    tipo: str                       # 'premium_sin_recibo', …
    severidad: str = "warning"      # info | warning | danger
    nivel: str = "medio"            # alto | medio | bajo (semáforo). Se rellena al listar.
    titulo: str
    detalle: str
    binder_id: int | None = None
    contrato_id: int | None = None  # para avisos de consultoría
    periodo: str | None = None      # 'YYYY-MM' del cobro/factura (consultoría)
    umr: str | None = None
    periodos: list[str] = []
    pagina: str | None = None       # a dónde ir para resolverlo (p. ej. 'binders')


def _risk_sin_recibo(db: Session) -> list[Aviso]:
    # Periodos de Risk BDX por binder (mes del reporting_period_start de las líneas Risk).
    risk: dict[int, set[str]] = defaultdict(set)
    for bid, rp in db.execute(
        select(Bdx.binder_id, BdxLinea.reporting_period_start)
        .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.tipo == "Risk", BdxLinea.reporting_period_start.is_not(None))
    ).all():
        risk[bid].add(rp.strftime("%Y-%m"))
    # Periodos con Recibo generado por binder (el recibo se indexa por reporting period).
    rec: dict[int, set[str]] = defaultdict(set)
    for bid, per in db.execute(
        select(Recibo.binder_id, Recibo.periodo).where(Recibo.binder_id.is_not(None), Recibo.periodo.is_not(None))
    ).all():
        rec[bid].add(per)

    binders = {b.id: b for b in db.scalars(select(Binder)).all()}
    prods = {p.id: (p.nombre or "").lower() for p in db.scalars(select(Productor)).all()}
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
            detalle=f"{b.umr if b else ''}: hay Risk BDX sin recibo en {', '.join(pendientes)}",
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
    """Duración exactamente anual: efecto +1 año = día siguiente al vencimiento."""
    if not efecto or not venc:
        return False
    try:
        mas = efecto.replace(year=efecto.year + 1)
    except ValueError:       # 29-feb
        mas = efecto.replace(year=efecto.year + 1, day=28)
    return mas == venc + dt.timedelta(days=1)


def _vencimientos_sin_renovar(db: Session) -> list[Aviso]:
    """Binders y pólizas que vencen en ≤1 mes (o ya vencidos) en vigor y sin renovación generada."""
    hoy = dt.date.today()
    limite = _mas_un_mes(hoy)
    avisos: list[Aviso] = []

    # ── Binders: el último de cada programa (sin otro posterior) que venza pronto ──
    binders = list(db.scalars(select(Binder)).all())
    for b in binders:
        if (b.estado or "") != "En Vigor" or b.no_renovar or not b.fecha_vencimiento or b.fecha_vencimiento > limite:
            continue
        renovado = b.programa_id is not None and any(
            x.id != b.id and x.programa_id == b.programa_id and x.fecha_efecto and b.fecha_efecto
            and x.fecha_efecto > b.fecha_efecto for x in binders)
        if renovado:
            continue
        avisos.append(Aviso(
            tipo="binder_sin_renovar", severidad="warning",
            titulo="Binder por vencer sin renovar",
            detalle=f"{b.umr or b.agreement_number}: vence el {b.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
            binder_id=b.id, umr=b.umr, pagina="binders",
        ))

    # ── Pólizas anuales en vigor que vencen pronto y no tienen renovación (mismo asegurado+ramo) ──
    polizas = list(db.scalars(select(Poliza)).all())
    def _k(s):
        return (str(s).strip().lower() if s else "")
    for p in polizas:
        if (p.estado or "") != "En Vigor" or not p.fecha_vencimiento or p.fecha_vencimiento > limite:
            continue
        if not _es_anual(p.fecha_efecto, p.fecha_vencimiento):
            continue
        objetivo = p.fecha_vencimiento + dt.timedelta(days=1)
        renovada = any(
            x.id != p.id and _k(x.asegurado) == _k(p.asegurado) and _k(x.ramo) == _k(p.ramo)
            and x.fecha_efecto == objetivo for x in polizas)
        if renovada:
            continue
        avisos.append(Aviso(
            tipo="poliza_sin_renovar", severidad="warning",
            titulo="Póliza por vencer sin renovar",
            detalle=f"{p.numero_poliza or p.asegurado}: vence el {p.fecha_vencimiento.strftime('%d/%m/%Y')} y no tiene renovación.",
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
    contratos = db.scalars(select(ConsultoriaContrato).where(ConsultoriaContrato.estado == "Activo")).all()
    for c in contratos:
        generados = {r.periodo for r in db.scalars(
            select(Recibo).where(Recibo.consultoria_id == c.id, Recibo.periodo.is_not(None))
        ).all()}
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


def _aplicar_niveles(db: Session, avisos: list[Aviso]) -> list[Aviso]:
    """Rellena el nivel (semáforo) de cada aviso: override del usuario por tipo, o el de defecto."""
    overrides = {a.tipo: a.nivel for a in db.scalars(select(AvisoNivel)).all()}
    for a in avisos:
        a.nivel = overrides.get(a.tipo) or TIPOS_AVISO.get(a.tipo, {}).get("defecto", "medio")
    avisos.sort(key=lambda a: (_ORDEN_NIVEL.get(a.nivel, 1), a.tipo, a.umr or ""))
    return avisos


@router.get("/avisos", response_model=list[Aviso])
def listar_avisos(db: Session = Depends(get_db)):
    """Lista de avisos/tareas pendientes (calculados al vuelo), ordenados por importancia."""
    avisos: list[Aviso] = []
    avisos += _facturas_consultoria(db)
    avisos += _risk_sin_recibo(db)
    avisos += _vencimientos_sin_renovar(db)
    return _aplicar_niveles(db, avisos)


class NivelTipo(BaseModel):
    tipo: str
    etiqueta: str
    nivel: str


class NivelUpdate(BaseModel):
    nivel: str   # alto | medio | bajo


@router.get("/avisos/niveles", response_model=list[NivelTipo])
def listar_niveles(db: Session = Depends(get_db)):
    """Catálogo de tipos de aviso con su nivel actual (override del usuario o el de defecto)."""
    overrides = {a.tipo: a.nivel for a in db.scalars(select(AvisoNivel)).all()}
    return [
        NivelTipo(tipo=t, etiqueta=info["etiqueta"], nivel=overrides.get(t) or info["defecto"])
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
    return NivelTipo(tipo=tipo, etiqueta=TIPOS_AVISO[tipo]["etiqueta"], nivel=payload.nivel)
