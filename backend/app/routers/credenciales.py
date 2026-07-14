"""Gestor de contraseñas: credenciales del equipo, privadas o compartidas.

La contraseña se guarda CIFRADA (``app/seguridad.py``) y solo se descifra al pedirla
explícitamente (``GET /credenciales/{id}/secreto``), tras comprobar que el usuario puede verla —
así el listado no lleva contraseñas en claro al navegador.

El usuario actual llega como parámetro ``usuario`` (igual que el resto de Mayrit: identidad por
nombre, sin login por contraseña dentro de la app; Entra es la puerta). La separación
privada/pública entre usuarios es por BUENA FE, no una barrera criptográfica: el cifrado protege
el dato en reposo en la BD. Ver la decisión razonada en docs/CONTEXTO.md.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import seguridad
from ..db import get_db
from ..models.maestras import Credencial, CredencialPermiso

router = APIRouter(prefix="/credenciales", tags=["Credenciales"])


# ── Reglas de visibilidad ────────────────────────────────────────────────────────────────────
def _visible_para(u: str):
    """Filtro SQL: credenciales que `u` puede ver (las suyas o las públicas compartidas con él)."""
    return or_(
        Credencial.propietario == u,
        Credencial.id.in_(
            select(CredencialPermiso.credencial_id).where(CredencialPermiso.usuario == u)
        ),
    )


def _puede_ver(c: Credencial, u: str) -> bool:
    return c.propietario == u or any(p.usuario == u for p in c.permisos)


def _limpiar_permisos(permisos: list[str] | None, propietario: str) -> list[str]:
    """Normaliza la lista de usuarios con permiso: recorta, quita vacíos, duplicados y al propietario
    (que siempre ve las suyas)."""
    out: list[str] = []
    for n in permisos or []:
        n = (n or "").strip()
        if n and n != propietario and n not in out:
            out.append(n)
    return out


# ── Schemas ──────────────────────────────────────────────────────────────────────────────────
class CredencialIn(BaseModel):
    titulo: str
    categoria: str | None = None
    usuario: str | None = None
    url: str | None = None
    notas: str | None = None
    secreto: str                       # contraseña en claro (se cifra al guardar)
    visibilidad: str = "privada"       # privada | publica
    permisos: list[str] = []           # usuarios que pueden verla (solo si publica)


class CredencialUpdate(BaseModel):
    titulo: str | None = None
    categoria: str | None = None
    usuario: str | None = None
    url: str | None = None
    notas: str | None = None
    secreto: str | None = None         # si viene (no vacío), re-cifra; si None, no cambia la contraseña
    visibilidad: str | None = None
    permisos: list[str] | None = None


class CredencialRead(BaseModel):
    """Metadatos de una credencial. NUNCA incluye la contraseña (esa va por /secreto)."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    propietario: str
    titulo: str
    categoria: str | None = None
    usuario: str | None = None
    url: str | None = None
    notas: str | None = None
    visibilidad: str
    permisos: list[str] = []
    es_propia: bool = False            # el usuario actual es el propietario → puede editar/borrar
    created_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None


def _read(c: Credencial, actual: str) -> CredencialRead:
    # Se construye a mano (no model_validate) porque `permisos` en el ORM son objetos
    # CredencialPermiso y aquí se exponen como lista de nombres.
    return CredencialRead(
        id=c.id,
        propietario=c.propietario,
        titulo=c.titulo,
        categoria=c.categoria,
        usuario=c.usuario,
        url=c.url,
        notas=c.notas,
        visibilidad=c.visibilidad,
        permisos=sorted(p.usuario for p in c.permisos),
        es_propia=c.propietario == actual,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


def _usuario_actual(usuario: str) -> str:
    u = (usuario or "").strip()
    if not u:
        raise HTTPException(status_code=422, detail="Falta el usuario actual.")
    return u


# ── Endpoints ────────────────────────────────────────────────────────────────────────────────
@router.get("", response_model=list[CredencialRead])
def listar(
    usuario: str = Query(...),
    q: str | None = None,
    categoria: str | None = None,
    db: Session = Depends(get_db),
):
    """Credenciales visibles para el usuario (propias + públicas compartidas con él), ordenadas por
    categoría y título. Sin contraseñas (se piden aparte)."""
    u = _usuario_actual(usuario)
    stmt = select(Credencial).where(_visible_para(u))
    if categoria:
        stmt = stmt.where(Credencial.categoria == categoria)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Credencial.titulo.ilike(like),
            Credencial.usuario.ilike(like),
            Credencial.categoria.ilike(like),
            Credencial.url.ilike(like),
        ))
    # En PostgreSQL, ASC deja los NULL al final → las sin categoría caen abajo.
    cs = db.scalars(stmt.order_by(Credencial.categoria, Credencial.titulo)).all()
    return [_read(c, u) for c in cs]


