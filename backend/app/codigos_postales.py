"""
Búsqueda de códigos postales contra la base COMPARTIDA de Alea (tabla `codigos_postales`),
para autorrellenar localidad y provincia. Solo lectura, con el usuario propio de Mayrit.
"""
from sqlalchemy import create_engine, text

from .config import settings

# Engine independiente apuntando a la base 'alea' (datos compartidos).
_ref_engine = create_engine(settings.ref_database_url, pool_pre_ping=True, future=True)

_SQL = text(
    "SELECT DISTINCT localidad, provincia FROM codigos_postales "
    "WHERE codigo_postal = :cp ORDER BY localidad"
)


def buscar(cp: str) -> list[dict]:
    """Devuelve las localidades/provincia para un código postal (puede haber varias localidades)."""
    cp = (cp or "").strip()
    if not cp:
        return []
    with _ref_engine.connect() as conn:
        filas = conn.execute(_SQL, {"cp": cp}).all()
    return [{"localidad": loc, "provincia": prov} for loc, prov in filas]
