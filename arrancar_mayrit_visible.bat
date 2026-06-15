@echo off
rem Lanzador VISIBLE de Mayrit (para diagnóstico). Abre dos ventanas: backend y frontend.
rem Para uso normal usa el acceso directo del Escritorio (silencioso).
set PYTHONDONTWRITEBYTECODE=1
cd /d "%~dp0"
start "Mayrit backend"  cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "Mayrit frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 6 >nul
start "" http://localhost:5173/
