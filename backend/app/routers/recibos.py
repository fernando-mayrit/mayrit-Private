"""
Recibos: núcleo de facturación/contabilidad. Modelo basado en SharePoint 'Mayrit - TRecibos'.

En la app se **emite 1 recibo por Risk BDX** (binder + periodo 'YYYY-MM'); la comisión de Mayrit
es `comision_retenida` = Σ `brokerage_amount` de las líneas Risk de ese periodo. El cobro llega
con los Premium BDX (rara vez coinciden con el Risk BDX) → puede ser parcial. Numeración por año
natural 'AÑO-NNNN'. Los "pendientes" (cobro/liquidación) los recalcula el backend.
"""
import calendar
import datetime as dt
import os
from decimal import Decimal, ROUND_HALF_UP

import openpyxl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models.maestras import (
    Bdx,
    BdxBloqueo,
    BdxLinea,
    Binder,
    BinderSeccion,
    CuentaBancaria,
    Mercado,
    Poliza,
    Productor,
    Recibo,
    SeccionMercado,
)
from ..schemas import maestras as sch

router = APIRouter(tags=["Recibos"])

D0 = Decimal(0)
# Nº de Risk BDX al año según el intervalo del binder (para "Recibo Nº X de N").
INTERVALO_N = {"Mensual": 12, "Trimestral": 4, "Semestral": 2, "Anual": 1}


def _q2(x) -> Decimal:
    return Decimal(x).quantize(Decimal("0.01"), ROUND_HALF_UP)


def _q4(x):
    return None if x is None else Decimal(x).quantize(Decimal("0.0001"), ROUND_HALF_UP)


def _max_numero(db: Session, anio: int) -> int:
    """Mayor correlativo NNNN usado en 'AÑO-NNNN' para ese año (0 si no hay)."""
    numeros = db.scalars(select(Recibo.numero).where(Recibo.anio == anio)).all()
    maximo = 0
    for n in numeros:
        try:
            maximo = max(maximo, int(str(n).split("-")[-1]))
        except (ValueError, IndexError):
            pass
    return maximo


def _siguiente_numero(db: Session, anio: int) -> str:
    """'AÑO-NNNN' correlativo por año natural (último + 1)."""
    return f"{anio}-{_max_numero(db, anio) + 1:04d}"


def _rango_mes(periodo: str) -> tuple[dt.date, dt.date]:
    """'YYYY-MM' → (primer día del mes, primer día del mes siguiente)."""
    try:
        y, m = (int(x) for x in periodo.split("-"))
        ini = dt.date(y, m, 1)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"Periodo inválido: {periodo!r} (use 'YYYY-MM').")
    fin = dt.date(y + 1, 1, 1) if m == 12 else dt.date(y, m + 1, 1)
    return ini, fin


def _lineas_risk_periodo(db: Session, binder_id: int, periodo: str):
    """Líneas del BDX (Risk) del binder cuyo reporting_period_start cae en el mes `periodo`."""
    ini, fin = _rango_mes(periodo)
    return db.scalars(
        select(BdxLinea)
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(
            Bdx.binder_id == binder_id,
            BdxLinea.reporting_period_start >= ini,
            BdxLinea.reporting_period_start < fin,
        )
    ).all()


def _mercados_binder(db: Session, binder_id: int) -> str | None:
    """Snapshot de los mercados del binder (nombres, sin repetir)."""
    nombres = db.execute(
        select(Mercado.nombre)
        .join(SeccionMercado, SeccionMercado.mercado_id == Mercado.id)
        .join(BinderSeccion, BinderSeccion.id == SeccionMercado.seccion_id)
        .where(BinderSeccion.binder_id == binder_id)
        .distinct()
    ).scalars().all()
    nombres = [n for n in nombres if n]
    return ", ".join(sorted(set(nombres))) if nombres else None


def _yoa_int(binder: Binder) -> int | None:
    return int(binder.yoa) if binder.yoa and str(binder.yoa).isdigit() else None


def _cuenta_binder(db: Session, binder: Binder) -> str | None:
    if not binder.cuenta_bancaria_id:
        return None
    c = db.get(CuentaBancaria, binder.cuenta_bancaria_id)
    return c.nombre if c else None


def _ramos_binder(db: Session, binder_id: int) -> str | None:
    ramos = db.scalars(
        select(BinderSeccion.ramo).where(BinderSeccion.binder_id == binder_id).distinct()
    ).all()
    ramos = [r for r in ramos if r]
    return ", ".join(sorted(set(ramos))) if ramos else None


def _pos_bdx_anual(binder: Binder, periodo: str) -> tuple[int | None, str | None]:
    """'Recibo Nº X de N' = posición de este Risk BDX en el año según el intervalo del binder."""
    mes = int(periodo.split("-")[1])
    n = INTERVALO_N.get(binder.risk_bdx_intervalo or "")
    if n == 12:
        x = mes
    elif n == 4:
        x = (mes - 1) // 3 + 1
    elif n == 2:
        x = (mes - 1) // 6 + 1
    elif n == 1:
        x = 1
    else:
        x, n = mes, None  # intervalo desconocido: usa el mes, total sin fijar
    return x, (str(n) if n else None)


