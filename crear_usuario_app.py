"""
Crea (o actualiza) el rol Postgres `mayrit_app`: usuario de APLICACIÓN con permisos LIMITADOS
— solo SELECT/INSERT/UPDATE/DELETE sobre la base `mayrit`. NO puede crear/alterar/borrar tablas
ni administrar el servidor. Es el usuario que usará la app en runtime (local y Azure). El usuario
DUEÑO actual de las tablas queda como ADMIN, reservado para migraciones de esquema (Alembic, vía
`migrar_mayrit.py`). Réplica del modelo de Alea (`alea_app` + `aleaadmin`).

Cómo se usa (UNA vez, desde un equipo cuyo ~/.mayrit/.env TODAVÍA tenga el usuario dueño/admin):
    # con el venv de Mayrit activo (tiene psycopg)
    python crear_usuario_app.py
Te pedirá una contraseña NUEVA para mayrit_app (elígela tú; la necesitarás para configurar cada
equipo y Azure). Es idempotente: si el rol ya existe, solo actualiza contraseña/permisos.
"""
import os
import sys
from getpass import getpass

import psycopg

# Permite importar el paquete 'app' (el backend) para leer la config (host/base, no secretos).
_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
sys.path.insert(0, _BACKEND)
from app.config import settings  # noqa: E402

APP_ROLE = "mayrit_app"


def main() -> int:
    admin = (settings.pg_user or "").strip()
    if not settings.pg_host or not admin:
        print("ERROR: faltan PG_HOST/PG_USER en ~/.mayrit/.env.")
        return 1
    if admin.lower() == APP_ROLE:
        print(f"⚠️  El .env de este equipo ya usa '{APP_ROLE}', que NO puede crear roles.")
        print("    Restaura temporalmente PG_USER al usuario dueño/admin y reintenta.")
        return 1
    print(f"Conectando como '{admin}' a {settings.pg_host}/{settings.pg_database} ...")

    pw1 = getpass(f"Contraseña NUEVA para {APP_ROLE}: ")
    pw2 = getpass("Repite la contraseña: ")
    if not pw1 or pw1 != pw2:
        print("Las contraseñas no coinciden (o están vacías). Abortado.")
        return 1

    conninfo = (
        f"host={settings.pg_host} port={settings.pg_port} dbname={settings.pg_database} "
        f"user={admin} password={settings.pg_password} sslmode={settings.pg_sslmode}"
    )
    db = settings.pg_database
    with psycopg.connect(conninfo, autocommit=True) as con:
        cur = con.cursor()
        existe = cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_ROLE,)).fetchone()
        if existe:
            cur.execute(f"ALTER ROLE {APP_ROLE} WITH LOGIN PASSWORD %s", (pw1,))
            print(f"Rol {APP_ROLE} ya existía → contraseña actualizada.")
        else:
            cur.execute(f"CREATE ROLE {APP_ROLE} WITH LOGIN PASSWORD %s", (pw1,))
            print(f"Rol {APP_ROLE} creado.")

        # Permisos: solo DML sobre la base. Nada de DDL ni administración.
        for sql in [
            f"GRANT CONNECT ON DATABASE {db} TO {APP_ROLE}",
            f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}",
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}",
            f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}",
            # Privilegios por defecto: las tablas/secuencias FUTURAS que cree el admin (en
            # migraciones) se conceden solas a mayrit_app, sin re-ejecutar este script.
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {admin} IN SCHEMA public "
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}",
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {admin} IN SCHEMA public "
            f"GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}",
        ]:
            cur.execute(sql)

    print("Permisos DML concedidos (+ privilegios por defecto para tablas futuras).")
    print(f"✅ LISTO. Ahora pon PG_USER={APP_ROLE} (+ su contraseña) en cada ~/.mayrit/.env")
    print("   (actualizar_a_usuario_app.bat) y en las Application settings del App Service en Azure.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
