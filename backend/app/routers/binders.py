"""
Endpoints de Binders. Estructura anidada:
  Binder → Secciones → (Mercado + participación %).
Por eso lleva lógica propia (no el CRUD genérico de las maestras).
"""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import (
    Bdx,
    BdxBloqueo,
    BdxLinea,
    Binder,
    BinderLimite,
    BinderSeccion,
    BinderSuplemento,
    SeccionMercado,
    SeccionRiskCode,
)
from ..schemas import maestras as sch


def _bdx_sin_bloquear(db: Session, binder_id: int) -> tuple[list[str], list[str]]:
    """Periodos (YYYY-MM) de Risk y de Premium del binder que NO están bloqueados."""
    lineas = db.scalars(
        select(BdxLinea).join(Bdx, BdxLinea.bdx_id == Bdx.id).where(Bdx.binder_id == binder_id)
    ).all()
    risk = {l.reporting_period_start.strftime("%Y-%m") for l in lineas if l.reporting_period_start}
    prem = {l.premium_bdx.strftime("%Y-%m") for l in lineas if l.incluido_en_premium and l.premium_bdx}
    locks = db.execute(select(BdxBloqueo.tipo, BdxBloqueo.periodo).where(BdxBloqueo.binder_id == binder_id)).all()
    risk_lock = {p for t, p in locks if t == "risk"}
    prem_lock = {p for t, p in locks if t == "premium"}
    return sorted(risk - risk_lock), sorted(prem - prem_lock)

router = APIRouter(prefix="/binders", tags=["Binders"])


def _f(x):
    return float(x) if x is not None else None


def _grupo_idx(b: Binder) -> dict[int, int]:
    """Mapa id-de-grupo → índice (0-based) en la lista de límites del binder."""
    return {lim.id: i for i, lim in enumerate(b.limites)}


