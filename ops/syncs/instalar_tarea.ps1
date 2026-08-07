# Registra (o re-registra) en ESTE PC la tarea programada que lanza las sincronizaciones automáticas.
# Ejecutar UNA vez por cada PC "portador" de la oficina, en una consola PowerShell normal de tu usuario
# (no hace falta admin: la tarea corre para tu usuario). Idempotente: relanzarlo re-crea la tarea.
$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "ejecutar_syncs.ps1"
$nombre = "MayritSyncs"
if (-not (Test-Path $script)) { throw "No encuentro $script" }

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

# Disparadores (CATCH-UP): al iniciar sesión + cada 2 horas. Con -StartWhenAvailable, si a la hora
# prevista el PC estaba apagado, en cuanto se enciende ejecuta y pone al día lo atrasado (no espera
# a la hora fija). Da igual qué PC esté encendido: el que pueda y le toque, corre; el candado en la
# BD impide que dos lo hagan a la vez.
$tLogon  = New-ScheduledTaskTrigger -AtLogOn
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Days 3650)

$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger @($tLogon, $tRepeat) `
    -Settings $ajustes `
    -Description "Mayrit: sincronizaciones automáticas (DGSFP + proyección de ingresos). Candado en BD: solo un PC ejecuta cada job." | Out-Null

Write-Host "Tarea '$nombre' registrada en $env:COMPUTERNAME."
Write-Host "Comprobar estado:  ~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --estado   (desde la carpeta backend)"
Write-Host "Log:               $HOME\.mayrit\logs\syncs.log"
