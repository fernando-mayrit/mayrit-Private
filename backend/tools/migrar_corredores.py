"""
Migración de Corredores desde SharePoint `Mayrit - TCorredores` (lectura en vivo)
a la maestra de Productores, SOLO los que son corredor de alguna póliza y que
NO estén ya dados de alta (respeta los existentes, no duplica).

- En las pólizas el corredor se guarda como IdCorredor (alias corto).
- Empareja por alias (IdCorredor) y, en su defecto, por nombre (NombreCorredor).
- tipo: Coverholder=True → "Agencia de Suscripción"; False → "Corredor".
- DRY-RUN por defecto. Para aplicar: --apply.

Uso:  py -m tools.migrar_corredores [--apply]
"""
from __future__ import annotations

import argparse
import re

from sqlalchemy import select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Poliza, Productor

CAMPOS = ["nombre", "tipo", "cif", "domicilio", "codigo_postal", "localidad", "provincia", "pais", "notas"]


def _n(s) -> str:
    # Normaliza ignorando puntuación (la coma antes de "S.L." varía entre fuentes).
    return " ".join(re.sub(r"[.,]", " ", str(s or "").lower()).split())


def _persona(f: dict) -> str | None:
    # TipoCorredor en TCorredores: 1 → Persona jurídica, 2 → Persona física.
    try:
        return {1: "Persona jurídica", 2: "Persona física"}.get(int(f.get("tipo_corredor")))
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    # Corredores que aparecen en pólizas (lo único que queremos traer).
    corredores = {_n(p.corredor): (p.corredor or "").strip() for p in db.scalars(select(Poliza)).all() if (p.corredor or "").strip()}

    # Productores ya existentes, indexados por alias y por nombre (no duplicar).
    existentes = db.scalars(select(Productor)).all()
    por_clave: dict[str, Productor] = {}
    for pr in existentes:
        if pr.alias:
            por_clave[_n(pr.alias)] = pr
        if pr.nombre:
            por_clave.setdefault(_n(pr.nombre), pr)

    # TCorredores indexado por alias (IdCorredor) y por nombre.
    filas = sharepoint.leer_lista_corredores()
    por_alias, por_nombre = {}, {}
    for f in filas:
        if f.get("alias"):
            por_alias.setdefault(_n(f["alias"]), f)
        if f.get("nombre"):
            por_nombre.setdefault(_n(f["nombre"]), f)

    nuevos, no_en_tcorredores, backfill = [], [], []
    for k, orig in corredores.items():
        f = por_alias.get(k) or por_nombre.get(k)
        if k in por_clave:
            # Ya está en Productores → respetar; solo rellenar 'persona' si falta.
            pr = por_clave[k]
            if f is not None and not pr.persona and _persona(f):
                backfill.append((pr, f))
            continue
        if f is None:
            no_en_tcorredores.append(orig)
        else:
            nuevos.append((k, f))

    print(f"== Migración Corredores → Productores (DRY-RUN={'NO' if args.apply else 'SÍ'}) ==")
    print(f"Corredores en pólizas: {len(corredores)} · ya en Productores: {sum(1 for k in corredores if k in por_clave)}")
    print(f"Nuevos a crear (encontrados en TCorredores): {len(nuevos)}")
    for _, f in nuevos:
        tipo = "Agencia de Suscripción" if f.get("coverholder") else "Corredor"
        print(f"   + [{f.get('alias') or '—'}] {f.get('nombre')}  ({tipo})")
    print(f"Persona a rellenar en existentes: {len(backfill)}")
    print(f"Corredores SIN ficha en TCorredores (alta manual): {len(no_en_tcorredores)}")
    for o in no_en_tcorredores:
        print(f"   ! {o}")

    if not args.apply:
        db.close()
        print("\nDRY-RUN: no se ha escrito nada. Repite con --apply para migrar.")
        return

    creados = 0
    for _, f in nuevos:
        pr = Productor(nombre=str(f.get("nombre")).strip())
        pr.alias = str(f.get("alias")).strip() if f.get("alias") else None
        pr.tipo = "Agencia de Suscripción" if f.get("coverholder") else "Corredor"
        pr.persona = _persona(f)
        for c in CAMPOS:
            if c in ("nombre", "tipo"):
                continue
            v = f.get(c)
            setattr(pr, c, str(v).strip() if v not in (None, "") else None)
        if f.get("_sp_id") is not None:
            pr.sp_old_id = f["_sp_id"]
        db.add(pr)
        creados += 1
    for pr, f in backfill:
        pr.persona = _persona(f)
    db.commit()
    print(f"\nAPLICADO: {creados} productores creados, {len(backfill)} con 'persona' rellenada (existentes respetados).")
    db.close()


if __name__ == "__main__":
    main()
