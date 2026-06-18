"""Punto de entrada de la API de Mayrit (FastAPI)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import bdx, binders, codigos_postales, maestras, ramos, recibos

app = FastAPI(title="Mayrit API", version="0.1.0")

# Permite que el frontend (Vite, normalmente en localhost:5173) llame a la API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
# recibos ANTES que polizas_router: define /polizas/siguiente-numero, que si no
# quedaría capturado por GET /polizas/{item_id} (item_id no entero → 422).
app.include_router(recibos.router)
app.include_router(maestras.polizas_router)
app.include_router(ramos.router)
app.include_router(binders.router)
app.include_router(bdx.router)
app.include_router(codigos_postales.router)
