"""
Migración de Tomadores desde SharePoint `Mayrit - TClientes` (lectura en vivo),
SOLO los que son asegurado de alguna póliza (no toda la tabla).

- Empareja por NombreCliente == Poliza.asegurado (normalizado).
- Idempotente: casa por nombre (normalizado) con los tomadores ya existentes.
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_tomadores [--apply]
"""
from __future__ import annotations

import argparse
import re

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Poliza, Tomador

CAMPOS = ["nombre", "tipo", "cif", "domicilio", "codigo_postal", "localidad", "provincia", "pais"]


def _n(s) -> str:
    # Normaliza ignorando puntuación (la coma antes de "S.L." varía entre pólizas y TClientes).
    return " ".join(re.sub(r"[.,]", " ", str(s or "").lower()).split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    # Asegurados que aparecen en pólizas (lo único que queremos traer).
    asegurados = {_n(p.asegurado): (p.asegurado or "").strip() for p in db.scalars(select(Poliza)).all() if (p.asegurado or "").strip()}
    existentes = {_n(t.nombre): t for t in db.scalars(select(Tomador)).all()}

    filas = sharepoint.leer_lista_tomadores()
    por_nombre = {}
    for f in filas:
        nb = _n(f.get("nombre"))
        if nb:
            por_nombre.setdefault(nb, f)  # primera ocurrencia

    nuevos, actualizados, no_en_tclientes = [], [], []
    for k, orig in asegurados.items():
        if k in existentes:
            f = por_nombre.get(k)
            if f:
                actualizados.append((k, f))  # refrescar datos del existente
            continue
        f = por_nombre.get(k)
        if f is None:
            no_en_tclientes.append(orig)  # asegurado sin ficha en TClientes (alta manual)
        else:
            nuevos.append((k, f))

    print(f"== Migración Tomadores con póliza (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Asegurados de pólizas: {len(asegurados)} · ya en maestra: {sum(1 for k in asegurados if k in existentes)}")
    print(f"Nuevos a crear (encontrados en TClientes): {len(nuevos)}")
    for _, f in nuevos[:50]:
        print(f"   + {f.get('nombre')}  [{f.get('cif') or '—'}]")
    print(f"Asegurados SIN ficha en TClientes (alta manual): {len(no_en_tclientes)}")
    for o in no_en_tclientes:
        print(f"   ! {o}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para migrar.")
        return

    def aplicar(t: Tomador, f: dict):
        for c in CAMPOS:
            v = f.get(c)
            v = str(v).strip() if v not in (None, "") else None
            if c == "nombre" and not v:
                continue
            setattr(t, c, v)
        if f.get("_sp_id") is not None:
            t.sp_old_id = f["_sp_id"]

    creados = 0
    for _, f in nuevos:
        t = Tomador(nombre=str(f.get("nombre")).strip())
        aplicar(t, f)
        db.add(t)
        creados += 1
    for _, f in actualizados:
        aplicar(existentes[_n(f.get("nombre"))], f)
    db.flush()

    # Criterio único: igualar el asegurado de cada póliza al nombre canónico del tomador.
    canon = {_n(t.nombre): t.nombre for t in db.scalars(select(Tomador)).all()}
    alineadas = 0
    for p in db.scalars(select(Poliza)).all():
        c = canon.get(_n(p.asegurado))
        if c and p.asegurado != c:
            p.asegurado = c
            alineadas += 1
    db.commit()
    print(f"\nAPLICADO: {creados} tomadores creados, {len(actualizados)} actualizados, "
          f"{alineadas} pólizas alineadas al nombre canónico.")
    db.close()


if __name__ == "__main__":
    main()
