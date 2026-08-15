"""
Aplica las migraciones de ALEMBIC de Mayrit como ADMIN (el rol DUEÑO de las tablas).

Con la separación de privilegios (como en Alea), la app corre como `mayrit_app` (SIN permisos DDL)
y las migraciones de esquema las aplica el ADMIN con este script. Sustituye al `alembic upgrade head`
que antes se lanzaba en el arranque del App Service (ya no puede correr ahí: runtime no tiene DDL).

Cómo se usa (en el equipo del admin, cuando hay migraciones nuevas, ANTES de desplegar a main):
    # con el venv de Mayrit activo (tiene alembic + psycopg)
    python migrar_mayrit.py
Pide usuario admin y contraseña. El host/puerto/base salen del .env; el usuario/contraseña se
fuerzan solo para esta ejecución (no tocan el .env).
"""
import os
import sys
from getpass import getpass

from alembic import command
from alembic.config import Config

admin = input("Usuario admin (dueño de las tablas): ").strip()
if not admin:
    print("Usuario vacío. Abortado.")
    sys.exit(1)
pw = getpass(f"Contraseña de {admin}: ")
if not pw:
    print("Contraseña vacía. Abortado.")
    sys.exit(1)

# Se fuerzan solo para esta ejecución; config.py los lee del entorno (tienen prioridad sobre el .env).
os.environ["PG_USER"] = admin
os.environ["PG_PASSWORD"] = pw

_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
cfg = Config(os.path.join(_BACKEND, "alembic.ini"))

print(f"Aplicando migraciones de Alembic como {admin} (host/base del .env)...")
command.upgrade(cfg, "head")
print("✅ Migraciones aplicadas (alembic upgrade head). Ya puedes desplegar a main.")
