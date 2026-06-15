"""
Endpoints CRUD de las maestras (Fase 1): productores, mercados y binders.
Cada entidad expone:
  GET    /            listar (con ?q= para buscar, ?limit=&offset= para paginar)
  GET    /{id}        obtener uno
  POST   /            crear
  PUT    /{id}        editar
  DELETE /{id}        borrar
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud
from ..db import get_db
from ..models.maestras import Binder, Mercado, Productor, Tomador
from ..schemas import maestras as sch


def _make_router(*, prefix, tag, model, read_schema, create_schema, update_schema, search_cols):
    router = APIRouter(prefix=prefix, tags=[tag])
    nombre = tag.lower()

    @router.get("", response_model=list[read_schema])
    def listar(q: str | None = None, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
        return crud.list_items(
            db, model, q=q, search_cols=search_cols(model), limit=limit, offset=offset
        )

    @router.get("/{item_id}", response_model=read_schema)
    def obtener(item_id: int, db: Session = Depends(get_db)):
        obj = crud.get_item(db, model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} no encontrado")
        return obj

    @router.post("", response_model=read_schema, status_code=201)
    def crear(payload: create_schema, db: Session = Depends(get_db)):
        return crud.create_item(db, model, payload.model_dump(exclude_unset=True))

    @router.put("/{item_id}", response_model=read_schema)
    def editar(item_id: int, payload: update_schema, db: Session = Depends(get_db)):
        obj = crud.get_item(db, model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} no encontrado")
        return crud.update_item(db, obj, payload.model_dump(exclude_unset=True))

    @router.delete("/{item_id}", status_code=204)
    def borrar(item_id: int, db: Session = Depends(get_db)):
        obj = crud.get_item(db, model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} no encontrado")
        crud.delete_item(db, obj)

    return router


productores_router = _make_router(
    prefix="/productores",
    tag="Productores",
    model=Productor,
    read_schema=sch.ProductorRead,
    create_schema=sch.ProductorCreate,
    update_schema=sch.ProductorUpdate,
    search_cols=lambda m: [m.nombre, m.alias, m.cif],
)

mercados_router = _make_router(
    prefix="/mercados",
    tag="Mercados",
    model=Mercado,
    read_schema=sch.MercadoRead,
    create_schema=sch.MercadoCreate,
    update_schema=sch.MercadoUpdate,
    search_cols=lambda m: [m.nombre, m.codigo],
)

tomadores_router = _make_router(
    prefix="/tomadores",
    tag="Tomadores",
    model=Tomador,
    read_schema=sch.TomadorRead,
    create_schema=sch.TomadorCreate,
    update_schema=sch.TomadorUpdate,
    search_cols=lambda m: [m.nombre, m.cif],
)

binders_router = _make_router(
    prefix="/binders",
    tag="Binders",
    model=Binder,
    read_schema=sch.BinderRead,
    create_schema=sch.BinderCreate,
    update_schema=sch.BinderUpdate,
    search_cols=lambda m: [m.titulo, m.umr, m.coverholder],
)
