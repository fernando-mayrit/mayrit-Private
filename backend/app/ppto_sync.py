"""Sincronización de la PROYECCIÓN DE INGRESOS del presupuesto desde el Excel a la tabla `parametros`.

Producción (Azure) no puede leer el fichero de OneDrive; esto solo funciona ejecutándose EN LOCAL,
donde el fichero es accesible. Lo usan tanto la herramienta CLI (tools/cargar_proyeccion_ingresos.py)
como el endpoint POST /kpis/proyeccion/sync (botón de la página de KPIs).
"""
import os
import shutil
import tempfile

import openpyxl
from sqlalchemy.orm import Session

from .models.maestras import Parametro

RUTA = r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Sociedad - Documentos\Societario\Cuentas\Ppto 2026.xlsx"
HOJA = "Ppto Ingresos Mensual 2026"
CELDA = "D42"
CLAVE = "proyeccion_ingresos_2026"
DESCRIPCION = "Proyección de ingresos 2026 (Ppto 2026.xlsx · Ppto Ingresos Mensual 2026 · D42)"


_FILA, _COL = 42, 4   # D42


def leer_valor(ruta: str = RUTA) -> float:
    """Lee la celda D42. Copia el fichero a un temporal antes (suele estar abierto en Excel/OneDrive)
    y usa modo read_only leyendo SOLO esa fila: el libro tiene hojas enormes y en modo normal tardaba
    ~40 s; así son décimas de segundo."""
    tmp = os.path.join(tempfile.gettempdir(), "_ppto_lectura.xlsx")
    origen = ruta
    try:
        shutil.copy2(ruta, tmp)
        origen = tmp
    except PermissionError:
        origen = ruta   # último intento: leer directamente
    wb = openpyxl.load_workbook(origen, read_only=True, data_only=True)
    try:
        ws = wb[HOJA]
        valor = None
        for row in ws.iter_rows(min_row=_FILA, max_row=_FILA, min_col=_COL, max_col=_COL, values_only=True):
            valor = row[0]
    finally:
        wb.close()
        if origen == tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass
    if valor is None:
        raise ValueError(f"La celda {CELDA} de '{HOJA}' está vacía.")
    return round(float(valor), 2)


def sincronizar(db: Session, ruta: str = RUTA) -> float:
    """Lee D42 y lo guarda (upsert) en parametros[CLAVE]. Devuelve el valor. Lanza FileNotFoundError
    si el fichero no es accesible (p. ej. en producción)."""
    valor = leer_valor(ruta)
    p = db.get(Parametro, CLAVE)
    if p is None:
        p = Parametro(clave=CLAVE)
        db.add(p)
    p.valor = valor
    p.descripcion = DESCRIPCION
    db.commit()
    return valor
