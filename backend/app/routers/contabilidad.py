"""
Módulo de Contabilidad — libro de banco categorizado (espejo de las listas SharePoint
`Contabilidad - <cuenta>`). Cada movimiento: fecha, cuenta, concepto/grupo/tipo (clasificación),
gasto/ingreso, saldo. La conciliación con el ledger de Transferencias es la Fase 2.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import re
from collections import Counter, defaultdict
from decimal import Decimal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import norma43
from ..db import get_db
from ..models.maestras import (
    Bdx, BdxLinea, Binder, ContaCategoria, CuentaBancaria, MovimientoBancario, Productor, Recibo, Transferencia,
)

router = APIRouter(prefix="/contabilidad", tags=["Contabilidad"])


# ── Schemas ──
class MovimientoRead(BaseModel):
    id: int
    cuenta: str
    iden: int | None
    identificador: str | None
    fecha: dt.date | None
    devengo: dt.date | None
    anio: int | None
    concepto: str | None
    grupo: str | None
    tipo: str | None
    gasto: Decimal
    ingreso: Decimal
    saldo: Decimal | None
    descripcion: str | None
    codigo: str | None
    movimiento_bancario: bool = True
    tarjeta: bool
    factura: bool
    conciliado: bool = False
    transferencia_ids: list[int] | None = None

    class Config:
        from_attributes = True


class MovimientosListados(BaseModel):
    items: list[MovimientoRead]
    total_gasto: Decimal
    total_ingreso: Decimal
    neto: Decimal               # ingreso − gasto
    saldo_cuenta: Decimal | None  # saldo del último movimiento (solo si se filtra por UNA cuenta)
    n_total: int


class OpcionesConta(BaseModel):
    cuentas: list[str]
    grupos: list[str]
    tipos: list[str]
    conceptos: list[str]
    anios: list[int]


class CategoriaRead(BaseModel):
    concepto: str
    grupo: str | None
    tipo: str | None
    cuenta_contable: str | None

    class Config:
        from_attributes = True


# ── Listado con filtros + totales ──
@router.get("", response_model=MovimientosListados)
def listar(
    db: Session = Depends(get_db),
    cuenta: str | None = None,
    anio: int | None = None,
    grupo: str | None = None,
    tipo: str | None = None,
    concepto: str | None = None,
    q: str | None = None,
    limit: int = 500,
):
    filtros = []
    if cuenta:
        filtros.append(MovimientoBancario.cuenta == cuenta)
    if anio:
        filtros.append(MovimientoBancario.anio == anio)
    if grupo:
        filtros.append(MovimientoBancario.grupo == grupo)
    if tipo:
        filtros.append(MovimientoBancario.tipo == tipo)
    if concepto:
        filtros.append(MovimientoBancario.concepto == concepto)
    if q:
        like = f"%{q.strip()}%"
        filtros.append(or_(
            MovimientoBancario.descripcion.ilike(like),
            MovimientoBancario.concepto.ilike(like),
            MovimientoBancario.codigo.ilike(like),
        ))

    base = select(MovimientoBancario).where(*filtros)

    tg, ti, n = db.execute(
        select(func.coalesce(func.sum(MovimientoBancario.gasto), 0),
               func.coalesce(func.sum(MovimientoBancario.ingreso), 0),
               func.count()).where(*filtros)
    ).one()

    # Saldo de la cuenta = saldo del movimiento más reciente, solo si se filtró por una sola cuenta.
    saldo_cuenta = None
    if cuenta:
        saldo_cuenta = db.scalar(
            select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.saldo.is_not(None))
            .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
        )

    items = db.scalars(
        base.order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(limit)
    ).all()

    return MovimientosListados(
        items=[_read(m) for m in items],
        total_gasto=Decimal(tg), total_ingreso=Decimal(ti), neto=Decimal(ti) - Decimal(tg),
        saldo_cuenta=saldo_cuenta, n_total=n,
    )


def _read(m: MovimientoBancario) -> MovimientoRead:
    out = MovimientoRead.model_validate(m)
    out.conciliado = bool(m.transferencia_ids) or (m.transferencia_id is not None)
    return out


@router.get("/opciones", response_model=OpcionesConta)
def opciones(db: Session = Depends(get_db)):
    def distintos(col):
        return [v for (v,) in db.execute(select(col).where(col.is_not(None)).distinct().order_by(col)).all() if v]
    anios = [a for (a,) in db.execute(
        select(MovimientoBancario.anio).where(MovimientoBancario.anio.is_not(None)).distinct().order_by(MovimientoBancario.anio.desc())
    ).all()]
    # Las cuentas DESACTIVADAS en Configuración (cuentas_bancarias.activa=False) no muestran pestaña.
    inactivas = {n for (n,) in db.execute(
        select(CuentaBancaria.nombre).where(CuentaBancaria.activa.is_(False))
    ).all()}
    cuentas = [c for c in distintos(MovimientoBancario.cuenta) if c not in inactivas]
    return OpcionesConta(
        cuentas=cuentas,
        grupos=distintos(MovimientoBancario.grupo),
        tipos=distintos(MovimientoBancario.tipo),
        conceptos=distintos(MovimientoBancario.concepto),
        anios=anios,
    )


@router.get("/categorias", response_model=list[CategoriaRead])
def categorias(db: Session = Depends(get_db)):
    return db.scalars(select(ContaCategoria).order_by(ContaCategoria.grupo, ContaCategoria.concepto)).all()


# ── Alta de movimiento (al estilo Access) ──
class BaseAlta(BaseModel):
    ultimo_saldo: Decimal | None   # saldo del último movimiento de la cuenta
    next_iden: int                 # siguiente Iden correlativo de la cuenta para ese año


@router.get("/base", response_model=BaseAlta)
def base_alta(cuenta: str, anio: int, db: Session = Depends(get_db)):
    """Datos para el alta de un movimiento de `cuenta`: saldo de partida y siguiente Iden del año."""
    ultimo = db.scalar(
        select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.saldo.is_not(None))
        .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
    )
    maxiden = db.scalar(
        select(func.max(MovimientoBancario.iden)).where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.anio == anio)
    )
    return BaseAlta(ultimo_saldo=ultimo, next_iden=(maxiden or 0) + 1)


class MovimientoCrear(BaseModel):
    cuenta: str
    fecha: dt.date
    devengo: dt.date | None = None
    tipo: str                       # Gasto | Ingreso
    grupo: str | None = None
    concepto: str | None = None
    importe: Decimal
    saldo: Decimal | None = None    # si no viene, se calcula (saldo anterior ± importe)
    descripcion: str | None = None
    movimiento_bancario: bool = True
    factura: bool = False           # 'Justificante'
    tarjeta: bool = False
    transferencia_ids: list[int] | None = None


@router.post("", response_model=MovimientoRead, status_code=201)
def crear(payload: MovimientoCrear, db: Session = Depends(get_db)):
    dev = payload.devengo or payload.fecha
    es_gasto = payload.tipo == "Gasto"
    importe = Decimal(payload.importe or 0)
    gasto = importe if es_gasto else Decimal(0)
    ingreso = Decimal(0) if es_gasto else importe

    # Iden correlativo por cuenta y AÑO; Id visible = '{iden}.{mes}' (mes del devengo).
    anio = payload.fecha.year
    maxiden = db.scalar(
        select(func.max(MovimientoBancario.iden)).where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.anio == anio)
    )
    iden = (maxiden or 0) + 1
    identificador = f"{iden:03d}.{dev.month:02d}"   # Id a 3 cifras (XXX.MM), con ceros delante

    # Saldo = el dado, o el del último movimiento ± importe.
    if payload.saldo is not None:
        saldo = Decimal(payload.saldo)
    else:
        ult = db.scalar(
            select(MovimientoBancario.saldo).where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.saldo.is_not(None))
            .order_by(MovimientoBancario.fecha.desc().nullslast(), MovimientoBancario.id.desc()).limit(1)
        )
        saldo = Decimal(ult or 0) + ingreso - gasto

    pgc = db.scalar(select(ContaCategoria.cuenta_contable).where(ContaCategoria.concepto == payload.concepto)) if payload.concepto else None
    codigo = f"{identificador}. {pgc or ''}. {payload.concepto or ''}".strip()

    m = MovimientoBancario(
        cuenta=payload.cuenta, iden=iden, identificador=identificador,
        fecha=payload.fecha, anio=anio, devengo=dev,
        concepto=payload.concepto, grupo=payload.grupo, tipo=payload.tipo,
        gasto=gasto, ingreso=ingreso, saldo=saldo,
        descripcion=payload.descripcion, codigo=codigo,
        movimiento_bancario=payload.movimiento_bancario, factura=payload.factura, tarjeta=payload.tarjeta,
        transferencia_ids=payload.transferencia_ids,
        sp_lista=None, sp_old_id=None,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _read(m)


# ── Importar extracto bancario (Norma 43) ─────────────────────────────────────────────────────
def _huella(cuenta: str, m: dict) -> str:
    """Hash estable de un movimiento del extracto (para deduplicar reimportaciones que solapan)."""
    base = f"{cuenta}|{m.get('fecha')}|{m.get('importe')}|{m.get('documento','')}|{m.get('referencia1','')}|{m.get('referencia2','')}|{m.get('descripcion','')}"
    return hashlib.md5(base.encode("utf-8")).hexdigest()


def _solo_digitos(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _cuenta_sugerida(db: Session, banco: str, oficina: str, cuenta_n43: str) -> str | None:
    """Mapea la cuenta del extracto (banco+oficina+nº) a una CuentaBancaria por su IBAN. Devuelve el
    NOMBRE de la cuenta si hay una única coincidencia; None si es ambigua o no hay."""
    bo = _solo_digitos(banco) + _solo_digitos(oficina)
    cn = _solo_digitos(cuenta_n43)
    if not (bo and cn):
        return None
    matches = []
    for c in db.scalars(select(CuentaBancaria).where(CuentaBancaria.iban.is_not(None))).all():
        ib = _solo_digitos(c.iban)
        if bo in ib and cn in ib:
            matches.append(c.nombre)
    return matches[0] if len(matches) == 1 else None


# Prefijos de "tipo de operación" del extracto: se quitan para quedarnos con el PAGADOR/comercio, que es
# lo que identifica la categoría (si no, todas las "TRANSFERENC. A ..." caerían en el mismo saco).
_PREFIJOS_OP = ("COMPRA TARJETA", "COMPRA TARJ", "COMPRA", "TRANSFERENC. A", "TRANSFERENCIA A", "TRANSFERENC.",
                "TRANSFERENCIA", "CARGO RECIBO", "ADEUDO RECIBO", "ADEUDO", "RECIBO", "PAGO ", "ABONO ", "BIZUM")


def _firma_desc(s: str | None) -> str:
    """Firma centrada en el PAGADOR/comercio: quita la máscara de tarjeta, el prefijo de tipo de operación
    y todo lo que no sean letras. Así 'TRANSFERENC. A IBERIAN INSURANCE' → 'IBERIAN INSURANCE'."""
    s = (s or "").upper()
    s = re.sub(r"\bTARJ\.?\s*\d[\dX]*", " ", s)          # máscara de tarjeta (5540XXXX...)
    s = re.sub(r"\s+", " ", s).strip()
    for p in _PREFIJOS_OP:
        if s.startswith(p):
            s = s[len(p):]
            break
    s = re.sub(r"[^A-ZÁÉÍÓÚÑ ]", " ", s)                  # solo letras
    return re.sub(r"\s+", " ", s).strip()[:25]


def _historial_categorias(db: Session, cuenta: str | None) -> dict[str, tuple]:
    """De los movimientos ya categorizados de la cuenta, la categoría (concepto,grupo,tipo) MÁS habitual
    por firma de PAGADOR. Sirve para proponer la categoría de los nuevos (aprende del histórico)."""
    if not cuenta:
        return {}
    por_clave: dict[str, Counter] = defaultdict(Counter)
    for concepto, grupo, tipo, desc in db.execute(
        select(MovimientoBancario.concepto, MovimientoBancario.grupo, MovimientoBancario.tipo, MovimientoBancario.descripcion)
        .where(MovimientoBancario.cuenta == cuenta, MovimientoBancario.concepto.is_not(None))
    ).all():
        clave = _firma_desc(desc)
        if len(clave) >= 4:
            por_clave[clave][(concepto, grupo, tipo)] += 1
    return {k: c.most_common(1)[0][0] for k, c in por_clave.items()}


def _sugerir_categoria(historial: dict, descripcion: str | None) -> tuple:
    """Propone (concepto,grupo,tipo) SOLO con match fuerte del pagador (exacto o prefijo largo en común).
    Mejor dejar en blanco que proponer mal: el usuario ajusta y así aprende para la próxima."""
    clave = _firma_desc(descripcion)
    if len(clave) < 4:
        return (None, None, None)
    if clave in historial:
        return historial[clave]
    for k, v in historial.items():                        # mismo pagador con variación menor (≥10 char)
        n = min(len(k), len(clave))
        if n >= 10 and k[:n] == clave[:n]:
            return v
    return (None, None, None)


class MovImportado(BaseModel):
    fecha: dt.date | None
    fecha_valor: dt.date | None
    importe: Decimal                 # con signo (negativo = gasto)
    tipo: str                        # Gasto | Ingreso
    descripcion: str
    concepto: str | None = None      # propuesto (aprendido del histórico)
    grupo: str | None = None
    tarjeta: bool = False
    saldo: Decimal | None = None     # saldo corriente del banco tras el movimiento
    huella: str
    estado: str                      # nuevo | importado | posible
    dup_id: int | None = None        # id del apunte existente si 'importado'/'posible'


class ImportPreview(BaseModel):
    cuenta_sugerida: str | None
    cuentas: list[str]
    banco: str
    cuenta_banco: str
    nombre_banco: str
    periodo_ini: dt.date | None
    periodo_fin: dt.date | None
    saldo_ini: Decimal | None
    saldo_fin: Decimal | None
    cuadra: bool
    n_nuevos: int
    n_importados: int
    n_posibles: int
    movimientos: list[MovImportado]


@router.post("/importar/preview", response_model=ImportPreview)
async def importar_preview(file: UploadFile = File(...), cuenta: str | None = Form(None), db: Session = Depends(get_db)):
    """Parsea un extracto Norma 43 y devuelve sus movimientos con categoría propuesta y estado de
    duplicado (nuevo / ya importado / posible), sin escribir nada."""
    contenido = await file.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El fichero está vacío.")
    try:
        cuentas_n43 = norma43.parse_norma43(contenido)
    except norma43.Norma43Error as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No se pudo leer el Norma 43: {e}")
    c = cuentas_n43[0]   # lo normal es una cuenta por fichero
    cuenta_app = cuenta or _cuenta_sugerida(db, c["banco"], c["oficina"], c["cuenta"])

    suma = sum((m["importe"] for m in c["movimientos"]), Decimal(0))
    cuadra = (c["saldo_inicial"] is not None and c["saldo_final"] is not None
              and c["saldo_inicial"] + suma == c["saldo_final"])

    historial = _historial_categorias(db, cuenta_app)
    huellas_exist: set[str] = set()
    posibles: dict[tuple, int] = {}
    if cuenta_app:
        huellas_exist = {h for (h,) in db.execute(select(MovimientoBancario.ref_extracto)
            .where(MovimientoBancario.cuenta == cuenta_app, MovimientoBancario.ref_extracto.is_not(None))).all()}
        for mid, f, g, i in db.execute(select(MovimientoBancario.id, MovimientoBancario.fecha, MovimientoBancario.gasto, MovimientoBancario.ingreso)
            .where(MovimientoBancario.cuenta == cuenta_app, MovimientoBancario.ref_extracto.is_(None))).all():
            posibles[(f, (i or Decimal(0)) - (g or Decimal(0)))] = mid

    saldo = c["saldo_inicial"] or Decimal(0)
    movs: list[MovImportado] = []
    n_nuevos = n_imp = n_pos = 0
    for m in c["movimientos"]:
        saldo = saldo + m["importe"]
        h = _huella(cuenta_app or "", m)
        concepto, grupo, _tc = _sugerir_categoria(historial, m["descripcion"])
        estado, dup_id = "nuevo", None
        if h in huellas_exist:
            estado, n_imp = "importado", n_imp + 1
        elif (m["fecha"], m["importe"]) in posibles:
            estado, dup_id, n_pos = "posible", posibles[(m["fecha"], m["importe"])], n_pos + 1
        else:
            n_nuevos += 1
        movs.append(MovImportado(
            fecha=m["fecha"], fecha_valor=m["fecha_valor"], importe=m["importe"],
            tipo=("Gasto" if m["importe"] < 0 else "Ingreso"), descripcion=m["descripcion"],
            concepto=concepto, grupo=grupo, tarjeta="COMPRA TARJ" in (m["descripcion"] or "").upper(),
            saldo=saldo, huella=h, estado=estado, dup_id=dup_id,
        ))
    nombres = [x.nombre for x in db.scalars(select(CuentaBancaria).where(CuentaBancaria.activa.is_(True)).order_by(CuentaBancaria.nombre)).all()]
    return ImportPreview(
        cuenta_sugerida=cuenta_app, cuentas=nombres,
        banco=c["banco"], cuenta_banco=c["cuenta"], nombre_banco=c["nombre"],
        periodo_ini=c["fecha_inicial"], periodo_fin=c["fecha_final"],
        saldo_ini=c["saldo_inicial"], saldo_fin=c["saldo_final"], cuadra=cuadra,
        n_nuevos=n_nuevos, n_importados=n_imp, n_posibles=n_pos, movimientos=movs,
    )


class MovAAlta(BaseModel):
    fecha: dt.date
    devengo: dt.date | None = None
    tipo: str
    grupo: str | None = None
    concepto: str | None = None
    importe: Decimal                 # con signo
    saldo: Decimal | None = None
    descripcion: str | None = None
    tarjeta: bool = False
    huella: str | None = None


class ImportAplicar(BaseModel):
    cuenta: str
    movimientos: list[MovAAlta]


@router.post("/importar/aplicar")
def importar_aplicar(payload: ImportAplicar, db: Session = Depends(get_db)):
    """Da de alta en bloque los movimientos elegidos del extracto (calcula iden por cuenta+año, guarda el
    saldo del banco, la cuenta contable por concepto y la huella para deduplicar). Salta los ya importados."""
    if not payload.cuenta:
        raise HTTPException(status_code=400, detail="Falta la cuenta de destino.")
    huellas_exist = {h for (h,) in db.execute(select(MovimientoBancario.ref_extracto)
        .where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.ref_extracto.is_not(None))).all()}
    idens: dict[int, int] = {}
    creados = saltados = 0
    for m in payload.movimientos:
        if m.huella and m.huella in huellas_exist:
            saltados += 1
            continue
        anio = m.fecha.year
        if anio not in idens:
            idens[anio] = db.scalar(select(func.max(MovimientoBancario.iden))
                .where(MovimientoBancario.cuenta == payload.cuenta, MovimientoBancario.anio == anio)) or 0
        idens[anio] += 1
        iden = idens[anio]
        dev = m.devengo or m.fecha
        identificador = f"{iden:03d}.{dev.month:02d}"
        es_gasto = m.tipo == "Gasto"
        imp = abs(Decimal(m.importe or 0))
        pgc = db.scalar(select(ContaCategoria.cuenta_contable).where(ContaCategoria.concepto == m.concepto)) if m.concepto else None
        codigo = f"{identificador}. {pgc or ''}. {m.concepto or ''}".strip()
        db.add(MovimientoBancario(
            cuenta=payload.cuenta, iden=iden, identificador=identificador, fecha=m.fecha, anio=anio, devengo=dev,
            concepto=m.concepto, grupo=m.grupo, tipo=m.tipo,
            gasto=(imp if es_gasto else Decimal(0)), ingreso=(Decimal(0) if es_gasto else imp), saldo=m.saldo,
            descripcion=m.descripcion, codigo=codigo, tarjeta=m.tarjeta, ref_extracto=m.huella,
            sp_lista=None, sp_old_id=None,
        ))
        if m.huella:
            huellas_exist.add(m.huella)
        creados += 1
    db.commit()
    return {"creados": creados, "saltados": saltados}


class MovimientoUpdate(BaseModel):
    fecha: dt.date | None = None
    devengo: dt.date | None = None
    tipo: str | None = None
    grupo: str | None = None
    concepto: str | None = None
    importe: Decimal | None = None         # magnitud (va a gasto o ingreso según el tipo)
    saldo: Decimal | None = None
    descripcion: str | None = None
    factura: bool | None = None            # 'Justificante'
    tarjeta: bool | None = None
    movimiento_bancario: bool | None = None
    transferencia_ids: list[int] | None = None   # transferencias que componen el apunte (justificante)


@router.put("/{mid}", response_model=MovimientoRead)
def actualizar(mid: int, payload: MovimientoUpdate, db: Session = Depends(get_db)):
    """Edición de un movimiento. Solo aplica los campos enviados (toggle del justificante, o edición
    completa desde el modal)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    datos = payload.model_dump(exclude_unset=True)
    for k in ("grupo", "concepto", "saldo", "descripcion", "factura", "tarjeta", "movimiento_bancario", "transferencia_ids"):
        if k in datos:
            setattr(m, k, datos[k])
    if datos.get("fecha"):
        m.fecha = datos["fecha"]
        m.anio = datos["fecha"].year
    if "devengo" in datos:
        m.devengo = datos["devengo"]
    # tipo/importe → recalcular gasto/ingreso
    if "tipo" in datos or "importe" in datos:
        tipo = datos.get("tipo") or m.tipo
        imp = Decimal(datos["importe"]) if datos.get("importe") is not None else Decimal(m.gasto or 0) + Decimal(m.ingreso or 0)
        m.tipo = tipo
        m.gasto = imp if tipo == "Gasto" else Decimal(0)
        m.ingreso = Decimal(0) if tipo == "Gasto" else imp
    db.commit()
    db.refresh(m)
    return _read(m)


