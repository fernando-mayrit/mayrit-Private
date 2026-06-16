"""
Endpoints de Binders. Estructura anidada:
  Binder → Secciones → (Mercado + participación %).
Por eso lleva lógica propia (no el CRUD genérico de las maestras).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Binder, BinderSeccion, BinderSuplemento, SeccionMercado, SeccionRiskCode
from ..schemas import maestras as sch

router = APIRouter(prefix="/binders", tags=["Binders"])


def _f(x):
    return float(x) if x is not None else None


def _terminos(b: Binder) -> dict:
    """Snapshot JSON-safe de los términos del binder (lo que congela un suplemento)."""
    return {
        "productor_id": b.productor_id,
        "fecha_efecto": b.fecha_efecto.isoformat() if b.fecha_efecto else None,
        "fecha_vencimiento": b.fecha_vencimiento.isoformat() if b.fecha_vencimiento else None,
        "estado": b.estado,
        "moneda": b.moneda,
        "yoa": b.yoa,
        "profit_commission": b.profit_commission,
        "pc_porcentaje": _f(b.pc_porcentaje),
        "pc_gastos": _f(b.pc_gastos),
        "risk_bdx_intervalo": b.risk_bdx_intervalo,
        "risk_bdx_plazo": b.risk_bdx_plazo,
        "premium_bdx_intervalo": b.premium_bdx_intervalo,
        "premium_bdx_plazo": b.premium_bdx_plazo,
        "claims_bdx_intervalo": b.claims_bdx_intervalo,
        "claims_bdx_plazo": b.claims_bdx_plazo,
        "comision_mayrit": _f(b.comision_mayrit),
        "cuenta_bancaria_id": b.cuenta_bancaria_id,
        "notas": b.notas,
        "secciones": [
            {
                "ramo": s.ramo,
                "risk_codes": [rc.codigo for rc in s.risk_codes],
                "limite_primas": _f(s.limite_primas),
                "notificacion": _f(s.notificacion),
                "comision": _f(s.comision),
                "sujeto_pc": s.sujeto_pc,
                "mercados": [
                    {"mercado_id": m.mercado_id, "participacion": _f(m.participacion)} for m in s.mercados
                ],
            }
            for s in b.secciones
        ],
    }


def _suplemento_dict(s: BinderSuplemento) -> dict:
    return {
        "id": s.id,
        "numero": s.numero,
        "fecha_efecto": s.fecha_efecto,
        "motivo": s.motivo,
        "created_at": s.created_at,
        "snapshot": s.snapshot,
    }


def _serializar(b: Binder) -> dict:
    return {
        "id": b.id,
        "umr": b.umr,
        "agreement_number": b.agreement_number,
        "productor_id": b.productor_id,
        "coverholder_nombre": b.productor.nombre if b.productor else None,
        "coverholder_alias": b.productor.alias if b.productor else None,
        "fecha_efecto": b.fecha_efecto,
        "fecha_vencimiento": b.fecha_vencimiento,
        "estado": b.estado,
        "moneda": b.moneda,
        "yoa": b.yoa,
        "profit_commission": b.profit_commission,
        "pc_porcentaje": b.pc_porcentaje,
        "pc_gastos": b.pc_gastos,
        "risk_bdx_intervalo": b.risk_bdx_intervalo,
        "risk_bdx_plazo": b.risk_bdx_plazo,
        "premium_bdx_intervalo": b.premium_bdx_intervalo,
        "premium_bdx_plazo": b.premium_bdx_plazo,
        "claims_bdx_intervalo": b.claims_bdx_intervalo,
        "claims_bdx_plazo": b.claims_bdx_plazo,
        "comision_mayrit": b.comision_mayrit,
        "cuenta_bancaria_id": b.cuenta_bancaria_id,
        "cuenta_bancaria_nombre": b.cuenta_bancaria.nombre if b.cuenta_bancaria else None,
        "notas": b.notas,
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "secciones": [
            {
                "id": s.id,
                "ramo": s.ramo,
                "risk_codes": [rc.codigo for rc in s.risk_codes],
                "limite_primas": s.limite_primas,
                "notificacion": s.notificacion,
                "comision": s.comision,
                "sujeto_pc": s.sujeto_pc,
                "mercados": [
                    {
                        "mercado_id": m.mercado_id,
                        "participacion": m.participacion,
                        "mercado_nombre": m.mercado.nombre if m.mercado else None,
                    }
                    for m in s.mercados
                ],
            }
            for s in b.secciones
        ],
    }


def _aplicar_secciones(b: Binder, secciones: list[sch.BinderSeccionIn]) -> None:
    b.secciones.clear()
    for s in secciones:
        seccion = BinderSeccion(
            ramo=s.ramo,
            limite_primas=s.limite_primas,
            notificacion=s.notificacion,
            comision=s.comision,
            sujeto_pc=s.sujeto_pc,
        )
        for m in s.mercados:
            seccion.mercados.append(
                SeccionMercado(mercado_id=m.mercado_id, participacion=m.participacion)
            )
        for codigo in s.risk_codes:
            if codigo and codigo.strip():
                seccion.risk_codes.append(SeccionRiskCode(codigo=codigo.strip()))
        b.secciones.append(seccion)


@router.get("", response_model=list[sch.BinderRead])
def listar(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Binder).order_by(Binder.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Binder.umr.ilike(like), Binder.agreement_number.ilike(like)))
    return [_serializar(b) for b in db.scalars(stmt).all()]


@router.get("/{binder_id}", response_model=sch.BinderRead)
def obtener(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return _serializar(b)


@router.post("", response_model=sch.BinderRead, status_code=201)
def crear(payload: sch.BinderCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude={"secciones"})
    b = Binder(**data)
    _aplicar_secciones(b, payload.secciones)
    # Suplemento 0 = alta inicial (snapshot de los términos de partida).
    b.suplementos.append(
        BinderSuplemento(numero=0, fecha_efecto=b.fecha_efecto, motivo="Alta inicial", snapshot=_terminos(b))
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _serializar(b)


@router.put("/{binder_id}", response_model=sch.BinderRead)
def editar(binder_id: int, payload: sch.BinderUpdate, db: Session = Depends(get_db)):
    """Corrección de la versión vigente (NO crea suplemento): actualiza el binder y refresca
    el snapshot de la última versión para que siga reflejando el estado actual."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    data = payload.model_dump(exclude={"secciones"}, exclude_unset=True)
    for k, v in data.items():
        setattr(b, k, v)
    if payload.secciones is not None:
        _aplicar_secciones(b, payload.secciones)
    db.flush()
    if b.suplementos:
        latest = max(b.suplementos, key=lambda s: s.numero)
        latest.snapshot = _terminos(b)
    else:  # binder antiguo sin suplementos: crea el 0
        b.suplementos.append(
            BinderSuplemento(numero=0, fecha_efecto=b.fecha_efecto, motivo="Alta inicial", snapshot=_terminos(b))
        )
    db.commit()
    db.refresh(b)
    return _serializar(b)


