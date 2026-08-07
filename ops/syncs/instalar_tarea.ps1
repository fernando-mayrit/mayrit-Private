# Registra (o re-registra) en ESTE PC la tarea programada que lanza las sincronizaciones automáticas.
# Ejecutar UNA vez por cada PC "portador" de la oficina. REQUIERE ADMINISTRADOR: si lo lanzas sin
# permisos, el script se auto-eleva (te saldrá el aviso de UAC, acepta).
#
# Cómo lanzarlo: clic derecho sobre este archivo → "Ejecutar con PowerShell", o desde una consola:
#     powershell -ExecutionPolicy Bypass -File "C:\Dev\mayrit\ops\syncs\instalar_tarea.ps1"
$ErrorActionPreference = "Stop"

# ── Auto-elevación: crear tareas programadas requiere administrador ──
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host "Se requieren permisos de administrador. Relanzando con UAC (acepta el aviso)…"
    Start-Process powershell.exe -Verb RunAs `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    return
}

$script = Join-Path $PSScriptRoot "ejecutar_syncs.ps1"
$nombre = "MayritSyncs"
if (-not (Test-Path $script)) { throw "No encuentro $script" }

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

# Disparadores (CATCH-UP): al iniciar sesión + cada 2 horas. Con -StartWhenAvailable, si a la hora
# prevista el PC estaba apagado, en cuanto se enciende ejecuta y pone al día lo atrasado. Da igual qué
# PC esté encendido: el que pueda y le toque corre; el candado en la BD impide que dos lo hagan a la vez.
$tLogon  = New-ScheduledTaskTrigger -AtLogOn
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Days 3650)

$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Correr como el usuario actual, solo cuando ha iniciado sesión (así ve el OneDrive/venv del usuario).
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger @($tLogon, $tRepeat) `
    -Settings $ajustes -Principal $principal `
    -Description "Mayrit: sincronizaciones automáticas (DGSFP + proyección de ingresos). Candado en BD: solo un PC ejecuta cada job." -ErrorAction Stop | Out-Null

# Verificación real (no dar por buena la creación sin comprobarla).
if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
    Write-Host "OK: tarea '$nombre' registrada en $env:COMPUTERNAME."
    Write-Host "Comprobar:  ~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --estado   (desde backend)"
    Write-Host "Log:        $HOME\.mayrit\logs\syncs.log"
} else {
    Write-Warning "No se pudo registrar la tarea. Abre PowerShell COMO ADMINISTRADOR y vuelve a lanzar este script."
    exit 1
}
