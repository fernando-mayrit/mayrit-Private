' Arranca SOLO los servidores de Mayrit (backend 8000 + frontend 5173) OCULTOS, sin abrir
' el navegador. Pensado para el AUTOARRANQUE al iniciar sesión: así la app (instalada como
' aplicación / PWA) abre al instante porque los servidores ya están en marcha.
Option Explicit
Dim sh, fso, base, py
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

' El venv vive FUERA de OneDrive (que lo deshidrata/borra): en %USERPROFILE%\.mayrit\venv.
py = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.mayrit\venv\Scripts\python.exe"

' --reload: IMPRESCINDIBLE. Sin él, uvicorn no recoge los cambios del código y hay que reiniciar el
' backend a mano cada vez (parecía "que el reload de Windows falla", pero es que faltaba el flag).
' --reload-dir app: vigila solo el código (no el venv ni static) → recarga rápida.
sh.Run "cmd /c set PYTHONDONTWRITEBYTECODE=1&& cd /d """ & base & "\backend"" && """ & py & """ -m uvicorn app.main:app --port 8000 --reload --reload-dir app", 0, False
sh.Run "cmd /c cd /d """ & base & "\frontend"" && npm run dev", 0, False
