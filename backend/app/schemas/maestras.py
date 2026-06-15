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
    codigo: str | None = None
    numero: int | None = None
    tipo: int | None = None
    es_coverholder: bool = False
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    notas: str | None = None
    sp_old_id: int | None = None


class ProductorCreate(ProductorBase):
    pass


class ProductorUpdate(BaseModel):
    nombre: str | None = None
    codigo: str | None = None
    numero: int | None = None
    tipo: int | None = None
    es_coverholder: bool | None = None
    cif: str | None = None
    domicilio: str | None = None
    codigo_postal: str | None = None
    localidad: str | None = None
    provincia: str | None = None
    pais: str | None = None
    contacto: str | None = None
    telefono: str | None = None
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


# ───────────────────────────────── Binder ────────────────────────────────
class BinderBase(BaseModel):
    titulo: str
    umr: str | None = None
    agreement_number: str | None = None
    referencia_bar: str | None = None
    coverholder: str | None = None
    mercado: str | None = None
    fecha_efecto: dt.date | None = None
    fecha_vencimiento: dt.date | None = None
    estado: str | None = None
    yoa: str | None = None
    moneda: str | None = None
    limite_primas: Decimal | None = None
    comision: Decimal | None = None
    comision_retenida: Decimal | None = None
    profit_commission: bool = False
    gwp: Decimal | None = None
    netto_uw: Decimal | None = None
    number_policies: int | None = None
    ramo: str | None = None
    numero_secciones: int | None = None
    ramo_seccion1: str | None = None
    ramo_seccion2: str | None = None
    ramo_seccion3: str | None = None
    ramo_seccion4: str | None = None
    intervalo_risk: str | None = None
    plazo_envio_risk: str | None = None
    intervalo_premium: str | None = None
    plazo_envio_premium: str | None = None
    intervalo_claims: str | None = None
    plazo_envio_claims: str | None = None
    plazo_pago: str | None = None
    cuenta: str | None = None
    claims_bdx: str | None = None
    notas: str | None = None


class BinderCreate(BinderBase):
    pass


class BinderUpdate(BinderBase):
    # Todos opcionales: en edición no es obligatorio reenviar el título.
    titulo: str | None = None


class BinderRead(BinderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime
