"""
Módulo de Contabilidad — libro de banco categorizado (espejo de las listas SharePoint
`Contabilidad - <cuenta>`). Cada movimiento: fecha, cuenta, concepto/grupo/tipo (clasificación),
gasto/ingreso, saldo. La conciliación con el ledger de Transferencias es la Fase 2.
"""
from __future__ import annotations

import datetime as dt
import io
from decimal import Decimal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.maestras import Binder, ContaCategoria, CuentaBancaria, MovimientoBancario, Recibo

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
    recibos_ids: list[int] | None = None

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
    out.conciliado = m.transferencia_id is not None
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
    recibos_ids: list[int] | None = None


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
    identificador = f"{iden}.{dev.month:02d}"

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
        recibos_ids=payload.recibos_ids,
        sp_lista=None, sp_old_id=None,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _read(m)


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
    recibos_ids: list[int] | None = None   # recibos que componen el apunte (para el justificante)


@router.put("/{mid}", response_model=MovimientoRead)
def actualizar(mid: int, payload: MovimientoUpdate, db: Session = Depends(get_db)):
    """Edición de un movimiento. Solo aplica los campos enviados (toggle del justificante, o edición
    completa desde el modal)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    datos = payload.model_dump(exclude_unset=True)
    for k in ("grupo", "concepto", "saldo", "descripcion", "factura", "tarjeta", "movimiento_bancario", "recibos_ids"):
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


# ─────────────────── Justificante de movimiento (recibos que lo componen) ───────────────────
def _num_es(x) -> str:
    """123456.7 -> '123.456,70' (formato es-ES)."""
    s = f"{Decimal(x or 0):,.2f}"
    return s.replace(",", "·").replace(".", ",").replace("·", ".")


# Según el tipo de apunte, qué importe y qué fecha del recibo se usan en el justificante.
_CAMPOS = {
    "cobro": ("prima_cobrada", "prima_fecha_cobro"),
    "liquidacion": ("liquidar_liquidado", "liquidar_fecha_liquidacion"),
    "traspaso": ("comision_retenida_traspasada", "comision_fecha_traspaso"),
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
    id: int
    numero: str | None
    importe: Decimal
    fecha: dt.date | None
    referencia: str | None
    cliente: str | None


def _recibo_row(r: Recibo, umr: str | None, clase: str) -> ReciboJustif:
    campo_imp, campo_fecha = _CAMPOS[clase]
    return ReciboJustif(
        id=r.id, numero=r.numero,
        importe=Decimal(getattr(r, campo_imp) or 0),
        fecha=getattr(r, campo_fecha),
        referencia=umr or r.numero_poliza,
        cliente=r.asegurado,
    )


def _recibos_ya_justificados(db: Session, excluir_mid: int | None) -> set[int]:
    """Recibos ya asignados al justificante de ALGÚN movimiento (para no ofrecerlos otra vez).
    Excluye el movimiento `excluir_mid` (el que se está editando)."""
    usados: set[int] = set()
    for (lst, mid_) in db.execute(
        select(MovimientoBancario.recibos_ids, MovimientoBancario.id).where(MovimientoBancario.recibos_ids.is_not(None))
    ).all():
        if excluir_mid is not None and mid_ == excluir_mid:
            continue
        usados.update(lst or [])
    return usados


@router.get("/recibos-justificante", response_model=list[ReciboJustif])
def recibos_justificante(
    clase: str = "cobro", q: str | None = None, fecha: dt.date | None = None,
    excluir_mid: int | None = None, limit: int = 800, db: Session = Depends(get_db),
):
    """Recibos candidatos para componer un apunte, con su importe (según la clase: cobro/liquidacion/
    traspaso), fecha de la gestión, UMR/nº póliza y cliente. Filtra por la FECHA de pago/cobro (la del
    movimiento) y OCULTA los recibos ya justificados en otro apunte (así la lista cuadra fácil)."""
    clase = clase if clase in _CAMPOS else "cobro"
    campo_imp, campo_fecha = _CAMPOS[clase]
    col_imp = getattr(Recibo, campo_imp)
    col_fecha = getattr(Recibo, campo_fecha)
    stmt = (
        select(Recibo, Binder.umr)
        .join(Binder, Binder.id == Recibo.binder_id, isouter=True)
        .where(col_imp.is_not(None), col_imp != 0)
    )
    if fecha:
        stmt = stmt.where(col_fecha == fecha)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Recibo.numero.ilike(like), Recibo.asegurado.ilike(like),
            Binder.umr.ilike(like), Recibo.numero_poliza.ilike(like),
        ))
    usados = _recibos_ya_justificados(db, excluir_mid)
    if usados:
        stmt = stmt.where(Recibo.id.not_in(usados))
    stmt = stmt.order_by(col_fecha.desc().nullslast(), Recibo.numero).limit(limit)
    return [_recibo_row(r, umr, clase) for (r, umr) in db.execute(stmt).all()]


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
    cab = ["Recibo", "Fecha", imp_label, "Referencia", "Cliente"]
    data = [cab]
    total = Decimal(0)
    cli = styles["Normal"].clone("cli"); cli.fontSize = 8
    for f in filas:
        total += f.importe
        data.append([
            f.numero or "", f.fecha.strftime("%d/%m/%Y") if f.fecha else "",
            _num_es(f.importe), f.referencia or "", Paragraph(f.cliente or "", cli),
        ])
    data.append(["", "Total", _num_es(total), "", ""])

    t = Table(data, colWidths=[24 * mm, 22 * mm, 28 * mm, 34 * mm, 70 * mm], repeatRows=1)
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
    """Genera el PDF del justificante del apunte con los recibos que lo componen (recibos_ids)."""
    m = db.get(MovimientoBancario, mid)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Movimiento {mid} no encontrado")
    ids = m.recibos_ids or []
    clase = _clase_de_concepto(m.concepto)
    filas: list[ReciboJustif] = []
    if ids:
        res = db.execute(
            select(Recibo, Binder.umr).join(Binder, Binder.id == Recibo.binder_id, isouter=True)
            .where(Recibo.id.in_(ids))
        ).all()
        byid = {r.id: (r, umr) for (r, umr) in res}
        for i in ids:                       # conserva el orden de selección
            if i in byid:
                r, umr = byid[i]
                filas.append(_recibo_row(r, umr, clase))
    if not filas:
        raise HTTPException(status_code=409, detail="Este apunte no tiene recibos asociados para el justificante.")
    pdf = _build_justificante_pdf(m, filas, clase)
    nombre = f"{m.identificador or m.id}. {m.concepto or 'Justificante'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nombre)}"},
    )
