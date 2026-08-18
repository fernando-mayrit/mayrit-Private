"""
Cierra DE VERDAD el candado que perseguía `crear_usuario_app.py`: deja las tablas en manos del
usuario ADMIN y a `mayrit_app` (el usuario con el que corre la app) solo con permiso para leer y
escribir DATOS, nunca para tocar la ESTRUCTURA.

POR QUÉ HACE FALTA (comprobado contra la BD real el 2026-08-18): `mayrit_app` es hoy el DUEÑO de
todas las tablas, y el dueño de una tabla siempre puede alterarla o borrarla por mucho que se le
quiten permisos. Es decir: el candado estaba puesto pero no cerraba. Con este script la propiedad
pasa al admin, se revoca la capacidad de crear objetos y se vuelven a conceder los permisos de datos
que la app (y Power BI) necesitan para seguir funcionando igual.

CÓMO SE USA (desde un equipo con el venv de Mayrit activo):
    python blindar_esquema.py              # SIMULACRO: enseña qué haría, sin tocar nada
    python blindar_esquema.py --aplicar    # lo hace de verdad

Pide por teclado el usuario y la contraseña del ADMIN (el que puede administrar la base, p. ej.
`aleaadmin`). No hay contraseñas dentro de este fichero ni se escriben en ningún sitio.

DESPUÉS DE APLICARLO, OJO: `alembic upgrade head` a secas dejará de funcionar desde los equipos
(su .env usa `mayrit_app`, que ya no podrá crear tablas). Las migraciones se aplican con
`python migrar_mayrit.py`, que pide el admin. Si alguien se lo salta, la propia app lo avisa en rojo
(aviso `esquema_desfasado`).
"""
import sys
from getpass import getpass

import psycopg

sys.path.insert(0, "backend")
from app.config import settings  # noqa: E402

APP_ROLE = "mayrit_app"          # usuario con el que corre la app (runtime)
BI_ROLE = "mayrit_bi"            # usuario de solo lectura para Power BI


def _conteo_objetos(cur, rol: str) -> dict:
    """Qué posee `rol` en la base: tablas, vistas y secuencias."""
    cur.execute(
        """
        SELECT CASE c.relkind WHEN 'r' THEN 'tablas' WHEN 'v' THEN 'vistas'
                              WHEN 'S' THEN 'secuencias' WHEN 'm' THEN 'vistas materializadas'
                              ELSE c.relkind::text END AS tipo,
               count(*)
        FROM pg_class c
        JOIN pg_roles r ON c.relowner = r.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public' AND r.rolname = %s AND c.relkind IN ('r','v','S','m')
        GROUP BY 1 ORDER BY 1
        """,
        (rol,),
    )
    return {t: n for t, n in cur.fetchall()}


def _informe(cur, titulo: str, admin: str) -> None:
    print(f"\n── {titulo} ──")
    print(f"  Objetos de {APP_ROLE}: {_conteo_objetos(cur, APP_ROLE) or 'ninguno'}")
    print(f"  Objetos de {admin}:   {_conteo_objetos(cur, admin) or 'ninguno'}")
    cur.execute("SELECT has_schema_privilege(%s, 'public', 'CREATE')", (APP_ROLE,))
    print(f"  ¿{APP_ROLE} puede CREAR tablas?: {'SÍ ⚠️' if cur.fetchone()[0] else 'NO ✅'}")
    for rol, priv in ((APP_ROLE, "INSERT"), (APP_ROLE, "SELECT"), (BI_ROLE, "SELECT")):
        cur.execute(
            "SELECT count(*) FROM information_schema.tables t "
            "WHERE t.table_schema='public' AND t.table_type='BASE TABLE' "
            "  AND NOT has_table_privilege(%s, format('public.%%I', t.table_name), %s)",
            (rol, priv),
        )
        faltan = cur.fetchone()[0]
        estado = "✅ todas" if faltan == 0 else f"⚠️ le faltan {faltan}"
        print(f"  ¿{rol} tiene {priv} en las tablas?: {estado}")


