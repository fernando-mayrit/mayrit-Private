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
import io
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import openpyxl
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


# ── Importación de Risk desde un Excel subido (sin SharePoint) ───────────────────────────────────
# Reaprovecha el MAPEO (columna interna → nombre de columna del bordereau) y la coacción de tipos.
_CLAVES_FILA = ("certificate_ref", "total_gwp_our_line", "gross_written_premium", "section_no")


def _resolver_columnas(headers: list[str]) -> dict[str, int]:
    """Para cada campo del MAPEO, el índice de la columna del Excel cuyo título casa (con alias)."""
    norm = {}
    for i, h in enumerate(headers):
        k = sharepoint._norm(h).lower()
        if k:
            norm.setdefault(k, i)
    out: dict[str, int] = {}
    for campo, alias in sharepoint.MAPEO.items():
        for nm in (alias if isinstance(alias, list) else [alias]):
            i = norm.get(sharepoint._norm(nm).lower())
            if i is not None:
                out[campo] = i
                break
    return out


def parse_risk_excel(content: bytes) -> tuple[list[dict], dict]:
    """Lee el Excel (primera hoja), detecta la cabecera y devuelve (filas, meta). Cada fila es un dict
    {campo_interno: valor_crudo} con las columnas reconocidas del MAPEO."""
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    # Cabecera = la fila con más celdas de texto entre las primeras 15.
    best_i, best_n = 0, -1
    for i in range(min(15, len(rows))):
        n = sum(1 for v in rows[i] if isinstance(v, str) and v.strip())
        if n > best_n:
            best_i, best_n = i, n
    headers = [str(v).strip() if v is not None else "" for v in (rows[best_i] if rows else [])]
    colmap = _resolver_columnas(headers)
    filas: list[dict] = []
    for r in rows[best_i + 1:]:
        if not any(v not in (None, "") for v in r):
            continue
        fila = {campo: (r[idx] if idx < len(r) else None) for campo, idx in colmap.items()}
        if not any(fila.get(k) not in (None, "") for k in _CLAVES_FILA):
            continue
        filas.append(fila)
    usados = set(colmap.values())
    meta = {
        "n_filas": len(filas),
        "cabecera_fila": best_i + 1,
        "mapeadas": {campo: headers[i] for campo, i in colmap.items()},
        "sin_mapear": [headers[i] for i in range(len(headers)) if headers[i] and i not in usados],
    }
    return filas, meta


def _coerce_fila(cols: dict, fila: dict) -> dict:
    return {campo: _coerce(campo, fila.get(campo), cols[campo])
            for campo in sharepoint.MAPEO if campo in cols and campo != "sp_old_id"}


def preview_risk_excel(db: Session, binder: Binder, content: bytes) -> dict:
    """Coacciona las filas y devuelve un resumen (sin escribir): nº líneas, periodos, totales y muestra."""
    filas, meta = parse_risk_excel(content)
    cols = {c.name: c.type for c in BdxLinea.__table__.columns}
    coerced = [_coerce_fila(cols, f) for f in filas]
    periodos = sorted({d["reporting_period_start"].strftime("%Y-%m") for d in coerced if d.get("reporting_period_start")})
    tot_our = sum((d.get("total_gwp_our_line") or Decimal(0)) for d in coerced)
    tot_100 = sum((d.get("gross_written_premium") or Decimal(0)) for d in coerced)
    muestra = [{
        "certificado": d.get("certificate_ref"), "asegurado": d.get("insured_name"),
        "section_no": d.get("section_no"), "risk_code": d.get("risk_code"),
        "reporting": d["reporting_period_start"].isoformat() if d.get("reporting_period_start") else None,
        "gwp_our_line": float(d["total_gwp_our_line"]) if d.get("total_gwp_our_line") is not None else None,
        "comision_pct": float((d.get("commission_coverholder_pct") or 0) + (d.get("brokerage_pct") or 0)),
    } for d in coerced[:8]]
    return {
        "n_lineas": meta["n_filas"], "periodos": periodos,
        "total_gwp_our_line": float(round(tot_our, 2)), "total_gwp_100": float(round(tot_100, 2)),
        "mapeadas": meta["mapeadas"], "sin_mapear": meta["sin_mapear"], "muestra": muestra,
    }


def importar_risk_excel(db: Session, binder: Binder, content: bytes) -> dict:
    """Inserta las líneas del Excel en el BDX Risk del binder. Dedup por clave natural (certificado +
    sección + reporting start + tipo de transacción + GWP our line): re-subir el mismo fichero no duplica."""
    filas, _ = parse_risk_excel(content)
    cols = {c.name: c.type for c in BdxLinea.__table__.columns}
    bdx = db.scalars(select(Bdx).where(Bdx.binder_id == binder.id, Bdx.tipo == "Risk")).first()
    if bdx is None:
        bdx = Bdx(binder_id=binder.id, tipo="Risk", estado="Abierto", notas="Importado de Excel")
        db.add(bdx)
        db.flush()

    # Fallback de sección por risk code declarado (cuando la línea llega sin sección).
    rc2sec: dict[str, int] = {}
    rc_amb: set[str] = set()
    for i, s in enumerate(binder.secciones, start=1):
        for rc in s.risk_codes:
            code = (rc.codigo or "").strip()
            if not code:
                continue
            if code in rc2sec and rc2sec[code] != i:
                rc_amb.add(code)
            rc2sec[code] = i

    # Clave natural para no duplicar al re-subir: certificado + sección + reporting + GWP our line
    # (el SIGNO del GWP ya separa Original de Devolución, sin depender del texto del tipo).
    def _nk(d: dict) -> tuple:
        return ((d.get("certificate_ref") or "").strip(), int(d.get("section_no") or 0),
                str(d.get("reporting_period_start") or ""), str(d.get("total_gwp_our_line") or ""))

    existentes = {_nk({
        "certificate_ref": l.certificate_ref, "section_no": l.section_no,
        "reporting_period_start": l.reporting_period_start, "total_gwp_our_line": l.total_gwp_our_line,
    }) for l in db.scalars(select(BdxLinea).where(BdxLinea.bdx_id == bdx.id)).all()}

    insertadas = duplicadas = auto_seccion = 0
    for fila in filas:
        datos = _coerce_fila(cols, fila)
        if datos.get("section_no") is None:
            code = (datos.get("risk_code") or "").strip()
            if code and code in rc2sec and code not in rc_amb:
                datos["section_no"] = rc2sec[code]
                auto_seccion += 1
        nk = _nk(datos)
        if nk in existentes:
            duplicadas += 1
            continue
        existentes.add(nk)
        linea = BdxLinea(bdx_id=bdx.id)
        for k, v in datos.items():
            setattr(linea, k, v)
        db.add(linea)
        insertadas += 1

    db.flush()
    starts = [l.reporting_period_start for l in bdx.lineas if l.reporting_period_start]
    ends = [l.reporting_period_end for l in bdx.lineas if l.reporting_period_end]
    bdx.reporting_period_start = min(starts) if starts else None
    bdx.reporting_period_end = max(ends) if ends else None
    db.commit()
    periodos = sorted({str(p) for p in (l.reporting_period_start for l in bdx.lineas) if p})
    return {"bdx_id": bdx.id, "insertadas": insertadas, "duplicadas": duplicadas,
            "auto_seccion": auto_seccion, "total_lineas": len(bdx.lineas), "periodos": periodos}