# ──────────── Justificante de movimiento (TRANSFERENCIAS del ledger que lo componen) ────────────
# Cada Transferencia es el importe REAL movido (cobro/liquidación parcial), con su fecha; sumadas por
# fecha cuadran con el importe del apunte. El cuadre es automático: se ofrecen las del mismo tipo y
# fecha del apunte (ocultando las ya usadas en otro apunte) y se autoseleccionan.
def _num_es(x) -> str:
    s = f"{Decimal(x or 0):,.2f}"
    return s.replace(",", "·").replace(".", ",").replace("·", ".")


# Clase del apunte (deducida del concepto) → subtipo(s) de Transferencia.
_CLASE_SUBTIPOS = {
    "cobro": ["Cobro"],
    "liquidacion": ["Liquidación", "Liquidacion"],
    "traspaso": ["Traspaso"],
}
_IMP_LABEL = {"cobro": "Cobrado", "liquidacion": "Liquidado al UW", "traspaso": "Traspasado"}


def _clase_de_concepto(concepto: str | None) -> str:
    c = (concepto or "").lower()
    if "liquid" in c:
        return "liquidacion"
    if "traspas" in c:
        return "traspaso"
    return "cobro"


class ReciboJustif(BaseModel):
    """Una fila POR RECIBO del justificante. Varias filas pueden compartir `transferencia_id`
    (un cobro que paga varios recibos); el cuadre con el apunte se hace por transferencia, por eso
    se incluye `importe_transferencia` (el importe real movido) además del importe individual."""
    transferencia_id: int
    importe_transferencia: Decimal
    fecha: dt.date | None
    importe: Decimal           # importe individual de ESTE recibo
    referencia: str | None
    recibo: str | None
    cliente: str | None
    mercado: str | None


