#!/bin/bash
# Arranque en Azure App Service: aplica migraciones pendientes y lanza el servidor.
# (La BD es compartida y suele estar ya al día → alembic será un no-op.)
set -e
python -m alembic upgrade head || echo "Aviso: alembic upgrade falló (se continúa)."
exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120
