#!/bin/bash
# Arranque en Azure App Service: lanza el servidor.
# Las migraciones de esquema (Alembic) NO se aplican aquí: con la separación de privilegios el
# usuario de runtime (mayrit_app) no tiene permisos DDL. Las aplica el ADMIN antes de desplegar,
# con `python migrar_mayrit.py` (ver ese script). Así un fallo/inyección en runtime no puede
# alterar el esquema.
set -e
exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120