@router.get("/categorias", response_model=list[str])
def categorias(usuario: str = Query(...), db: Session = Depends(get_db)):
    """Categorías distintas ya usadas en las credenciales visibles (para el filtro y el autocompletar)."""
    u = _usuario_actual(usuario)
    rows = db.scalars(
        select(Credencial.categoria)
        .where(_visible_para(u), Credencial.categoria.is_not(None))
        .distinct()
    ).all()
    return sorted({r for r in rows if r})


@router.get("/{cred_id}/secreto")
def ver_secreto(cred_id: int, usuario: str = Query(...), db: Session = Depends(get_db)):
    """Descifra y devuelve la contraseña, si el usuario puede ver la credencial."""
    u = _usuario_actual(usuario)
    c = db.get(Credencial, cred_id)
    if c is None or not _puede_ver(c, u):
        raise HTTPException(status_code=404, detail="Credencial no encontrada.")
    try:
        return {"secreto": seguridad.descifrar(c.secreto_cifrado)}
    except seguridad.VaultKeyMissing as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=CredencialRead, status_code=201)
def crear(payload: CredencialIn, usuario: str = Query(...), db: Session = Depends(get_db)):
    u = _usuario_actual(usuario)
    if not payload.titulo.strip():
        raise HTTPException(status_code=422, detail="El título es obligatorio.")
    if not payload.secreto:
        raise HTTPException(status_code=422, detail="La contraseña es obligatoria.")
    vis = payload.visibilidad if payload.visibilidad in ("privada", "publica") else "privada"
    try:
        token = seguridad.cifrar(payload.secreto)
    except seguridad.VaultKeyMissing as e:
        raise HTTPException(status_code=503, detail=str(e))
    c = Credencial(
        propietario=u,
        titulo=payload.titulo.strip(),
        categoria=(payload.categoria or "").strip() or None,
        usuario=(payload.usuario or "").strip() or None,
        url=(payload.url or "").strip() or None,
        notas=(payload.notas or "").strip() or None,
        secreto_cifrado=token,
        visibilidad=vis,
    )
    if vis == "publica":
        for nombre in _limpiar_permisos(payload.permisos, u):
            c.permisos.append(CredencialPermiso(usuario=nombre))
    db.add(c)
    db.commit()
    db.refresh(c)
    return _read(c, u)


@router.put("/{cred_id}", response_model=CredencialRead)
def editar(cred_id: int, payload: CredencialUpdate, usuario: str = Query(...), db: Session = Depends(get_db)):
    u = _usuario_actual(usuario)
    c = db.get(Credencial, cred_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Credencial no encontrada.")
    if c.propietario != u:
        raise HTTPException(status_code=403, detail="Solo el propietario puede editar esta credencial.")
    data = payload.model_dump(exclude_unset=True)

    if "titulo" in data and data["titulo"] is not None:
        if not data["titulo"].strip():
            raise HTTPException(status_code=422, detail="El título es obligatorio.")
        c.titulo = data["titulo"].strip()
    if "categoria" in data:
        c.categoria = (data["categoria"] or "").strip() or None
    if "usuario" in data:
        c.usuario = (data["usuario"] or "").strip() or None
    if "url" in data:
        c.url = (data["url"] or "").strip() or None
    if "notas" in data:
        c.notas = (data["notas"] or "").strip() or None
    if data.get("secreto"):            # re-cifra solo si mandan una contraseña nueva no vacía
        try:
            c.secreto_cifrado = seguridad.cifrar(data["secreto"])
        except seguridad.VaultKeyMissing as e:
            raise HTTPException(status_code=503, detail=str(e))
    if "visibilidad" in data and data["visibilidad"] in ("privada", "publica"):
        c.visibilidad = data["visibilidad"]

    # Permisos: si queda privada, se vacían; si es pública y mandan lista, se reemplaza.
    if c.visibilidad == "privada":
        c.permisos.clear()
    elif "permisos" in data and data["permisos"] is not None:
        deseados = _limpiar_permisos(data["permisos"], c.propietario)
        c.permisos.clear()
        db.flush()                     # aplica el borrado antes de reinsertar (evita choque con la unique)
        for nombre in deseados:
            c.permisos.append(CredencialPermiso(usuario=nombre))

    db.commit()
    db.refresh(c)
    return _read(c, u)


@router.delete("/{cred_id}", status_code=204)
def borrar(cred_id: int, usuario: str = Query(...), db: Session = Depends(get_db)):
    u = _usuario_actual(usuario)
    c = db.get(Credencial, cred_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Credencial no encontrada.")
    if c.propietario != u:
        raise HTTPException(status_code=403, detail="Solo el propietario puede borrar esta credencial.")
    db.delete(c)
    db.commit()