def _coverholders(db: Session, umrs: set[str]) -> dict[str, str]:
    """UMR de binder → nombre del coverholder (agencia), para la columna Cliente."""
    umrs = {u for u in umrs if u}
    if not umrs:
        return {}
    rows = db.execute(
        select(Binder.umr, Productor.nombre).join(Productor, Productor.id == Binder.productor_id)
        .where(Binder.umr.in_(umrs))
    ).all()
    return {umr: nom for (umr, nom) in rows if umr}


def _desglose_recibos(db: Session, trs: list[Transferencia]) -> dict[int, list[tuple[str | None, Decimal]]]:
    """tid → [(recibo|None, importe_individual)]: el DESGLOSE POR RECIBO de cada transferencia.

    Conjunto de recibos: 1) recibo_num / recibo_id directos; si no, 2) por (binder, mes de premium_bdx)
    == periodo de la transferencia (preciso), con respaldo por la FECHA de pago/liq./traspaso.
    Importe por recibo (solo cuando hay varios): Σ de la columna del subtipo (ingresado / liquidado_uw
    / traspasado) de las líneas de ese recibo en la fecha de la transferencia. Con un solo recibo se usa
    el importe de la transferencia (evita el ruido de redondeo)."""
    umrs = {t.numero_poliza for t in trs if t.numero_poliza and t.binder_id is None}
    umr2bid = ({u: i for (u, i) in db.execute(select(Binder.umr, Binder.id).where(Binder.umr.in_(umrs))).all()}
               if umrs else {})
    bid_de = lambda t: t.binder_id or umr2bid.get(t.numero_poliza or "")
    rids = {t.recibo_id for t in trs if t.recibo_id}
    rec_por_id = ({i: n for (i, n) in db.execute(select(Recibo.id, Recibo.numero).where(Recibo.id.in_(rids))).all()}
                  if rids else {})
    bids = {bid_de(t) for t in trs}
    bids.discard(None)

    por_premio: dict[tuple[int, str], set[str]] = defaultdict(set)
    por_fecha_set: dict[tuple[str, int, dt.date], set[str]] = defaultdict(set)
    por_fecha_amt: dict[tuple[str, int, dt.date, str], Decimal] = {}
    if bids:
        for (b, pbdx, num) in db.execute(
            select(Bdx.binder_id, BdxLinea.premium_bdx, Recibo.numero)
            .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
            .where(Bdx.binder_id.in_(bids), BdxLinea.premium_bdx.is_not(None), Recibo.numero.is_not(None))
        ).all():
            por_premio[(b, pbdx.strftime("%Y-%m"))].add(num)
        for sub, dcol, acol in (("Cobro", BdxLinea.premium_payment_date, BdxLinea.ingresado),
                                ("Liquidación", BdxLinea.fecha_liquidacion, BdxLinea.liquidado_uw),
                                ("Traspaso", BdxLinea.fecha_traspaso, BdxLinea.traspasado)):
            for (b, f, num, amt) in db.execute(
                select(Bdx.binder_id, dcol, Recibo.numero, func.sum(acol))
                .join(Bdx, Bdx.id == BdxLinea.bdx_id).join(Recibo, Recibo.id == BdxLinea.recibo_id)
                .where(Bdx.binder_id.in_(bids), dcol.is_not(None), Recibo.numero.is_not(None))
                .group_by(Bdx.binder_id, dcol, Recibo.numero)
            ).all():
                por_fecha_set[(sub, b, f)].add(num)
                por_fecha_amt[(sub, b, f, num)] = Decimal(amt or 0)

    def _sub(t):
        return "Liquidación" if (t.subtipo or "").startswith("Liquidaci") else t.subtipo

    out: dict[int, list[tuple[str | None, Decimal]]] = {}
    for t in trs:
        imp_t = Decimal(t.importe or 0)
        if t.recibo_num:
            out[t.id] = [(t.recibo_num, imp_t)]
            continue
        if t.recibo_id and t.recibo_id in rec_por_id:
            out[t.id] = [(rec_por_id[t.recibo_id], imp_t)]
            continue
        # El desglose por recibo SOLO aplica a Primas: Siniestros/Comisiones/Honorarios no tienen
        # recibo de prima → una sola fila con el importe de la transferencia (si no, salen recibos
        # de prima ajenos con importe 0 y la suma no cuadra).
        if (t.tipo or "") != "Primas":
            out[t.id] = [(None, imp_t)]
            continue
        b = bid_de(t)
        sub = _sub(t)
        recibos: set[str] = set()
        if b and t.periodo:
            recibos = set(por_premio.get((b, t.periodo.strftime("%Y-%m")), set()))
        if not recibos and b and t.fecha:
            recibos = set(por_fecha_set.get((sub, b, t.fecha), set()))
        if not recibos:
            out[t.id] = [(None, imp_t)]
        elif len(recibos) == 1:
            out[t.id] = [(next(iter(recibos)), imp_t)]
        else:
            out[t.id] = [(r, por_fecha_amt.get((sub, b, t.fecha, r), Decimal(0))) for r in sorted(recibos)]
    return out


