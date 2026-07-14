"""Cifrado de secretos del gestor de contraseñas.

Cifrado simétrico autenticado (Fernet = AES-128-CBC + HMAC-SHA256) con la clave en
`MAYRIT_VAULT_KEY`. Protege los secretos EN REPOSO en la base de datos: quien lea la BD a
pelo (backup, acceso directo) ve solo el token cifrado, no la contraseña.

NO es zero-knowledge: el servidor tiene la clave y puede descifrar, así que un compromiso del
propio servidor sí expondría los secretos. Es el nivel adecuado para un gestor interno detrás
del login de Entra; para el máximo (que ni el servidor pueda leerlos) haría falta un gestor pro
tipo Bitwarden. Ver la decisión razonada en docs/CONTEXTO.md.
"""
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


class VaultKeyMissing(RuntimeError):
    """No hay `MAYRIT_VAULT_KEY` configurada: el gestor de contraseñas no puede cifrar/descifrar."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = (settings.mayrit_vault_key or "").strip()
    if not key:
        raise VaultKeyMissing(
            "Falta MAYRIT_VAULT_KEY en el entorno (~/.mayrit/.env en local; App Setting enlazado a "
            "Key Vault en Azure). Genera una clave con:  python -m app.seguridad"
        )
    return Fernet(key.encode())


def cifrar(texto: str) -> str:
    """Cifra un secreto en claro y devuelve el token (str) que se guarda en la BD."""
    return _fernet().encrypt(texto.encode()).decode()


def descifrar(token: str) -> str:
    """Descifra un token guardado. Lanza ValueError si la clave no corresponde o el dato está corrupto."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise ValueError("No se pudo descifrar el secreto (clave incorrecta o dato corrupto).") from e


if __name__ == "__main__":
    # `python -m app.seguridad` imprime una clave nueva para pegar en MAYRIT_VAULT_KEY.
    # IMPORTANTE: la MISMA clave debe ir en todos los equipos y en Azure.
    print(Fernet.generate_key().decode())
