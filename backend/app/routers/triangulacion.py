"""
Triangulación de siniestralidad.

Construye triángulos de desarrollo a partir de las presentaciones mensuales de Claims
(`claims_presentaciones`), que guardan por (binder, mes, siniestro) el pagado acumulado y las
reservas. De ahí se deriva el INCURRIDO (= pagado + reservas) y el PAGADO acumulados.

Triángulo por BINDER:
  - Filas (origen)   = mes de apertura del siniestro (date_opened; respaldo: claim_first_advised
                       o su primer mes de aparición en los snapshots).
  - Columnas (desarrollo) = meses transcurridos desde el origen (0, 1, 2, …).
  - Celda = valor del cohorte valuado en el mes calendario `origen + desarrollo`, usando para cada
            siniestro su último snapshot ≤ ese mes (acumulado; los meses sin presentación
            arrastran el último valor conocido).
  - 3 triángulos conmutables: Incurrido, Pagado, Nº de siniestros.
  - Importe de referencia: Net to UWs = GWP our line − comisión coverholder − brokerage (mismo
    criterio que el binder/ratios), para el ratio de siniestralidad. Los siniestros van sin escalar.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, ClaimsPresentacion, Siniestro

router = APIRouter(tags=["Triangulación"])


def _mi(anio: int, mes: int) -> int:
    """Índice de mes absoluto (para restar meses fácilmente): aaaa-mm -> aaaa*12 + (mm-1)."""
    return anio * 12 + (mes - 1)


def _mi_de_ord(ord_: int) -> int:
    return _mi(ord_ // 100, ord_ % 100)


def _periodo_de_mi(mi: int) -> str:
    return f"{mi // 12:04d}-{mi % 12 + 1:02d}"


def _net_uw(db: Session, binder_id: int) -> float:
    """GWP our line − comisión coverholder − brokerage de las líneas Risk del binder."""
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
    return round(gwp - cc - brk, 2)


@router.get("/binders/{binder_id}/triangulacion")
def triangulacion_binder(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")

    # Snapshots del binder con siniestro (los NIL tienen siniestro_id NULL → se ignoran).
    pres = db.execute(
        select(
            ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord,
            ClaimsPresentacion.paid_indemnity_acum, ClaimsPresentacion.paid_fees_acum,
            ClaimsPresentacion.reserves_indemnity, ClaimsPresentacion.reserves_fees,
        )
        .where(ClaimsPresentacion.binder_id == binder_id, ClaimsPresentacion.siniestro_id.is_not(None))
        .order_by(ClaimsPresentacion.siniestro_id, ClaimsPresentacion.periodo_ord)
    ).all()

    # Por siniestro: lista de (mi, incurrido, pagado) acumulados, ordenada cronológicamente.
    snaps: dict[int, list[tuple[int, float, float]]] = {}
    for sid, ord_, pi, pf, ri, rf in pres:
        mi = _mi_de_ord(ord_)
        inc = float(pi or 0) + float(pf or 0) + float(ri or 0) + float(rf or 0)
        paid = float(pi or 0) + float(pf or 0)
        snaps.setdefault(sid, []).append((mi, inc, paid))

    if not snaps:
        return {"origenes": [], "max_desarrollo": -1, "triangulos": {"incurrido": [], "pagado": [], "num": []},
                "net_uw": _net_uw(db, binder_id), "incurrido_actual": 0.0}

    # Mes de origen de cada siniestro: apertura → primer aviso → primer snapshot.
    sins = {s.id: s for s in db.scalars(select(Siniestro).where(Siniestro.binder_id == binder_id)).all()}
    origen: dict[int, int] = {}
    for sid, lista in snaps.items():
        s = sins.get(sid)
        f = (s.date_opened if s else None) or (s.claim_first_advised if s else None)
        origen[sid] = _mi(f.year, f.month) if f else lista[0][0]

    latest = max(mi for lista in snaps.values() for (mi, _, _) in lista)

    # Valor acumulado de un siniestro en el mes calendario C: último snapshot con mi ≤ C.
    def val_at(sid: int, C: int):
        v = None
        for mi, inc, paid in snaps[sid]:  # ordenada ascendente
            if mi <= C:
                v = (inc, paid)
            else:
                break
        return v  # None si aún no ha aparecido en esa fecha

    # Cohortes por mes de origen.
    cohortes: dict[int, list[int]] = {}
    for sid, o in origen.items():
        cohortes.setdefault(o, []).append(sid)
    origenes_mi = sorted(cohortes)

    tri_inc, tri_paid, tri_num = [], [], []
    for o in origenes_mi:
        fila_inc, fila_paid, fila_num = [], [], []
        for d in range(latest - o + 1):  # 0 .. hasta el último mes con datos
            C = o + d
            sinc = spaid = 0.0
            cnt = 0
            for sid in cohortes[o]:
                v = val_at(sid, C)
                if v is not None:
                    sinc += v[0]
                    spaid += v[1]
                    cnt += 1
            fila_inc.append(round(sinc, 2))
            fila_paid.append(round(spaid, 2))
            fila_num.append(cnt)
        tri_inc.append(fila_inc)
        tri_paid.append(fila_paid)
        tri_num.append(fila_num)

    # Incurrido actual del binder = valuación de todos los siniestros en el último mes.
    incurrido_actual = round(sum((val_at(sid, latest) or (0.0, 0.0))[0] for sid in snaps), 2)

    ibnr, ultimate = _chain_ladder(tri_inc)

    return {
        "origenes": [_periodo_de_mi(o) for o in origenes_mi],
        "max_desarrollo": latest - min(origenes_mi),
        "triangulos": {"incurrido": tri_inc, "pagado": tri_paid, "num": tri_num},
        "net_uw": _net_uw(db, binder_id),
        "incurrido_actual": incurrido_actual,
        "ibnr_sugerido": ibnr,
        "ultimate_sugerido": ultimate,
    }


def _chain_ladder(tri: list[list[float]]) -> tuple[float, float]:
    """Estimación SUGERIDA de IBNR por chain-ladder (volumen ponderado) sobre el triángulo de
    incurrido acumulado. Devuelve (ibnr_sugerido, ultimate_sugerido).

    IBNR = Σ ultimate − Σ último incurrido conocido de cada cohorte. Es una orientación: con
    pocos cohortes o desarrollo errático puede ser inestable (de ahí "sugerido")."""
    if not tri:
        return 0.0, 0.0
    maxlen = max(len(f) for f in tri)
    if maxlen < 2:
        actual = sum(f[-1] for f in tri if f)
        return 0.0, round(actual, 2)
    # Factores edad-a-edad f[d]: Σ C(i,d+1) / Σ C(i,d) sobre cohortes con datos en d y d+1.
    factores = []
    for d in range(maxlen - 1):
        num = sum(f[d + 1] for f in tri if len(f) > d + 1)
        den = sum(f[d] for f in tri if len(f) > d + 1)
        factores.append(num / den if den > 0 else 1.0)
    # Proyección de cada cohorte desde su último desarrollo conocido hasta el final.
    ultimate = 0.0
    actual = 0.0
    for f in tri:
        if not f:
            continue
        last = len(f) - 1
        v = f[last]
        actual += v
        for d in range(last, maxlen - 1):
            v *= factores[d]
        ultimate += v
    return round(ultimate - actual, 2), round(ultimate, 2)