def _filas_recibo(trs: list[Transferencia], cov: dict[str, str],
                  desg: dict[int, list[tuple[str | None, Decimal]]]) -> list["ReciboJustif"]:
    """Aplana las transferencias a filas POR RECIBO (conservando el orden de `trs`)."""
    filas: list[ReciboJustif] = []
    for t in trs:
        for (rec, imp) in desg.get(t.id, [(None, Decimal(t.importe or 0))]):
            filas.append(ReciboJustif(
                transferencia_id=t.id, importe_transferencia=Decimal(t.importe or 0),
                fecha=t.fecha, importe=imp, referencia=t.numero_poliza, recibo=rec,
                cliente=cov.get(t.numero_poliza or ""), mercado=t.mercado,
            ))
    return filas


def _transferencias_ya_justificadas(db: Session, excluir_mid: int | None) -> set[int]:
    """Transferencias ya asignadas al justificante de ALGÚN apunte (para no ofrecerlas otra vez)."""
    usados: set[int] = set()
    for (lst, mid_) in db.execute(
        select(MovimientoBancario.transferencia_ids, MovimientoBancario.id)
        .where(MovimientoBancario.transferencia_ids.is_not(None))
    ).all():
        if excluir_mid is not None and mid_ == excluir_mid:
            continue
        usados.update(lst or [])
    return usados


