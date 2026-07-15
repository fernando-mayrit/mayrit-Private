' Lanzador de Mayrit SIN consola negra. Arranca el backend (FastAPI/uvicorn, puerto 8000)
' y el frontend (Vite, puerto 5173) OCULTOS, espera a que el frontend responda y abre la
' app en Edge en modo --app (ventana limpia, sin barras del navegador).
' Si ya hay servidores arrancados en esos puertos, los nuevos intentos fallan en silencio
' y se reutilizan los que ya estaban. Para pararlos: cerrar sesión/reiniciar, o el
' Administrador de tareas -> "python" y "node".
Option Explicit
Dim sh, fso, base, edge, py
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

' El venv vive FUERA de OneDrive (que lo deshidrata/borra): en %USERPROFILE%\.mayrit\venv.
py = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.mayrit\venv\Scripts\python.exe"

' Backend OCULTO (ventana 0). PYTHONDONTWRITEBYTECODE evita .pyc en conflicto (OneDrive).
' --reload: IMPRESCINDIBLE. Sin él, uvicorn no recoge los cambios del código y hay que reiniciar el
' backend a mano cada vez (parecía "que el reload de Windows falla", pero es que faltaba el flag).
' --reload-dir app: vigila solo el código (no el venv ni static) → recarga rápida.
sh.Run "cmd /c set PYTHONDONTWRITEBYTECODE=1&& cd /d """ & base & "\backend"" && """ & py & """ -m uvicorn app.main:app --port 8000 --reload --reload-dir app", 0, False

' Frontend OCULTO (ventana 0).
sh.Run "cmd /c cd /d """ & base & "\frontend"" && npm run dev", 0, False

' Esperar a que el frontend responda en el 5173 (hasta ~40 s; la 1ª vez del día tarda).
Dim http, i, listo
listo = False
For i = 1 To 80
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", "http://localhost:5173/", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then listo = True
  On Error GoTo 0
  If listo Then Exit For
  WScript.Sleep 500
Next

edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edge) Then edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=http://localhost:5173/", 1, False
Else
  sh.Run "http://localhost:5173/", 1, False   ' fallback: navegador por defecto
End If