def _recompute(r: Recibo) -> None:
    """Recalcula los 'pendientes' a partir de los importes base."""
    r.comision_pendiente_cobro = (r.comision_retenida or D0) - (r.comision_retenida_cobrada or D0)
    r.liquidar_pendiente_cobro = (r.liquidar or D0) - (r.liquidar_cobrado or D0)


def _read(db: Session, r: Recibo) -> sch.ReciboRead:
    """ReciboRead enriquecido con UMR del binder (o nº de póliza en OM) y nº de líneas enlazadas."""
    binder = db.get(Binder, r.binder_id) if r.binder_id else None
    poliza = db.get(Poliza, r.poliza_id) if r.poliza_id else None
    num_lineas = db.scalar(select(func.count(BdxLinea.id)).where(BdxLinea.recibo_id == r.id)) or 0
    data = sch.ReciboRead.model_validate(r)
    data.binder_umr = (binder.umr or binder.agreement_number) if binder else None
    data.poliza_numero = poliza.numero_poliza if poliza else None
    data.num_lineas = num_lineas
    return data


def _read_lote(db: Session, recibos: list[Recibo]) -> list[sch.ReciboRead]:
    """Como _read pero para una lista, cargando binders, pólizas y conteos EN LOTE (evita N+1)."""
    if not recibos:
        return []
    bids = {r.binder_id for r in recibos if r.binder_id}
    pids = {r.poliza_id for r in recibos if r.poliza_id}
    binders = {b.id: b for b in db.scalars(select(Binder).where(Binder.id.in_(bids))).all()} if bids else {}
    polizas = {p.id: p for p in db.scalars(select(Poliza).where(Poliza.id.in_(pids))).all()} if pids else {}
    rids = [r.id for r in recibos]
    counts = {
        rid: c
        for rid, c in db.execute(
            select(BdxLinea.recibo_id, func.count(BdxLinea.id))
            .where(BdxLinea.recibo_id.in_(rids))
            .group_by(BdxLinea.recibo_id)
        ).all()
    }
    out: list[sch.ReciboRead] = []
    for r in recibos:
        data = sch.ReciboRead.model_validate(r)
        b = binders.get(r.binder_id) if r.binder_id else None
        p = polizas.get(r.poliza_id) if r.poliza_id else None
        data.binder_umr = (b.umr or b.agreement_number) if b else None
        data.poliza_numero = p.numero_poliza if p else None
        data.num_lineas = counts.get(r.id, 0)
        out.append(data)
    return out


# ──────────────────────────────── Listados ──────────────────────────────────
@router.get("/recibos", response_model=list[sch.ReciboRead])
def listar(anio: int | None = None, binder_id: int | None = None, q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Recibo)
    if anio is not None:
        stmt = stmt.where(Recibo.anio == anio)
    if binder_id is not None:
        stmt = stmt.where(Recibo.binder_id == binder_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Recibo.numero.ilike(like) | Recibo.nombre_mercado.ilike(like) | Recibo.asegurado.ilike(like)
        )
    stmt = stmt.order_by(Recibo.anio.desc(), Recibo.numero.desc())
    return _read_lote(db, list(db.scalars(stmt).all()))


@router.get("/binders/{binder_id}/recibos", response_model=list[sch.ReciboRead])
def listar_de_binder(binder_id: int, db: Session = Depends(get_db)):
    filas = db.scalars(
        select(Recibo).where(Recibo.binder_id == binder_id).order_by(Recibo.periodo.desc())
    ).all()
    return _read_lote(db, list(filas))


@router.get("/recibos/{recibo_id}", response_model=sch.ReciboRead)
def obtener(recibo_id: int, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    return _read(db, r)


# ───────────────────────── Generar desde un Risk BDX ─────────────────────────
def _validar(db: Session, binder: Binder, periodo: str):
    """Valida y devuelve las líneas del Risk BDX del periodo. Aborta 409/400 si procede."""
    _rango_mes(periodo)  # valida el formato
    existe = db.scalar(
        select(Recibo).where(Recibo.binder_id == binder.id, Recibo.periodo == periodo)
    )
    if existe is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe el recibo {existe.numero} para este Risk BDX ({periodo}).",
        )
    lineas = _lineas_risk_periodo(db, binder.id, periodo)
    if not lineas:
        raise HTTPException(status_code=400, detail=f"No hay líneas Risk en el periodo {periodo}.")
    return lineas


