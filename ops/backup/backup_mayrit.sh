#!/bin/bash
# Backup lógico de la BD de Mayrit (PostgreSQL en Azure) a ESTE Synology, vía Docker (pg_dump).
# Pensado para lanzarse desde DSM > Programador de tareas (como root), p. ej. cada noche.
#
# - Usa un usuario PostgreSQL de SOLO LECTURA (mayrit_backup) -> no puede alterar datos.
# - Formato custom (-Fc): comprimido y restaurable selectivamente con pg_restore.
# - El histórico largo y la INMUTABILIDAD frente a manipulación los da el NAS (snapshots bloqueadas
#   de la carpeta de backups). Este script solo gestiona el disco con una rotación corta.
#
# Config (con credenciales) en mayrit-backup.env, JUNTO a este script y con chmod 600. NO va a Git.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="${1:-$DIR/mayrit-backup.env}"
[ -f "$CONF" ] || { echo "Falta el fichero de config: $CONF" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONF"

: "${PGHOST:?define PGHOST}" "${PGDATABASE:?define PGDATABASE}" "${PGUSER:?define PGUSER}"
: "${PGPASSWORD:?define PGPASSWORD}" "${BACKUP_DIR:?define BACKUP_DIR}"
PGPORT="${PGPORT:-5432}"
PGSSLMODE="${PGSSLMODE:-require}"        # Azure Flexible Server exige TLS; 'require' lo garantiza
RETEN_DIAS="${RETEN_DIAS:-30}"          # borra dumps locales con más de N días (el NAS guarda el resto)
PG_IMAGE="${PG_IMAGE:-postgres:16}"      # client pg_dump >= versión del servidor

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y-%m-%d_%H%M)"
OUT="$BACKUP_DIR/mayrit_${TS}.dump"
LOG="$BACKUP_DIR/backup.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

log "Inicio backup -> $OUT"
# pg_dump dentro de un contenedor efímero (no hay que instalar Postgres en el NAS). Azure exige SSL.
if docker run --rm -e PGPASSWORD="$PGPASSWORD" -e PGSSLMODE="$PGSSLMODE" "$PG_IMAGE" \
      pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
      --no-owner --no-privileges -Fc > "$OUT.tmp" 2>>"$LOG"; then
    if [ -s "$OUT.tmp" ]; then
        mv "$OUT.tmp" "$OUT"
        log "OK  $(du -h "$OUT" | cut -f1)  $OUT"
    else
        rm -f "$OUT.tmp"; log "ERROR: dump vacío"; exit 1
    fi
else
    rm -f "$OUT.tmp"; log "ERROR: pg_dump falló (ver log)"; exit 1
fi

# Rotación de disco (NO es la protección anti-borrado: eso son las snapshots inmutables del NAS).
find "$BACKUP_DIR" -maxdepth 1 -name 'mayrit_*.dump' -type f -mtime +"$RETEN_DIAS" -delete
log "Fin (rotación: borrados dumps locales > ${RETEN_DIAS} días)"
