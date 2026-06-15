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

function New-MayritShortcut($ruta) {
    $sc = $sh.CreateShortcut($ruta)
    $sc.TargetPath       = $wscript
    $sc.Arguments        = '"' + $vbs + '"'
    $sc.WorkingDirectory = $base
    $sc.IconLocation     = "$ico,0"
    $sc.WindowStyle      = 1
    $sc.Description       = 'Mayrit - gestion de Agencias de Suscripcion'
    $sc.Save()
}

# 1) Escritorio
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkDesktop = Join-Path $desktop 'Mayrit.lnk'
New-MayritShortcut $lnkDesktop

# 2) Menú Inicio (desde aquí Windows 11 SÍ deja anclar a la barra de tareas y buscar "Mayrit")
$startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
$lnkStart = Join-Path $startMenu 'Mayrit.lnk'
New-MayritShortcut $lnkStart

& ie4uinit.exe -show 2>$null
Write-Host "Acceso directo creado en:"
Write-Host "  - Escritorio:   $lnkDesktop"
Write-Host "  - Menu Inicio:  $lnkStart"
Write-Host ""
Write-Host "Para anclarlo a la barra de tareas (Windows 11):"
Write-Host "  Abre Inicio, escribe 'Mayrit', clic derecho sobre el resultado -> 'Anclar a la barra de tareas'."
