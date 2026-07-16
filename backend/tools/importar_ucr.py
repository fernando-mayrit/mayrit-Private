"""Trae la tabla de UCR desde SharePoint (`Mayrit - TUCR`) a la tabla `ucrs` de Mayrit.

Idempotente por `sp_old_id` (el _OldID de Access/SharePoint): re-ejecutar actualiza, no duplica.
Uso: python -m tools.importar_ucr
"""
from sqlalchemy import func, select

from app import sharepoint
from app.db import SessionLocal
from app.models.maestras import Ucr

CAMPOS = ["titulo", "coverholder", "umr", "section", "risk_code", "signing", "ucr", "notas", "estado", "tpa"]


def _txt(v):
    return str(v).strip() if v not in (None, "") else None


def main() -> None:
    filas = sharepoint.leer_lista_ucr()
    db = SessionLocal()
    existentes = {u.sp_old_id: u for u in db.scalars(select(Ucr)).all() if u.sp_old_id is not None}
    ins = upd = 0
    for f in filas:
        oldid = f.get("sp_old_id")
        try:
            oldid = int(oldid) if oldid is not None else None
        except (ValueError, TypeError):
            oldid = None
        u = existentes.get(oldid) if oldid is not None else None
        if u is None:
            u = Ucr(sp_old_id=oldid)
            db.add(u)
            ins += 1
            if oldid is not None:
                existentes[oldid] = u
        else:
            upd += 1
        for c in CAMPOS:
            setattr(u, c, _txt(f.get(c)))
    db.commit()
    total = db.scalar(select(func.count()).select_from(Ucr))
    print(f"UCR: {len(filas)} leidos de SharePoint · {ins} nuevos · {upd} actualizados · total en BD: {total}")
    db.close()


if __name__ == "__main__":
    main()
