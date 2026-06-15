"""
Inspecciona (SOLO LECTURA) las listas de SharePoint del sitio configurado en
~/.mayrit/.env y vuelca su ESQUEMA (listas + campos), SIN leer datos de negocio.
Sirve para modelar las tablas nuevas sobre los campos reales del Access/SharePoint.

Uso:  python backend/tools/inspeccionar_sharepoint.py
Requiere: Office365-REST-Python-Client, cryptography  (pip install -r backend/requirements.txt)
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from office365.sharepoint.client_context import ClientContext

ENV = os.path.join(os.path.expanduser("~"), ".mayrit", ".env")


def cargar_env():
    if not os.path.exists(ENV):
        sys.exit(f"No existe {ENV}. Copia backend/.env.example y rellénalo.")
    with open(ENV, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#") or "=" not in ln:
                continue
            k, _, v = ln.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def cert_pem_thumb(pfx, pwd):
    from cryptography.hazmat.primitives.serialization import (
        pkcs12, Encoding, PrivateFormat, NoEncryption,
    )
    from cryptography.hazmat.primitives import hashes
    with open(pfx, "rb") as f:
        data = f.read()
    key, cert, _ = pkcs12.load_key_and_certificates(data, pwd.encode() if pwd else None)
    if key is None or cert is None:
        sys.exit(f"El .pfx '{pfx}' no contiene clave privada + certificado válidos.")
    pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    return pem, cert.fingerprint(hashes.SHA1()).hex().upper()


def get_context():
    pem, thumb = cert_pem_thumb(os.environ["SP_PFX_PATH"], os.environ.get("SP_PFX_PASSWORD", ""))
    return ClientContext(os.environ["SP_SITE_URL"]).with_client_certificate(
        tenant=os.environ["SP_TENANT_ID"],
        client_id=os.environ["SP_CLIENT_ID"],
        thumbprint=thumb,
        private_key=pem,
    )


def main():
    cargar_env()
    ctx = get_context()
    web = ctx.web
    ctx.load(web)
    ctx.execute_query()
    print("Sitio:", web.properties.get("Title"), "|", os.environ["SP_SITE_URL"])

    listas = ctx.web.lists
    ctx.load(listas)
    ctx.execute_query()
    visibles = [l for l in listas if not l.properties.get("Hidden")]
    print(f"Listas visibles: {len(visibles)}")
    print("=" * 72)
    for l in sorted(visibles, key=lambda x: (x.properties.get("Title") or "")):
        titulo = l.properties.get("Title")
        n = l.properties.get("ItemCount")
        print(f"\n## {titulo}  ({n} elementos)")
        campos = l.fields
        ctx.load(campos)
        ctx.execute_query()
        for fld in campos:
            p = fld.properties
            if p.get("Hidden") or p.get("ReadOnlyField"):
                continue
            print(f"   - {p.get('Title')}  [{p.get('InternalName')}]  {p.get('TypeAsString')}")


if __name__ == "__main__":
    main()
