# Registra (o re-registra) en ESTE PC la tarea programada que lanza las sincronizaciones automáticas.
# REQUIERE ADMINISTRADOR: si lo lanzas sin permisos, se auto-eleva (te saldrá el UAC, acepta).
# Deja la ventana abierta y escribe el resultado en ~/.mayrit/logs/instalar_tarea.log
$ErrorActionPreference = "Stop"

# ── Auto-elevación (crear tareas programadas requiere administrador) ──
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host "Se requieren permisos de administrador. Relanzando con UAC (acepta el aviso)…"
    Start-Process powershell.exe -Verb RunAs `
        -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    return
}

$logDir = Join-Path $HOME ".mayrit\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "instalar_tarea.log"
function Registrar($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Encoding utf8 $logFile
    Write-Host $msg
}

$nombre = "MayritSyncs"
try {
    $script = Join-Path $PSScriptRoot "ejecutar_syncs.ps1"
    if (-not (Test-Path $script)) { throw "No encuentro $script" }
    Registrar "Instalando '$nombre' en $env:COMPUTERNAME como $env:USERNAME (admin)…"

    $accion = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

    # Al iniciar sesión + cada 2 h (catch-up con StartWhenAvailable).
    $tLogon  = New-ScheduledTaskTrigger -AtLogOn
    $tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Hours 2)

    $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger @($tLogon, $tRepeat) `
        -Settings $ajustes `
        -Description "Mayrit: sincronizaciones automaticas (DGSFP + proyeccion de ingresos)." -ErrorAction Stop | Out-Null

    if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
        Registrar "OK: tarea '$nombre' registrada correctamente."
    } else {
        Registrar "FALLO: la tarea no aparece tras registrarla."
    }
} catch {
    Registrar ("ERROR: " + $_.Exception.Message)
}

Write-Host ""
Write-Host "Log: $logFile"
Write-Host "Puedes cerrar esta ventana."
