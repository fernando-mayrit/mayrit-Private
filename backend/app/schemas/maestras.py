"""
Esquemas Pydantic para las maestras (Fase 1). Por cada entidad:
  - *Base   : campos editables (los que viajan al crear/editar).
  - *Create : igual que Base (alta).
  - *Update : todos opcionales (edición parcial).
  - *Read   : Base + id + timestamps (lo que devuelve la API).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ─────────────────────────────── Productor ───────────────────────────────
class ProductorBase(BaseModel):
    nombre: str
    alias: str | None = None
    tipo: str | None = None
    persona: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class ProductorCreate(ProductorBase):
    pass


class ProductorUpdate(BaseModel):
    nombre: str | None = None
    alias: str | None = None
    tipo: str | None = None
    persona: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None


class ProductorRead(ProductorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────────── Mercado ────────────────────────────────
class MercadoBase(BaseModel):
    nombre: str
    codigo: str | None = None
    id_tipo: int | None = None
    tipo_mercado: str | None = None
    toba: bool = False
    fecha: dt.date | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class MercadoCreate(MercadoBase):
    pass


class MercadoUpdate(BaseModel):
    nombre: str | None = None
    codigo: str | None = None
    id_tipo: int | None = None
    tipo_mercado: str | None = None
    toba: bool | None = None
    fecha: dt.date | None = None
    notas: str | None = None


class MercadoRead(MercadoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ──────────────────────────────── Tomador ────────────────────────────────
class TomadorBase(BaseModel):
    nombre: str
    tipo: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class TomadorCreate(TomadorBase):
    pass


class TomadorUpdate(BaseModel):
    nombre: str | None = None
    tipo: str | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    notas: str | None = None


class TomadorRead(TomadorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime


# ────────────────────────────────── Ramo ─────────────────────────────────
class RiskCodeIn(BaseModel):
    codigo: str
    descripcion: str | None = None


class RiskCodeOut(BaseModel):
    id: int
    codigo: str
    descripcion: str | None = None


class RamoBase(BaseModel):
    nombre: str


class RamoCreate(RamoBase):
    risk_codes: list[RiskCodeIn] = []


class RamoUpdate(BaseModel):
    nombre: str | None = None
    risk_codes: list[RiskCodeIn] | None = None


class RamoRead(RamoBase):
    id: int
    risk_codes: list[RiskCodeOut] = []


# ───────────────────────────────── Binder ────────────────────────────────
# Estructura: Binder → Secciones → (Mercado + participación)
class SeccionMercadoIn(BaseModel):
    mercado_id: int
    participacion: Decimal | None = None


class SeccionMercadoOut(BaseModel):
    mercado_id: int
    participacion: Decimal | None = None
    mercado_nombre: str | None = None


class BinderSeccionIn(BaseModel):
    ramo: str | None = None
    risk_codes: list[str] = []
    limite_primas: Decimal | None = None
    notificacion: Decimal | None = None
    comision: Decimal | None = None
    sujeto_pc: bool = False
    mercados: list[SeccionMercadoIn] = []


class BinderSeccionOut(BaseModel):
    id: int
    ramo: str | None = None
    risk_codes: list[str] = []
    limite_primas: Decimal | None = None
    notificacion: Decimal | None = None
    comision: Decimal | None = None
    sujeto_pc: bool = False
    mercados: list[SeccionMercadoOut] = []


class BinderBase(BaseModel):
    agreement_number: str
    umr: str | None = None
    productor_id: int | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    estado: str | None = None
    moneda: str | None = None
    yoa: str | None = None
    notas: str | None = None


class BinderCreate(BinderBase):
    secciones: list[BinderSeccionIn] = []


class BinderUpdate(BinderBase):
    agreement_number: str | None = None
    secciones: list[BinderSeccionIn] | None = None


class BinderRead(BinderBase):
    id: int
    coverholder_nombre: str | None = None
    secciones: list[BinderSeccionOut] = []
    created_at: dt.datetime
    updated_at: dt.datetime
