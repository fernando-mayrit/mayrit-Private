"""
Volcado del ledger de movimientos de dinero desde SharePoint 'Mayrit - TLiquidaciones' (lectura en
vivo) a la tabla `transferencias`. Cada fila = un movimiento (Origen · Tipo · Subtipo; importe en
Cobro/Traspaso/Liquidacion según el subtipo).

- Idempotente por CONTENIDO (origen·tipo·subtipo·fecha·importe·periodo·póliza·recibo), NO por el Id de
  SharePoint: el histórico se cargó desde una copia antigua ('TLiquidaciones1') cuyos Id no coinciden
  con los de esta lista, así que deduplicar por Id volvería a meter todo. Por contenido solo entra lo
  que falta.
- Esta lista NO tiene Mercado/CuentaOrigen/CuentaDestino (las tenía la copia 'TLiquidaciones1'): esos
  campos quedan a None en los movimientos nuevos.
- Enlaza `recibo_id` por nº de recibo y `binder_id` por UMR/agreement (= NumeroPoliza) cuando Origen=Binder.
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_transferencias [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Binder, Recibo, Transferencia

LISTA = "Mayrit - TLiquidaciones"

MAPEO = {
    "origen": "Origen",
    "tipo": "Tipo",
    "subtipo": "Subtipo",
    "fecha": "Fecha",
    "numero_poliza": "NumeroPoliza",
    "periodo": "Periodo",
    "traspaso": "Traspaso",
    "liquidacion": "Liquidacion",
    "cobro": "Cobro",
    "recibo": "Recibo",
    "mercado": "Mercado",
    "notas": "Notas",
    "cuenta_origen": "CuentaOrigen",
    "cuenta_destino": "CuentaDestino",
}
DATE_FIELDS = {"fecha", "periodo"}

# El subtipo marca el sentido. Se normaliza la variante sin tilde 'Liquidacion'.
SENTIDO = {"Cobro": "entrada", "Liquidación": "salida", "Liquidacion": "salida", "Traspaso": "interno"}
COL_DE_SUBTIPO = {"Cobro": "cobro", "Liquidación": "liquidacion", "Liquidacion": "liquidacion", "Traspaso": "traspaso"}


def _fecha(v):
    if not v:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _dec(v):
    if v in (None, ""):
        return Decimal(0)
    try:
        return Decimal(str(v).replace(",", ".")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return Decimal(0)


def _importe(f, subtipo: str) -> Decimal:
    """Importe del movimiento: el cajón que corresponde al subtipo; si va a 0, el primero no nulo."""
    col = COL_DE_SUBTIPO.get((subtipo or "").strip())
    if col:
        v = _dec(f.get(col))
        if v != 0:
            return v
    for c in ("cobro", "traspaso", "liquidacion"):
        v = _dec(f.get(c))
        if v != 0:
            return v
    return Decimal(0)


def _clave(origen, tipo, subtipo, fecha, importe, periodo, numpol, recibo):
    """Clave de CONTENIDO para deduplicar contra lo ya cargado. No se usa el Id de SharePoint porque
    el histórico se volcó desde otra lista (Id distintos)."""
    return (origen or "—", tipo or "—", subtipo or "—", fecha, Decimal(importe or 0),
            periodo, numpol or None, recibo or None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    filas = sharepoint.leer_lista(LISTA, MAPEO, DATE_FIELDS)
    db = SessionLocal()

    # Índices para enlazar.
    by_umr: dict[str, int] = {}
    for b in db.scalars(select(Binder)).all():
        for k in (b.umr, b.agreement_number):
            if k:
                by_umr[k.strip()] = b.id
    recibo_id_de = {r.numero.strip(): r.id for r in db.scalars(select(Recibo)).all() if r.numero}
    # Dedup por CONTENIDO: lo que ya hay en la BD (venga de donde venga), contado por multiplicidad.
    existentes: Counter = Counter()
    for t in db.scalars(select(Transferencia)).all():
        existentes[_clave(t.origen, t.tipo, t.subtipo, t.fecha, t.importe, t.periodo,
                          t.numero_poliza, t.recibo_num)] += 1

    nuevas, ya = [], 0
    cont_origen, cont_tipo, cont_sub = Counter(), Counter(), Counter()
    enlazados_recibo = enlazados_binder = 0
    for f in filas:
        subtipo = (f.get("subtipo") or "").strip()
        # Normaliza la variante sin tilde.
        if subtipo == "Liquidacion":
            subtipo = "Liquidación"
        origen = (f.get("origen") or "").strip() or "—"
        tipo = (f.get("tipo") or "").strip() or "—"
        fecha = _fecha(f.get("fecha"))
        periodo = _fecha(f.get("periodo"))
        importe = _importe(f, subtipo)
        numero_poliza = (str(f.get("numero_poliza")).strip() if f.get("numero_poliza") else None)
        recibo_num = (str(f.get("recibo")).strip() if f.get("recibo") else None)
        k = _clave(origen, tipo, subtipo or "—", fecha, importe, periodo, numero_poliza, recibo_num)
        if existentes.get(k, 0) > 0:   # ya está en la BD: consúmelo y salta
            existentes[k] -= 1
            ya += 1
            continue
        rid = recibo_id_de.get(recibo_num) if recibo_num else None
        bid = by_umr.get(numero_poliza) if (origen == "Binder" and numero_poliza) else None
        if rid:
            enlazados_recibo += 1
        if bid:
            enlazados_binder += 1
        cont_origen[origen] += 1
        cont_tipo[tipo] += 1
        cont_sub[subtipo or "—"] += 1
        nuevas.append(Transferencia(
            sp_old_id=f.get("_sp_id"),
            origen=origen, tipo=tipo, subtipo=subtipo or "—",
            sentido=SENTIDO.get(subtipo, "interno"),
            fecha=fecha, anio=fecha.year if fecha else None,
            periodo=periodo,
            importe=importe,
            numero_poliza=numero_poliza, recibo_num=recibo_num, recibo_id=rid, binder_id=bid,
            mercado=(str(f.get("mercado")).strip() if f.get("mercado") else None),
            cuenta_origen=(str(f.get("cuenta_origen")).strip() if f.get("cuenta_origen") else None),
            cuenta_destino=(str(f.get("cuenta_destino")).strip() if f.get("cuenta_destino") else None),
            notas=(str(f.get("notas")).strip() if f.get("notas") else None),
            manual=False,
        ))

    print(f"== Migración {LISTA} -> transferencias (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Filas en SharePoint: {len(filas)} · ya en BD: {ya} · nuevas: {len(nuevas)}")
    print(f"Enlace recibo: {enlazados_recibo} · enlace binder: {enlazados_binder}")
    print(f"Por origen:  {dict(cont_origen)}")
    print(f"Por tipo:    {dict(cont_tipo)}")
    print(f"Por subtipo: {dict(cont_sub)}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para volcar.")
        return

    db.add_all(nuevas)
    db.commit()
    print(f"\nAPLICADO: {len(nuevas)} transferencias volcadas.")
    db.close()


if __name__ == "__main__":
    main()
