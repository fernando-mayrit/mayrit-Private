"""
Lector de SharePoint (SOLO LECTURA) para traer los BDX históricos del sitio Mayrit-Negocio.

Cada binder tiene su propia lista `Mayrit - <UMR>` (anti-patrón "una tabla por binder")
con las líneas del bordereau Risk (que incluye las columnas de Premium). Este módulo:
  - autentica por certificado (mismo enfoque que tools/inspeccionar_sharepoint.py),
  - lee una lista y mapea sus columnas a los campos de `BdxLinea` por el TÍTULO visible
    (estable entre listas; el InternalName de SharePoint varía).

No escribe nada. La importación a Postgres se hace en otro paso, controlada y binder a binder.
"""
from __future__ import annotations

import re

from .config import settings

# Mapeo campo_modelo -> Título visible de la columna en SharePoint (Lloyd's Coverholder
# Reporting Standard + columnas internas de Mayrit). Se compara normalizando espacios.
MAPEO: dict[str, str] = {
    # Periodo de reporte (por línea)
    "reporting_period_start": "Reporting Period Start Date",
    "reporting_period_end": "Reporting Period (End Date)",
    # Identificación
    "section_no": "Section No",
    "class_of_business": "Class of Business",
    "risk_code": "Risk Code",
    "type_of_insurance": "Type of Insurance (Direct or Reinsurance)",
    "certificate_ref": "Certificate Ref",
    # Asegurado
    "insured_name": "Insured Full Name, Last Name or Company Name",
    "insured_id": "ID Insured/Policyholder",
    "insured_address": "Insured Address",
    "insured_province": "Insured Country Sub-division: State, Province, Territory, Canton",
    "insured_postcode": "Insured Postcode, Zip Code or Similar",
    "insured_country": "Insured Country (see code list)",
    # Riesgo
    "risk_inception_date": "Risk Inception Date",
    "risk_expiry_date": "Risk Expiry Date",
    "location_risk_province": "Location of Risk - Country Sub-division: State, Province, Territ",
    "location_risk_country": "Location of risk - Country (Location ID)",
    "risk_transaction_type": ["Risk Transaction Type"],
    "transaction_type": ["Transaction Type"],
    "effective_date_transaction": "Effective Date of Transaction",
    "expiry_date_transaction": "Expiry Date of Transaction",
    # Prima
    "original_currency": "Original Currency Premium",  # en el origen esta columna trae la MONEDA (EUR)
    # Algunas plantillas no traen "Gross Written Premium" (100%); en su lugar usan
    # "Gross Premium paid this time" (cuando la línea suscrita es el 100%, coincide con Our Line).
    "gross_written_premium": ["Gross Written Premium", "Gross Premium paid this time"],
    "written_line_pct": "Written Line (%)",
    "total_gwp_our_line": "Total Gross Written Premium (Our line)",
    "fees": ["Fees"],
    # La plantilla varía por binder: en unas listas es "Commission %/Amount" y en otras
    # "Commission Coverholder %/Amount". Se prueban los alias en orden.
    "commission_coverholder_pct": ["Commission Coverholder %", "Commission %"],
    "commission_coverholder_amount": ["Commission Coverholder Amount", "Commission Amount"],
    "total_taxes_levies": "Total Taxes and Levies",
    "total_gwp_including_tax": "Gross Premium including tax (Our Line)",
    "net_premium_to_broker": "Net Premium to Lloyd´s Broker in original currency",
    # Suma asegurada / deducible
    "sum_insured_total": "Sum Insured Currency (see code list)",  # en el origen esta columna trae el IMPORTE (100 %)
    "sum_insured_our_line": ["Sum insured Our Line", "Sum insured Amount"],
    "deductible_amount": "Deductible Amount",
    "deductible_basis": "Deductible Basis (eec)",
    # Impuestos 1–4
    "tax1_jurisdiction": "Tax 1 - Jurisdiction: Country, Province",
    "tax1_type": "Tax 1 - Tax Type",
    "tax1_taxable_premium": "Tax 1 - Amount of Taxable Premium",
    "tax1_pct": "Tax 1 - %",
    "tax1_amount": "Tax 1 - Amount",
    "tax1_administered_by": "Tax 1 - Administered By",
    "tax1_payable_by": "Tax 1 - Payable By",
    "tax2_jurisdiction": "Tax 2 - Jurisdiction: Country, Province",
    "tax2_type": "Tax 2 - Tax Type",
    "tax2_taxable_premium": "Tax 2 - Amount of Taxable Premium",
    "tax2_pct": "Tax 2 - %",
    "tax2_amount": "Tax 2 - Amount",
    "tax2_administered_by": "Tax 2 - Administered By",
    "tax2_payable_by": "Tax 2 - Payable By",
    "tax3_jurisdiction": "Tax 3 - Jurisdiction: Country, Province",
    "tax3_type": "Tax 3 - Tax Type",
    "tax3_taxable_premium": "Tax 3 - Amount of Taxable Premium",
    "tax3_pct": "Tax 3 - %",
    "tax3_amount": "Tax 3 - Amount",
    "tax3_administered_by": "Tax 3 - Administered By",
    "tax3_payable_by": "Tax 3 - Payable By",
    "tax4_jurisdiction": "Tax 4 - Jurisdiction: Country, Province",
    "tax4_type": "Tax 4 - Tax Type",
    "tax4_taxable_premium": "Tax 4 - Amount of Taxable Premium",
    "tax4_pct": "Tax 4 - %",
    "tax4_amount": "Tax 4 - Amount",
    "tax4_administered_by": "Tax 4 - Administered By",
    "tax4_payable_by": "Tax 4 - Payable By",
    # Plazos / Lloyd's / brokerage
    "instalment_number": "Instalment Number",
    "number_of_instalments": "Number of Instalments",
    "referred_to_london": "Referred to London Yes/No",
    "pct_for_lloyds": "% for Lloyd's",
    "policy_issuance_date": "Policy issuance date",
    "policy_number_reinsured": "Policy Number Reinsured",
    "brokerage_pct": "Brokerage % of gross premium",
    "brokerage_amount": "Brokerage Amount (Original Currency)",
    "final_net_premium_uw": "Final Net Premium to UW (Original Currency)",
    # Premium (subconjunto)
    "incluido_en_premium": "Incluido en Premium",
    "premium_bdx": "Premium Bdx",
    # Control interno
    "prima_cobrada": "PrimaCobrada",
    "ingresado": "Ingresado",
    "premium_payment_date": "Premium Payment Date by Coverholder",
    "traspaso": "Traspaso",
    "traspasado": "Traspasado",
    "fecha_traspaso": "Fecha Traspaso",
    "liquidado": "Liquidado",
    "liquidado_uw": "Liquidado al UW",
    "fecha_liquidacion": "Fecha Liquidacion",
    "recibo": "Recibo",
    "notas": "Notas",
    # Clave de origen para casar/idempotencia
    "sp_old_id": "_OldID",
}


