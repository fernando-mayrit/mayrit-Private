"""
Endpoints de BDX (bordereaux Risk/Premium). Estructura:
  Binder → BDX (cabecera de un periodo) → líneas.
Claims va en otro módulo.
"""
import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from .. import bdx_import
from ..models.maestras import Binder, Bdx, BdxBloqueo, BdxLinea
from ..schemas import maestras as sch

router = APIRouter(tags=["BDX"])

TIPOS_BLOQUEO = {"risk", "premium", "claims"}


def _mes(fecha: dt.date | None) -> str | None:
    return fecha.strftime("%Y-%m") if fecha else None


def _bloqueos_binder(db: Session, binder_id: int) -> set[tuple[str, str]]:
    """Conjunto de (tipo, periodo) bloqueados de un binder."""
    return {
        (t, p)
        for t, p in db.execute(
            select(BdxBloqueo.tipo, BdxBloqueo.periodo).where(BdxBloqueo.binder_id == binder_id)
        ).all()
    }


def _periodo_bloqueado(
    locks: set[tuple[str, str]],
    reporting_period_start: dt.date | None,
    incluido_en_premium: bool | None,
    premium_bdx: dt.date | None,
) -> bool:
    """True si la línea cae en algún periodo bloqueado (Risk por su mes de reporting,
    o Premium por su mes de premium_bdx cuando está incluida en el Premium)."""
    rs = _mes(reporting_period_start)
    if rs and ("risk", rs) in locks:
        return True
    pm = _mes(premium_bdx)
    if incluido_en_premium and pm and ("premium", pm) in locks:
        return True
    return False


def _exigir_no_bloqueada(db: Session, bdx_id: int, linea: BdxLinea | sch.BdxLineaCreate):
    """Aborta con 409 si la línea (existente o a crear) cae en un periodo bloqueado."""
    bdx = db.get(Bdx, bdx_id)
    if bdx is None:
        return
    locks = _bloqueos_binder(db, bdx.binder_id)
    if _periodo_bloqueado(
        locks,
        getattr(linea, "reporting_period_start", None),
        getattr(linea, "incluido_en_premium", None),
        getattr(linea, "premium_bdx", None),
    ):
        raise HTTPException(
            status_code=409,
            detail="Periodo bloqueado: este BDX está cerrado y no admite cambios en sus líneas.",
        )


# ── Subir Risk BDX desde un Excel del navegador (funciona en local y en Azure) ──
async def _leer_xlsx(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Solo se admite .xlsx (convierte los .xls antes de subir).")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El fichero está vacío.")
    return content


