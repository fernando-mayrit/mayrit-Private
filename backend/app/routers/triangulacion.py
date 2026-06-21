"""
Triangulación de siniestralidad.

Estructura (la del usuario): eje de MESES de calendario, desde el inicio del binder hasta el
último mes con snapshot.
  - Filas    = mes de apertura del siniestro (date_opened; respaldo: claim_first_advised o su
               primer mes de aparición). Se muestran TODOS los meses del binder, aunque no haya
               siniestros (salen en 0). Cada fila lleva su GWP Our Line del mes.
  - Columnas = mes de valuación (calendario). La celda (mes_origen, mes_valuación) es la
               siniestralidad de los siniestros abiertos en `mes_origen` valuada a `mes_valuación`
               (último snapshot ≤ ese mes; arrastra el anterior). Vacío si valuación < origen.
  - Fila inferior = Total por columna (siniestralidad total a ese mes). La última columna = hoy.
  - 3 métricas conmutables: Incurrido (pagado+reservas), Pagado, Nº de siniestros.
  - IBNR sugerido por chain-ladder (sobre el desarrollo por antigüedad).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, ClaimsPresentacion, Programa, Siniestro

router = APIRouter(tags=["Triangulación"])


def _mi(anio: int, mes: int) -> int:
    return anio * 12 + (mes - 1)


def _mi_de_ord(ord_: int) -> int:
    return _mi(ord_ // 100, ord_ % 100)


def _periodo_de_mi(mi: int) -> str:
    return f"{mi // 12:04d}-{mi % 12 + 1:02d}"


def _bases(db: Session, binder_id: int) -> tuple[float, float]:
    """(GWP our line, Net to UWs) de las líneas Risk. Net = GWP − com. coverholder − brokerage."""
    row = db.execute(
        select(
            func.coalesce(func.sum(BdxLinea.total_gwp_our_line), 0),
            func.coalesce(func.sum(BdxLinea.commission_coverholder_amount), 0),
            func.coalesce(func.sum(BdxLinea.brokerage_amount), 0),
        )
        .select_from(BdxLinea)
        .join(Bdx, Bdx.id == BdxLinea.bdx_id)
        .where(Bdx.binder_id == binder_id, Bdx.tipo == "Risk")
    ).first()
    gwp, cc, brk = (float(x) for x in row)
    return round(gwp, 2), round(gwp - cc - brk, 2)


def _premium_por_mes(db: Session, binder_id: int) -> dict[int, float]:
    """GWP our line por mes (reporting_period_start) de las líneas Risk."""
    rows = db.execute(
        select(BdxLinea.reporting_period_start, func.coalesce(func.sum(BdxLinea.total_gwp_our_line), 0))
        .join(Bdx, Bdx.id == BdxLinea.bdx_id)
        .where(Bdx.binder_id == binder_id, Bdx.tipo == "Risk", BdxLinea.reporting_period_start.is_not(None))
        .group_by(BdxLinea.reporting_period_start)
    ).all()
    out: dict[int, float] = {}
    for d, s in rows:
        out[_mi(d.year, d.month)] = out.get(_mi(d.year, d.month), 0.0) + float(s)
    return out


@router.get("/binders/{binder_id}/triangulacion")
def triangulacion_binder(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")

    gwp_our_line, net_uw = _bases(db, binder_id)
    prem_mi = _premium_por_mes(db, binder_id)

    pres = db.execute(
        select(
            ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord,
            ClaimsPresentacion.paid_indemnity_acum, ClaimsPresentacion.paid_fees_acum,
            ClaimsPresentacion.reserves_indemnity, ClaimsPresentacion.reserves_fees,
        )
        .where(ClaimsPresentacion.binder_id == binder_id, ClaimsPresentacion.siniestro_id.is_not(None))
        .order_by(ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord)
    ).all()

    # Por siniestro: lista de (mi, incurrido, pagado) acumulados, cronológica.
    snaps: dict[int, list[tuple[int, float, float]]] = {}
    for sid, ord_, pi, pf, ri, rf in pres:
        mi = _mi_de_ord(ord_)
        snaps.setdefault(sid, []).append(
            (mi, float(pi or 0) + float(pf or 0) + float(ri or 0) + float(rf or 0), float(pi or 0) + float(pf or 0))
        )

    vacio = {
        "meses": [], "premium_mes": [], "triangulos": {"incurrido": [], "pagado": [], "num": []},
        "total_premium": round(sum(prem_mi.values()), 2), "gwp_our_line": gwp_our_line, "net_uw": net_uw,
        "incurrido_actual": 0.0, "ibnr_sugerido": 0.0, "ultimate_sugerido": 0.0,
    }
    if not snaps:
        return vacio

    # Mes de origen de cada siniestro: apertura → primer aviso → primer snapshot.
    sins = {s.id: s for s in db.scalars(select(Siniestro).where(Siniestro.binder_id == binder_id)).all()}
    origen: dict[int, int] = {}
    for sid, lista in snaps.items():
        s = sins.get(sid)
        f = (s.date_opened if s else None) or (s.claim_first_advised if s else None)
        origen[sid] = _mi(f.year, f.month) if f else lista[0][0]

    # Eje de meses: desde el inicio del binder hasta el último snapshot.
    latest = max(mi for lista in snaps.values() for (mi, _, _) in lista)
    inicio_cand = [origen[s] for s in origen] + list(prem_mi) + [latest]
    if b.fecha_efecto:
        inicio_cand.append(_mi(b.fecha_efecto.year, b.fecha_efecto.month))
    start = min(inicio_cand)
    meses = list(range(start, latest + 1))
    idx = {mi: k for k, mi in enumerate(meses)}

    def val_at(sid: int, C: int):
        v = None
        for mi, inc, paid in snaps[sid]:
            if mi <= C:
                v = (inc, paid)
            else:
                break
        return v

    # Cohortes por mes de origen.
    cohortes: dict[int, list[int]] = {}
    for sid, o in origen.items():
        cohortes.setdefault(o, []).append(sid)

    n = len(meses)
    tri_inc = [[None] * n for _ in range(n)]
    tri_paid = [[None] * n for _ in range(n)]
    tri_num = [[None] * n for _ in range(n)]
    for i, o in enumerate(meses):
        claims_o = cohortes.get(o, [])
        for j in range(i, n):  # valuación >= origen
            C = meses[j]
            sinc = spaid = 0.0
            cnt = 0
            for sid in claims_o:
                v = val_at(sid, C)
                if v is not None:
                    sinc += v[0]
                    spaid += v[1]
                    cnt += 1
            tri_inc[i][j] = round(sinc, 2)
            tri_paid[i][j] = round(spaid, 2)
            tri_num[i][j] = cnt

    incurrido_actual = round(sum((val_at(sid, latest) or (0.0, 0.0))[0] for sid in snaps), 2)
    ibnr, ultimate = _chain_ladder_desde_meses(meses, cohortes, val_at)

    return {
        "meses": [_periodo_de_mi(m) for m in meses],
        "premium_mes": [round(prem_mi.get(m, 0.0), 2) for m in meses],
        "triangulos": {"incurrido": tri_inc, "pagado": tri_paid, "num": tri_num},
        "total_premium": round(sum(prem_mi.values()), 2),
        "gwp_our_line": gwp_our_line,
        "net_uw": net_uw,
        "incurrido_actual": incurrido_actual,
        "ibnr_sugerido": ibnr,
        "ultimate_sugerido": ultimate,
    }


def _chain_ladder_desde_meses(meses, cohortes, val_at) -> tuple[float, float]:
    """IBNR sugerido (chain-ladder volumen-ponderado) sobre el desarrollo POR ANTIGÜEDAD.
    Construye el triángulo por desarrollo (meses desde el origen) a partir de los cohortes y
    proyecta cada cohorte a 'ultimate'. Devuelve (ibnr, ultimate)."""
    latest = meses[-1]
    # tri[d] por cohorte: incurrido acumulado a `origen + d` meses, solo cohortes con siniestros.
    filas = []
    for o, claims_o in cohortes.items():
        if not claims_o:
            continue
        fila = []
        for d in range(latest - o + 1):
            C = o + d
            s = sum((val_at(sid, C) or (0.0, 0.0))[0] for sid in claims_o)
            fila.append(s)
        filas.append(fila)
    if not filas:
        return 0.0, 0.0
    maxlen = max(len(f) for f in filas)
    if maxlen < 2:
        actual = sum(f[-1] for f in filas if f)
        return 0.0, round(actual, 2)
    factores = []
    for d in range(maxlen - 1):
        num = sum(f[d + 1] for f in filas if len(f) > d + 1)
        den = sum(f[d] for f in filas if len(f) > d + 1)
        factores.append(num / den if den > 0 else 1.0)
    ultimate = actual = 0.0
    for f in filas:
        last = len(f) - 1
        v = f[last]
        actual += v
        for d in range(last, maxlen - 1):
            v *= factores[d]
        ultimate += v
    return round(ultimate - actual, 2), round(ultimate, 2)


def _curva_binder(db: Session, binder: Binder) -> dict | None:
    """Desarrollo POR ANTIGÜEDAD de un binder: para cada edad d (meses desde el inicio del binder),
    el incurrido/pagado/nº de TODOS sus siniestros valuados a ese mes. Devuelve None si no hay
    snapshots. Incluye GWP our line, net to UWs e incurrido actual."""
    gwp, net = _bases(db, binder.id)
    pres = db.execute(
        select(
            ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord,
            ClaimsPresentacion.paid_indemnity_acum, ClaimsPresentacion.paid_fees_acum,
            ClaimsPresentacion.reserves_indemnity, ClaimsPresentacion.reserves_fees,
        )
        .where(ClaimsPresentacion.binder_id == binder.id, ClaimsPresentacion.siniestro_id.is_not(None))
        .order_by(ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord)
    ).all()
    snaps: dict[int, list[tuple[int, float, float]]] = {}
    for sid, ord_, pi, pf, ri, rf in pres:
        mi = _mi_de_ord(ord_)
        snaps.setdefault(sid, []).append(
            (mi, float(pi or 0) + float(pf or 0) + float(ri or 0) + float(rf or 0), float(pi or 0) + float(pf or 0))
        )
    if not snaps:
        return {"gwp": gwp, "net": net, "inc": [], "paid": [], "num": [],
                "incurrido_actual": 0.0, "start": None}

    latest = max(mi for lista in snaps.values() for (mi, _, _) in lista)
    start = _mi(binder.fecha_efecto.year, binder.fecha_efecto.month) if binder.fecha_efecto \
        else min(lista[0][0] for lista in snaps.values())
    if start > latest:
        start = min(lista[0][0] for lista in snaps.values())

    def val_at(sid: int, C: int):
        v = None
        for mi, inc, paid in snaps[sid]:
            if mi <= C:
                v = (inc, paid)
            else:
                break
        return v

    inc, paid, num = [], [], []
    for d in range(latest - start + 1):
        C = start + d
        si = sp = 0.0
        cnt = 0
        for sid in snaps:
            v = val_at(sid, C)
            if v is not None:
                si += v[0]; sp += v[1]; cnt += 1
        inc.append(round(si, 2)); paid.append(round(sp, 2)); num.append(cnt)
    return {"gwp": gwp, "net": net, "inc": inc, "paid": paid, "num": num,
            "incurrido_actual": inc[-1] if inc else 0.0, "start": start}


@router.get("/programas/{programa_id}/triangulacion")
def triangulacion_programa(programa_id: int, db: Session = Depends(get_db)):
    """Triángulo del PROGRAMA: una fila por binder/YOA, columnas = antigüedad (meses desde el
    inicio de cada binder). Los factores de desarrollo se calculan con TODO el programa (los años
    maduros guían la proyección de los jóvenes) y de ahí sale el IBNR de cada año y el total."""
    prog = db.get(Programa, programa_id)
    if prog is None:
        raise HTTPException(status_code=404, detail=f"Programa {programa_id} no encontrado")
    binders = db.scalars(
        select(Binder).where(Binder.programa_id == programa_id).order_by(Binder.yoa, Binder.id)
    ).all()

    filas = []  # por binder: meta + curvas
    for b in binders:
        c = _curva_binder(db, b)
        filas.append({"binder": b, "curva": c})

    # Factores de desarrollo (volumen-ponderado) con el incurrido de TODOS los binders del programa.
    tri_inc = [f["curva"]["inc"] for f in filas if f["curva"]["inc"]]
    maxlen = max((len(x) for x in tri_inc), default=0)
    factores = []
    for d in range(max(maxlen - 1, 0)):
        numer = sum(x[d + 1] for x in tri_inc if len(x) > d + 1)
        denom = sum(x[d] for x in tri_inc if len(x) > d + 1)
        factores.append(numer / denom if denom > 0 else 1.0)

    def proyecta(inc: list[float]) -> tuple[float, float]:
        """(ultimate, ibnr) de una curva con los factores del programa."""
        if not inc:
            return 0.0, 0.0
        last = len(inc) - 1
        v = inc[last]
        for d in range(last, maxlen - 1):
            v *= factores[d]
        return round(v, 2), round(v - inc[last], 2)

    edades = maxlen  # nº de columnas de antigüedad (0..maxlen-1)
    out_binders, m_inc, m_paid, m_num = [], [], [], []
    premium_b, netuw_b, inc_act_b, ult_b, ibnr_b = [], [], [], [], []
    for f in filas:
        b, c = f["binder"], f["curva"]
        ult, ibnr = proyecta(c["inc"])
        out_binders.append({"id": b.id, "umr": b.umr, "agreement": b.agreement_number, "yoa": b.yoa})
        # padding a la longitud común con None
        m_inc.append(c["inc"] + [None] * (edades - len(c["inc"])))
        m_paid.append(c["paid"] + [None] * (edades - len(c["paid"])))
        m_num.append(c["num"] + [None] * (edades - len(c["num"])))
        premium_b.append(c["gwp"]); netuw_b.append(c["net"])
        inc_act_b.append(c["incurrido_actual"]); ult_b.append(ult); ibnr_b.append(ibnr)

    return {
        "programa": prog.nombre,
        "binders": out_binders,
        "max_edad": max(edades - 1, 0),
        "triangulos": {"incurrido": m_inc, "pagado": m_paid, "num": m_num},
        "premium_binder": premium_b,
        "net_uw_binder": netuw_b,
        "incurrido_binder": inc_act_b,
        "ultimate_binder": ult_b,
        "ibnr_binder": ibnr_b,
        "incurrido_total": round(sum(inc_act_b), 2),
        "ultimate_total": round(sum(ult_b), 2),
        "ibnr_total": round(sum(ibnr_b), 2),
        "premium_total": round(sum(premium_b), 2),
        "net_uw_total": round(sum(netuw_b), 2),
    }