@router.get("/transferencias-justificante", response_model=list[ReciboJustif])
def transferencias_justificante(
    clase: str = "cobro", fecha: dt.date | None = None, ambito: str | None = None,
    excluir_mid: int | None = None, limit: int = 1500, db: Session = Depends(get_db),
):
    """Transferencias candidatas (del subtipo de la clase) para componer un apunte, filtradas por la
    FECHA del movimiento y ocultando las ya usadas en otro apunte. Se autoseleccionan en el front y su
    suma debe cuadrar con el importe del apunte.

    `ambito` (Primas/Siniestros/Comisiones/Honorarios, deducido del concepto del apunte) acota el
    `tipo` de transferencia: un apunte «Cobro Primas» NO debe mezclar transferencias de Siniestros."""
    # Sin fecha NO se devuelve nada: el justificante siempre se cuadra por la fecha del apunte; así se
    # evita autoseleccionar TODAS las transferencias por error.
    if fecha is None:
        return []
    subtipos = _CLASE_SUBTIPOS.get(clase, _CLASE_SUBTIPOS["cobro"])
    stmt = select(Transferencia).where(Transferencia.subtipo.in_(subtipos), Transferencia.fecha == fecha)
    if ambito:
        stmt = stmt.where(Transferencia.tipo == ambito)
    usados = _transferencias_ya_justificadas(db, excluir_mid)
    if usados:
        stmt = stmt.where(Transferencia.id.not_in(usados))
    stmt = stmt.order_by(Transferencia.fecha.desc().nullslast(), Transferencia.numero_poliza).limit(limit)
    trs = list(db.scalars(stmt).all())
    cov = _coverholders(db, {t.numero_poliza for t in trs if t.numero_poliza})
    return _filas_recibo(trs, cov, _desglose_recibos(db, trs))


