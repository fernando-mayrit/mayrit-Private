@echo off
REM Sincroniza la proyeccion de ingresos (D42 del Ppto 2026.xlsx) a la BD.
REM Lo ejecuta la Tarea Programada "Mayrit - Sync Proyeccion Ppto". Log en %TEMP%.
REM Las rutas de abajo son de ESTA maquina: al usarlo en otro equipo, ajusta la del repo y la del venv.
cd /d C:\Dev\mayrit\backend
echo [%date% %time%] --- sync proyeccion --- >> "%TEMP%\mayrit_sync_ppto.log"
"C:\Users\ferna\.mayrit\venv\Scripts\python.exe" -m tools.cargar_proyeccion_ingresos >> "%TEMP%\mayrit_sync_ppto.log" 2>&1
