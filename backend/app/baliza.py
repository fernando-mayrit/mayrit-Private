"""Puente con la baliza PROPIA de la web pública (www.mayritbroker.com).

Este módulo solo LEE del alojamiento y devuelve lo que hay. Quien lo interpreta y lo archiva es
`routers/web.py`.

POR QUÉ EXISTE, SI YA ESTÁ CLOUDFLARE
    Porque la web es una sola dirección. Sus siete páginas —Inicio, Agencias, Compañías, Cómo
    funciona, Diccionario, Nosotros, Contacto— son `<div>` que se esconden y se enseñan sin recargar
    ni cambiar la dirección. Cloudflare ve UNA visita a UNA página y ahí se acaba su informe. Todo el
    recorrido (qué páginas, en qué orden, cuántos segundos, cuánto llegó a ver de cada una, qué
    buscó en el diccionario) solo se puede medir desde dentro de la propia página. Eso hace
    `mayrit-web/marca/medir.js`.

LA CADENA ENTERA
    medir.js (navegador) → medir.php (apunta una línea por envío en medidas/AAAA-MM-DD.jsonl)
    → datos.php (la entrega, con clave) → ESTE MÓDULO → routers/web.py → BD de Mayrit.

    El archivo BUENO es la BD: la carpeta del alojamiento se limpia sola a los 40 días. Aquello es
    un buzón, no un archivo.

CÓMO SE PIDE
    - sin `dia`: el índice, o sea qué días hay y cuántas líneas tiene cada uno.
    - con `dia` y `desde`: las líneas de ese día a partir de la que se diga, en tandas de 2000.
      Por eso la app guarda cuántas lleva leídas de cada día (`web_baliza_dias`) y pide solo lo
      nuevo, en vez de rebajarse el día entero cada vez.

LA CLAVE vive en el alojamiento en `medir-clave.ini`, un piso por encima de la web, y aquí en
`WEB_MEDIR_CLAVE`. Si no coinciden, datos.php contesta 403 y la pantalla lo dice con esas palabras.
"""
from __future__ import annotations

import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request

from .config import settings

TIMEOUT = 60
TANDA = 2000        # el tope que devuelve datos.php de una vez; si hay más, avisa con `hay_mas`
MAX_TANDAS = 25     # tope de cordura por día y sincronización (50.000 envíos: nunca va a pasar)


def configurado() -> bool:
    """¿Se puede recoger? Sin clave no se llama siquiera: datos.php contestaría 403."""
    return bool(settings.web_medir_clave and settings.web_medir_url)


def _pide(**parametros) -> dict:
    """Una llamada a datos.php. Devuelve el JSON ya descodificado."""
    if not configurado():
        raise RuntimeError("Falta la clave de la baliza (WEB_MEDIR_CLAVE).")

    query = {"clave": settings.web_medir_clave, **{k: v for k, v in parametros.items() if v is not None}}
    url = settings.web_medir_url + "?" + urllib.parse.urlencode(query)
    peticion = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(peticion, timeout=TIMEOUT) as r:
            datos = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # datos.php contesta el motivo en JSON: se enseña tal cual, que es más útil que "error 403".
        detalle = ""
        try:
            detalle = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        if e.code == 403:
            raise RuntimeError(
                "El alojamiento rechaza la clave. Comprueba que WEB_MEDIR_CLAVE es la misma que "
                "subió mayrit-web\\scripts\\subir_medir.py."
            ) from e
        raise RuntimeError("La web contestó %s%s" % (e.code, ": " + detalle if detalle else "")) from e
    except urllib.error.URLError as e:
        raise RuntimeError("No se puede hablar con la web (%s)." % e.reason) from e

    if isinstance(datos, dict) and datos.get("error"):
        raise RuntimeError(str(datos["error"]))
    return datos


def dias_disponibles() -> list[dict]:
    """Qué días tiene el alojamiento sin recoger, y de cuántas líneas.

    Devuelve [{'dia': date, 'lineas': int}], de más antiguo a más nuevo."""
    datos = _pide()
    out = []
    for f in datos.get("dias", []):
        try:
            out.append({"dia": dt.date.fromisoformat(f["dia"]), "lineas": int(f.get("lineas") or 0)})
        except (ValueError, KeyError, TypeError):
            continue        # un nombre de fichero raro no puede tumbar la sincronización
    return sorted(out, key=lambda f: f["dia"])


def lineas_de(dia: dt.date, desde: int = 0) -> tuple[list[dict], int]:
    """Los envíos de un día a partir de la línea `desde`.

    Devuelve (envíos, cuántas líneas van leídas en total). Se encadenan las tandas aquí dentro para
    que quien llama no tenga que saber que existen."""
    envios: list[dict] = []
    leidas = desde
    for _ in range(MAX_TANDAS):
        datos = _pide(dia=dia.isoformat(), desde=leidas)
        nuevas = datos.get("lineas") or []
        envios.extend(l for l in nuevas if isinstance(l, dict))
        leidas = int(datos.get("hasta") or leidas)
        if not datos.get("hay_mas") or not nuevas:
            break
    return envios, leidas