def _campos_emision(db: Session, binder: Binder, periodo: str, lineas, fecha: dt.date) -> dict:
    """Auto-relleno COMPLETO del recibo a partir de las líneas del Risk BDX (our line).
    Pagador = Agencia de Suscripción → Prima Adeudada = Prima Total − Comisión Cedida."""
    def S(attr) -> Decimal:
        return sum((getattr(l, attr) or D0) for l in lineas)

    prima_neta = _q2(S("total_gwp_our_line"))       # Prima Neta Bordereau (our line, sin impuestos)
    impuestos = _q2(S("total_taxes_levies"))
    prima_bruta = _q2(prima_neta + impuestos)        # Prima Total Bordereau
    cedida = _q2(S("commission_coverholder_amount")) # comisión a la agencia (coverholder)
    retenida = _q2(S("brokerage_amount"))            # comisión de Mayrit
    honorarios = _q2(S("fees"))
    deduccion = _q2(cedida + retenida + honorarios)
    gwp100 = _q2(S("gross_written_premium"))         # GWP al 100% (para la participación)
    adeudada = _q2(prima_bruta - cedida)             # pagador = Agencia
    liquidar = _q2(adeudada - retenida)

    def pct(x):
        return _q4(x / prima_neta * 100) if prima_neta else None

    ini, fin = _rango_mes(periodo)
    mercados = _mercados_binder(db, binder.id)
    pos, total = _pos_bdx_anual(binder, periodo)

    return dict(
        binder_id=binder.id,
        periodo=periodo,
        anio=fecha.year,
        estado="Emitido",
        # Contexto
        numero_poliza=None,                           # bordereau: varias pólizas
        referencia=binder.umr or binder.agreement_number,
        nombre_mercado=mercados,
        mercado=mercados,
        corredor=(binder.productor.nombre if binder.productor else None),
        ramo=_ramos_binder(db, binder.id),
        produccion=None,
        fecha_efecto=binder.fecha_efecto,
        fecha_vencimiento=binder.fecha_vencimiento,
        yoa=_yoa_int(binder),
        pago="Fraccionado" if (total and total != "1") else "Único",
        moneda=binder.moneda or "EUR",
        prima_neta_poliza=prima_neta,
        participacion=(_q4(prima_neta / gwp100 * 100) if gwp100 else None),
        recibo_num=pos,
        recibos_totales=total,
        # Importe del recibo + impuestos
        fecha_efecto_recibo=ini,
        fecha_vcto_recibo=fin - dt.timedelta(days=1),
        prima_neta_recibo=prima_neta,
        impuestos_porc=pct(impuestos),
        impuestos_recibo=impuestos,
        prima_bruta_recibo=prima_bruta,
        deduccion_total_porc=pct(deduccion),
        deduccion_total=deduccion,
        honorarios=honorarios,
        # Comisiones
        comision_cedida_porc=pct(cedida),
        comision_cedida=cedida,
        comision_retenida_porc=pct(retenida),
        comision_retenida=retenida,
        pagador="Agencia de Suscripción",
        # Cobro (a 0 al emitir; llega con los Premium BDX)
        prima_adeudada=adeudada,
        # Liquidación a la Cía
        liquidar=liquidar,
        # Contable
        cuenta=_cuenta_binder(db, binder),
        fecha_contable=fecha,
    )


@router.get("/binders/{binder_id}/recibos/preview", response_model=sch.ReciboPreview)
def preview(binder_id: int, periodo: str, db: Session = Depends(get_db)):
    """Calcula el recibo SIN guardarlo, para precumplimentar el formulario de emisión."""
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    lineas = _validar(db, binder, periodo)
    fecha = dt.date.today()
    campos = _campos_emision(db, binder, periodo, lineas, fecha)
    return sch.ReciboPreview(
        numero=_siguiente_numero(db, fecha.year),
        binder_umr=binder.umr or binder.agreement_number,
        num_lineas=len(lineas),
        **campos,
    )


@router.post("/binders/{binder_id}/recibos/generar", response_model=sch.ReciboRead, status_code=201)
def generar(binder_id: int, payload: sch.ReciboGenerar, db: Session = Depends(get_db)):
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")

    periodo = payload.periodo
    lineas = _validar(db, binder, periodo)
    overrides = payload.model_dump(exclude_unset=True, exclude={"periodo"})
    fecha = overrides.get("fecha_contable") or dt.date.today()

    campos = _campos_emision(db, binder, periodo, lineas, fecha)
    campos.update(overrides)  # lo editado en el formulario prevalece
    recibo = Recibo(numero=_siguiente_numero(db, campos["anio"]), **campos)
    _recompute(recibo)
    db.add(recibo)
    db.flush()                  # asigna recibo.id

    # Enlaza las líneas del periodo con el recibo (y guarda el nº en texto).
    for l in lineas:
        l.recibo_id = recibo.id
        l.recibo = recibo.numero

    db.commit()
    db.refresh(recibo)
    return _read(db, recibo)


# ═══════════════════ Emisión de Póliza OM (póliza + sus recibos) ═══════════════════
# Reglas (acordadas con negocio):
#  - Pago Único/Dos/Tres/Cuatro Pagos → 1..4 plazos; la prima de participación se reparte
#    a partes iguales (el último plazo absorbe el redondeo).
#  - Comisión por recibo = cedida% (al corredor) + retenida% (Mayrit), independientes.
#  - Fechas de plazos: 1º en fecha de efecto y los siguientes cada 12/N meses (editables).
#  - Importes por recibo: prima_bruta = prima + impuestos + recargos;
#    adeudada = prima_bruta − cedida; liquidar = adeudada − retenida.
PAGO_LABEL = {1: "Único", 2: "Dos Pagos", 3: "Tres Pagos", 4: "Cuatro Pagos"}