def main() -> int:
    aplicar = "--aplicar" in sys.argv
    if not settings.pg_host:
        print("ERROR: falta PG_HOST en ~/.mayrit/.env.")
        return 1

    print(f"Base de datos: {settings.pg_host}/{settings.pg_database}")
    admin = input("Usuario ADMIN de la base (p. ej. aleaadmin): ").strip()
    if not admin:
        print("Sin usuario admin. Abortado.")
        return 1
    if admin == APP_ROLE:
        print(f"ERROR: el admin no puede ser {APP_ROLE} (es justo el que queremos limitar).")
        return 1
    pwd = getpass(f"Contraseña de {admin}: ")
    if not pwd:
        print("Sin contraseña. Abortado.")
        return 1

    conninfo = (
        f"host={settings.pg_host} port={settings.pg_port} dbname={settings.pg_database} "
        f"user={admin} password={pwd} sslmode={settings.pg_sslmode}"
    )

    # Las órdenes, en orden. Cada una es idempotente: se puede repetir sin estropear nada.
    ordenes = [
        # 1. La propiedad de TODO lo que hoy es de la app pasa al admin (incluye tablas, vistas,
        #    secuencias e índices). A partir de aquí, la app ya no es dueña de nada.
        (f'REASSIGN OWNED BY "{APP_ROLE}" TO "{admin}"',
         "pasar la propiedad de los objetos al admin"),
        # 2. Quitarle la llave: sin CREATE en el esquema no puede fabricar tablas nuevas.
        (f'REVOKE CREATE ON SCHEMA public FROM "{APP_ROLE}"',
         "quitar a la app el permiso de crear objetos"),
        # 3. Devolverle lo que SÍ necesita para trabajar: leer y escribir datos.
        (f'GRANT USAGE ON SCHEMA public TO "{APP_ROLE}"', "acceso al esquema"),
        (f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{APP_ROLE}"',
         "permisos de datos para la app"),
        (f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{APP_ROLE}"',
         "contadores (ids autoincrementales)"),
        # 4. Power BI, solo lectura (sus permisos venían del antiguo dueño y hay que rehacerlos).
        (f'GRANT USAGE ON SCHEMA public TO "{BI_ROLE}"', "acceso al esquema para Power BI"),
        (f'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{BI_ROLE}"', "lectura para Power BI"),
        # 5. Que lo FUTURO (tablas de próximas migraciones, creadas por el admin) herede lo mismo,
        #    sin tener que volver a ejecutar este script.
        (f'ALTER DEFAULT PRIVILEGES FOR ROLE "{admin}" IN SCHEMA public '
         f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{APP_ROLE}"',
         "herencia de permisos en tablas futuras (app)"),
        (f'ALTER DEFAULT PRIVILEGES FOR ROLE "{admin}" IN SCHEMA public '
         f'GRANT USAGE, SELECT ON SEQUENCES TO "{APP_ROLE}"',
         "herencia en contadores futuros (app)"),
        (f'ALTER DEFAULT PRIVILEGES FOR ROLE "{admin}" IN SCHEMA public '
         f'GRANT SELECT ON TABLES TO "{BI_ROLE}"',
         "herencia de lectura en tablas futuras (Power BI)"),
    ]

    with psycopg.connect(conninfo, autocommit=True) as con:
        cur = con.cursor()
        cur.execute("SELECT current_user")
        print(f"Conectado como: {cur.fetchone()[0]}")
        _informe(cur, "ANTES", admin)

        if not aplicar:
            print("\n── SIMULACRO: no se ha tocado nada. Se ejecutarían estas órdenes ──")
            for sql, que in ordenes:
                print(f"  · {que}\n      {sql}")
            print("\nCuando lo veas bien:  python blindar_esquema.py --aplicar")
            return 0

        print("\n── APLICANDO ──")
        for sql, que in ordenes:
            print(f"  · {que} …", end=" ")
            try:
                cur.execute(sql)
                print("ok")
            except Exception as e:
                print(f"ERROR: {e}")
                print("\n⚠️  Se ha parado aquí. Nada de lo anterior se deshace solo; revisa el error")
                print("    y vuelve a lanzarlo (las órdenes se pueden repetir sin daño).")
                return 1

        _informe(cur, "DESPUÉS", admin)
        print("\n✅ LISTO. La app sigue leyendo y escribiendo igual, pero ya no puede alterar la")
        print("   estructura de la base de datos.")
        print("   RECUERDA: las migraciones, a partir de ahora, con `python migrar_mayrit.py`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
