"""Carga el presupuesto de INGRESOS (comisión retenida) desde el Excel limpio
a la tabla `ppto_ingresos` de la BD, para que Power BI lo cruce con el real.

Excel fuente (hoja 'Ppto Ingresos 2026'):
    Cuentas\\Presupuesto Ingresos 2026.xlsx
Layout: fila 4 = cabecera; datos desde la fila 5 hasta la fila 'TOTAL'.
    A Corredor | B Tipo | C Real2025 | D Real2026 | E..P Ene..Dic | Q Total | R Objetivo | S Dif

Carga FULL-REFRESH del año: borra ppto_ingresos del año y reinserta una fila por
(corredor, mes) con importe > 0. Por defecto es DRY-RUN; usa --commit para escribir.

    python tools/migrar_ppto_ingresos.py                # dry-run
    python tools/migrar_ppto_ingresos.py --commit       # escribe en la BD
    python tools/migrar_ppto_ingresos.py --anio 2026 --xlsx "ruta\\otro.xlsx" --commit
"""
import argparse, os, sys
import openpyxl
import psycopg
from dotenv import load_dotenv

XLSX_DEFAULT = (r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Sociedad - Documentos"
                r"\Societario\Cuentas\Presupuesto Ingresos 2026.xlsx")
HOJA = "Ppto Ingresos 2026"
FILA_CAB = 4            # cabecera
COL_CORREDOR, COL_TIPO = 1, 2
COL_MES_INI = 5         # E = Enero ... P = Diciembre


def num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def leer_excel(ruta):
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    ws = wb[HOJA]
    filas = []
    for row in ws.iter_rows(min_row=FILA_CAB + 1, values_only=True):
        corredor = row[COL_CORREDOR - 1]
        tipo = row[COL_TIPO - 1]
        if corredor is None or str(corredor).strip().upper() == "TOTAL":
            if tipo and str(tipo).strip().upper() == "TOTAL":
                break          # fila de totales -> fin
            continue
        for m in range(1, 13):
            importe = num(row[COL_MES_INI - 1 + (m - 1)])
            if importe:
                filas.append((str(corredor).strip(), (str(tipo).strip() if tipo else None), m, importe))
    return filas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--anio", type=int, default=2026)
    ap.add_argument("--xlsx", default=XLSX_DEFAULT)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.xlsx):
        sys.exit(f"No encuentro el Excel: {args.xlsx}")

    filas = leer_excel(args.xlsx)
    total = sum(f[3] for f in filas)
    print(f"Leídas {len(filas)} líneas (corredor×mes) del Excel · año {args.anio}")
    print(f"Total presupuesto: {total:,.2f} €")
    porcor = {}
    for cor, tipo, m, imp in filas:
        porcor[cor] = porcor.get(cor, 0) + imp
    for cor in sorted(porcor, key=lambda k: -porcor[k]):
        print(f"  {cor:24} {porcor[cor]:12,.2f}")

    if not args.commit:
        print("\n[DRY-RUN] No se ha escrito nada. Repite con --commit para cargar.")
        return

    load_dotenv(os.path.expanduser("~/.mayrit/.env"))
    cs = (f"host={os.environ['PG_HOST']} port={os.environ['PG_PORT']} "
          f"dbname={os.environ['PG_DATABASE']} user={os.environ['PG_USER']} "
          f"password={os.environ['PG_PASSWORD']} sslmode=require")
    with psycopg.connect(cs) as c, c.cursor() as cur:
        cur.execute("DELETE FROM ppto_ingresos WHERE anio = %s", (args.anio,))
        borradas = cur.rowcount
        cur.executemany(
            "INSERT INTO ppto_ingresos (anio, mes, corredor, tipo, importe, moneda) "
            "VALUES (%s, %s, %s, %s, %s, 'EUR')",
            [(args.anio, m, cor, tipo, imp) for cor, tipo, m, imp in filas],
        )
        c.commit()
        print(f"\nOK. Borradas {borradas} del año {args.anio}, insertadas {len(filas)}.")


if __name__ == "__main__":
    main()
