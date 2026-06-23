-- Usuario PostgreSQL de SOLO LECTURA para los backups: puede leer todo (lo que necesita pg_dump)
-- pero NO puede alterar datos. Si le roban estas credenciales, no pueden corromper la BD.
--
-- Ejecutar UNA VEZ como 'aleaadmin' (admin del servidor) sobre la base 'mayrit'.
-- Sustituye la contraseña por una fuerte y guárdala en el gestor de contraseñas + en mayrit-backup.env.

CREATE ROLE mayrit_backup WITH LOGIN PASSWORD 'CAMBIA_ESTA_PASSWORD';
GRANT CONNECT ON DATABASE mayrit TO mayrit_backup;

-- PostgreSQL 14+ (Azure Flexible Server): rol predefinido que da lectura de TODO. Ideal para pg_dump.
GRANT pg_read_all_data TO mayrit_backup;

-- (Para PostgreSQL < 14, en lugar de la línea anterior:)
--   GRANT USAGE ON SCHEMA public TO mayrit_backup;
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO mayrit_backup;
--   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO mayrit_backup;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mayrit_backup;
