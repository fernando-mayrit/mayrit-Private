' ─────────────────────────────────────────────────────────────────────────────
'  REINICIAR EL BACKEND DE MAYRIT (puerto 8000) — un doble clic y listo.
'
'  ¿Para qué? El backend va a propósito SIN --reload (ver docs/CONTEXTO.md): con
'  --reload, uvicorn lanza el worker por "multiprocessing spawn" y su línea de
'  comandos NO dice "uvicorn"; si el padre muere, ese worker queda HUÉRFANO
'  agarrado al 8000 y el siguiente arranque falla en silencio → acabas con un
'  backend zombi que responde a los GET pero se come los POST sin dar error
'  (el bug de "Generar LPAN / Cobrar Premium no hacen nada"). Con la app
'  escribiendo en la BD de PRODUCCIÓN, eso es inaceptable.
'
'  El precio de no usar --reload es reiniciar al tocar el backend. Este script
'  hace justo eso, bien hecho y sin buscar PIDs a mano:
'    1) mata TODO lo que escuche en el 8000 (y sus hijos huérfanos)
'    2) arranca un backend limpio, oculto
'  El backend de ALEA (puerto 8010) NO se toca.
'
'  Uso: doble clic aquí (o crea un acceso directo en el escritorio).
' ─────────────────────────────────────────────────────────────────────────────
Option Explicit
Dim sh, fso, base, py, ps
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
py = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.mayrit\venv\Scripts\python.exe"

' 1) Limpieza a fondo del puerto 8000: los procesos que lo escuchan MÁS sus hijos python
'    (los workers huérfanos no llevan "uvicorn" en la línea de comandos, así que hay que ir
'    por el puerto y por la paternidad, no por el nombre). Espera a terminar (True).
ps = "$ErrorActionPreference='SilentlyContinue';" & _
     "$objetivo=@();" & _
     "$duenos=(Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess | Select-Object -Unique;" & _
     "foreach($d in $duenos){ $objetivo+=$d; $objetivo+=(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$d)).ProcessId };" & _
     "$objetivo+=(Get-CimInstance Win32_Process -Filter ""Name='python.exe'"" | Where-Object { $_.CommandLine -like '*uvicorn app.main:app*' -and $_.CommandLine -like '*--port 8000*' }).ProcessId;" & _
     "foreach($p in ($objetivo | Where-Object { $_ } | Select-Object -Unique)){ Stop-Process -Id $p -Force };" & _
     "Start-Sleep -Milliseconds 800"
sh.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & ps & """", 0, True

' 2) Backend limpio, oculto. PYTHONDONTWRITEBYTECODE evita .pyc en conflicto (OneDrive).
sh.Run "cmd /c set PYTHONDONTWRITEBYTECODE=1&& cd /d """ & base & "\backend"" && """ & py & """ -m uvicorn app.main:app --port 8000", 0, False

' 3) Esperar a que responda y avisar (así sabes que ya puedes recargar la app).
Dim http, i, listo
listo = False
For i = 1 To 40
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", "http://127.0.0.1:8000/health", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then listo = True
  On Error GoTo 0
  If listo Then Exit For
  WScript.Sleep 500
Next
If listo Then
  sh.Popup "Backend de Mayrit reiniciado y respondiendo." & vbCrLf & "Ya puedes recargar la app (Ctrl+F5).", 3, "Mayrit", 64
Else
  sh.Popup "El backend NO responde en el 8000." & vbCrLf & "Mira si hay algún error arrancándolo a mano.", 8, "Mayrit", 48
End If
