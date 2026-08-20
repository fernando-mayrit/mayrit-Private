"""Inversiones de la casa: fondos, depósitos y cuentas remuneradas (nada tangible).

Dos cosas separan este módulo de un registro de inversiones cualquiera:

1) EL ORIGEN DEL DINERO. Cada inversión es de dinero 'Propio' o de 'Primas' (dinero de clientes que
   está de paso en nuestras cuentas antes de liquidarlo a la compañía). El de primas hay que
   devolverlo íntegro, así que se controla hasta cuándo está bloqueado (`fecha_vencimiento`) y si el
   producto puede bajar de valor (`capital_garantizado`).

2) EL VALOR NO SE DEDUCE DE LOS MOVIMIENTOS. Un fondo sube y baja sin que se mueva un euro. El valor
   sale SIEMPRE de la última valoración tecleada (`InversionValoracion`); los movimientos solo dicen
   cuánto dinero de bolsillo ha entrado o salido.

   Las cifras de cada inversión, con esa separación:

     aportado_neto = Σ Aportación − Σ Rescate                    (dinero de bolsillo que sigue dentro)
     cobrado       = Σ Rendimiento − Σ Comisión − Σ Retención    (SOLO los NO internos)
     valor         = última valoración por fecha
     ganancia      = valor + cobrado − aportado_neto

   `interno` = el movimiento no pasa por la cuenta corriente (intereses que capitalizan dentro del
   depósito, comisión que se descuenta del propio fondo). Se excluye de `cobrado` porque la
   valoración YA lo refleja; contarlo otra vez duplicaría la ganancia.

   Sin ninguna valoración todavía, `valor` se estima con lo aportado más los movimientos internos y
   se marca `valor_estimado` para que la pantalla lo advierta.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Inversion, InversionMovimiento, InversionValoracion

router = APIRouter(prefix="/inversiones", tags=["Inversiones"])

TIPOS = ["Fondo", "Depósito", "Cuenta remunerada", "Renta fija", "Otro"]
ORIGENES = ["Propio", "Primas"]
TIPOS_MOV = ["Aportación", "Rescate", "Rendimiento", "Comisión", "Retención"]
ESTADOS = ["Abierta", "Cerrada"]

# A partir de cuántos días sin teclear una valoración se considera desactualizada.
DIAS_VALORACION_VIEJA = 45


def _f(v) -> float:
    """Decimal/None → float (las cifras calculadas viajan como número normal al frontend)."""
    return float(v or 0)


# ───────────────────────────────── Esquemas ──────────────────────────────────
class MovimientoBase(BaseModel):
    fecha: dt.date
    tipo: str
    importe: Decimal = Decimal(0)
    participaciones: Decimal | None = None
    interno: bool = False
    concepto: str | None = None


class MovimientoRead(MovimientoBase):
    id: int
    inversion_id: int
    movimiento_bancario_id: int | None = None


class MovimientoUpdate(BaseModel):
    fecha: dt.date | None = None
    tipo: str | None = None
    importe: Decimal | None = None
    participaciones: Decimal | None = None
    interno: bool | None = None
    concepto: str | None = None


class ValoracionBase(BaseModel):
    fecha: dt.date
    valor: Decimal = Decimal(0)
    participaciones: Decimal | None = None
    valor_liquidativo: Decimal | None = None
    notas: str | None = None


class ValoracionRead(ValoracionBase):
    id: int
    inversion_id: int


class ValoracionUpdate(BaseModel):
    fecha: dt.date | None = None
    valor: Decimal | None = None
    participaciones: Decimal | None = None
    valor_liquidativo: Decimal | None = None
    notas: str | None = None


class InversionBase(BaseModel):
    nombre: str
    entidad: str | None = None
    tipo: str
    isin: str | None = None
    referencia: str | None = None
    origen: str
    capital_garantizado: bool = False
    fecha_alta: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    tae_pct: Decimal | None = None
    moneda: str | None = "EUR"
    estado: str = "Abierta"
    notas: str | None = None


class InversionUpdate(BaseModel):
    nombre: str | None = None
    entidad: str | None = None
    tipo: str | None = None
    isin: str | None = None
    referencia: str | None = None
    origen: str | None = None
    capital_garantizado: bool | None = None
    fecha_alta: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    tae_pct: Decimal | None = None
    moneda: str | None = None
    estado: str | None = None
    notas: str | None = None


class InversionRead(InversionBase):
    id: int
    # Cifras calculadas (ver la cabecera del módulo).
    aportado: float = 0
    rescatado: float = 0
    aportado_neto: float = 0
    cobrado: float = 0
    valor: float = 0
    valor_estimado: bool = False          # aún no hay ninguna valoración tecleada
    ganancia: float = 0
    rentabilidad_pct: float | None = None
    fecha_valoracion: dt.date | None = None
    dias_sin_valorar: int | None = None
    valoracion_vieja: bool = False
    vence_en_dias: int | None = None      # negativo = ya venció
    bloqueada: bool = False               # tiene vencimiento futuro → el dinero no se puede tocar
    n_movimientos: int = 0


class InversionDetalle(InversionRead):
    movimientos: list[MovimientoRead] = []
    valoraciones: list[ValoracionRead] = []


class BloqueResumen(BaseModel):
    n: int = 0
    aportado_neto: float = 0
    valor: float = 0
    cobrado: float = 0
    ganancia: float = 0
    rentabilidad_pct: float | None = None


class Resumen(BaseModel):
    """Foto de las inversiones ABIERTAS, con el desglose por origen del dinero y los controles
    propios del dinero de primas."""
    total: BloqueResumen
    propio: BloqueResumen
    primas: BloqueResumen
    ganancia_historica: float = 0          # incluye las cerradas
    n_cerradas: int = 0
    # Controles del dinero de primas (lo que hay que vigilar de verdad).
    primas_bloqueado: float = 0            # valor de primas con vencimiento futuro
    primas_bloqueado_hasta: dt.date | None = None
    primas_sin_garantia: float = 0         # valor de primas en productos que pueden bajar
    primas_en_perdida: float = 0           # pérdida acumulada en dinero de primas (positivo = pérdida)
    n_valoraciones_viejas: int = 0
    proximo_vencimiento: dt.date | None = None
    proximo_vencimiento_nombre: str | None = None


# ─────────────────────────────── Cálculo ─────────────────────────────────────
def _calcula(inv: Inversion, hoy: dt.date) -> dict:
    """Cifras de una inversión a partir de sus movimientos y su última valoración."""
    aportado = rescatado = Decimal(0)
    cobrado = Decimal(0)
    interno_neto = Decimal(0)   # lo que se ha quedado DENTRO del producto (para estimar sin valoración)

    for m in inv.movimientos:
        imp = m.importe or Decimal(0)
        if m.tipo == "Aportación":
            aportado += imp
        elif m.tipo == "Rescate":
            rescatado += imp
        elif m.tipo == "Rendimiento":
            if m.interno:
                interno_neto += imp
            else:
                cobrado += imp
        elif m.tipo in ("Comisión", "Retención"):
            # La retención se la queda Hacienda del rendimiento: reste donde reste, siempre sale.
            if m.interno:
                interno_neto -= imp
            else:
                cobrado -= imp

    aportado_neto = aportado - rescatado

    ultima = max(inv.valoraciones, key=lambda v: (v.fecha, v.id), default=None)
    if ultima is not None:
        valor = ultima.valor or Decimal(0)
        estimado = False
    else:
        # Sin valoración: lo mejor que se puede decir es lo aportado más lo que se quedó dentro.
        valor = aportado_neto + interno_neto
        estimado = True
        # Una inversión cerrada ya no tiene dinero dentro: lo que valía se rescató.
        if inv.estado == "Cerrada":
            valor = Decimal(0)

    ganancia = valor + cobrado - aportado_neto
    base = aportado_neto if aportado_neto > 0 else aportado
    rent = float(ganancia / base * 100) if base > 0 else None

    dias_sin = (hoy - ultima.fecha).days if ultima is not None else None
    vence_en = (inv.fecha_vencimiento - hoy).days if inv.fecha_vencimiento else None

    return {
        "aportado": _f(aportado),
        "rescatado": _f(rescatado),
        "aportado_neto": _f(aportado_neto),
        "cobrado": _f(cobrado),
        "valor": _f(valor),
        "valor_estimado": estimado,
        "ganancia": _f(ganancia),
        "rentabilidad_pct": rent,
        "fecha_valoracion": ultima.fecha if ultima is not None else None,
        "dias_sin_valorar": dias_sin,
        "valoracion_vieja": inv.estado == "Abierta" and (dias_sin is None or dias_sin > DIAS_VALORACION_VIEJA),
        "vence_en_dias": vence_en,
        "bloqueada": bool(vence_en is not None and vence_en > 0 and inv.estado == "Abierta"),
        "n_movimientos": len(inv.movimientos),
    }


def _read(inv: Inversion, hoy: dt.date) -> InversionRead:
    return InversionRead(**InversionBase.model_validate(inv, from_attributes=True).model_dump(),
                         id=inv.id, **_calcula(inv, hoy))


def _inversion_o_404(inv_id: int, db: Session) -> Inversion:
    inv = db.get(Inversion, inv_id)
    if inv is None:
        raise HTTPException(status_code=404, detail=f"Inversión {inv_id} no encontrada")
    return inv


def _valida(datos: dict) -> None:
    """Comprueba que tipo/origen/estado son de la lista (evita que entren valores inventados)."""
    if datos.get("tipo") is not None and datos["tipo"] not in TIPOS:
        raise HTTPException(status_code=422, detail=f"Tipo no válido. Opciones: {', '.join(TIPOS)}")
    if datos.get("origen") is not None and datos["origen"] not in ORIGENES:
        raise HTTPException(status_code=422, detail=f"Origen no válido. Opciones: {', '.join(ORIGENES)}")
    if datos.get("estado") is not None and datos["estado"] not in ESTADOS:
        raise HTTPException(status_code=422, detail=f"Estado no válido. Opciones: {', '.join(ESTADOS)}")


# ─────────────────────────── Inversiones (lista/ficha) ───────────────────────
# OJO al orden: /inversiones/resumen y /inversiones/entidades van ANTES que /inversiones/{inv_id},
# que si no capturaría la ruta y devolvería un 422 ("resumen" no es un entero).
@router.get("/resumen", response_model=Resumen)
def resumen(db: Session = Depends(get_db)):
    """Foto global: cuánto hay invertido, cuánto vale, cuánto se ha ganado y qué vigilar del dinero
    de primas (bloqueado, sin garantía, en pérdida)."""
    hoy = dt.date.today()
    invs = db.scalars(select(Inversion)).all()

    bloques = {"Propio": BloqueResumen(), "Primas": BloqueResumen()}
    ganancia_historica = 0.0
    n_cerradas = 0
    primas_bloqueado = 0.0
    primas_bloqueado_hasta: dt.date | None = None
    primas_sin_garantia = 0.0
    primas_en_perdida = 0.0
    n_valoraciones_viejas = 0
    prox_venc: dt.date | None = None
    prox_venc_nombre: str | None = None
    # Base de la rentabilidad por bloque (lo aportado, para no dividir por cero).
    bases = {"Propio": 0.0, "Primas": 0.0}

    for inv in invs:
        c = _calcula(inv, hoy)
        ganancia_historica += c["ganancia"]
        if inv.estado == "Cerrada":
            n_cerradas += 1
            continue

        b = bloques.get(inv.origen)
        if b is None:      # origen inesperado (dato antiguo): no rompe el resumen
            continue
        b.n += 1
        b.aportado_neto += c["aportado_neto"]
        b.valor += c["valor"]
        b.cobrado += c["cobrado"]
        b.ganancia += c["ganancia"]
        bases[inv.origen] += c["aportado_neto"] if c["aportado_neto"] > 0 else c["aportado"]

        if c["valoracion_vieja"]:
            n_valoraciones_viejas += 1
        if inv.fecha_vencimiento and (prox_venc is None or inv.fecha_vencimiento < prox_venc):
            prox_venc, prox_venc_nombre = inv.fecha_vencimiento, inv.nombre

        if inv.origen == "Primas":
            if c["bloqueada"]:
                primas_bloqueado += c["valor"]
                if primas_bloqueado_hasta is None or inv.fecha_vencimiento > primas_bloqueado_hasta:
                    primas_bloqueado_hasta = inv.fecha_vencimiento
            if not inv.capital_garantizado:
                primas_sin_garantia += c["valor"]
            if c["ganancia"] < 0:
                primas_en_perdida += -c["ganancia"]

    total = BloqueResumen()
    for k, b in bloques.items():
        total.n += b.n
        total.aportado_neto += b.aportado_neto
        total.valor += b.valor
        total.cobrado += b.cobrado
        total.ganancia += b.ganancia
        b.rentabilidad_pct = (b.ganancia / bases[k] * 100) if bases[k] > 0 else None
    base_total = bases["Propio"] + bases["Primas"]
    total.rentabilidad_pct = (total.ganancia / base_total * 100) if base_total > 0 else None

    return Resumen(
        total=total, propio=bloques["Propio"], primas=bloques["Primas"],
        ganancia_historica=ganancia_historica, n_cerradas=n_cerradas,
        primas_bloqueado=primas_bloqueado, primas_bloqueado_hasta=primas_bloqueado_hasta,
        primas_sin_garantia=primas_sin_garantia, primas_en_perdida=primas_en_perdida,
        n_valoraciones_viejas=n_valoraciones_viejas,
        proximo_vencimiento=prox_venc, proximo_vencimiento_nombre=prox_venc_nombre,
    )


@router.get("/entidades", response_model=list[str])
def entidades(db: Session = Depends(get_db)):
    """Entidades ya usadas (para sugerirlas al teclear y no escribir 'Mediolanum' de tres maneras)."""
    # El orden se hace aquí y no en SQL: con SELECT DISTINCT, Postgres exige que la expresión del
    # ORDER BY esté en la lista de campos, y `lower(entidad)` no lo está.
    filas = db.scalars(
        select(Inversion.entidad).where(Inversion.entidad.isnot(None)).distinct()
    ).all()
    return sorted((e for e in filas if (e or "").strip()), key=str.lower)


@router.get("", response_model=list[InversionRead])
def listar(origen: str | None = None, estado: str | None = None, q: str | None = None,
           db: Session = Depends(get_db)):
    stmt = select(Inversion)
    if origen:
        stmt = stmt.where(Inversion.origen == origen)
    if estado:
        stmt = stmt.where(Inversion.estado == estado)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Inversion.nombre.ilike(like) | Inversion.entidad.ilike(like)
                          | Inversion.isin.ilike(like) | Inversion.referencia.ilike(like))
    # Abiertas primero, y dentro por entidad y nombre.
    invs = db.scalars(stmt.order_by(Inversion.estado, func.lower(Inversion.entidad),
                                    func.lower(Inversion.nombre))).all()
    hoy = dt.date.today()
    return [_read(i, hoy) for i in invs]


@router.get("/{inv_id}", response_model=InversionDetalle)
def obtener(inv_id: int, db: Session = Depends(get_db)):
    inv = _inversion_o_404(inv_id, db)
    hoy = dt.date.today()
    base = _read(inv, hoy).model_dump()
    return InversionDetalle(
        **base,
        movimientos=[MovimientoRead.model_validate(m, from_attributes=True)
                     for m in sorted(inv.movimientos, key=lambda m: (m.fecha, m.id), reverse=True)],
        valoraciones=[ValoracionRead.model_validate(v, from_attributes=True)
                      for v in sorted(inv.valoraciones, key=lambda v: (v.fecha, v.id), reverse=True)],
    )


@router.post("", response_model=InversionRead, status_code=201)
def crear(payload: InversionBase, db: Session = Depends(get_db)):
    datos = payload.model_dump()
    _valida(datos)
    inv = Inversion(**datos)
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _read(inv, dt.date.today())


@router.put("/{inv_id}", response_model=InversionRead)
def editar(inv_id: int, payload: InversionUpdate, db: Session = Depends(get_db)):
    inv = _inversion_o_404(inv_id, db)
    datos = payload.model_dump(exclude_unset=True)
    _valida(datos)
    for k, v in datos.items():
        setattr(inv, k, v)
    db.commit()
    db.refresh(inv)
    return _read(inv, dt.date.today())


@router.delete("/{inv_id}", status_code=204)
def borrar(inv_id: int, db: Session = Depends(get_db)):
    inv = _inversion_o_404(inv_id, db)
    db.delete(inv)          # arrastra movimientos y valoraciones (cascade)
    db.commit()


# ──────────────────────────────── Movimientos ────────────────────────────────
@router.get("/{inv_id}/movimientos", response_model=list[MovimientoRead])
def listar_movimientos(inv_id: int, db: Session = Depends(get_db)):
    _inversion_o_404(inv_id, db)
    ms = db.scalars(select(InversionMovimiento).where(InversionMovimiento.inversion_id == inv_id)
                    .order_by(InversionMovimiento.fecha.desc(), InversionMovimiento.id.desc())).all()
    return [MovimientoRead.model_validate(m, from_attributes=True) for m in ms]


@router.post("/{inv_id}/movimientos", response_model=MovimientoRead, status_code=201)
def crear_movimiento(inv_id: int, payload: MovimientoBase, db: Session = Depends(get_db)):
    _inversion_o_404(inv_id, db)
    if payload.tipo not in TIPOS_MOV:
        raise HTTPException(status_code=422, detail=f"Tipo de movimiento no válido. Opciones: {', '.join(TIPOS_MOV)}")
    if (payload.importe or 0) <= 0:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que cero (el sentido lo da el tipo).")
    m = InversionMovimiento(inversion_id=inv_id, **payload.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return MovimientoRead.model_validate(m, from_attributes=True)


@router.put("/movimientos/{mov_id}", response_model=MovimientoRead)
def editar_movimiento(mov_id: int, payload: MovimientoUpdate, db: Session = Depends(get_db)):
    m = db.get(InversionMovimiento, mov_id)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mov_id} no encontrado")
    datos = payload.model_dump(exclude_unset=True)
    if datos.get("tipo") is not None and datos["tipo"] not in TIPOS_MOV:
        raise HTTPException(status_code=422, detail=f"Tipo de movimiento no válido. Opciones: {', '.join(TIPOS_MOV)}")
    if "importe" in datos and (datos["importe"] or 0) <= 0:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que cero (el sentido lo da el tipo).")
    for k, v in datos.items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return MovimientoRead.model_validate(m, from_attributes=True)


@router.delete("/movimientos/{mov_id}", status_code=204)
def borrar_movimiento(mov_id: int, db: Session = Depends(get_db)):
    m = db.get(InversionMovimiento, mov_id)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mov_id} no encontrado")
    db.delete(m)
    db.commit()


# ──────────────────────────────── Valoraciones ───────────────────────────────
@router.get("/{inv_id}/valoraciones", response_model=list[ValoracionRead])
def listar_valoraciones(inv_id: int, db: Session = Depends(get_db)):
    _inversion_o_404(inv_id, db)
    vs = db.scalars(select(InversionValoracion).where(InversionValoracion.inversion_id == inv_id)
                    .order_by(InversionValoracion.fecha.desc(), InversionValoracion.id.desc())).all()
    return [ValoracionRead.model_validate(v, from_attributes=True) for v in vs]


@router.post("/{inv_id}/valoraciones", response_model=ValoracionRead, status_code=201)
def crear_valoracion(inv_id: int, payload: ValoracionBase, db: Session = Depends(get_db)):
    _inversion_o_404(inv_id, db)
    ya = db.scalar(select(InversionValoracion).where(
        InversionValoracion.inversion_id == inv_id, InversionValoracion.fecha == payload.fecha))
    if ya is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Ya hay una valoración con fecha {payload.fecha.strftime('%d/%m/%Y')}. Edítala en vez de crear otra.")
    v = InversionValoracion(inversion_id=inv_id, **payload.model_dump())
    db.add(v)
    db.commit()
    db.refresh(v)
    return ValoracionRead.model_validate(v, from_attributes=True)


@router.put("/valoraciones/{val_id}", response_model=ValoracionRead)
def editar_valoracion(val_id: int, payload: ValoracionUpdate, db: Session = Depends(get_db)):
    v = db.get(InversionValoracion, val_id)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Valoración {val_id} no encontrada")
    datos = payload.model_dump(exclude_unset=True)
    nueva_fecha = datos.get("fecha")
    if nueva_fecha is not None and nueva_fecha != v.fecha:
        ya = db.scalar(select(InversionValoracion).where(
            InversionValoracion.inversion_id == v.inversion_id, InversionValoracion.fecha == nueva_fecha))
        if ya is not None:
            raise HTTPException(status_code=409,
                                detail=f"Ya hay una valoración con fecha {nueva_fecha.strftime('%d/%m/%Y')}.")
    for k, val in datos.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return ValoracionRead.model_validate(v, from_attributes=True)


@router.delete("/valoraciones/{val_id}", status_code=204)
def borrar_valoracion(val_id: int, db: Session = Depends(get_db)):
    v = db.get(InversionValoracion, val_id)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Valoración {val_id} no encontrada")
    db.delete(v)
    db.commit()
