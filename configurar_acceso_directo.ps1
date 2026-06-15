# Crea (o actualiza) el acceso directo de Mayrit en el Escritorio, con el icono de la Y
# naranja y en forma ANCLABLE a la barra de tareas.
#
# Windows NO deja anclar a la barra de tareas un acceso directo a un .vbs directo; por eso
# apunta a wscript.exe con el .vbs como argumento (wscript.exe SÍ es anclable). El .vbs
# arranca backend+frontend ocultos y abre la app en Edge modo app.
#
# Ejecutar UNA vez por equipo:
#   powershell -ExecutionPolicy Bypass -File configurar_acceso_directo.ps1
$ErrorActionPreference = 'SilentlyContinue'

$base    = $PSScriptRoot
$ico     = Join-Path $base 'mayrit-Y.ico'
$vbs     = Join-Path $base 'arrancar_mayrit.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path $ico)) { Write-Host "No se encuentra $ico"; exit 1 }
if (-not (Test-Path $vbs)) { Write-Host "No se encuentra $vbs"; exit 1 }

$sh      = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop 'Mayrit.lnk'

$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath       = $wscript
$sc.Arguments        = '"' + $vbs + '"'
$sc.WorkingDirectory = $base
$sc.IconLocation     = "$ico,0"
$sc.WindowStyle      = 1
$sc.Description       = 'Mayrit - gestion de Agencias de Suscripcion'
$sc.Save()

& ie4uinit.exe -show 2>$null
Write-Host "Acceso directo creado en el Escritorio: $lnk"
Write-Host "Para anclarlo a la barra de tareas: clic derecho sobre el -> 'Anclar a la barra de tareas'."
