"""manual_secciones: secciones del Manual de uso (editable), sembradas con el contenido v1

Revision ID: manual_secciones_0001
Revises: dgsfp_ag_0003
Create Date: 2026-07-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'manual_secciones_0001'
down_revision: Union[str, Sequence[str], None] = 'dgsfp_ag_0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Contenido inicial (v1) en Markdown. Convención de recuadros: un párrafo que empieza por 📌 se
# pinta como "regla"; por ⚠️ como "aviso". Tablas en formato GFM.
SECCIONES = [
    ("🧩", "Conceptos base", """La app gira alrededor del **binder** (acuerdo de suscripción agencia ↔ mercado):

- **Binder → Secciones → Mercados** (con su % de participación). La suma de participaciones de una sección es 100 %.
- **Lloyd's vs Compañía:** un binder es **Lloyd's** si algún mercado de sus secciones es de tipo `Lloyds` (sindicatos); el resto son de **Compañía**. Esta distinción cambia el proceso de LPAN/FDO.
- **Programa:** agrupa binders relacionados. Algunos programas son de **reaseguro** (p. ej. caución), con una economía de recibo distinta."""),

    ("📥", "BDX: Risk y Premium", """Cada binder reporta dos tipos de bordereau (BDX) por mes:

- **Risk BDX:** los **riesgos suscritos** del mes (qué se ha vendido). De él se genera el **recibo**.
- **Premium BDX:** las **primas cobradas** (el dinero que entra). Rara vez coincide en el tiempo con el Risk. El cobro/traspaso/liquidación del recibo se **derivan** del Premium.

«**Our line**» = la parte que le corresponde a nuestra participación (no el 100 %). Una línea solo entra en la facturación si está marcada **«incluida en Premium»**."""),

    ("🧾", "Recibos", """- **1 recibo por Risk BDX** = por (binder, periodo `YYYY-MM`). Numeración por año natural: `AÑO-NNNN`.
- La comisión de Mayrit (**retenida**) = Σ brokerage de las líneas de ese periodo.
- El **cobro** llega con los Premium BDX (puede ser parcial); los «pendientes» los recalcula la app.

📌 La **Fecha Contable** es el **mes al que se imputa** el recibo (para el cierre). El día es **SIEMPRE 1**: se elige el mes libremente (el del periodo o, si está cerrado, otro abierto), pero nunca un día distinto del 1. La app lo fuerza sola.

⚠️ Un recibo **Contabilizado** (enviado al cierre mensual) queda **bloqueado**: para corregirlo hay que **reabrirlo** primero."""),

    ("🔗", "El ciclo de liquidación (la cadena)", """Para pagar al mercado hay que seguir esta cadena. **Cada paso bloquea el siguiente** si no está hecho:

**💰 Cobrar → 📐 Generar LPAN → 🔓 Liberar → 🏦 Liquidar**

- **Cobrar** las líneas del Premium (marcar cobro con su fecha).
- **Generar el LPAN** del periodo. **No se puede generar hasta que TODAS las líneas del grupo estén cobradas.**
- **Liberar** el LPAN (sello de Xchanging) — **solo en binders Lloyd's**.
- **Liquidar** el Premium: paga al mercado y **sella la fecha de liquidación en los LPAN** automáticamente.

📌 Para liquidar, **tienen que existir LPAN que cuadren**: la suma del neto de los LPAN debe coincidir con el neto a pagar al mercado del Premium. Si no hay LPAN, o no cuadran, la app **no deja liquidar** (te avisa con los dos importes y la diferencia).

⚠️ Los LPAN son obligatorios para liquidar **tanto en Lloyd's como en Compañía** (os sirven para controlar la liquidación). La diferencia está en el FDO y el «Liberado» (ver LPAN y FDO)."""),

    ("📐", "LPAN y FDO (Lloyd's vs Compañía)", """El **LPAN** (London Premium Advice Note) es la nota de pago que agrupa las líneas del Premium de un risk code y controla la liquidación al mercado.

|  | Lloyd's | Compañía |
| --- | --- | --- |
| **FDO previo** (con signing number) | ✅ Obligatorio antes del LPAN | ❌ No hace falta |
| **Generar LPAN** | ✅ (necesita el FDO) | ✅ (directo, sin FDO) |
| **Liberar** (Xchanging) | ✅ Se exige antes de liquidar | ❌ No aplica |
| **LPAN para liquidar** | ✅ Obligatorio | ✅ Obligatorio |

En resumen: la **única diferencia real** es que los **Lloyd's exigen FDO previo** (y el paso «Liberado» de Xchanging). En Compañía se genera el LPAN directo y se liquida sin Liberado."""),

    ("💶", "Comisiones (Iberian)", """- Cada mes se **prepara un recibo tipo «Comisiones»** (prima 0, día 1 del mes) con la comisión **estimada** del Premium: **10 % del GWP** (our line).
- Queda **pendiente de ratificar** hasta que Iberian envía la comisión **definitiva** y el reparto del **85 % cedido** entre sus sociedades. Mayrit **retiene el 15 %**.

📌 En los recibos de comisiones de Iberian, el **Mercado** es siempre **«Iberian Insurance Group, S.L.»**."""),

    ("🏦", "Mercados: alias vs nombre", """Cada mercado tiene un **nombre canónico** y un **alias** corto (p. ej. nombre «Liberty Specialty Markets», alias «LSM»).

📌 En los recibos se guarda siempre el **nombre canónico** del mercado, no el alias (p. ej. «Axeria» → «Axeria Iard, S.L.»)."""),

    ("🔒", "Cierre contable", """- El cierre mensual **cierra un (año, mes)** por **Fecha Contable**: sus recibos pasan a **Contabilizado** y quedan bloqueados.
- No se pueden **crear ni imputar** recibos en un mes ya cerrado (hay que elegir un mes abierto).
- Para corregir algo de un mes cerrado, primero se **reabre** el recibo (descontabilizar)."""),
]


def upgrade() -> None:
    tabla = op.create_table(
        'manual_secciones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('orden', sa.Integer(), nullable=False, server_default='0', index=True),
        sa.Column('emoji', sa.String(length=16), nullable=False, server_default=''),
        sa.Column('titulo', sa.String(length=160), nullable=False, server_default=''),
        sa.Column('cuerpo', sa.Text(), nullable=False, server_default=''),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.bulk_insert(tabla, [
        {"orden": i, "emoji": emoji, "titulo": titulo, "cuerpo": cuerpo}
        for i, (emoji, titulo, cuerpo) in enumerate(SECCIONES)
    ])


def downgrade() -> None:
    op.drop_table('manual_secciones')