# Campos de fecha: SIEMPRE se devuelven sin hora (aaaa-mm-dd).
DATE_FIELDS: set[str] = {
    "reporting_period_start",
    "reporting_period_end",
    "risk_inception_date",
    "risk_expiry_date",
    "effective_date_transaction",
    "expiry_date_transaction",
    "policy_issuance_date",
    "premium_bdx",
    "premium_payment_date",
    "fecha_traspaso",
    "fecha_liquidacion",
}


def _norm(s: str | None) -> str:
    """Normaliza un título de columna para comparar (colapsa espacios, recorta)."""
    return re.sub(r"\s+", " ", (s or "").strip())


def _solo_fecha(v):
    """Devuelve la fecha (aaaa-mm-dd) SIN hora a partir de lo que dé SharePoint:
    ISO '2018-06-28T07:00:00Z', texto 'dd/mm/aaaa', o ya 'aaaa-mm-dd'. Si no se reconoce,
    devuelve el valor tal cual."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)          # ISO (con o sin hora)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)       # dd/mm/aaaa
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return s


def _cert_pem_thumb(pfx: str, pwd: str) -> tuple[str, str]:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
        pkcs12,
    )

    with open(pfx, "rb") as f:
        data = f.read()
    key, cert, _ = pkcs12.load_key_and_certificates(data, pwd.encode() if pwd else None)
    if key is None or cert is None:
        raise RuntimeError(f"El .pfx '{pfx}' no contiene clave privada + certificado válidos.")
    pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    return pem, cert.fingerprint(hashes.SHA1()).hex().upper()


def get_context():
    """Devuelve un ClientContext autenticado por certificado (solo lectura)."""
    if not settings.sp_site_url or not settings.sp_pfx_path:
        raise RuntimeError("SharePoint no configurado (faltan SP_SITE_URL / SP_PFX_PATH en ~/.mayrit/.env).")
    from office365.sharepoint.client_context import ClientContext

    pem, thumb = _cert_pem_thumb(settings.sp_pfx_path, settings.sp_pfx_password)
    return ClientContext(settings.sp_site_url).with_client_certificate(
        tenant=settings.sp_tenant_id,
        client_id=settings.sp_client_id,
        thumbprint=thumb,
        private_key=pem,
    )


# ── Pólizas (Open Market): lista única `Mayrit - TPolizas` → campos del modelo Poliza ──
MAPEO_POLIZAS: dict[str, str] = {
    "numero_poliza": "NumeroPoliza",
    "asegurado": "Asegurado",
    "corredor": "Corredor",
    "ramo": "Ramo",
    "mercado": "Mercado",
    "produccion": "Produccion",
    "tipo_documento": "TipoDocumento",
    "estado": "Estado",
    "seguro": "Seguro",
    "pago": "Pago",
    "moneda": "Moneda",
    "fecha_efecto": "FechaEfecto",
    "fecha_vencimiento": "FechaVencimiento",
    "renovacion_automatica": "RenovacionAutomatica",
    "coaseguro": "Coaseguro",
    "limite": "Limite",
    "franquicia": "Franquicia",
    "capacidad": "Capacidad",
    "prima_neta": "PrimaNeta",
    "impuestos_porc": "ImpuestosPerc",
    "impuestos": "Impuestos",
    "recargos": "Recargos",
    "prima_total": "PrimaTotal",
    "comision_porc": "ComisionPerc",
    "comision_total": "ComisionTotal",
    "prima_participacion": "PrimaParticipacion",
}
DATE_FIELDS_POLIZAS = {"fecha_efecto", "fecha_vencimiento"}


def leer_lista(list_title: str, mapeo: dict, date_fields: set[str]) -> list[dict]:
    """Lee TODAS las filas de `list_title` y las devuelve mapeadas a los campos de `mapeo`
    (campo_modelo → título/alias de columna). Empareja por TÍTULO visible (estable entre listas;
    el InternalName varía). Cada fila incluye `_sp_id` (Id del elemento en SharePoint).
    Valores tal cual los da SharePoint; la coerción de tipos se hace al importar."""
    ctx = get_context()
    lst = ctx.web.lists.get_by_title(list_title)
    campos = lst.fields
    ctx.load(campos)
    ctx.execute_query()
    titulos = [(_norm(f.properties.get("Title")).lower(), f.properties.get("InternalName")) for f in campos]

    def resolver(aliases) -> str | None:
        opts = [aliases] if isinstance(aliases, str) else aliases
        normados = [_norm(a).lower() for a in opts]
        for a in normados:
            for t, intn in titulos:
                if t == a:
                    return intn
        for a in normados:
            for t, intn in titulos:
                if t.startswith(a):
                    return intn
        return None

    internal_de = {campo: resolver(aliases) for campo, aliases in mapeo.items()}

    items = lst.items.get_all().execute_query()
    filas: list[dict] = []
    for it in items:
        props = it.properties
        fila: dict = {"_sp_id": props.get("Id")}
        for campo, internal in internal_de.items():
            valor = props.get(internal) if internal else None
            if valor is None and internal and internal.startswith("_"):
                valor = props.get("OData_" + internal)
            fila[campo] = _solo_fecha(valor) if campo in date_fields else valor
        filas.append(fila)
    return filas


def leer_lista_bdx(list_title: str) -> list[dict]:
    """Líneas de un BDX (`Mayrit - <UMR>`) mapeadas a los campos de BdxLinea."""
    return leer_lista(list_title, MAPEO, DATE_FIELDS)


def leer_lista_polizas(list_title: str = "Mayrit - TPolizas") -> list[dict]:
    """Pólizas (Open Market) mapeadas a los campos de Poliza."""
    return leer_lista(list_title, MAPEO_POLIZAS, DATE_FIELDS_POLIZAS)


# ── Tomadores (TClientes) → campos del modelo Tomador ──
MAPEO_CLIENTES: dict[str, str] = {
    "nombre": "NombreCliente",
    "tipo": "TipoCliente",
    "cif": "CIF",
    "domicilio": "Domicilio",
    "codigo_postal": "CodigoPostal",
    "localidad": "Localidad",
    "provincia": "Provincia",
    "pais": "Pais",
}


def leer_lista_tomadores(list_title: str = "Mayrit - TClientes") -> list[dict]:
    """Tomadores (clientes) mapeados a los campos de Tomador."""
    return leer_lista(list_title, MAPEO_CLIENTES, set())


# ── Corredores (TCorredores) → campos del modelo Productor ──
MAPEO_CORREDORES: dict[str, str] = {
    "alias": "IdCorredor",
    "nombre": "NombreCorredor",
    "tipo_corredor": "TipoCorredor",  # 1 → Persona jurídica, 2 → Persona física
    "coverholder": "Coverholder",   # True → Agencia de Suscripción, False → Corredor
    "cif": "CIF",
    "domicilio": "Domicilio",
    "codigo_postal": "CodigoPostal",
    "localidad": "Localidad",
    "provincia": "Provincia",
    "pais": "Pais",
    "notas": "Notas",
}


def leer_lista_corredores(list_title: str = "Mayrit - TCorredores") -> list[dict]:
    """Corredores mapeados a los campos de Productor."""
    return leer_lista(list_title, MAPEO_CORREDORES, set())
