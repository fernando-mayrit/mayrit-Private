"""Operaciones CRUD genéricas reutilizables por cualquier modelo ORM."""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session


def list_items(db: Session, model, *, q=None, search_cols=None, limit=100, offset=0):
    stmt = select(model)
    if q and search_cols:
        like = f"%{q}%"
        stmt = stmt.where(or_(*[col.ilike(like) for col in search_cols]))
    stmt = stmt.order_by(model.id).limit(limit).offset(offset)
    return list(db.scalars(stmt))


def get_item(db: Session, model, item_id: int):
    return db.get(model, item_id)


def create_item(db: Session, model, data: dict):
    obj = model(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def update_item(db: Session, obj, data: dict):
    for key, value in data.items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


def delete_item(db: Session, obj):
    db.delete(obj)
    db.commit()
