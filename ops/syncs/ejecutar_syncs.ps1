# Lanza las sincronizaciones automáticas (DGSFP + proyección de ingresos).
# Lo llama la tarea programada "MayritSyncs". Puede correr en CUALQUIER PC de la oficina: el candado
# en la BD evita que dos lo hagan a la vez, y cada PC solo intenta el job que puede (Playwright / Excel).
$ErrorActionPreference = "Stop"

$repo    = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backend = Join-Path $repo "backend"
$venvPy  = Join-Path $HOME ".mayrit\venv\Scripts\python.exe"
$logDir  = Join-Path $HOME ".mayrit\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "syncs.log"

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Encoding utf8 $log }

if (-not (Test-Path $venvPy))  { Log "[ejecutar_syncs] No existe el venv en $venvPy"; exit 1 }
if (-not (Test-Path $backend)) { Log "[ejecutar_syncs] No existe el backend en $backend"; exit 1 }

Log "[ejecutar_syncs] inicio ($env:COMPUTERNAME)"
Push-Location $backend
try {
    & $venvPy -m tools.runner_syncs 2>&1 | ForEach-Object { $_ | Add-Content -Encoding utf8 $log }
} finally {
    Pop-Location
}
Log "[ejecutar_syncs] fin"