def _sumar_meses(d: dt.date, meses: int) -> dt.date:
    m = d.month - 1 + meses
    y = d.year + m // 12
    m = m % 12 + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


class _EmisionParams(BaseModel):
    n_plazos: int = 1                                   # 1..4
    comision_cedida_porc: Decimal | None = None         # al corredor
    comision_retenida_porc: Decimal | None = None       # de Mayrit
    plazos_fechas: list[dt.date] | None = None          # override opcional de fechas


class PolizaEmitir(sch.PolizaCreate, _EmisionParams):
    pass


class EmisionLinea(BaseModel):
    recibo_num: int
    recibos_totales: int
    fecha_efecto_recibo: dt.date | None = None
    fecha_vcto_recibo: dt.date | None = None
    prima_neta_recibo: Decimal
    impuestos_porc: Decimal | None = None
    impuestos_recibo: Decimal
    recargos: Decimal
    prima_bruta_recibo: Decimal
    comision_cedida_porc: Decimal | None = None
    comision_cedida: Decimal
    comision_retenida_porc: Decimal | None = None
    comision_retenida: Decimal
    prima_adeudada: Decimal
    liquidar: Decimal


class EmisionPreview(BaseModel):
    pago: str
    prima_participacion: Decimal
    impuestos: Decimal
    prima_total: Decimal
    comision_total: Decimal
    lineas: list[EmisionLinea]


def _emision_lineas(p: PolizaEmitir) -> EmisionPreview:
    n = max(1, min(4, p.n_plazos or 1))
    cap = p.capacidad if p.capacidad is not None else Decimal(1)
    base_total = _q2((p.prima_neta or D0) * cap)        # prima de participación (our line)
    recargos_total = _q2(p.recargos or D0)
    imp_pct, ced_pct, ret_pct = p.impuestos_porc, p.comision_cedida_porc, p.comision_retenida_porc

    cuota = _q2(base_total / n)
    rec_cuota = _q2(recargos_total / n)
    step = 12 // n
    lineas: list[EmisionLinea] = []
    for i in range(n):
        prima_i = cuota if i < n - 1 else _q2(base_total - cuota * (n - 1))
        rec_i = rec_cuota if i < n - 1 else _q2(recargos_total - rec_cuota * (n - 1))
        imp_i = _q2(prima_i * imp_pct / 100) if imp_pct else D0
        bruta_i = _q2(prima_i + imp_i + rec_i)
        ced_i = _q2(prima_i * ced_pct / 100) if ced_pct else D0
        ret_i = _q2(prima_i * ret_pct / 100) if ret_pct else D0
        adeudada = _q2(bruta_i - ced_i)
        # fechas
        def fecha_plazo(idx):
            if p.plazos_fechas and idx < len(p.plazos_fechas):
                return p.plazos_fechas[idx]
            return _sumar_meses(p.fecha_efecto, idx * step) if p.fecha_efecto else None
        fe = fecha_plazo(i)
        if i < n - 1:
            sig = fecha_plazo(i + 1)
            fv = (sig - dt.timedelta(days=1)) if sig else None
        else:
            fv = p.fecha_vencimiento
        lineas.append(EmisionLinea(
            recibo_num=i + 1, recibos_totales=n,
            fecha_efecto_recibo=fe, fecha_vcto_recibo=fv,
            prima_neta_recibo=prima_i, impuestos_porc=imp_pct, impuestos_recibo=imp_i,
            recargos=rec_i, prima_bruta_recibo=bruta_i,
            comision_cedida_porc=ced_pct, comision_cedida=ced_i,
            comision_retenida_porc=ret_pct, comision_retenida=ret_i,
            prima_adeudada=adeudada, liquidar=_q2(adeudada - ret_i),
        ))
    imp_total = _q2(sum((l.impuestos_recibo for l in lineas), D0))
    com_total = _q2(sum((l.comision_cedida + l.comision_retenida for l in lineas), D0))
    return EmisionPreview(
        pago=PAGO_LABEL[n], prima_participacion=base_total, impuestos=imp_total,
        prima_total=_q2(base_total + imp_total + recargos_total), comision_total=com_total, lineas=lineas,
    )


@router.post("/polizas/emitir/preview", response_model=EmisionPreview)
def emitir_preview(payload: PolizaEmitir):
    """Calcula la póliza y sus recibos SIN guardar, para precumplimentar el formulario."""
    return _emision_lineas(payload)


