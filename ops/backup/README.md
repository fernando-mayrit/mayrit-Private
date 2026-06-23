# Copia de seguridad de Mayrit (PostgreSQL → Synology)

Backup **lógico** (`pg_dump`) de la base de datos de Azure hacia un **NAS Synology**, pensado contra
**manipulación/corrupción de datos**: copia **independiente de Azure**, hecha con un usuario de
**solo lectura**, y con histórico **inmutable** gracias a las snapshots del NAS.

Es la **2ª capa**; la 1ª son los backups automáticos (PITR) de Azure, ya configurados.

## Ficheros
- `crear_usuario_backup.sql` — crea el usuario PostgreSQL de solo lectura `mayrit_backup`.
- `backup_mayrit.sh` — script que ejecuta el Synology (vía Docker) para volcar la BD.
- `mayrit-backup.env.example` — plantilla de config. La real (`mayrit-backup.env`, con la contraseña)
  **NO se sube a Git**; vive solo en el NAS con `chmod 600`.

## Puesta en marcha (una vez)

1. **Crear el usuario de solo lectura.** Conéctate a la BD `mayrit` como `aleaadmin` y ejecuta
   `crear_usuario_backup.sql` (cambia la contraseña). Guarda esa contraseña en el gestor de
   contraseñas y en `mayrit-backup.env`.

2. **Firewall de Azure.** Añade la **IP pública de la oficina** (la que sale el NAS) a las reglas de
   firewall del servidor PostgreSQL, para que el Synology pueda conectar.

3. **En el Synology:**
   - Instala **Container Manager** (Docker) y descarga la imagen `postgres:16` (o ≥ la del servidor).
   - Crea la carpeta de backups, p. ej. `/volume1/backups/mayrit`.
   - Copia ahí `backup_mayrit.sh` y `mayrit-backup.env` (desde la plantilla). Protege la config:
     `chmod 600 mayrit-backup.env` y `chmod 700 backup_mayrit.sh`.

4. **Programar (DSM > Panel de control > Programador de tareas):**
   - Nueva tarea programada → *Script definido por el usuario*, usuario **root**.
   - Frecuencia: diaria, de madrugada (p. ej. 03:00).
   - Comando: `bash /volume1/backups/mayrit/backup_mayrit.sh`
   - Lanza la tarea **a mano una vez** y revisa `backup.log` y que aparezca el `.dump`.

5. **Inmutabilidad (clave contra manipulación) — Snapshot Replication:**
   - Instala **Snapshot Replication** y activa **snapshots** del volumen/carpeta de backups.
   - Programa snapshots (p. ej. diarias) con **retención larga** (p. ej. 90 días) y, si tu modelo lo
     permite, marca las snapshots como **bloqueadas/inmutables (WORM)**. Así, aunque un atacante borre
     o cifre los `.dump`, el histórico en las snapshots **no se puede alterar ni borrar**.

## Restaurar (probar de vez en cuando)

Restaurar un dump a una base **nueva/limpia** (no machaques la de producción sin pensarlo):

```bash
# Crear primero una BD vacía 'mayrit_restore' (como aleaadmin) y luego:
docker run --rm -e PGPASSWORD='PASS_DE_ALEAADMIN' -v /volume1/backups/mayrit:/d postgres:16 \
  pg_restore -h tu-servidor.postgres.database.azure.com -U aleaadmin -d mayrit_restore \
  --no-owner --clean --if-exists /d/mayrit_AAAA-MM-DD_HHMM.dump
```

> **Haz una prueba de restore al menos una vez** (y cada cierto tiempo): un backup que no se ha
> probado a restaurar no es un backup fiable.

## Qué NO cubre esto (gestionar aparte)
- **Secretos:** `.env` de cada equipo, certificado `.pfx` de SharePoint (+ su contraseña), secreto de
  cliente de Entra. Guárdalos en el **gestor de contraseñas** (o Azure Key Vault). Sin ellos no se
  puede reconectar la app aunque tengas los datos.
- **Documentos de SharePoint/OneDrive:** los versiona Microsoft (papelera + historial).
- **Código:** ya está en GitHub.
