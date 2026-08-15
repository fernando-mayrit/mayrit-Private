@echo off
REM Sincroniza el registro DGSFP (aseguradoras <-> agencias de suscripcion) en la BD de Mayrit.
REM Lo ejecuta la Tarea Programada "Mayrit - Sync Agencias DGSFP" (mensual). Log en %TEMP%.
REM Las rutas de abajo son de ESTA maquina: al usarlo en otro equipo, ajusta la del repo y la del venv.
cd /d C:\Dev\mayrit\backend
echo [%date% %time%] --- sync agencias DGSFP --- >> "%TEMP%\mayrit_sync_dgsfp.log"
"C:\Users\ferna\.mayrit\venv\Scripts\python.exe" -m tools.sync_agencias_dgsfp >> "%TEMP%\mayrit_sync_dgsfp.log" 2>&1