def _terminos(b: Binder) -> dict:
    """Snapshot JSON-safe de los términos del binder (lo que congela un suplemento)."""
    idx = _grupo_idx(b)
    return {
        "productor_id": b.productor_id,
        "programa_id": b.programa_id,
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
        "limites": [
            {
                "limite_primas": _f(lim.limite_primas),
                "notificacion": _f(lim.notificacion),
                "fecha_notificacion": lim.fecha_notificacion.isoformat() if lim.fecha_notificacion else None,
            }
            for lim in b.limites
        ],
        "secciones": [
            {
                "ramo": s.ramo,
                "risk_codes": [{"codigo": rc.codigo, "comision_mayrit": _f(rc.comision_mayrit)} for rc in s.risk_codes],
                "limite_grupo": idx.get(s.limite_id),
                "limite_primas": _f(s.limite_primas),
                "notificacion": _f(s.notificacion),
                "comision": _f(s.comision),
                "comision_mayrit": _f(s.comision_mayrit),
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


# Aviso (ámbar) cuando faltan <= estos puntos porcentuales para el umbral de notificación.
MARGEN_AVISO_PUNTOS = 10.0
_SEV_RANK = {"verde": 0, "ambar": 1, "rojo": 2}


def _severidad(consumo_pct: float, umbral_pct: float | None) -> str:
    """Color del semáforo según el consumo (% del límite de primas) frente al umbral de
    notificación: rojo al alcanzarlo, ámbar a menos de MARGEN_AVISO_PUNTOS de él, verde si no."""
    if umbral_pct is None:
        return "verde"
    if consumo_pct >= umbral_pct:
        return "rojo"
    if consumo_pct >= umbral_pct - MARGEN_AVISO_PUNTOS:
        return "ambar"
    return "verde"


def _metricas_binders(db: Session, binders: list[Binder]) -> dict[int, dict]:
    """Por binder: Σ GWP our line (total) y estado de notificación del límite MÁS CRÍTICO.
    Calculado al vuelo (sin persistir): se mantiene siempre al día tras cada Risk BDX.

    Mapeo a límites: si el binder tiene un único límite efectivo (nivel binder), todo el GWP
    suma a ese límite; si hay varios (por sección/grupos), la línea con `section_no`=N va a la
    N-ésima sección del binder → su límite (las de section_no fuera de rango quedan sin asignar)."""
    ids = [b.id for b in binders]
    por_seccion: dict[int, dict[int | None, float]] = defaultdict(dict)
    if ids:
        rows = db.execute(
            select(Bdx.binder_id, BdxLinea.section_no, func.sum(BdxLinea.total_gwp_our_line))
            .join(BdxLinea, BdxLinea.bdx_id == Bdx.id)
            .where(Bdx.tipo == "Risk", Bdx.binder_id.in_(ids))
            .group_by(Bdx.binder_id, BdxLinea.section_no)
        ).all()
        for bid, sec_no, total in rows:
            if bid is not None:
                por_seccion[bid][sec_no] = _f(total) or 0.0

    out: dict[int, dict] = {}
    for b in binders:
        secs = por_seccion.get(b.id, {})
        total = sum(secs.values()) if secs else 0.0
        # `por_limite`: estado y % de consumo de CADA límite (por id), para destacar en la ficha
        # el campo de fecha del límite que toca notificar. `notif_*`: el límite más crítico (listado).
        m = {
            "gwp_our_line": round(total, 2) if secs else None,
            "notif_estado": None,
            "notif_consumo_pct": None,
            "por_limite": {},
        }

        # Binder cerrado (Cerrado Producción / Cerrado): el GWP se mantiene (histórico),
        # pero el semáforo de notificación deja de tener sentido y desaparece.
        cerrado = (b.estado or "").startswith("Cerrado")
        if b.limites and secs and not cerrado:
            consumo: dict[int, float] = defaultdict(float)
            distintos = {s.limite_id for s in b.secciones if s.limite_id is not None}
            if len(distintos) <= 1:
                destino = next(iter(distintos), None) or b.limites[0].id
                consumo[destino] = total
            else:
                secciones = list(b.secciones)  # orden por id (relationship order_by)
                for sec_no, gwp in secs.items():
                    if sec_no is not None and 1 <= sec_no <= len(secciones):
                        lid = secciones[sec_no - 1].limite_id
                        if lid is not None:
                            consumo[lid] += gwp
            mejor = None  # ((rank, consumo_pct), estado, consumo_pct)
            for lim in b.limites:
                cap = _f(lim.limite_primas)
                if not cap:
                    continue
                pct = consumo.get(lim.id, 0.0) / cap * 100.0
                estado = _severidad(pct, _f(lim.notificacion))
                m["por_limite"][lim.id] = {"estado": estado, "consumo_pct": round(pct, 1)}
                clave = (_SEV_RANK[estado], pct)
                if mejor is None or clave > mejor[0]:
                    mejor = (clave, estado, pct)
            if mejor is not None:
                m["notif_estado"] = mejor[1]
                m["notif_consumo_pct"] = round(mejor[2], 1)
        out[b.id] = m
    return out


def _serializar(b: Binder, met: dict | None = None) -> dict:
    met = met or {}
    idx = _grupo_idx(b)
    return {
        "id": b.id,
        "gwp_our_line": met.get("gwp_our_line"),
        "notif_estado": met.get("notif_estado"),
        "notif_consumo_pct": met.get("notif_consumo_pct"),
        "umr": b.umr,
        "agreement_number": b.agreement_number,
        "productor_id": b.productor_id,
        "coverholder_nombre": b.productor.nombre if b.productor else None,
        "coverholder_alias": b.productor.alias if b.productor else None,
        "programa_id": b.programa_id,
        "programa_nombre": b.programa.nombre if b.programa else None,
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
        "limites": [
            {
                "limite_primas": lim.limite_primas,
                "notificacion": lim.notificacion,
                "fecha_notificacion": lim.fecha_notificacion,
                "estado": met.get("por_limite", {}).get(lim.id, {}).get("estado"),
                "consumo_pct": met.get("por_limite", {}).get(lim.id, {}).get("consumo_pct"),
            }
            for lim in b.limites
        ],
        "secciones": [
            {
                "id": s.id,
                "ramo": s.ramo,
                "risk_codes": [{"codigo": rc.codigo, "comision_mayrit": rc.comision_mayrit} for rc in s.risk_codes],
                "limite_grupo": idx.get(s.limite_id),
                "limite_primas": s.limite_primas,
                "notificacion": s.notificacion,
                "comision": s.comision,
                "comision_mayrit": s.comision_mayrit,
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


def _aplicar(
    b: Binder, limites: list[sch.BinderLimiteIn], secciones: list[sch.BinderSeccionIn]
) -> None:
    """Reemplaza los grupos de límite y las secciones del binder. Cada sección apunta a un
    grupo por su índice (`limite_grupo`) en la lista `limites`."""
    b.limites.clear()
    b.secciones.clear()
    grupos: list[BinderLimite] = []
    for lim in limites:
        g = BinderLimite(
            limite_primas=lim.limite_primas,
            notificacion=lim.notificacion,
            fecha_notificacion=lim.fecha_notificacion,
        )
        b.limites.append(g)
        grupos.append(g)
    for s in secciones:
        seccion = BinderSeccion(
            ramo=s.ramo, comision=s.comision, comision_mayrit=s.comision_mayrit, sujeto_pc=s.sujeto_pc
        )
        gi = s.limite_grupo
        if grupos and gi is not None and 0 <= gi < len(grupos):
            seccion.limite = grupos[gi]
        for m in s.mercados:
            seccion.mercados.append(
                SeccionMercado(mercado_id=m.mercado_id, participacion=m.participacion)
            )
        for rc in s.risk_codes:
            if rc.codigo and rc.codigo.strip():
                seccion.risk_codes.append(
                    SeccionRiskCode(codigo=rc.codigo.strip(), comision_mayrit=rc.comision_mayrit)
                )
        b.secciones.append(seccion)


@router.get("", response_model=list[sch.BinderRead])
def listar(q: str | None = None, programa_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Binder).order_by(Binder.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Binder.umr.ilike(like), Binder.agreement_number.ilike(like)))
    if programa_id is not None:
        stmt = stmt.where(Binder.programa_id == programa_id)
    binders = db.scalars(stmt).all()
    met = _metricas_binders(db, binders)
    return [_serializar(b, met.get(b.id)) for b in binders]


@router.get("/{binder_id}", response_model=sch.BinderRead)
def obtener(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    return _serializar(b, _metricas_binders(db, [b]).get(b.id))


@router.post("", response_model=sch.BinderRead, status_code=201)
def crear(payload: sch.BinderCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude={"secciones", "limites"})
    b = Binder(**data)
    _aplicar(b, payload.limites, payload.secciones)
    # Suplemento 0 = alta inicial (snapshot de los términos de partida).
    b.suplementos.append(
        BinderSuplemento(numero=0, fecha_efecto=b.fecha_efecto, motivo="Alta inicial", snapshot=_terminos(b))
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _serializar(b, _metricas_binders(db, [b]).get(b.id))


@router.put("/{binder_id}", response_model=sch.BinderRead)
def editar(binder_id: int, payload: sch.BinderUpdate, db: Session = Depends(get_db)):
    """Corrección de la versión vigente (NO crea suplemento): actualiza el binder y refresca
    el snapshot de la última versión para que siga reflejando el estado actual."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    data = payload.model_dump(exclude={"secciones", "limites"}, exclude_unset=True)
    # No se puede cerrar un binder si quedan Risk o Premium sin bloquear.
    nuevo_estado = data.get("estado")
    if nuevo_estado and nuevo_estado.startswith("Cerrado") and not (b.estado or "").startswith("Cerrado"):
        risk_p, prem_p = _bdx_sin_bloquear(db, binder_id)
        if risk_p or prem_p:
            partes = []
            if risk_p:
                partes.append(f"Risk sin bloquear: {', '.join(risk_p)}")
            if prem_p:
                partes.append(f"Premium sin bloquear: {', '.join(prem_p)}")
            raise HTTPException(
                status_code=409,
                detail="No se puede cerrar el binder con BDX sin bloquear. " + " · ".join(partes),
            )
    for k, v in data.items():
        setattr(b, k, v)
    if payload.secciones is not None:
        _aplicar(b, payload.limites or [], payload.secciones)
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
    return _serializar(b, _metricas_binders(db, [b]).get(b.id))


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
    # En un binder cerrado (Cerrado Producción / Cerrado) no se pueden emitir suplementos.
    if (b.estado or "").startswith("Cerrado"):
        raise HTTPException(
            status_code=409,
            detail=f"El binder está {b.estado}: no se pueden emitir suplementos.",
        )
    # Si es un binder antiguo sin historial, congelamos primero su estado actual como versión 0.
    if not b.suplementos:
        b.suplementos.append(
            BinderSuplemento(numero=0, fecha_efecto=b.fecha_efecto, motivo="Alta inicial", snapshot=_terminos(b))
        )
    # Aplicar los nuevos términos al binder (igual que una edición).
    data = payload.model_dump(exclude={"secciones", "limites", "suplemento_fecha_efecto", "motivo"})
    for k, v in data.items():
        setattr(b, k, v)
    _aplicar(b, payload.limites, payload.secciones)
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
    return _serializar(b, _metricas_binders(db, [b]).get(b.id))


@router.delete("/{binder_id}", status_code=204)
def borrar(binder_id: int, db: Session = Depends(get_db)):
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    db.delete(b)
    db.commit()


@router.get("/{binder_id}/bdx/sharepoint-preview")
def bdx_sharepoint_preview(binder_id: int, db: Session = Depends(get_db)):
    """Lee (SOLO LECTURA) la lista `Mayrit - <UMR>` de SharePoint del binder y devuelve un
    resumen para verificar el mapeo ANTES de importar nada: nº de líneas, periodos detectados,
    totales y una muestra de las primeras filas ya mapeadas a los campos de BdxLinea."""
    from .. import sharepoint

    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if not b.umr:
        raise HTTPException(status_code=400, detail="El binder no tiene UMR; no se puede localizar su lista.")
    list_title = f"Mayrit - {b.umr}"
    try:
        filas = sharepoint.leer_lista_bdx(list_title)
    except Exception as e:  # noqa: BLE001 — cualquier fallo de SharePoint se reporta al cliente
        raise HTTPException(status_code=502, detail=f"No se pudo leer la lista '{list_title}': {e}")

    def fnum(v) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    periodos = sorted({str(f["reporting_period_start"])[:10] for f in filas if f.get("reporting_period_start")})
    return {
        "list_title": list_title,
        "total_lineas": len(filas),
        "periodos": periodos,
        "suma_gwp": round(sum(fnum(f.get("gross_written_premium")) for f in filas), 2),
        "suma_gwp_our_line": round(sum(fnum(f.get("total_gwp_our_line")) for f in filas), 2),
        "incluidas_en_premium": sum(1 for f in filas if f.get("incluido_en_premium")),
        "muestra": filas[:5],
    }


@router.post("/{binder_id}/bdx/import")
def bdx_import(binder_id: int, db: Session = Depends(get_db)):
    """Importa (o re-importa) los BDX del binder desde su lista `Mayrit - <UMR>` de SharePoint
    al BDX único del binder. Idempotente por `_OldID`. Devuelve resumen + conciliación."""
    from .. import bdx_import as imp

    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if not b.umr:
        raise HTTPException(status_code=400, detail="El binder no tiene UMR; no se puede localizar su lista.")
    try:
        return imp.importar(db, b)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=502, detail=f"Error importando '{b.umr}': {e}")
