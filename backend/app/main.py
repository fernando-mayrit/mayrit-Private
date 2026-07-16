"""Punto de entrada de la API de Mayrit (FastAPI)."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers import avisos, bdx, binders, cierre, claims_bdx, codigos_postales, comisiones, consultoria, contabilidad, credenciales, dgsfp, kpis, lpan, maestras, manual, ramos, recibos, siniestros, tareas, transferencias, triangulacion, ucr

app = FastAPI(title="Mayrit API", version="0.1.0")

# En producción el backend sirve el frontend (mismo origen, no necesita CORS). En desarrollo,
# el frontend de Vite (localhost:5173) llama a la API. Se incluye el dominio propio por robustez.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://app.mayritbroker.com",
        "https://mayrit.azurewebsites.net",
    ],
    # En desarrollo, Vite puede arrancar en cualquier puerto (5173, 5174…) si el anterior está
    # ocupado; se permite cualquier puerto de localhost para no tener que ir tocando la lista.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Cabeceras de seguridad (defensa en profundidad; NO afectan al uso normal de la app):
# HSTS obliga a HTTPS, nosniff evita adivinar tipos de contenido, X-Frame-Options evita
# clickjacking (la app no se embebe en iframes), Referrer-Policy limita la fuga de URLs,
# Permissions-Policy desactiva APIs del navegador que no usamos. Sin CSP para no romper el SPA.
@app.middleware("http")
async def cabeceras_seguridad(request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return resp


@app.get("/health")
def health():
    return {"status": "ok", "service": "mayrit-api"}


@app.get("/usuario-equipo")
def usuario_equipo():
    """Usuario asignado a ESTE equipo (MAYRIT_USUARIO en ~/.mayrit/.env), para autologin."""
    from .config import settings
    return {"nombre": (settings.mayrit_usuario or "").strip() or None}


app.include_router(maestras.productores_router)
app.include_router(maestras.mercados_router)
app.include_router(maestras.tomadores_router)
app.include_router(maestras.cuentas_bancarias_router)
app.include_router(maestras.usuarios_router)
app.include_router(maestras.programas_router)
# recibos ANTES que polizas_router: define /polizas/siguiente-numero, que si no
# quedaría capturado por GET /polizas/{item_id} (item_id no entero → 422).
app.include_router(recibos.router)
app.include_router(maestras.polizas_router)
app.include_router(ramos.router)
app.include_router(binders.router)
app.include_router(bdx.router)
app.include_router(cierre.router)
app.include_router(siniestros.router)
app.include_router(ucr.router)
app.include_router(claims_bdx.router)
app.include_router(triangulacion.router)
app.include_router(consultoria.router)
app.include_router(comisiones.router)
app.include_router(transferencias.router)
app.include_router(contabilidad.router)
app.include_router(tareas.router)
app.include_router(lpan.router)
app.include_router(avisos.router)
app.include_router(kpis.router)
app.include_router(dgsfp.router)
app.include_router(codigos_postales.router)
app.include_router(manual.router)
app.include_router(credenciales.router)


# ── Frontend compilado ──
# En producción (Azure) el backend sirve también el frontend (carpeta backend/static, generada
# por el build de Vite y copiada en el despliegue). Va al FINAL para que la API tenga prioridad.
# En desarrollo local esa carpeta no existe → no se monta (se usa el dev server de Vite).
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="frontend")