# ── Conciliación automática (Fase B): proponer las transferencias que cuadran cada apunte de seguros ──
def _ambito_de(concepto: str | None) -> str | None:
    """Ámbito de seguros del apunte (Primas/Siniestros/Comisiones/Honorarios), o None si NO es de seguros.
    'Comisiones Bancarias' se excluye (es una comisión del banco, no de mediación)."""
    c = (concepto or "").lower()
    if "bancari" in c:
        return None
    if "prima" in c:
        return "Primas"
    if "siniestro" in c:
        return "Siniestros"
    if "comision" in c or "comisión" in c:
        return "Comisiones"
    if "honorario" in c:
        return "Honorarios"
    return None


def _preseleccion(cands: list[tuple[int, Decimal, dt.date | None]], objetivo: Decimal,
                  fecha_apunte: dt.date | None, tol: Decimal = Decimal("0.01")) -> tuple[list[int], str]:
    """Sugiere qué transferencias marcar y con qué confianza. NUNCA inventa: si nada suma exacto, marca las
    de la misma fecha (o todas) como 'revisar' con su residual, para que el usuario decida."""
    from itertools import combinations
    if not cands:
        return [], "sin_candidatas"
    for i, imp, _f in cands:                                   # 1) una sola exacta
        if abs(imp - objetivo) <= tol:
            return [i], "exacta"
    if abs(sum(imp for _, imp, _ in cands) - objetivo) <= tol:  # 2) todas suman exacto
        return [i for i, _, _ in cands], "exacta"
    mismo = [(i, imp) for i, imp, f in cands if f == fecha_apunte]
    if mismo and abs(sum(imp for _, imp in mismo) - objetivo) <= tol:   # 3) las de misma fecha, exacto
        return [i for i, _ in mismo], "exacta"
    if 1 < len(cands) <= 16:                                    # 4) subconjunto exacto (pequeño)
        idx = [(i, imp) for i, imp, _ in cands]
        for r in range(2, len(idx) + 1):
            for combo in combinations(idx, r):
                if abs(sum(imp for _, imp in combo) - objetivo) <= tol:
                    return sorted(i for i, _ in combo), "exacta"
    return ([i for i, _ in mismo] if mismo else [i for i, _, _ in cands]), "revisar"   # 5) fuzzy → revisar


