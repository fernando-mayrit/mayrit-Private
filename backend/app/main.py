"""Punto de entrada de la API de Mayrit (FastAPI)."""
from fastapi import FastAPI

app = FastAPI(title="Mayrit API", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "mayrit-api"}