@router.get("/{binder_id}/suplementos")
def listar_suplementos(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if b.suplementos:
        return [_suplemento_dict(s) for s in sorted(b.suplementos, key=lambda s: s.numero)]
    # Binder antiguo sin suplementos: versión 0 sintética (no se persiste hasta el próximo cambio).
    return [
        {
            "id": None,
            "numero": 0,
            "fecha_efecto": b.fecha_efecto,
            "motivo": "Alta inicial",
            "created_at": b.created_at,
            "snapshot": _terminos(b),
        }
    ]


@router.post("/{binder_id}/suplementos", response_model=sch.BinderRead, status_code=201)
def crear_suplemento(binder_id: int, payload: sch.SuplementoCreate, db: Session = Depends(get_db)):
    """Nueva versión del binder: aplica los nuevos términos y añade un suplemento numerado
    con su fecha de efecto (puede ser retroactiva) y motivo."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    # Si es un binder antiguo sin historial, congelamos primero su estado actual como versión 0.
    if not b.suplementos:
        b.suplementos.append(
            BinderSuplemento(numero=0, fecha_efecto=b.fecha_efecto, motivo="Alta inicial", snapshot=_terminos(b))
        )
    # Aplicar los nuevos términos al binder (igual que una edición).
    data = payload.model_dump(exclude={"secciones", "suplemento_fecha_efecto", "motivo"})
    for k, v in data.items():
        setattr(b, k, v)
    _aplicar_secciones(b, payload.secciones)
    db.flush()
    numero = max(s.numero for s in b.suplementos) + 1
    b.suplementos.append(
        BinderSuplemento(
            numero=numero,
            fecha_efecto=payload.suplemento_fecha_efecto,
            motivo=payload.motivo,
            snapshot=_terminos(b),
        )
    )
    db.commit()
    db.refresh(b)
    return _serializar(b)


@router.delete("/{binder_id}", status_code=204)
def borrar(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    db.delete(b)
    db.commit()