@router.post("/polizas/emitir", response_model=sch.PolizaRead, status_code=201)
def emitir(payload: PolizaEmitir, db: Session = Depends(get_db)):
    """Crea la póliza Y genera sus recibos (1..N según el pago), todo en una operación."""
    if not payload.fecha_efecto:
        raise HTTPException(status_code=422, detail="La fecha de efecto es obligatoria para emitir.")
    if not payload.prima_neta:
        raise HTTPException(status_code=422, detail="La prima neta es obligatoria para emitir.")
    prev = _emision_lineas(payload)

    # 1) Póliza (con los totales ya calculados)
    base = payload.model_dump(exclude={"n_plazos", "comision_cedida_porc", "comision_retenida_porc", "plazos_fechas"})
    ced = payload.comision_cedida_porc or D0
    ret = payload.comision_retenida_porc or D0
    base.update(
        pago=prev.pago,
        comision_porc=_q4(ced + ret),
        comision_total=prev.comision_total,
        impuestos=prev.impuestos,
        prima_total=prev.prima_total,
        prima_participacion=prev.prima_participacion,
    )
    poliza = Poliza(**base)
    db.add(poliza)
    db.flush()  # asigna poliza.id

    # 2) Recibos (numeración correlativa por año, sin colisiones entre plazos)
    contadores: dict[int, int] = {}

    def numero(anio: int) -> str:
        if anio not in contadores:
            contadores[anio] = _max_numero(db, anio)
        contadores[anio] += 1
        return f"{anio}-{contadores[anio]:04d}"

    cap = payload.capacidad if payload.capacidad is not None else Decimal(1)
    for l in prev.lineas:
        fe = l.fecha_efecto_recibo or payload.fecha_efecto
        anio = fe.year
        recibo = Recibo(
            numero=numero(anio), poliza_id=poliza.id, binder_id=None,
            periodo=fe.strftime("%Y-%m"), anio=anio, estado="Emitido",
            numero_poliza=poliza.numero_poliza, referencia=poliza.referencia,
            asegurado=poliza.asegurado, corredor=poliza.corredor, ramo=poliza.ramo,
            mercado=poliza.mercado, nombre_mercado=poliza.mercado, produccion=poliza.produccion,
            tipo_poliza="Póliza", fecha_efecto=poliza.fecha_efecto, fecha_vencimiento=poliza.fecha_vencimiento,
            pago=prev.pago, moneda=poliza.moneda or "EUR",
            prima_neta_poliza=prev.prima_participacion, participacion=_q4(cap * 100),
            recibo_num=l.recibo_num, recibos_totales=str(l.recibos_totales),
            fecha_efecto_recibo=l.fecha_efecto_recibo, fecha_vcto_recibo=l.fecha_vcto_recibo,
            prima_neta_recibo=l.prima_neta_recibo, impuestos_porc=l.impuestos_porc,
            impuestos_recibo=l.impuestos_recibo, prima_bruta_recibo=l.prima_bruta_recibo,
            comision_cedida_porc=l.comision_cedida_porc, comision_cedida=l.comision_cedida,
            comision_retenida_porc=l.comision_retenida_porc, comision_retenida=l.comision_retenida,
            pagador="Corredor", prima_adeudada=l.prima_adeudada, liquidar=l.liquidar,
            fecha_contable=fe,
        )
        _recompute(recibo)
        db.add(recibo)

    db.commit()
    db.refresh(poliza)
    return sch.PolizaRead.model_validate(poliza)