class ConcApunte(BaseModel):
    mid: int
    fecha: dt.date | None
    importe: Decimal
    concepto: str | None
    cuenta: str
    clase: str
    ambito: str | None
    filas: list[ReciboJustif]        # candidatas (por recibo), como el justificante
    preseleccion: list[int]          # transferencia_ids sugeridas
    suma_pre: Decimal
    residual: Decimal                # importe − suma sugerida
    confianza: str                   # exacta | revisar | sin_candidatas


class ConcPreview(BaseModel):
    cuenta: str | None
    dias: int
    n_exactas: int
    n_revisar: int
    n_sin: int
    apuntes: list[ConcApunte]


@router.get("/conciliar/preview", response_model=ConcPreview)
def conciliar_preview(cuenta: str, dias: int = 7, desde: dt.date | None = None, db: Session = Depends(get_db)):
    """Propone (SIN escribir nada) las transferencias que cuadran cada apunte de SEGUROS aún no conciliado
    de la cuenta. Ventana de ±`dias` (la fecha valor del banco ≠ la contable). Etiqueta cada uno:
    exacta / revisar (con residual) / sin candidatas."""
    q = select(MovimientoBancario).where(MovimientoBancario.cuenta == cuenta)
    if desde:
        q = q.where(MovimientoBancario.fecha >= desde)
    apuntes = db.scalars(q.order_by(MovimientoBancario.fecha.desc())).all()
    usadas = _transferencias_ya_justificadas(db, None)
    out: list[ConcApunte] = []
    n_ex = n_rev = n_sin = 0
    for m in apuntes:
        if m.transferencia_ids:               # ya conciliado
            continue
        amb = _ambito_de(m.concepto)
        if not amb:                           # no es de seguros → no se toca
            continue
        clase = _clase_de_concepto(m.concepto)
        subs = _CLASE_SUBTIPOS[clase]
        objetivo = Decimal(m.ingreso or 0) if (m.ingreso or 0) else Decimal(m.gasto or 0)
        f = m.fecha
        qtr = select(Transferencia).where(Transferencia.subtipo.in_(subs), Transferencia.tipo == amb)
        if f:
            qtr = qtr.where(Transferencia.fecha >= f - dt.timedelta(days=dias),
                            Transferencia.fecha <= f + dt.timedelta(days=dias))
        cand_tr = [t for t in db.scalars(qtr.order_by(Transferencia.fecha, Transferencia.numero_poliza)).all()
                   if t.id not in usadas]
        pre, conf = _preseleccion([(t.id, Decimal(t.importe or 0), t.fecha) for t in cand_tr], objetivo, f)
        suma = sum((Decimal(t.importe or 0) for t in cand_tr if t.id in pre), Decimal(0))
        cov = _coverholders(db, {t.numero_poliza for t in cand_tr if t.numero_poliza})
        filas = _filas_recibo(cand_tr, cov, _desglose_recibos(db, cand_tr))
        out.append(ConcApunte(
            mid=m.id, fecha=f, importe=objetivo, concepto=m.concepto, cuenta=m.cuenta,
            clase=clase, ambito=amb, filas=filas, preseleccion=pre,
            suma_pre=suma, residual=objetivo - suma, confianza=conf,
        ))
        n_ex += conf == "exacta"; n_rev += conf == "revisar"; n_sin += conf == "sin_candidatas"
    return ConcPreview(cuenta=cuenta, dias=dias, n_exactas=n_ex, n_revisar=n_rev, n_sin=n_sin, apuntes=out)


