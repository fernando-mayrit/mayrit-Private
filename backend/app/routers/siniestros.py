"""
Siniestros (Claims BDX por binder).

- Cada binder tiene su lista en SharePoint `Mayrit - Claims<agreement>` (agreement = UMR sin
  el prefijo 'B1634'). Se leen en SOLO LECTURA y se vuelcan a la tabla `siniestros`.
- Importación idempotente por `sp_old_id` (_OldID) y, en su defecto, por (binder, certificate, reference).
- Flujo controlado: primero 'sharepoint-preview' para verificar, luego 'import'.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models.maestras import Bdx, BdxLinea, Binder, Programa, Siniestro
from ..schemas import maestras as sch

router = APIRouter(tags=["Siniestros"])

TEXTO = {"risk_code", "currency", "certificate", "reference", "insured", "reporting_period",
         "description", "status", "refer", "denial", "claimant", "ucr", "abogado", "informacion"}
FECHAS = {"risk_inception", "risk_expiry", "claim_first_advised", "date_opened",
          "date_closed", "last_bdx_change", "ultima_revision"}
INT = {"section", "yoa"}
NUM = {"amount_claimed", "to_pay_indemnity", "to_pay_fees", "paid_indemnity", "paid_fees",
       "reserves_indemnity", "reserves_fees", "total_indemnity", "total_fees"}


def _fecha(v):
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _dec(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v).replace(",", ".")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return None


def _coaccionar(fila: dict) -> dict:
    out: dict = {"sp_old_id": fila.get("_sp_id")}
    for campo, v in fila.items():
        if campo == "_sp_id":
            continue
        if campo in FECHAS:
            out[campo] = _fecha(v)
        elif campo in INT:
            try:
                out[campo] = int(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                out[campo] = None
        elif campo in NUM:
            out[campo] = _dec(v)
        elif campo in TEXTO:
            out[campo] = str(v).strip() if v not in (None, "") else None
        else:
            out[campo] = v
    return out


def _list_title(b: Binder) -> str:
    return f"Mayrit - Claims{b.agreement_number}"


def _binder_o_404(binder_id: int, db: Session) -> Binder:
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if not b.agreement_number:
        raise HTTPException(status_code=400, detail="El binder no tiene Agreement Number; no se localiza su lista de Claims.")
    return b


@router.get("/siniestros", response_model=list[sch.SiniestroReadGlobal])
def listar_todos(db: Session = Depends(get_db)):
    """Listado GLOBAL de siniestros (todos los binders), con el UMR/Agreement de cada binder."""
    filas = db.scalars(
        select(Siniestro).options(selectinload(Siniestro.binder).selectinload(Binder.programa)).order_by(Siniestro.id)
    ).all()
    out = []
    for s in filas:
        d = sch.SiniestroReadGlobal.model_validate(s)
        d.binder_umr = s.binder.umr if s.binder else None
        d.binder_agreement = s.binder.agreement_number if s.binder else None
        d.binder_programa = s.binder.programa.nombre if (s.binder and s.binder.programa) else None
        out.append(d)
    return out


@router.get("/siniestros/ratios")
def ratios(db: Session = Depends(get_db)):
    """Base de producción para los ratios de siniestralidad/frecuencia del módulo de Siniestros,
    agregada por programa (y total). Misma fórmula que el binder:
      netUW = GWP our line − comisión coverholder − brokerage
      nPolizas = combinaciones distintas (asegurado·inicio·vencimiento) con GWP>0, por binder.
    Se calcula sobre las líneas del BDX Risk de todos los binders."""
    SIN = "(sin programa)"
    scope = func.coalesce(Programa.nombre, SIN)

    # Sumas por programa (en SQL, no en Python: antes traía ~todas las líneas Risk).
    sumas = db.execute(
        select(
            scope.label("scope"),
            func.sum(BdxLinea.total_gwp_our_line),
            func.sum(BdxLinea.commission_coverholder_amount),
            func.sum(BdxLinea.brokerage_amount),
        )
        .select_from(BdxLinea)
        .join(Bdx, Bdx.id == BdxLinea.bdx_id)
        .join(Binder, Binder.id == Bdx.binder_id)
        .outerjoin(Programa, Programa.id == Binder.programa_id)
        .where(Bdx.tipo == "Risk")
        .group_by(scope)
    ).all()

    # nº de pólizas = combinaciones distintas (binder · asegurado · inicio · vencimiento) con
    # GWP>0, por programa. La clave de asegurado replica str(iid or inm or "").strip().
    ikey = func.trim(func.coalesce(
        func.nullif(BdxLinea.insured_id, ""), func.nullif(BdxLinea.insured_name, ""), ""
    ))
    sub = (
        select(
            scope.label("scope"),
            func.sum(BdxLinea.total_gwp_our_line).label("g"),
        )
        .select_from(BdxLinea)
        .join(Bdx, Bdx.id == BdxLinea.bdx_id)
        .join(Binder, Binder.id == Bdx.binder_id)
        .outerjoin(Programa, Programa.id == Binder.programa_id)
        .where(Bdx.tipo == "Risk")
        .group_by(scope, BdxLinea.bdx_id, ikey,
                  BdxLinea.risk_inception_date, BdxLinea.risk_expiry_date)
    ).subquery()
    pol = dict(db.execute(
        select(sub.c.scope, func.count()).where(sub.c.g > 0.005).group_by(sub.c.scope)
    ).all())

    def f(x):
        return float(x) if x is not None else 0.0

    por_programa: dict = {}
    tot = {"gwp": 0.0, "com_cover": 0.0, "brokerage": 0.0, "npol": 0}
    for sc, gwp, cc, brk in sumas:
        npol = int(pol.get(sc, 0))
        por_programa[sc] = {
            "gwp_our_line": round(f(gwp), 2),
            "com_coverholder": round(f(cc), 2),
            "brokerage": round(f(brk), 2),
            "net_uw": round(f(gwp) - f(cc) - f(brk), 2),
            "n_polizas": npol,
        }
        tot["gwp"] += f(gwp); tot["com_cover"] += f(cc); tot["brokerage"] += f(brk); tot["npol"] += npol
    # El total es la suma de los programas: cada póliza/línea pertenece a un único binder y, por
    # tanto, a un único programa (claves disjuntas).
    total = {
        "gwp_our_line": round(tot["gwp"], 2),
        "com_coverholder": round(tot["com_cover"], 2),
        "brokerage": round(tot["brokerage"], 2),
        "net_uw": round(tot["gwp"] - tot["com_cover"] - tot["brokerage"], 2),
        "n_polizas": tot["npol"],
    } if sumas else {"gwp_our_line": 0, "com_coverholder": 0, "brokerage": 0, "net_uw": 0, "n_polizas": 0}
    return {"total": total, "por_programa": por_programa}


@router.get("/binders/{binder_id}/siniestros", response_model=list[sch.SiniestroRead])
def listar(binder_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(Siniestro).where(Siniestro.binder_id == binder_id).order_by(Siniestro.certificate, Siniestro.id)
    ).all()


@router.get("/binders/{binder_id}/siniestros/sharepoint-preview")
def preview(binder_id: int, db: Session = Depends(get_db)):
    """Lee la lista de Claims del binder en SharePoint y resume ANTES de importar."""
    from .. import sharepoint

    b = _binder_o_404(binder_id, db)
    list_title = _list_title(b)
    try:
        filas = sharepoint.leer_lista_claims(list_title)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo leer la lista '{list_title}': {e}")

    def fnum(v) -> float:
        try:
            return float(str(v).replace(",", "."))
        except (TypeError, ValueError):
            return 0.0

    return {
        "list_title": list_title,
        "total": len(filas),
        "suma_total_indemnity": round(sum(fnum(f.get("total_indemnity")) for f in filas), 2),
        "suma_total_fees": round(sum(fnum(f.get("total_fees")) for f in filas), 2),
        "suma_reservas": round(sum(fnum(f.get("reserves_indemnity")) + fnum(f.get("reserves_fees")) for f in filas), 2),
        "muestra": filas[:5],
    }


@router.post("/binders/{binder_id}/siniestros/import")
def importar(binder_id: int, db: Session = Depends(get_db)):
    """Importa (o re-importa) los siniestros del binder desde SharePoint. Idempotente."""
    from .. import sharepoint

    b = _binder_o_404(binder_id, db)
    if (b.estado or "") == "Cerrado":
        raise HTTPException(status_code=409, detail="El binder está «Cerrado»: no se pueden cargar más claims.")
    list_title = _list_title(b)
    try:
        filas = sharepoint.leer_lista_claims(list_title)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo leer la lista '{list_title}': {e}")

    existentes = db.scalars(select(Siniestro).where(Siniestro.binder_id == binder_id)).all()
    por_sp = {s.sp_old_id: s for s in existentes if s.sp_old_id is not None}
    por_nat = {(s.certificate or "", s.reference or ""): s for s in existentes}

    nuevos = actualizados = 0
    for fila in filas:
        datos = _coaccionar(fila)
        clave_nat = (datos.get("certificate") or "", datos.get("reference") or "")
        s = por_sp.get(datos["sp_old_id"]) or por_nat.get(clave_nat)
        if s is None:
            s = Siniestro(binder_id=binder_id)
            db.add(s)
            nuevos += 1
        else:
            actualizados += 1
        for k, v in datos.items():
            setattr(s, k, v)
        s.binder_id = binder_id

    db.commit()
    total = db.scalar(select(func.count()).select_from(Siniestro).where(Siniestro.binder_id == binder_id))
    return {"list_title": list_title, "leidos": len(filas), "nuevos": nuevos, "actualizados": actualizados, "total_binder": total}
