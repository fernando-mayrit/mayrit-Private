"""
Importador de BDX desde SharePoint, controlado y binder a binder.

Lee la lista `Mayrit - <UMR>` del binder (vía app.sharepoint), coacciona los valores al tipo
de cada columna de `BdxLinea` y vuelca las líneas en el **BDX único** del binder (tipo Risk).
Idempotente por `sp_old_id` (el `_OldID` del origen): re-importar actualiza, no duplica.

Normalizaciones (decididas con datos reales):
  - Fechas SIN hora (ya las normaliza el lector a 'aaaa-mm-dd' → se parsean a date).
  - Importes con coma o punto decimal (y punto de miles europeo).
  - Porcentajes: en el origen vienen como fracción (0,8 = 80 %) → ×100.
"""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import Boolean, Date, Integer, Numeric, select
from sqlalchemy.orm import Session

from . import sharepoint
from .models.maestras import Bdx, Binder, BdxLinea

# Porcentajes que en el origen vienen como fracción (0,8) y guardamos como entero (80).
PCT_FIELDS = {
    "written_line_pct",
    "commission_coverholder_pct",
    "brokerage_pct",
    "pct_for_lloyds",
    "tax1_pct",
    "tax2_pct",
    "tax3_pct",
    "tax4_pct",
}


def _num(v) -> Decimal | None:
    """Importe → Decimal. Acepta int/float y texto con coma/punto (miles y decimal europeos)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return Decimal(str(v))
    s = str(v).strip()
    if "." in s and "," in s:        # europeo: '.' miles, ',' decimal
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:                    # solo coma → decimal
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _fecha(v) -> dt.date | None:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).replace(",", ".")))
    except (TypeError, ValueError):
        return None


def _coerce(field: str, value, coltype):
    """Coacciona el valor crudo de SharePoint al tipo de la columna del modelo."""
    if isinstance(coltype, Boolean):
        return bool(value)
    if value is None or value == "":
        return None
    if isinstance(coltype, Date):
        return _fecha(value)
    if isinstance(coltype, Integer):
        return _int(value)
    if isinstance(coltype, Numeric):
        n = _num(value)
        if n is None:
            return None
        if field in PCT_FIELDS:
            n = n * 100
        # Cuantizar a la escala de la columna (dinero=2, % =4) → quita el ruido de coma flotante.
        escala = coltype.scale if coltype.scale is not None else 2
        n = n.quantize(Decimal(1).scaleb(-escala), rounding=ROUND_HALF_UP)
        # Fuera de rango para la precisión de la columna → se anula (dato erróneo en origen, p. ej.
        # una fecha metida en una columna de %). Evita que un valor basura tumbe toda la importación.
        if coltype.precision is not None and abs(n) >= Decimal(10) ** (coltype.precision - escala):
            return None
        return n
    return str(value)  # String / Text


def importar(db: Session, binder: Binder) -> dict:
    """Importa (o re-importa) los BDX del binder desde su lista de SharePoint. Devuelve un
    resumen con la conciliación SharePoint ↔ Postgres."""
    list_title = f"Mayrit - {binder.umr}"
    filas = sharepoint.leer_lista_bdx(list_title)
    return importar_filas(db, binder, filas, origen=list_title)


def importar_filas(db: Session, binder: Binder, filas: list[dict], origen: str = "(excel)") -> dict:
    """Inserta/actualiza líneas Risk del binder desde `filas` (dicts con las claves del MAPEO).
    Origen-agnóstico: lo usan tanto la importación de SharePoint como la de Excel. Idempotente
    por `sp_old_id`. Devuelve la conciliación origen ↔ Postgres."""
    list_title = origen
    # BDX único por binder (tipo Risk): se reutiliza si ya existe.
    bdx = db.scalars(
        select(Bdx).where(Bdx.binder_id == binder.id, Bdx.tipo == "Risk")
    ).first()
    if bdx is None:
        bdx = Bdx(binder_id=binder.id, tipo="Risk", estado="Abierto", notas="Importado de SharePoint")
        db.add(bdx)
        db.flush()

    # Líneas existentes indexadas por sp_old_id (idempotencia).
    existentes = {
        l.sp_old_id: l
        for l in db.scalars(select(BdxLinea).where(BdxLinea.bdx_id == bdx.id)).all()
        if l.sp_old_id is not None
    }

    cols = {c.name: c.type for c in BdxLinea.__table__.columns}
    insertadas = actualizadas = sin_old_id = auto_seccion = 0

    # Fallback de sección: risk_code → nº de sección (1-based) SOLO cuando el código pertenece a una
    # única sección declarada del binder. Cubre líneas que llegan con "Section No" vacío en el origen.
    rc2sec: dict[str, int] = {}
    rc_ambiguos: set[str] = set()
    for i, s in enumerate(binder.secciones, start=1):
        for rc in s.risk_codes:
            code = (rc.codigo or "").strip()
            if not code:
                continue
            if code in rc2sec and rc2sec[code] != i:
                rc_ambiguos.add(code)
            rc2sec[code] = i

    for fila in filas:
        datos = {campo: _coerce(campo, fila.get(campo), cols[campo]) for campo in sharepoint.MAPEO}
        if datos.get("section_no") is None:
            code = (datos.get("risk_code") or "").strip()
            if code and code in rc2sec and code not in rc_ambiguos:
                datos["section_no"] = rc2sec[code]
                auto_seccion += 1
        oldid = datos.get("sp_old_id")
        if oldid is None:
            sin_old_id += 1
        linea = existentes.get(oldid) if oldid is not None else None
        if linea is None:
            linea = BdxLinea(bdx_id=bdx.id)
            db.add(linea)
            insertadas += 1
            if oldid is not None:
                existentes[oldid] = linea
        else:
            actualizadas += 1
        for k, v in datos.items():
            setattr(linea, k, v)

    db.flush()

    # Cabecera: rango global de periodos (informativo; el periodo real va por línea).
    starts = [l.reporting_period_start for l in bdx.lineas if l.reporting_period_start]
    ends = [l.reporting_period_end for l in bdx.lineas if l.reporting_period_end]
    bdx.reporting_period_start = min(starts) if starts else None
    bdx.reporting_period_end = max(ends) if ends else None

    db.commit()

    # ── Conciliación SharePoint ↔ Postgres ──
    # GWP de origen redondeado a céntimos por línea (igual que se guarda) para comparar de verdad.
    def _cent(v) -> Decimal:
        d = _num(v)
        return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if d is not None else Decimal(0)

    sp_total = len(filas)
    sp_gwp = sum(_cent(f.get("gross_written_premium")) for f in filas)
    db_lineas = db.scalars(select(BdxLinea).where(BdxLinea.bdx_id == bdx.id)).all()
    db_total = len(db_lineas)
    db_gwp = sum((l.gross_written_premium or Decimal(0)) for l in db_lineas)
    periodos = sorted({str(l.reporting_period_start) for l in db_lineas if l.reporting_period_start})

    return {
        "bdx_id": bdx.id,
        "list_title": list_title,
        "insertadas": insertadas,
        "actualizadas": actualizadas,
        "sin_old_id": sin_old_id,
        "auto_seccion": auto_seccion,
        "periodos": periodos,
        "conciliacion": {
            "lineas_sharepoint": sp_total,
            "lineas_postgres": db_total,
            "lineas_ok": sp_total == db_total,
            "gwp_sharepoint": float(round(sp_gwp, 2)),
            "gwp_postgres": float(round(db_gwp, 2)),
            "gwp_ok": abs(sp_gwp - db_gwp) < Decimal("0.01"),
        },
    }
