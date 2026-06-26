"""Configuración leída del entorno o de ~/.mayrit/.env (fuera de OneDrive)."""
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV = os.path.join(os.path.expanduser("~"), ".mayrit", ".env")
_ENV_ALEA = os.path.join(os.path.expanduser("~"), ".alea", ".env")

# Plantillas Word incluidas en el repo (fallback para Azure, donde no existe la carpeta de OneDrive).
_PLANTILLAS_REPO = os.path.join(os.path.dirname(__file__), "plantillas")


def _resolver_plantilla(preferida: str, nombre: str) -> str:
    """Devuelve la plantilla de OneDrive si existe (uso local, así se editan en su sitio); si no
    (p. ej. en Azure), la copia incluida en el repo (backend/app/plantillas/<nombre>)."""
    if preferida and os.path.isfile(preferida):
        return preferida
    return os.path.join(_PLANTILLAS_REPO, nombre)


def _leer_env(path: str) -> dict:
    d: dict = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if ln and not ln.startswith("#") and "=" in ln:
                    k, _, v = ln.partition("=")
                    d[k.strip()] = v.strip().strip('"').strip("'")
    return d


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV, env_file_encoding="utf-8", extra="ignore")

    pg_host: str = ""
    pg_port: int = 5432
    pg_database: str = "mayrit"
    pg_user: str = ""
    pg_password: str = ""
    pg_sslmode: str = "require"

    # Usuario asignado a ESTE equipo (autologin): MAYRIT_USUARIO en ~/.mayrit/.env.
    mayrit_usuario: str = ""

    # Datos de referencia COMPARTIDOS con Alea (mismo servidor, base 'alea'): p. ej. el
    # callejero de códigos postales. Se leen con el propio usuario de Mayrit (solo lectura).
    pg_database_ref: str = "alea"

    # SharePoint (SOLO LECTURA): puente para traer los BDX históricos del sitio Mayrit-Negocio.
    # Autenticación por certificado (mismo app/cert que Alea). Credenciales en ~/.mayrit/.env.
    sp_site_url: str = ""
    sp_tenant_id: str = ""
    sp_client_id: str = ""
    sp_pfx_path: str = ""
    sp_pfx_password: str = ""

    # Plantilla Word (tokens) para generar los FDO/LPAN (formulario London Premium Advice Note).
    lpan_plantilla: str = (
        r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Negocio - Documentos"
        r"\Documentacion\Plantillas\Plantilla LPAN.dotx"
    )

    # Plantilla Word (tokens) para las facturas de Consultoría (honorarios). La ruta LOCAL (OneDrive)
    # se usa si existe; en Azure no existe y se cae a la copia del repo (ver `factura_plantilla`).
    factura_plantilla_local: str = (
        r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Negocio - Documentos"
        r"\Documentacion\Plantillas\Plantilla Factura.dotx"
    )
    # Plantilla Word (tokens) para las facturas de Comisiones (mismos tokens que la de Consultoría).
    comisiones_plantilla_local: str = (
        r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Negocio - Documentos"
        r"\Documentacion\Plantillas\Plantilla Factura Comisiones.dotx"
    )
    # Carpeta base de facturas emitidas. La factura se guarda en
    # <facturas_dir>\<año>\Facturas Emitidas\<Cliente>\<numero> <Cliente> <Mes>.docx
    facturas_dir: str = (
        r"C:\Users\ferna\Mayrit Insurance Broker\Mayrit - Sociedad - Documentos"
        r"\Societario\Cuentas"
    )

    @property
    def factura_plantilla(self) -> str:
        return _resolver_plantilla(self.factura_plantilla_local, "Plantilla Factura.dotx")

    @property
    def comisiones_plantilla(self) -> str:
        return _resolver_plantilla(self.comisiones_plantilla_local, "Plantilla Factura Comisiones.dotx")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}?sslmode={self.pg_sslmode}"
        )

    @property
    def ref_database_url(self) -> str:
        """Conexión de SOLO LECTURA a la base 'alea' para datos compartidos (p. ej. códigos
        postales). Reutiliza las credenciales de Alea (~/.alea/.env), que tienen permiso de
        lectura sobre esas tablas; si no existen, cae a las de Mayrit."""
        alea = _leer_env(_ENV_ALEA)
        user = alea.get("PG_USER") or self.pg_user
        pwd = alea.get("PG_PASSWORD") or self.pg_password
        host = alea.get("PG_HOST") or self.pg_host
        db = alea.get("PG_DATABASE") or self.pg_database_ref
        return (
            f"postgresql+psycopg://{user}:{pwd}@{host}:{self.pg_port}/{db}?sslmode={self.pg_sslmode}"
        )


settings = Settings()
