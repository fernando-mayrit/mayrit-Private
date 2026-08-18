"""Puente con Cloudflare Web Analytics (analítica de la web pública www.mayritbroker.com).

La web lleva la baliza de Cloudflare Web Analytics (medición SIN cookies, declarada en los legales).
Cloudflare expone esos datos por su API GraphQL; aquí los pedimos para pintarlos DENTRO de Mayrit y,
sobre todo, para archivarlos en nuestra BD (Cloudflare purga pasados unos días; el histórico propio
no caduca). Ver `routers/web.py`.

Detalles del dataset (`rumPageloadEventsAdaptiveGroups`, comprobados contra la API real):
  - métricas: `count` = páginas vistas · `sum { visits }` = visitas (entradas desde fuera del sitio).
  - dimensiones usadas: date, requestPath, countryName, deviceType, userAgentBrowser, userAgentOS,
    refererHost. Se filtra por `requestHost` (nuestro dominio).

⚠ GOTCHA COMPROBADO (2026-08-18) — la ventana no puede pasar de 7 DÍAS. El dataset es "adaptive":
con rangos de ≤7 días responde la tabla EXACTA (11/5/6 visitas los días 15/16/17-ago), pero con 8 días
o más cambia a un resumen grueso que devuelve múltiplos de 10 (20/10) —el DOBLE de lo real— y además
se deja fuera el día más reciente. Por eso `datos()` trocea siempre el periodo en bloques de 7 días.
Por lo mismo NO se pide `avg { sampleInterval }` ni se escala nada: en la tabla exacta el factor es 1.

Credenciales: token de usuario con permiso *Account Analytics: Read* (`CF_API_TOKEN`) y el id de
cuenta (`CF_ACCOUNT_ID`). Solo LECTURA: este módulo nunca escribe en Cloudflare.
"""
from __future__ import annotations

import datetime as dt
import json
import urllib.error
import urllib.request

from .config import settings

GQL_URL = "https://api.cloudflare.com/client/v4/graphql"
TIMEOUT = 90
LIMITE = 10000          # filas por bloque (tope de la API); de sobra para un sitio de este tamaño
DIAS_BLOQUE = 7         # ventana máxima que devuelve el dato exacto (ver GOTCHA arriba)

# Desgloses que guardamos: clave interna (la que va a `web_visitas_detalle.tipo`) → dimensión de
# Cloudflare. La clave interna es la que entiende el frontend, así la pantalla no habla "cloudflarés".
DESGLOSES: dict[str, str] = {
    "pagina": "requestPath",
    "pais": "countryName",
    "dispositivo": "deviceType",
    "navegador": "userAgentBrowser",
    "so": "userAgentOS",
    "referente": "refererHost",
}


def configurado() -> bool:
    """¿Hay token y cuenta? Si no, la pantalla lo explica en vez de reventar."""
    return bool(settings.cf_api_token and settings.cf_account_id)


def _gql(query: str, variables: dict) -> dict:
    """POST a la API GraphQL de Cloudflare. Devuelve `data`; lanza RuntimeError con el motivo.
    Un reintento: la API de Cloudflare se queda colgada de vez en cuando."""
    cuerpo = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    ultimo: Exception | None = None
    for intento in (1, 2):
        req = urllib.request.Request(
            GQL_URL,
            data=cuerpo,
            method="POST",
            headers={
                "Authorization": f"Bearer {settings.cf_api_token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:                  # error con respuesta: no reintentar
            detalle = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"Cloudflare respondió {e.code}: {detalle}") from e
        except Exception as e:                               # red caída, DNS, timeout…
            ultimo = e
    else:
        raise RuntimeError(f"No se pudo conectar con Cloudflare: {ultimo}")

    if res.get("errors"):
        msg = "; ".join(str(x.get("message")) for x in res["errors"])
        raise RuntimeError(f"Cloudflare rechazó la consulta: {msg}")
    return res.get("data") or {}


def _consulta() -> str:
    """Arma la consulta: un bloque de totales por día + un bloque por cada desglose. Todo en UNA
    petición (alias de GraphQL), que es una llamada de red en vez de siete."""
    filtro = "{date_geq:$d, date_leq:$h, requestHost:$host}"
    bloques = [
        f"""    total: rumPageloadEventsAdaptiveGroups(limit:{LIMITE}, filter:{filtro}, orderBy:[date_ASC]) {{
      count sum {{ visits }} dimensions {{ date }}
    }}"""
    ]
    for clave, dim in DESGLOSES.items():
        bloques.append(
            f"""    {clave}: rumPageloadEventsAdaptiveGroups(limit:{LIMITE}, filter:{filtro}) {{
      count sum {{ visits }} dimensions {{ date {dim} }}
    }}"""
        )
    return (
        "query($a:String!, $d:Date!, $h:Date!, $host:String!) {\n"
        "  viewer { accounts(filter:{accountTag:$a}) {\n"
        + "\n".join(bloques)
        + "\n  } }\n}"
    )


def _bloques(desde: dt.date, hasta: dt.date):
    """Trocea [desde, hasta] en tramos de como mucho DIAS_BLOQUE días (ver GOTCHA de la cabecera)."""
    ini = desde
    while ini <= hasta:
        fin = min(ini + dt.timedelta(days=DIAS_BLOQUE - 1), hasta)
        yield ini, fin
        ini = fin + dt.timedelta(days=1)


def datos(desde: dt.date, hasta: dt.date) -> dict[str, list[dict]]:
    """Baja de Cloudflare el periodo [desde, hasta] (ambos incluidos) y lo normaliza.

    Devuelve ``{"total": [{dia, visitas, vistas}], "pagina": [{dia, valor, visitas, vistas}], …}``
    con una clave por desglose de `DESGLOSES`.
    """
    if not configurado():
        raise RuntimeError("Falta CF_API_TOKEN / CF_ACCOUNT_ID: la analítica web no está configurada.")

    query = _consulta()
    out: dict[str, list[dict]] = {"total": [], **{k: [] for k in DESGLOSES}}

    for ini, fin in _bloques(desde, hasta):
        data = _gql(query, {
            "a": settings.cf_account_id,
            "d": ini.isoformat(),
            "h": fin.isoformat(),
            "host": settings.cf_web_host,
        })
        cuentas = ((data.get("viewer") or {}).get("accounts")) or []
        if not cuentas:
            continue
        cuenta = cuentas[0]

        for f in cuenta.get("total") or []:
            out["total"].append({
                "dia": dt.date.fromisoformat(f["dimensions"]["date"]),
                "visitas": int((f.get("sum") or {}).get("visits") or 0),
                "vistas": int(f.get("count") or 0),
            })
        for clave, dim in DESGLOSES.items():
            for f in cuenta.get(clave) or []:
                valor = (f["dimensions"].get(dim) or "").strip()
                out[clave].append({
                    "dia": dt.date.fromisoformat(f["dimensions"]["date"]),
                    "valor": valor or "(desconocido)",
                    "visitas": int((f.get("sum") or {}).get("visits") or 0),
                    "vistas": int(f.get("count") or 0),
                })
    return out