# ──────────────────────────── Editar / borrar ───────────────────────────────
@router.put("/recibos/{recibo_id}", response_model=sch.ReciboRead)
def editar(recibo_id: int, payload: sch.ReciboUpdate, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    _recompute(r)
    db.commit()
    db.refresh(r)
    return _read(db, r)


@router.delete("/recibos/{recibo_id}", status_code=204)
def borrar(recibo_id: int, db: Session = Depends(get_db)):
    r = db.get(Recibo, recibo_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Recibo {recibo_id} no encontrado")
    # Desenlaza las líneas antes de borrar (el FK es SET NULL, pero limpiamos también el texto).
    db.execute(
        update(BdxLinea).where(BdxLinea.recibo_id == recibo_id).values(recibo_id=None, recibo=None)
    )
    db.execute(delete(Recibo).where(Recibo.id == recibo_id))
    db.commit()


# ─────────────────── Cobro vía Premium BDX (deriva el cobro del recibo) ───────────────────
def _comp_linea(l: BdxLinea):
    """(adeudada, retenida, a_liquidar) de una línea, sobre our line (igual que en la emisión)."""
    neta = l.total_gwp_our_line or D0
    imp = l.total_taxes_levies or D0
    cedida = l.commission_coverholder_amount or D0
    retenida = l.brokerage_amount or D0
    adeudada = (neta + imp) - cedida
    return adeudada, retenida, adeudada - retenida


def _recalcular_cobro_recibo(db: Session, recibo: Recibo) -> None:
    """El cobro/traspaso/liquidación del recibo se DERIVAN de sus líneas (vía Premium)."""
    lineas = db.scalars(select(BdxLinea).where(BdxLinea.recibo_id == recibo.id)).all()
    adeu = ret = liq = ret_tras = liq_liq = D0
    f_cobro, f_tras, f_liq = [], [], []
    for l in lineas:
        a, r, q = _comp_linea(l)
        if l.prima_cobrada:
            adeu += a
            ret += r
            liq += q
            if l.premium_payment_date:
                f_cobro.append(l.premium_payment_date)
        if l.traspaso:
            ret_tras += r
            if l.fecha_traspaso:
                f_tras.append(l.fecha_traspaso)
        if l.liquidado:
            liq_liq += q
            if l.fecha_liquidacion:
                f_liq.append(l.fecha_liquidacion)
    recibo.prima_cobrada = _q2(adeu)
    recibo.comision_retenida_cobrada = _q2(ret)
    recibo.liquidar_cobrado = _q2(liq)
    recibo.comision_retenida_traspasada = _q2(ret_tras)
    recibo.liquidar_liquidado = _q2(liq_liq)
    recibo.prima_fecha_cobro = max(f_cobro) if f_cobro else None
    recibo.comision_fecha_traspaso = max(f_tras) if f_tras else None
    recibo.liquidar_fecha_liquidacion = max(f_liq) if f_liq else None
    _recompute(recibo)


def _premium_bloqueado(db: Session, binder_id: int, periodo: str) -> bool:
    return db.scalar(
        select(BdxBloqueo).where(
            BdxBloqueo.binder_id == binder_id, BdxBloqueo.tipo == "premium", BdxBloqueo.periodo == periodo
        )
    ) is not None


def _exigir_premium_no_bloqueado(db: Session, binder_id: int, periodo: str):
    if _premium_bloqueado(db, binder_id, periodo):
        raise HTTPException(
            status_code=409,
            detail=f"El Premium {periodo} está bloqueado: no se puede modificar ni cambiar su cobro.",
        )


def _lineas_premium(db: Session, binder_id: int, periodo: str):
    ini, fin = _rango_mes(periodo)
    return db.scalars(
        select(BdxLinea)
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(
            Bdx.binder_id == binder_id,
            BdxLinea.incluido_en_premium.is_(True),
            BdxLinea.premium_bdx >= ini,
            BdxLinea.premium_bdx < fin,
        )
    ).all()


class PremiumGrupo(BaseModel):
    periodo: str            # 'YYYY-MM' del Premium
    num_lineas: int
    prima: Decimal          # Σ adeudada de sus líneas
    comision: Decimal       # Σ comisión retenida (brokerage)
    a_liquidar: Decimal     # Σ (adeudada − retenida)
    cobrado: bool           # todas sus líneas cobradas
    traspasado: bool        # todas sus líneas traspasadas
    liquidado: bool         # todas sus líneas liquidadas
    fecha_pago: dt.date | None = None
    fecha_traspaso: dt.date | None = None
    fecha_liquidacion: dt.date | None = None


class AccionPremium(BaseModel):
    periodo: str
    fecha: dt.date


@router.get("/binders/{binder_id}/premium", response_model=list[PremiumGrupo])
def listar_premium(binder_id: int, db: Session = Depends(get_db)):
    """Grupos de Premium del binder (líneas incluidas en premium, agrupadas por mes)."""
    lineas = db.scalars(
        select(BdxLinea)
        .join(Bdx, BdxLinea.bdx_id == Bdx.id)
        .where(Bdx.binder_id == binder_id, BdxLinea.incluido_en_premium.is_(True), BdxLinea.premium_bdx.is_not(None))
    ).all()
    grupos: dict[str, dict] = {}
    for l in lineas:
        per = l.premium_bdx.strftime("%Y-%m")
        g = grupos.setdefault(per, {"num": 0, "prima": D0, "com": D0, "liq": D0, "cob": 0, "tra": 0, "liqd": 0, "fc": [], "ft": [], "fl": []})
        a, r, q = _comp_linea(l)
        g["num"] += 1
        g["prima"] += a
        g["com"] += r
        g["liq"] += q
        if l.prima_cobrada:
            g["cob"] += 1
            if l.premium_payment_date:
                g["fc"].append(l.premium_payment_date)
        if l.traspaso:
            g["tra"] += 1
            if l.fecha_traspaso:
                g["ft"].append(l.fecha_traspaso)
        if l.liquidado:
            g["liqd"] += 1
            if l.fecha_liquidacion:
                g["fl"].append(l.fecha_liquidacion)
    return [
        PremiumGrupo(
            periodo=per,
            num_lineas=g["num"],
            prima=_q2(g["prima"]),
            comision=_q2(g["com"]),
            a_liquidar=_q2(g["liq"]),
            cobrado=g["num"] > 0 and g["cob"] == g["num"],
            traspasado=g["num"] > 0 and g["tra"] == g["num"],
            liquidado=g["num"] > 0 and g["liqd"] == g["num"],
            fecha_pago=max(g["fc"]) if g["fc"] else None,
            fecha_traspaso=max(g["ft"]) if g["ft"] else None,
            fecha_liquidacion=max(g["fl"]) if g["fl"] else None,
        )
        for per, g in sorted(grupos.items())
    ]


def _accion_premium(db: Session, binder_id: int, periodo: str, setter) -> dict:
    """Aplica una acción (setter) a todas las líneas del Premium y recalcula los recibos."""
    _exigir_premium_no_bloqueado(db, binder_id, periodo)
    lineas = _lineas_premium(db, binder_id, periodo)
    if not lineas:
        raise HTTPException(status_code=400, detail=f"No hay líneas en el Premium {periodo}.")
    for l in lineas:
        setter(l)
    db.flush()
    rids = {l.recibo_id for l in lineas if l.recibo_id}
    recibos = db.scalars(select(Recibo).where(Recibo.id.in_(rids))).all() if rids else []
    for r in recibos:
        _recalcular_cobro_recibo(db, r)
    db.commit()
    return {"lineas": len(lineas), "recibos_actualizados": len(recibos)}


@router.post("/binders/{binder_id}/premium/cobrar")
def cobrar_premium(binder_id: int, payload: AccionPremium, db: Session = Depends(get_db)):
    """💰 Cobrar: marca las líneas como cobradas (fecha real) → Cantidad Cobrada y Pdte. Cobro en los recibos."""
    def setter(l):
        l.prima_cobrada = True
        l.premium_payment_date = payload.fecha
    return _accion_premium(db, binder_id, payload.periodo, setter)


@router.post("/binders/{binder_id}/premium/descobrar")
def descobrar_premium(binder_id: int, payload: AccionPremium, db: Session = Depends(get_db)):
    """Deshace el cobro de un Premium (vuelve a pendiente)."""
    def setter(l):
        l.prima_cobrada = False
        l.premium_payment_date = None
    return _accion_premium(db, binder_id, payload.periodo, setter)


@router.post("/binders/{binder_id}/premium/traspasar")
def traspasar_premium(binder_id: int, payload: AccionPremium, db: Session = Depends(get_db)):
    """🔁 Traspasar: lleva NUESTRA comisión de la cuenta de primas a la de gastos."""
    def setter(l):
        l.traspaso = True
        l.fecha_traspaso = payload.fecha
        l.traspasado = l.brokerage_amount
    return _accion_premium(db, binder_id, payload.periodo, setter)


@router.post("/binders/{binder_id}/premium/liquidar")
def liquidar_premium(binder_id: int, payload: AccionPremium, db: Session = Depends(get_db)):
    """🏦 Liquidar: paga a la compañía/Lloyd's la parte a liquidar (adeudada − comisión retenida)."""
    def setter(l):
        a, r, q = _comp_linea(l)
        l.liquidado = True
        l.fecha_liquidacion = payload.fecha
        l.liquidado_uw = _q2(q)
    return _accion_premium(db, binder_id, payload.periodo, setter)


# ─────────────── Macheo automático desde Excel (cualquier formato) ───────────────
def _resolver_excel(ruta: str) -> str:
    base = os.path.abspath(settings.bdx_excel_dir)
    destino = os.path.abspath(os.path.join(base, ruta))
    if os.path.commonpath([base, destino]) != base:
        raise HTTPException(status_code=400, detail="Ruta fuera de la carpeta base.")
    if not os.path.isfile(destino):
        raise HTTPException(status_code=404, detail=f"No existe el fichero: {ruta}")
    if not destino.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Solo se admite .xlsx (convierte los .xls antes).")
    return destino


def _cabecera(ws, max_scan: int = 12):
    """Detecta la fila de cabecera (la que más celdas de texto tiene) y devuelve (idx, columnas)."""
    filas = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        filas.append(row)
        if i >= max_scan:
            break
    best_i, best_n = 0, -1
    for i, row in enumerate(filas):
        n = sum(1 for v in row if isinstance(v, str) and v.strip())
        if n > best_n:
            best_i, best_n = i, n
    cols = [(str(v).strip() if v is not None else "") for v in filas[best_i]]
    return best_i, cols


def _sugerir(cols: list[str], guardado: str | None, claves: list[str]) -> str | None:
    """Sugiere una columna: primero la guardada (si existe), si no por palabras clave EN ORDEN
    de prioridad (la 1ª clave manda; así 'our line' gana a un genérico 'premium')."""
    if guardado and guardado in cols:
        return guardado
    for k in claves:
        for c in cols:
            if k in c.lower():
                return c
    return None


class ExcelPreviewReq(BaseModel):
    ruta: str
    hoja: str | None = None


@router.post("/binders/{binder_id}/premium/excel-preview")
def excel_preview(binder_id: int, payload: ExcelPreviewReq, db: Session = Depends(get_db)):
    """Lee hojas/cabeceras del Excel y sugiere el mapeo (recordado de la agencia o por palabras clave)."""
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    destino = _resolver_excel(payload.ruta)
    wb = openpyxl.load_workbook(destino, read_only=True, data_only=True)
    hoja = payload.hoja if (payload.hoja and payload.hoja in wb.sheetnames) else wb.sheetnames[0]
    ws = wb[hoja]
    hdr_i, cols = _cabecera(ws)
    columnas = [c for c in cols if c]
    # Muestra: hasta 3 filas de datos tras la cabecera
    muestra = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i <= hdr_i:
            continue
        fila = {cols[j]: ("" if v is None else str(v)) for j, v in enumerate(row) if j < len(cols) and cols[j]}
        if any(fila.values()):
            muestra.append(fila)
        if len(muestra) >= 3:
            break
    prod = binder.productor
    return {
        "hojas": wb.sheetnames,
        "hoja": hoja,
        "columnas": columnas,
        "muestra": muestra,
        "mapeo": {
            "certificado": _sugerir(columnas, prod.premium_col_certificado if prod else None, ["certificate", "certificado", "cert ref", "policy", "poliza"]),
            "importe": _sugerir(columnas, prod.premium_col_importe if prod else None, ["our line", "gross written", "net to broker", "net to", "gwp", "importe", "premium"]),
        },
    }


class MatchExcelReq(BaseModel):
    ruta: str
    hoja: str
    certificado: str           # nombre de la columna del Certificado
    importe: str | None = None  # nombre de la columna del Importe (comprobación)
    periodo: str                # mes del Premium 'YYYY-MM'


class MatchRow(BaseModel):
    certificate_ref: str
    importe_excel: Decimal | None = None
    estado: str                 # 'match' | 'importe_distinto' | 'no_encontrada'
    linea_id: int | None = None
    importe_risk: Decimal | None = None


def _a_decimal(v) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v).replace(",", "."))
    except (ValueError, TypeError, ArithmeticError):
        return None


