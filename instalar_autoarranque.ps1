# Activa (o desactiva) el AUTOARRANQUE de los servidores de Mayrit al iniciar sesión.
# Coloca un acceso directo a 'arrancar_servidores.vbs' en la carpeta Inicio del usuario.
# Así, al encender el equipo, backend+frontend quedan listos y la app abre al instante.
#
#   Activar:     powershell -ExecutionPolicy Bypass -File instalar_autoarranque.ps1
#   Desactivar:  powershell -ExecutionPolicy Bypass -File instalar_autoarranque.ps1 -Quitar
param([switch]$Quitar)
$ErrorActionPreference = 'SilentlyContinue'

$base    = $PSScriptRoot
$vbs     = Join-Path $base 'arrancar_servidores.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'Mayrit servidores.lnk'

if ($Quitar) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Autoarranque DESACTIVADO." }
    else { Write-Host "No estaba activado." }
    return
}

if (-not (Test-Path $vbs)) { Write-Host "No se encuentra $vbs"; exit 1 }

$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath       = $wscript
$sc.Arguments        = '"' + $vbs + '"'
$sc.WorkingDirectory = $base
$sc.WindowStyle      = 7   # minimizado/oculto
$sc.Description       = 'Mayrit - arranque de servidores al iniciar sesion'
$sc.Save()

Write-Host "Autoarranque ACTIVADO. Los servidores de Mayrit se iniciaran al entrar en Windows."
Write-Host "(Para desactivarlo: ...instalar_autoarranque.ps1 -Quitar)"
