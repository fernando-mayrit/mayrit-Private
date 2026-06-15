"""Punto de entrada de la API de Mayrit (FastAPI)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import binders, codigos_postales, maestras, ramos

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


app.include_router(maestras.productores_router)
app.include_router(maestras.mercados_router)
app.include_router(maestras.tomadores_router)
app.include_router(ramos.router)
app.include_router(binders.router)
app.include_router(codigos_postales.router)
