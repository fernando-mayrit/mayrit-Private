"""
Parser del extracto bancario en **Norma 43 / Cuaderno 43 AEB** (el estándar de los bancos españoles).

Un fichero Norma 43 es texto de registros de 80 caracteres, uno por línea, con estos tipos:
  - 11  Cabecera de cuenta   (banco, oficina, nº de cuenta, fechas, saldo inicial, divisa)
  - 22  Movimiento           (fecha operación, fecha valor, concepto, debe/haber, importe, referencias)
  - 23  Concepto complementario (hasta 5 por movimiento; 2 textos de 38 char cada registro → descripción)
  - 33  Fin de cuenta        (totales, saldo final)
  - 88  Fin de fichero

Un fichero puede traer VARIAS cuentas (varios bloques 11…33). `parse_norma43` devuelve una lista de
cuentas, cada una con sus movimientos ya normalizados (importe con signo, fechas date, descripción unida).

Importes: 14 dígitos (12 enteros + 2 decimales), SIN signo; el signo lo da el indicador debe/haber
(posición del campo: '1' = debe/adeudo → negativo/gasto; '2' = haber/abono → positivo/ingreso).
Fechas: AAMMDD (año de 2 dígitos → 2000+).

Posiciones (0-based), validadas contra ficheros reales de Sabadell:
  Reg 11: entidad[2:6] oficina[6:10] cuenta[10:20] fIni[20:26] fFin[26:32] dh[32:33] saldoIni[33:47] divisa[47:50] nombre[51:77]
  Reg 22: ofiOrigen[6:10] fOper[10:16] fValor[16:22] cComun[22:24] cPropio[24:27] dh[27:28] importe[28:42] documento[42:52] ref1[52:64] ref2[64:80]
  Reg 23: codigo[2:4] concepto1[4:42] concepto2[42:80]
  Reg 33: nDebe[20:25] totDebe[25:39] nHaber[39:44] totHaber[44:58] dh[58:59] saldoFin[59:73]

El cuadre (saldo_inicial + Σ movimientos = saldo_final, y totales debe/haber del registro 33) sirve de
validación automática: si no cuadra, es que las posiciones no encajan con ese banco.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal


class Norma43Error(ValueError):
    """El fichero no es un Norma 43 válido / no se pudo interpretar."""


def _fecha(aammdd: str) -> dt.date | None:
    """AAMMDD → date (año 2000+). None si no es fecha válida."""
    aammdd = (aammdd or "").strip()
    if len(aammdd) != 6 or not aammdd.isdigit():
        return None
    yy, mm, dd = int(aammdd[0:2]), int(aammdd[2:4]), int(aammdd[4:6])
    try:
        return dt.date(2000 + yy, mm, dd)
    except ValueError:
        return None


def _importe(campo: str, debe_haber: str) -> Decimal:
    """14 dígitos (2 decimales), sin signo, + indicador debe/haber → Decimal con signo (debe negativo)."""
    campo = (campo or "").strip() or "0"
    val = Decimal(campo) / Decimal(100) if campo.isdigit() else Decimal(0)
    return -val if (debe_haber or "").strip() == "1" else val   # 1=debe (gasto/adeudo), 2=haber (ingreso/abono)


def parse_norma43(content: bytes) -> list[dict]:
    """Interpreta un fichero Norma 43. Devuelve una lista de cuentas:
        {
          "banco", "oficina", "cuenta" (10 díg.), "divisa", "nombre",
          "fecha_inicial", "fecha_final", "saldo_inicial", "saldo_final",
          "movimientos": [ {fecha, fecha_valor, concepto_comun, concepto_propio,
                            importe (Decimal con signo), documento, referencia1, referencia2,
                            descripcion}, ... ]
        }
    Lanza Norma43Error si no reconoce ninguna cuenta (registro tipo 11)."""
    # Los AEB43 suelen venir en ISO-8859-1 (acentos). Probamos utf-8 y caemos a latin-1.
    try:
        texto = content.decode("utf-8")
    except UnicodeDecodeError:
        texto = content.decode("latin-1", errors="replace")
    lineas = [l.rstrip("\r\n") for l in texto.splitlines()]

    cuentas: list[dict] = []
    cuenta: dict | None = None
    mov: dict | None = None

    def cerrar_mov():
        nonlocal mov
        if cuenta is not None and mov is not None:
            cuenta["movimientos"].append(mov)
        mov = None

    for l in lineas:
        if len(l) < 2:
            continue
        tipo = l[0:2]

        if tipo == "11":                                    # cabecera de cuenta
            cerrar_mov()
            cuenta = {
                "banco": l[2:6].strip(),
                "oficina": l[6:10].strip(),
                "cuenta": l[10:20].strip(),
                "fecha_inicial": _fecha(l[20:26]),
                "fecha_final": _fecha(l[26:32]),
                "saldo_inicial": _importe(l[33:47], l[32:33]),
                "divisa": l[47:50].strip(),
                "nombre": l[51:77].strip() if len(l) >= 52 else "",
                "saldo_final": None,
                "total_debe": None, "total_haber": None, "n_debe": None, "n_haber": None,
                "movimientos": [],
            }
            cuentas.append(cuenta)

        elif tipo == "22" and cuenta is not None:           # movimiento principal
            cerrar_mov()
            mov = {
                "oficina_origen": l[6:10].strip(),
                "fecha": _fecha(l[10:16]),
                "fecha_valor": _fecha(l[16:22]),
                "concepto_comun": l[22:24].strip(),
                "concepto_propio": l[24:27].strip(),
                "importe": _importe(l[28:42], l[27:28]),
                "documento": l[42:52].strip(),
                "referencia1": l[52:64].strip(),
                "referencia2": l[64:80].strip() if len(l) >= 64 else "",
                "descripcion": "",
            }

        elif tipo == "23" and mov is not None:              # conceptos complementarios (2 × 38 char)
            trozos = [l[4:42].strip(), l[42:80].strip() if len(l) >= 42 else ""]
            extra = " ".join(t for t in trozos if t)
            if extra:
                mov["descripcion"] = (mov["descripcion"] + " " + extra).strip()

        elif tipo == "33" and cuenta is not None:           # fin de cuenta (totales + saldo final)
            cerrar_mov()
            if len(l) >= 73:
                s = l[25:39].strip()
                cuenta["total_debe"] = Decimal(s) / 100 if s.isdigit() else None
                s = l[44:58].strip()
                cuenta["total_haber"] = Decimal(s) / 100 if s.isdigit() else None
                cuenta["n_debe"] = int(l[20:25]) if l[20:25].strip().isdigit() else None
                cuenta["n_haber"] = int(l[39:44]) if l[39:44].strip().isdigit() else None
                cuenta["saldo_final"] = _importe(l[59:73], l[58:59])

        elif tipo == "88":                                  # fin de fichero
            cerrar_mov()

    cerrar_mov()
    if not cuentas:
        raise Norma43Error("No se reconoce ninguna cuenta (registro tipo 11). ¿Es un fichero Norma 43 / Cuaderno 43?")
    return cuentas
