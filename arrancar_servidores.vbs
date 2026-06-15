' Arranca SOLO los servidores de Mayrit (backend 8000 + frontend 5173) OCULTOS, sin abrir
' el navegador. Pensado para el AUTOARRANQUE al iniciar sesión: así la app (instalada como
' aplicación / PWA) abre al instante porque los servidores ya están en marcha.
Option Explicit
Dim sh, fso, base, py
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

py = base & "\backend\.venv\Scripts\python.exe"

sh.Run "cmd /c set PYTHONDONTWRITEBYTECODE=1&& cd /d """ & base & "\backend"" && """ & py & """ -m uvicorn app.main:app --port 8000", 0, False
sh.Run "cmd /c cd /d """ & base & "\frontend"" && npm run dev", 0, False
