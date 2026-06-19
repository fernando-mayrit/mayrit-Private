@echo off
rem Lanzador VISIBLE de Mayrit. Abre dos ventanas (backend y frontend) y el navegador.
rem Detecta el venv en backend\.venv o en %USERPROFILE%\.mayrit\venv.
set PYTHONDONTWRITEBYTECODE=1
cd /d "%~dp0"

set "PY=%~dp0backend\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=%USERPROFILE%\.mayrit\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo No se encuentra el entorno de Python ^(venv^).
  echo Buscado en: %~dp0backend\.venv  y  %USERPROFILE%\.mayrit\venv
  pause
  exit /b 1
)

start "Mayrit backend"  cmd /k "cd /d "%~dp0backend" && "%PY%" -m uvicorn app.main:app --reload --port 8000"
start "Mayrit frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 6 >nul
start "" http://localhost:5173/