class ConcItem(BaseModel):
    mid: int
    transferencia_ids: list[int]


class ConcAplicar(BaseModel):
    items: list[ConcItem]


@router.post("/conciliar/aplicar")
def conciliar_aplicar(payload: ConcAplicar, db: Session = Depends(get_db)):
    """Persiste SOLO lo que el usuario confirma: marca cada apunte con sus transferencias. No toca nada más.
    Evita usar una transferencia ya asignada a otro apunte (aviso, no escribe esa)."""
    usadas = _transferencias_ya_justificadas(db, None)
    conciliados = 0
    conflictos: list[int] = []
    for it in payload.items:
        m = db.get(MovimientoBancario, it.mid)
        if m is None or not it.transferencia_ids:
            continue
        chocan = [tid for tid in it.transferencia_ids if tid in usadas]
        if chocan:
            conflictos.append(it.mid)
            continue
        m.transferencia_ids = it.transferencia_ids
        usadas.update(it.transferencia_ids)
        conciliados += 1
    db.commit()
    return {"conciliados": conciliados, "conflictos": conflictos}


def _build_justificante_pdf(m: MovimientoBancario, filas: list[ReciboJustif], clase: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm, title=m.identificador or "Justificante")
    styles = getSampleStyleSheet()
    elems = []
    naranja = colors.HexColor("#da5833")
    elems.append(Paragraph(f"<b>Concepto</b>&nbsp;&nbsp; {m.concepto or ''}", styles["Normal"]))
    elems.append(Paragraph(f"<b>Fecha</b>&nbsp;&nbsp; {m.fecha.strftime('%d/%m/%Y') if m.fecha else ''}", styles["Normal"]))
    elems.append(Paragraph(f"<b>Movimiento</b>&nbsp;&nbsp; {m.identificador or ''} &nbsp;·&nbsp; {m.cuenta}", styles["Normal"]))
    elems.append(Spacer(1, 8))

    imp_label = _IMP_LABEL.get(clase, "Importe")
    cli = styles["Normal"].clone("cli"); cli.fontSize = 8
    data = [["Recibo", "Fecha", imp_label, "Referencia", "Cliente"]]
    total = Decimal(0)
    for f in filas:
        total += f.importe
        data.append([
            f.recibo or "", f.fecha.strftime("%d/%m/%Y") if f.fecha else "",
            _num_es(f.importe), f.referencia or "", Paragraph(f.cliente or f.mercado or "", cli),
        ])
    data.append(["", "Total", _num_es(total), "", ""])

    t = Table(data, colWidths=[24 * mm, 22 * mm, 28 * mm, 36 * mm, 68 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), naranja),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f6f6f6")]),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fff1ea")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elems.append(t)
    doc.build(elems)
    return buf.getvalue()


@router.get("/{mid}/justificante.pdf")
def justificante_pdf(mid: int, db: Session = Depends(get_db)):
    """PDF del justificante del apunte con las transferencias que lo componen (transferencia_ids)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    ids = m.transferencia_ids or []
    clase = _clase_de_concepto(m.concepto)
    filas: list[ReciboJustif] = []
    if ids:
        trs = list(db.scalars(select(Transferencia).where(Transferencia.id.in_(ids))).all())
        cov = _coverholders(db, {t.numero_poliza for t in trs if t.numero_poliza})
        byid = {t.id: t for t in trs}
        trs_ord = [byid[i] for i in ids if i in byid]   # conserva el orden de selección
        filas = _filas_recibo(trs_ord, cov, _desglose_recibos(db, trs_ord))
    if not filas:
        raise HTTPException(status_code=409, detail="Este apunte no tiene transferencias asociadas para el justificante.")
    pdf = _build_justificante_pdf(m, filas, clase)
    nombre = f"{m.identificador or m.id}. {m.concepto or 'Justificante'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nombre)}"},
    )
