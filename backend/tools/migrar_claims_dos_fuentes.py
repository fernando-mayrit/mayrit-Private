"""
Importa los snapshots mensuales de Claims de un binder cuya información viene de DOS fuentes que
hay que FUSIONAR por mes (modelo Crouco-Beazley: GES40 + AULES; reutilizable en todo ese programa).

  - GES40: carpeta-por-mes con el bordereau combinado del mes (fichero 'YOA…bdx…'); formato
    Heca/AXIS. Se usa tal cual (los PDF se ignoran).
  - AULES: carpeta-por-mes; en cada mes hay un fichero común 'YOA…' que se IGNORA y varios ficheros
    por risk code (E7/E9/D3/CY…) que se AGRUPAN.

El snapshot de cada mes = claims de GES40 + claims de AULES, unidos por referencia (fusionar()).
Reutiliza leer_carpeta/fusionar/volcar de migrar_claims_heca (mismo parser, casado y volcado).

DRY-RUN por defecto. Uso:
  py -m tools.migrar_claims_dos_fuentes --ges40 "RUTA\\Ges 40" --aules "RUTA\\Aules" \\
     --binder-id 52 [--crear-siniestros] [--apply]
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.maestras import Binder
from tools.migrar_claims_heca import leer_carpeta, fusionar, volcar, _tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ges40", help="Carpeta GES40 (subcarpetas por mes; bordereau combinado 'YOA…bdx…').")
    ap.add_argument("--aules", help="Carpeta AULES (subcarpetas por mes; ficheros por risk code E7/E9/D3/CY…).")
    ap.add_argument("--binder-id", type=int)
    ap.add_argument("--agreement")
    ap.add_argument("--crear-siniestros", action="store_true",
                    help="Da de alta los siniestros que aparezcan en los snapshots y no existan.")
    ap.add_argument("--anio-defecto", type=int, default=None,
                    help="Año para carpetas cuyo nombre es solo el mes (respaldo si no hay periodo en celda).")
    ap.add_argument("--alias-ref", default="", help="Mapea referencias renumeradas: 'refOrigen=refSiniestro,...'.")
    ap.add_argument("--periodo-override", default="",
                    help="Corrige el periodo de una carpeta: 'NombreCarpeta=AAAA-MM' (se aplica a ambas fuentes).")
    ap.add_argument("--periodo-de-carpeta", action="store_true",
                    help="Toma el periodo del NOMBRE de la carpeta e ignora la celda 'Reporting Period' "
                         "(úsalo cuando esa celda viene mal en origen, como en los BDX antiguos de Crouco).")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if not args.ges40 and not args.aules:
        print("Indica al menos --ges40 o --aules.")
        return

    db = SessionLocal()
    b = db.get(Binder, args.binder_id) if args.binder_id else \
        db.scalar(select(Binder).where(Binder.agreement_number == args.agreement))
    if b is None:
        print("Binder no encontrado.")
        return
    agr_tok = _tok(b.agreement_number)

    overrides = {}
    for par in args.periodo_override.split(","):
        if "=" in par:
            k, v = par.split("=", 1)
            overrides[k.strip()] = v.strip()

    todo = []
    if args.ges40:
        print("Leyendo GES40…")
        todo += leer_carpeta(args.ges40, agr_tok, args.anio_defecto, overrides, "ges40", args.periodo_de_carpeta)
    if args.aules:
        print("Leyendo AULES…")
        todo += leer_carpeta(args.aules, agr_tok, args.anio_defecto, overrides, "aules", args.periodo_de_carpeta)

    meses = fusionar(todo)   # une GES40 + AULES por periodo (claims por referencia)
    volcar(db, b, meses, args.alias_ref, args.crear_siniestros, args.apply,
           "Claims dos fuentes (GES40 + AULES)")
    db.close()


if __name__ == "__main__":
    main()
