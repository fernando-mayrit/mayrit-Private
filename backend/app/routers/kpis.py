"""
KPIs / cuadro de mando. Agrega en el backend (una sola petición) los indicadores de las cuatro
áreas: Producción, Financiero, Siniestralidad y Operativo. Todo son SUMAS/COUNTS en SQL salvo el
bloque Operativo, que reutiliza el módulo de Avisos (mismos criterios que las campanas).
"""
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Binder, Lpan, Parametro, Poliza, Recibo

router = APIRouter(tags=["KPIs"])

D0 = Decimal(0)


def _f(v) -> float:
    return float(v or 0)


@router.get("/kpis")
def kpis(anio: int | None = None, db: Session = Depends(get_db)):
    """Cuadro de mando. `anio` = año de producción/ingresos (por defecto, el año en curso o, si aún
    no hay recibos, el último con datos). Los pendientes y la siniestralidad son acumulados (todos
    los años), como en Financiero y Siniestros."""
    # Año de referencia para Producción/Ingresos.
    anios = [a for (a,) in db.execute(select(Recibo.anio).where(Recibo.anio.is_not(None)).distinct()).all()]
    y = anio or dt.date.today().year
    if y not in anios and anios:
        y = max(anios)
    y_ant = y - 1

    # ── PRODUCCIÓN ──────────────────────────────────────────────────────────
    # Prima de PRODUCCIÓN = prima neta del recibo (el volumen suscrito), no la prima adeudada
    # (que es lo que queda por cobrar tras deducciones y va en el bloque Financiero).
    # Comparación año a año A MISMO PERIODO: se acumula hasta el mes en curso (si el año es el
    # corriente); para un año pasado ya cerrado, hasta diciembre (año completo vs año completo).
    corte_mes = dt.date.today().month if y == dt.date.today().year else 12
    prima_de = lambda yy: db.scalar(
        select(func.coalesce(func.sum(Recibo.prima_neta_recibo), 0))
        .where(Recibo.anio_contable == yy, Recibo.mes_contable <= corte_mes)) or D0
    # Comisión retenida (ingreso de la agencia), mismo criterio y periodo que la prima.
    comis_de = lambda yy: db.scalar(
        select(func.coalesce(func.sum(Recibo.comision_retenida), 0))
        .where(Recibo.anio_contable == yy, Recibo.mes_contable <= corte_mes)) or D0
    # Facturación de Mayrit = comisión retenida (de todo) + comisión cedida SOLO de lo que no es
    # binder. En los binders la comisión cedida va al coverholder/mercado (Mayrit solo la traspasa),
    # no es facturación suya; en pólizas/comisiones/consultoría sí se factura la comisión completa.
    cedida_facturada = case((Recibo.tipo_poliza != "Binder", func.coalesce(Recibo.comision_cedida, 0)), else_=0)
    factura_de = lambda yy: db.scalar(
        select(func.coalesce(func.sum(func.coalesce(Recibo.comision_retenida, 0) + cedida_facturada), 0))
        .where(Recibo.anio_contable == yy, Recibo.mes_contable <= corte_mes)) or D0
    binders_vigor = db.scalar(select(func.count()).select_from(Binder).where(Binder.estado == "En Vigor")) or 0
    polizas_vigor = db.scalar(select(func.count()).select_from(Poliza).where(Poliza.estado == "En Vigor")) or 0

    # Comisión retenida RELATIVA: acumulada hasta el mes de corte de CADA año (comparable año a año).
    comis_ret_serie = [
        {"anio": int(yy), "valor": _f(v)}
        for yy, v in db.execute(
            select(Recibo.anio_contable, func.sum(Recibo.comision_retenida))
            .where(Recibo.anio_contable.is_not(None), Recibo.mes_contable <= corte_mes)
            .group_by(Recibo.anio_contable).order_by(Recibo.anio_contable)
        ).all()
    ]
    # Comisión neta (retenida) por MES y AÑO — matriz para el gráfico multi-año.
    por_anio: dict[int, list[float]] = {}
    for yy, mm, v in db.execute(
        select(Recibo.anio_contable, Recibo.mes_contable, func.sum(Recibo.comision_retenida))
        .where(Recibo.anio_contable.is_not(None), Recibo.mes_contable.is_not(None))
        .group_by(Recibo.anio_contable, Recibo.mes_contable)
    ).all():
        por_anio.setdefault(int(yy), [0.0] * 12)[int(mm) - 1] = _f(v)
    comis_neta_mensual = [{"anio": yy, "valores": vals} for yy, vals in sorted(por_anio.items())]

    # Proyección de ingresos del presupuesto (sincronizada desde el Ppto 2026.xlsx → tabla parametros).
    proyeccion = db.scalar(select(Parametro.valor).where(Parametro.clave == f"proyeccion_ingresos_{y}"))
    # Comisión retenida (neta) del AÑO ANTERIOR COMPLETO (100%), para comparar contra la proyección.
    comis_ret_anterior_full = db.scalar(
        select(func.coalesce(func.sum(Recibo.comision_retenida), 0))
        .where(Recibo.anio_contable == y_ant)) or D0

    # ── FINANCIERO (acumulado, mismas definiciones que la página Financiero) ──
    fin_row = db.execute(select(
        func.coalesce(func.sum(Recibo.prima_adeudada - Recibo.prima_cobrada), 0),
        func.coalesce(func.sum(Recibo.liquidar_cobrado - Recibo.liquidar_liquidado), 0),
        func.coalesce(func.sum(Recibo.comision_retenida_cobrada - Recibo.comision_retenida_traspasada), 0),
        func.coalesce(func.sum(Recibo.comision_cedida_a_pagar - Recibo.comision_cedida_pagada), 0),
    )).one()

    # ── OPERATIVO (reutiliza los avisos: mismos criterios que las campanas) ──
    from .avisos import listar_avisos   # lazy: evita ciclo de imports
    avisos = listar_avisos(db)
    n_tipo = lambda t: sum(1 for a in avisos if a.tipo == t)
    lpan_pend = db.scalar(select(func.count()).select_from(Lpan).where(
        Lpan.binder_id.is_not(None),
        (func.coalesce(func.btrim(Lpan.work_package), "") == "") | (Lpan.fecha.is_(None)),
    )) or 0

    return {
        "anio": y,
        "produccion": {
            "prima_anio": _f(prima_de(y)),
            "prima_anterior": _f(prima_de(y_ant)),
            "comis_ret_anio": _f(comis_de(y)),
            "comis_ret_anterior": _f(comis_de(y_ant)),
            "facturacion_anio": _f(factura_de(y)),
            "facturacion_anterior": _f(factura_de(y_ant)),
            "proyeccion": _f(proyeccion) if proyeccion is not None else None,
            "comis_ret_anterior_full": _f(comis_ret_anterior_full),
            "corte_mes": corte_mes,
            "binders_en_vigor": int(binders_vigor),
            "polizas_en_vigor": int(polizas_vigor),
            "comis_ret_serie": comis_ret_serie,
            "comis_neta_mensual": comis_neta_mensual,
        },
        "financiero": {
            "pendiente_cobro": _f(fin_row[0]),
            "pendiente_liquidacion": _f(fin_row[1]),
            "pendiente_traspaso": _f(fin_row[2]),
            "pendiente_pago": _f(fin_row[3]),
        },
        "operativo": {
            "alertas": sum(1 for a in avisos if a.categoria == "alerta"),
            "avisos_dia": sum(1 for a in avisos if a.categoria == "dia"),
            "recibos_por_generar": n_tipo("risk_sin_recibo"),
            "tareas_pendientes": n_tipo("tarea_pendiente"),
            "lpan_pendientes": int(lpan_pend),
        },
    }