@router.post("/binders/{binder_id}/bdx/risk-excel-preview")
async def risk_excel_preview(binder_id: int, file: UploadFile = File(...), hoja: str | None = Form(None),
                             db: Session = Depends(get_db)):
    """Vista previa del Risk BDX subido (sin escribir): hojas, líneas, periodos, totales, mapeo y muestra."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    content = await _leer_xlsx(file)
    try:
        return bdx_import.preview_risk_excel(db, b, content, hoja)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el Excel: {e}")


@router.post("/binders/{binder_id}/bdx/risk-excel-import")
async def risk_excel_import(binder_id: int, file: UploadFile = File(...), hoja: str | None = Form(None),
                            db: Session = Depends(get_db)):
    """Importa (añade) las líneas del Risk BDX subido al BDX del binder; omite los meses ya cargados."""
    b = db.get(Binder, binder_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    content = await _leer_xlsx(file)
    try:
        return bdx_import.importar_risk_excel(db, b, content, hoja)
    except HTTPException:
        raise
    except ValueError as e:
        # Guardarraíl: problemas críticos (columnas clave, periodo…). No se ha importado nada.
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo importar el Excel: {e}")


def _cab(b: Bdx, num: int | None = None) -> dict:
    return {
        "id": b.id,
        "binder_id": b.binder_id,
        "tipo": b.tipo,
        "reporting_period_start": b.reporting_period_start,
        "reporting_period_end": b.reporting_period_end,
        "estado": b.estado,
        "notas": b.notas,
        "num_lineas": num if num is not None else len(b.lineas),
        "created_at": b.created_at,
        "updated_at": b.updated_at,
    }


# ─────────────────────────── Cabeceras BDX por binder ───────────────────────
@router.get("/binders/{binder_id}/bdx", response_model=list[sch.BdxRead])
def listar(binder_id: int, tipo: str | None = None, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    # nº de líneas por bdx en una sola consulta
    conteo = dict(
        db.execute(
            select(BdxLinea.bdx_id, func.count(BdxLinea.id)).group_by(BdxLinea.bdx_id)
        ).all()
    )
    stmt = select(Bdx).where(Bdx.binder_id == binder_id)
    if tipo:
        stmt = stmt.where(Bdx.tipo == tipo)
    stmt = stmt.order_by(Bdx.reporting_period_start.desc().nullslast(), Bdx.id.desc())
    return [_cab(b, conteo.get(b.id, 0)) for b in db.scalars(stmt).all()]


@router.post("/binders/{binder_id}/bdx", response_model=sch.BdxRead, status_code=201)
def crear(binder_id: int, payload: sch.BdxCreate, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    b = Bdx(binder_id=binder_id, **payload.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return _cab(b, 0)


@router.get("/bdx/{bdx_id}", response_model=sch.BdxDetalle)
def obtener(bdx_id: int, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    return {**_cab(b, len(b.lineas)), "lineas": b.lineas}


@router.put("/bdx/{bdx_id}", response_model=sch.BdxRead)
def editar(bdx_id: int, payload: sch.BdxUpdate, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return _cab(b)


@router.delete("/bdx/{bdx_id}", status_code=204)
def borrar(bdx_id: int, db: Session = Depends(get_db)):
    b = db.get(Bdx, bdx_id)
    if b is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    db.delete(b)
    db.commit()


# ──────────────────────────────── Líneas de un BDX ──────────────────────────
@router.post("/bdx/{bdx_id}/lineas", response_model=sch.BdxLineaRead, status_code=201)
def crear_linea(bdx_id: int, payload: sch.BdxLineaCreate, db: Session = Depends(get_db)):
    if db.get(Bdx, bdx_id) is None:
        raise HTTPException(status_code=404, detail=f"BDX {bdx_id} no encontrado")
    _exigir_no_bloqueada(db, bdx_id, payload)
    linea = BdxLinea(bdx_id=bdx_id, **payload.model_dump())
    db.add(linea)
    db.commit()
    db.refresh(linea)
    return linea


@router.put("/bdx/lineas/{linea_id}", response_model=sch.BdxLineaRead)
def editar_linea(linea_id: int, payload: sch.BdxLineaUpdate, db: Session = Depends(get_db)):
    linea = db.get(BdxLinea, linea_id)
    if linea is None:
        raise HTTPException(status_code=404, detail=f"Línea {linea_id} no encontrada")
    _exigir_no_bloqueada(db, linea.bdx_id, linea)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(linea, k, v)
    db.commit()
    db.refresh(linea)
    return linea


@router.delete("/bdx/lineas/{linea_id}", status_code=204)
def borrar_linea(linea_id: int, db: Session = Depends(get_db)):
    linea = db.get(BdxLinea, linea_id)
    if linea is None:
        raise HTTPException(status_code=404, detail=f"Línea {linea_id} no encontrada")
    _exigir_no_bloqueada(db, linea.bdx_id, linea)
    db.delete(linea)
    db.commit()


# ───────────── Macheo Risk ↔ Premium: incluir/quitar líneas de un Premium ─────────────
class IncluirPremium(BaseModel):
    linea_ids: list[int]
    periodo: str | None = None   # 'YYYY-MM' del Premium; None = quitar del Premium


@router.post("/bdx/lineas/premium")
def incluir_en_premium(payload: IncluirPremium, db: Session = Depends(get_db)):
    """Marca líneas como incluidas (o no) en un Premium BDX y les fija el mes del Premium
    (premium_bdx = día 1 de ese mes)."""
    if not payload.linea_ids:
        return {"actualizadas": 0}
    fecha = None
    incluido = False
    if payload.periodo:
        try:
            y, m = (int(x) for x in payload.periodo.split("-"))
            fecha = dt.date(y, m, 1)
            incluido = True
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Periodo inválido: {payload.periodo!r} (use 'YYYY-MM').")
        # No permitir machear contra un Premium bloqueado.
        primera = db.get(BdxLinea, payload.linea_ids[0])
        binder_id = db.get(Bdx, primera.bdx_id).binder_id if primera else None
        if binder_id and db.scalar(
            select(BdxBloqueo).where(
                BdxBloqueo.binder_id == binder_id, BdxBloqueo.tipo == "premium", BdxBloqueo.periodo == payload.periodo
            )
        ) is not None:
            raise HTTPException(status_code=409, detail=f"El Premium {payload.periodo} está bloqueado: no admite cambios.")
    db.execute(
        update(BdxLinea)
        .where(BdxLinea.id.in_(payload.linea_ids))
        .values(incluido_en_premium=incluido, premium_bdx=fecha)
    )
    db.commit()
    return {"actualizadas": len(payload.linea_ids), "incluido": incluido, "periodo": payload.periodo}


# ─────────────────── Bloqueo de periodos del BDX (presentado) ────────────────
class Bloqueo(BaseModel):
    tipo: str       # 'risk' | 'premium' | 'claims'
    periodo: str    # 'YYYY-MM'


@router.get("/binders/{binder_id}/bloqueos", response_model=list[Bloqueo])
def listar_bloqueos(binder_id: int, db: Session = Depends(get_db)):
    if db.get(Binder, binder_id) is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    filas = db.scalars(
        select(BdxBloqueo).where(BdxBloqueo.binder_id == binder_id).order_by(BdxBloqueo.tipo, BdxBloqueo.periodo)
    ).all()
    return [Bloqueo(tipo=b.tipo, periodo=b.periodo) for b in filas]


def _exigir_no_cerrado(binder: Binder, tipo: str):
    """Con el binder cerrado, los bloqueos quedan congelados: Risk/Premium si la producción está
    cerrada (Cerrado Producción/Cerrado); Claims solo cuando el binder está 'Cerrado'."""
    estado = binder.estado or ""
    congelado = (
        (tipo in ("risk", "premium") and estado.startswith("Cerrado"))
        or (tipo == "claims" and estado == "Cerrado")
    )
    if congelado:
        raise HTTPException(
            status_code=409,
            detail=f"El binder está «{estado}»: los bloqueos de {tipo} no se pueden modificar.",
        )


@router.post("/binders/{binder_id}/bloqueos", response_model=Bloqueo, status_code=201)
def bloquear(binder_id: int, payload: Bloqueo, db: Session = Depends(get_db)):
    binder = db.get(Binder, binder_id)
    if binder is None:
        raise HTTPException(status_code=404, detail=f"Binder {binder_id} no encontrado")
    if payload.tipo not in TIPOS_BLOQUEO:
        raise HTTPException(status_code=422, detail=f"Tipo de bloqueo inválido: {payload.tipo}")
    _exigir_no_cerrado(binder, payload.tipo)
    existe = db.scalar(
        select(BdxBloqueo).where(
            BdxBloqueo.binder_id == binder_id,
            BdxBloqueo.tipo == payload.tipo,
            BdxBloqueo.periodo == payload.periodo,
        )
    )
    if existe is None:
        db.add(BdxBloqueo(binder_id=binder_id, tipo=payload.tipo, periodo=payload.periodo))
        db.commit()
    return payload


@router.delete("/binders/{binder_id}/bloqueos", status_code=204)
def desbloquear(binder_id: int, tipo: str, periodo: str, db: Session = Depends(get_db)):
    binder = db.get(Binder, binder_id)
    if binder is not None:
        _exigir_no_cerrado(binder, tipo)
    db.execute(
        delete(BdxBloqueo).where(
            BdxBloqueo.binder_id == binder_id,
            BdxBloqueo.tipo == tipo,
            BdxBloqueo.periodo == periodo,
        )
    )
    db.commit()
