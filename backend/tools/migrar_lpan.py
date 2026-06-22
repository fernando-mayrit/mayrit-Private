"""
Migra el listado maestro `Mayrit - TLPAN` de SharePoint a las tablas `fdos` y `lpans`.

- Cada fila se enlaza por UMR a su BINDER (binder.umr) o, si no, a su PÓLIZA OM
  (poliza.numero_poliza). Variantes con/sin prefijo 'B1634'.
- Filas Tipo='FDO' -> tabla `fdos`. Tipo AP/PM/RP -> tabla `lpans` (colgando del FDO de su
  binder/póliza + sección + risk code, si existe).
- Idempotente: borra primero lo ya migrado (sp_old_id no nulo) y reinserta.
- Reconciliación final: lista los periodos de Premium (cobrados) de cada binder sin LPAN.

DRY-RUN por defecto. Uso:  py -m tools.migrar_lpan [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import delete, select

from app import sharepoint as sp
from app.db import SessionLocal
from app.models.maestras import Binder, Fdo, Lpan, Poliza
from app.routers.lpan import _grupos_premium

LIST_TITLE = "Mayrit - TLPAN"


def _n(s) -> str:
    return (str(s).strip() if s is not None else "")


def _fecha(v) -> dt.date | None:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _dec(v) -> Decimal | None:
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v).replace(",", ".")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return None


def _int(v) -> int:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return 0


def _periodo(v) -> str:
    f = _fecha(v)
    return f"{f.year:04d}-{f.month:02d}" if f else ""


def _leer_tlpan() -> list[dict]:
    ctx = sp.get_context()
    lst = ctx.web.lists.get_by_title(LIST_TITLE)
    items = lst.items.top(5000).get().execute_query()
    return [dict(it.properties) for it in items]


def _mapas(db):
    binder_por: dict[str, int] = {}
    for b in db.scalars(select(Binder)).all():
        u = _n(b.umr)
        if u:
            binder_por[u] = b.id
            binder_por[u.replace("B1634", "")] = b.id
    poliza_por: dict[str, int] = {}
    for p in db.scalars(select(Poliza)).all():
        u = _n(p.numero_poliza)
        if u:
            poliza_por[u] = p.id
            poliza_por[u.replace("B1634", "")] = p.id
    return binder_por, poliza_por


def _destino(umr: str, binder_por, poliza_por):
    """Devuelve (binder_id, poliza_id) según el UMR; (None, None) si no casa."""
    for c in (umr, umr.replace("B1634", ""), "B1634" + umr):
        if c in binder_por:
            return binder_por[c], None
    for c in (umr, umr.replace("B1634", ""), "B1634" + umr):
        if c in poliza_por:
            return None, poliza_por[c]
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    binder_por, poliza_por = _mapas(db)
    print(f"Leyendo {LIST_TITLE}…")
    rows = _leer_tlpan()
    print(f"  {len(rows)} filas")

    # Clasificación y reparto.
    clasif = Counter()
    fdos_rows, lpan_rows, externas = [], [], []
    for r in rows:
        umr = _n(r.get("UMR"))
        bid, pid = _destino(umr, binder_por, poliza_por)
        if bid is None and pid is None:
            externas.append(umr)
            clasif["externa"] += 1
            continue
        clasif["binder" if bid else "poliza"] += 1
        tipo = _n(r.get("Tipo")) or "PM"
        item = {"r": r, "bid": bid, "pid": pid, "tipo": tipo}
        (fdos_rows if tipo == "FDO" else lpan_rows).append(item)

    print(f"  clasificación: {dict(clasif)}")
    print(f"  FDO: {len(fdos_rows)} | LPAN (AP/PM/RP): {len(lpan_rows)}")
    if externas:
        print(f"  ⚠ externas sin binder/póliza ({len(externas)}): {sorted(set(externas))[:20]}")

    # Dedupe FDO por (binder, sección, risk code) para respetar la unicidad (gana el más reciente).
    fdo_clave: dict[tuple, dict] = {}
    dups = 0
    for it in fdos_rows:
        if it["bid"] is None:  # FDO de póliza: sin restricción de unicidad, se admite tal cual
            fdo_clave[("p", it["r"].get("_sp_id"))] = it
            continue
        k = (it["bid"], _int(it["r"].get("Section")), _n(it["r"].get("RiskCode")))
        prev = fdo_clave.get(k)
        if prev is None or _n(it["r"].get("Procesado")) > _n(prev["r"].get("Procesado")):
            if prev is not None:
                dups += 1
            fdo_clave[k] = it
        else:
            dups += 1
    if dups:
        print(f"  (FDO duplicados por combinación, se queda el más reciente: {dups})")

    if not args.apply:
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply.")
        _reconciliar(db, solo_resumen=True)
        db.close()
        return

    # Idempotencia: borrar lo migrado antes (sp_old_id no nulo).
    db.execute(delete(Lpan).where(Lpan.sp_old_id.is_not(None)))
    db.execute(delete(Fdo).where(Fdo.sp_old_id.is_not(None)))
    db.flush()

    # Insertar FDOs y construir índice (binder/poliza, sección, risk code) -> fdo.id
    fdo_id_por: dict[tuple, int] = {}
    for it in fdo_clave.values():
        r = it["r"]
        f = Fdo(
            sp_old_id=r.get("_sp_id"), binder_id=it["bid"], poliza_id=it["pid"],
            section=_int(r.get("Section")), risk_code=_n(r.get("RiskCode")),
            broker_ref1=_n(r.get("BrokerRef1")) or None, broker_ref2=_n(r.get("BrokerRef2")) or None,
            signing_number=_n(r.get("BureauOriginalRef")) or None, work_package=_n(r.get("WorkPackage")) or None,
            fecha_proceso=_fecha(r.get("Procesado")), work_package_status=_n(r.get("Status")) or None,
            fecha_generado=_fecha(r.get("Procesado")),
        )
        db.add(f)
        db.flush()
        fdo_id_por[(it["bid"], it["pid"], f.section, f.risk_code)] = f.id

    # Insertar LPANs (enlazando al FDO de su combinación si existe).
    n_lpan = 0
    for it in lpan_rows:
        r = it["r"]
        sec = _int(r.get("Section"))
        rc = _n(r.get("RiskCode"))
        fdo_id = fdo_id_por.get((it["bid"], it["pid"], sec, rc))
        db.add(Lpan(
            sp_old_id=r.get("_sp_id"), fdo_id=fdo_id, binder_id=it["bid"], poliza_id=it["pid"],
            risk_code=rc, section=sec, periodo=_periodo(r.get("PremiumBdx")), tipo=it["tipo"],
            gross_premium=_dec(r.get("Premium")), brokerage=_dec(r.get("Brokerage")),
            tax=_dec(r.get("Taxes")), net_premium=_dec(r.get("BureauPremium")),
            signing_number=_n(r.get("BureauOriginalRef")) or None, work_package=_n(r.get("WorkPackage")) or None,
            broker_ref1=_n(r.get("BrokerRef1")) or None, broker_ref2=_n(r.get("BrokerRef2")) or None,
            sdd=_fecha(r.get("SDD")), liberado=_fecha(r.get("Liberado")), pagado=_fecha(r.get("Pagado")),
            fecha=_fecha(r.get("Procesado")), estado=_n(r.get("Status")) or "Completed",
        ))
        n_lpan += 1
    db.commit()
    print(f"\nAPLICADO: {len(fdo_clave)} FDO + {n_lpan} LPAN. FDO sin enlazar a LPAN: n/a.")
    _reconciliar(db)
    db.close()


def _reconciliar(db, solo_resumen=False):
    """Lista, por binder con LPAN o premium, los periodos de Premium cobrados sin LPAN."""
    print("\n== Conciliación: Premium (cobrado) sin LPAN ==")
    lpan_keys: set[tuple] = set()
    for lp in db.scalars(select(Lpan).where(Lpan.binder_id.is_not(None))).all():
        lpan_keys.add((lp.binder_id, lp.periodo, lp.section, lp.risk_code))
    binders = {b.id: b for b in db.scalars(select(Binder)).all()}
    total_sin = 0
    detalle = []
    for bid, b in binders.items():
        grupos = _grupos_premium(db, bid)
        for (per, sec, rc), g in grupos.items():
            if g["num"] > 0 and g["cobr"] == g["num"] and (bid, per, sec, rc) not in lpan_keys:
                total_sin += 1
                detalle.append(f"  {b.umr}  {per}  S{sec}  {rc}")
    print(f"  periodos de Premium cobrados SIN LPAN: {total_sin}")
    for d in detalle[:40]:
        print(d)
    if len(detalle) > 40:
        print(f"  … y {len(detalle) - 40} más")


if __name__ == "__main__":
    main()