@router.post("/binders/{binder_id}/premium/match-excel")
def match_excel(binder_id: int, payload: MatchExcelReq, db: Session = Depends(get_db)):
    """Casa las filas del Excel con las líneas Risk del binder por Certificate Ref (importe como
    comprobación). Guarda el mapeo en la agencia. NO aplica: devuelve preview + ids macheados."""
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    _rango_mes(payload.periodo)
    destino = _resolver_excel(payload.ruta)
    wb = openpyxl.load_workbook(destino, read_only=True, data_only=True)
    if payload.hoja not in wb.sheetnames:
        raise HTTPException(status_code=404, detail=f"Hoja '{payload.hoja}' no encontrada")
    ws = wb[payload.hoja]
    hdr_i, cols = _cabecera(ws)
    try:
        cert_idx = cols.index(payload.certificado)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Columna de certificado '{payload.certificado}' no está en la hoja")
    imp_idx = cols.index(payload.importe) if (payload.importe and payload.importe in cols) else None

    # Líneas Risk del binder indexadas por certificate_ref
    risk = db.scalars(
        select(BdxLinea).join(Bdx, BdxLinea.bdx_id == Bdx.id).where(Bdx.binder_id == binder_id)
    ).all()
    por_cert: dict[str, list[BdxLinea]] = {}
    for l in risk:
        if l.certificate_ref:
            por_cert.setdefault(l.certificate_ref.strip().lower(), []).append(l)

    filas: list[MatchRow] = []
    matched_ids: list[int] = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i <= hdr_i:
            continue
        cert_raw = row[cert_idx] if cert_idx < len(row) else None
        if cert_raw is None or str(cert_raw).strip() == "":
            continue
        cert = str(cert_raw).strip()
        imp = _a_decimal(row[imp_idx]) if (imp_idx is not None and imp_idx < len(row)) else None
        cands = por_cert.get(cert.lower(), [])
        if not cands:
            filas.append(MatchRow(certificate_ref=cert, importe_excel=imp, estado="no_encontrada"))
            continue
        # mejor candidata: la de importe más cercano (entre our line / gwp / net)
        def candidatos_importe(l: BdxLinea):
            return [l.total_gwp_our_line, l.gross_written_premium, l.net_premium_to_broker]
        best = cands[0]
        best_diff = None
        for l in cands:
            for amt in candidatos_importe(l):
                if amt is None:
                    continue
                d = abs(Decimal(amt) - (imp if imp is not None else Decimal(amt)))
                if best_diff is None or d < best_diff:
                    best, best_diff = l, d
        risk_amt = _q2(best.total_gwp_our_line or 0)
        ok_importe = imp is None or (best_diff is not None and best_diff <= max(Decimal("0.02"), abs(imp) * Decimal("0.01")))
        estado = "match" if ok_importe else "importe_distinto"
        filas.append(MatchRow(certificate_ref=cert, importe_excel=imp, estado=estado, linea_id=best.id, importe_risk=risk_amt))
        if estado == "match":
            matched_ids.append(best.id)

    # Recordar el mapeo en la agencia
    if binder.productor:
        binder.productor.premium_col_certificado = payload.certificado
        binder.productor.premium_col_importe = payload.importe
        db.commit()

    resumen = {
        "total": len(filas),
        "match": sum(1 for f in filas if f.estado == "match"),
        "importe_distinto": sum(1 for f in filas if f.estado == "importe_distinto"),
        "no_encontrada": sum(1 for f in filas if f.estado == "no_encontrada"),
    }
    return {"periodo": payload.periodo, "filas": filas, "matched_ids": matched_ids, "resumen": resumen}
