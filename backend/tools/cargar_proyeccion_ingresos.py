"""Sincroniza la PROYECCIÓN DE INGRESOS del presupuesto (celda D42 del Ppto 2026.xlsx) en la tabla
`parametros`. La página de KPIs lee ese valor de la BD.

Ejecutar EN LOCAL cada vez que se actualice el Excel (producción no puede leer el fichero de
OneDrive; el backend local escribe en la BD de producción, así que al ejecutarlo se actualiza
también el móvil/producción). También está el botón "Sincronizar" en la página de KPIs.

    ~/.mayrit/venv/Scripts/python.exe -m tools.cargar_proyeccion_ingresos
    (opcional) pasar otra ruta del fichero como primer argumento.
"""
import sys

from app.db import SessionLocal
from app.ppto_sync import CLAVE, RUTA, sincronizar


def main(ruta: str = RUTA) -> None:
    db = SessionLocal()
    try:
        valor = sincronizar(db, ruta)
        print(f"OK  {CLAVE} = {valor:,.2f}")
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else RUTA)
