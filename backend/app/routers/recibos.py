"""
Recibos: núcleo de facturación/contabilidad. Modelo basado en SharePoint 'Mayrit - TRecibos'.

En la app se **emite 1 recibo por Risk BDX** (binder + periodo 'YYYY-MM'); la comisión de Mayrit
es `comision_retenida` = Σ `brokerage_amount` de las líneas Risk de ese periodo. El cobro llega
con los Premium BDX (rara vez coinciden con el Risk BDX) → puede ser parcial. Numeración por año
natural 'AÑO-NNNN'. Los "pendientes" (cobro/liquidación) los recalcula el backend.
"""
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


def _siguiente_numero(db: Session, anio: int) -> str:
    """'AÑO-NNNN' correlativo por año natural (último + 1)."""
    numeros = db.scalars(select(Recibo.numero).where(Recibo.anio == anio)).all()
    maximo = 0
    for n in numeros:
        try:
            maximo = max(maximo, int(str(n).split("-")[-1]))
        except (ValueError, IndexError):
            pass
    return f"{anio}-{maximo + 1:04d}"


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
    """ReciboRead enriquecido con UMR del binder y nº de líneas enlazadas."""
    binder = db.get(Binder, r.binder_id)
    num_lineas = db.scalar(select(func.count(BdxLinea.id)).where(BdxLinea.recibo_id == r.id)) or 0
    data = sch.ReciboRead.model_validate(r)
    data.binder_umr = (binder.umr or binder.agreement_number) if binder else None
    data.num_lineas = num_lineas
    return data


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
    return [_read(db, r) for r in db.scalars(stmt).all()]


@router.get("/binders/{binder_id}/recibos", response_model=list[sch.ReciboRead])
def listar_de_binder(binder_id: int, db: Session = Depends(get_db)):
    filas = db.scalars(
        select(Recibo).where(Recibo.binder_id == binder_id).order_by(Recibo.periodo.desc())
    ).all()
    return [_read(db, r) for r in filas]


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
    """El cobro del recibo se DERIVA de sus líneas pagadas (incluidas en un Premium ya cobrado)."""
    lineas = db.scalars(select(BdxLinea).where(BdxLinea.recibo_id == recibo.id)).all()
    adeu = ret = liq = D0
    fechas = []
    for l in lineas:
        if not l.prima_cobrada:
            continue
        a, r, q = _comp_linea(l)
        adeu += a
        ret += r
        liq += q
        if l.premium_payment_date:
            fechas.append(l.premium_payment_date)
    recibo.prima_cobrada = _q2(adeu)
    recibo.comision_retenida_cobrada = _q2(ret)
    recibo.liquidar_cobrado = _q2(liq)
    recibo.prima_fecha_cobro = max(fechas) if fechas else None
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
    cobrado: bool           # todas sus líneas pagadas
    fecha_pago: dt.date | None = None


class CobrarPremium(BaseModel):
    periodo: str
    fecha_pago: dt.date


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
        g = grupos.setdefault(per, {"num": 0, "prima": D0, "com": D0, "pagadas": 0, "fechas": []})
        a, r, _ = _comp_linea(l)
        g["num"] += 1
        g["prima"] += a
        g["com"] += r
        if l.prima_cobrada:
            g["pagadas"] += 1
        if l.premium_payment_date:
            g["fechas"].append(l.premium_payment_date)
    return [
        PremiumGrupo(
            periodo=per,
            num_lineas=g["num"],
            prima=_q2(g["prima"]),
            comision=_q2(g["com"]),
            cobrado=g["num"] > 0 and g["pagadas"] == g["num"],
            fecha_pago=max(g["fechas"]) if g["fechas"] else None,
        )
        for per, g in sorted(grupos.items())
    ]


@router.post("/binders/{binder_id}/premium/cobrar")
def cobrar_premium(binder_id: int, payload: CobrarPremium, db: Session = Depends(get_db)):
    """Da por cobrado el Premium entero (con la fecha real) y deriva el cobro a los recibos afectados."""
    _exigir_premium_no_bloqueado(db, binder_id, payload.periodo)
    lineas = _lineas_premium(db, binder_id, payload.periodo)
    if not lineas:
        raise HTTPException(status_code=400, detail=f"No hay líneas en el Premium {payload.periodo}.")
    for l in lineas:
        l.prima_cobrada = True
        l.premium_payment_date = payload.fecha_pago
    db.flush()
    rids = {l.recibo_id for l in lineas if l.recibo_id}
    recibos = db.scalars(select(Recibo).where(Recibo.id.in_(rids))).all() if rids else []
    for r in recibos:
        _recalcular_cobro_recibo(db, r)
    db.commit()
    return {"lineas": len(lineas), "recibos_actualizados": len(recibos)}


@router.post("/binders/{binder_id}/premium/descobrar")
def descobrar_premium(binder_id: int, payload: CobrarPremium, db: Session = Depends(get_db)):
    """Deshace el cobro de un Premium (vuelve a pendiente) y recalcula los recibos."""
    _exigir_premium_no_bloqueado(db, binder_id, payload.periodo)
    lineas = _lineas_premium(db, binder_id, payload.periodo)
    if not lineas:
        raise HTTPException(status_code=400, detail=f"No hay líneas en el Premium {payload.periodo}.")
    for l in lineas:
        l.prima_cobrada = False
        l.premium_payment_date = None
    db.flush()
    rids = {l.recibo_id for l in lineas if l.recibo_id}
    recibos = db.scalars(select(Recibo).where(Recibo.id.in_(rids))).all() if rids else []
    for r in recibos:
        _recalcular_cobro_recibo(db, r)
    db.commit()
    return {"lineas": len(lineas), "recibos_actualizados": len(recibos)}


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
