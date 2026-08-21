<#
  abrir_firewall.ps1 — deja que ESTE PC llegue a la base de datos de Azure.

  El problema que resuelve: la IP publica de casa (Movistar) y de la oficina (O2) es
  DINAMICA, cambia sola. El cortafuegos de `alea-db` solo admite IPs autorizadas, asi
  que cuando cambia, el backend local deja de conectar. Y lo hace COLGANDOSE, sin dar
  un error claro, que es lo que hacia perder el rato.

  Que hace, en orden:
    1. Prueba si ya se llega al puerto de la BD. Si se llega, no hace NADA y termina
       en menos de un segundo (el caso normal, casi todos los dias).
    2. Si no se llega, mira cual es la IP publica de ahora mismo y la mete en el
       cortafuegos de Azure, en una regla con el nombre de este equipo.
    3. Si no ha podido, lo dice con todas las letras en una ventana y deja el motivo
       escrito en logs/firewall.log.

  Lo llaman solos arrancar_mayrit.vbs y arrancar_servidores.vbs, antes de levantar
  el backend. Tambien se puede ejecutar a mano (boton derecho -> Ejecutar con PowerShell).

  Parametros:
    -Siempre     no comprueba antes, actualiza la regla si o si.
    -Silencioso  no saca ventana de aviso (para el autoarranque, si molestara).
#>
param([switch]$Siempre, [switch]$Silencioso)

$ErrorActionPreference = 'Stop'

# --- Datos del servidor en Azure. Si se dejan vacios, el script los busca solo. ---
$ServidorAzure  = 'alea-db'
$GrupoRecursos  = 'rg-alea'   # descubierto el 20-ago-2026; si cambiara, dejarlo vacio y se busca solo

$base    = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir  = Join-Path $base 'logs'
$logFile = Join-Path $logDir 'firewall.log'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Apuntar([string]$txt) {
  $linea = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $txt
  Add-Content -Path $logFile -Value $linea -Encoding utf8
  Write-Host $linea
}

function Avisar([string]$titulo, [string]$texto) {
  Apuntar "AVISO: $texto"
  if ($Silencioso) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($texto, $titulo, 'OK', 'Warning') | Out-Null
  } catch {
    (New-Object -ComObject WScript.Shell).Popup($texto, 0, $titulo, 48) | Out-Null
  }
}

# --- 1. A donde hay que llegar (se lee del .env real, para que no se quede desfasado) ---
$envFile = Join-Path $env:USERPROFILE '.mayrit\.env'
$pgHost = 'alea-db.postgres.database.azure.com'
$pgPort = 5432
if (Test-Path $envFile) {
  foreach ($l in Get-Content $envFile) {
    if ($l -match '^\s*PG_HOST\s*=\s*(.+?)\s*$') { $pgHost = $Matches[1] }
    if ($l -match '^\s*PG_PORT\s*=\s*(\d+)\s*$') { $pgPort = [int]$Matches[1] }
  }
}

function LlegaALaBD([int]$segundos = 4) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $r = $c.BeginConnect($pgHost, $pgPort, $null, $null)
    if (-not $r.AsyncWaitHandle.WaitOne($segundos * 1000, $false)) { return $false }
    $c.EndConnect($r)
    return $c.Connected
  } catch { return $false } finally { $c.Close() }
}

# --- 2. Si ya se llega, no tocamos nada ---
if (-not $Siempre) {
  if (LlegaALaBD) { Apuntar "ok - ya se llega a $pgHost, no hay nada que hacer"; exit 0 }
  Apuntar "no se llega a ${pgHost}:${pgPort} - probablemente cambio la IP"
}

# --- 3. Cual es mi IP publica ahora ---
$ip = $null
foreach ($url in @('https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com')) {
  try {
    $r = (Invoke-RestMethod -Uri $url -TimeoutSec 8).ToString().Trim()
    if ($r -match '^\d{1,3}(\.\d{1,3}){3}$') { $ip = $r; break }
  } catch { }
}
if (-not $ip) {
  Avisar 'Mayrit - cortafuegos' "No he podido averiguar tu IP publica (sin internet?).`n`nLa base de datos seguira sin responder."
  exit 1
}
Apuntar "mi IP publica ahora: $ip"

# --- 4. Esta la herramienta de Azure y hay sesion iniciada? ---
# Se busca por PATH y, si no, en las rutas fijas del instalador: recien instalada, el PATH
# todavia no la tiene hasta que se reinicia la sesion de Windows.
$azExe = $null
$c = Get-Command az -ErrorAction SilentlyContinue
if ($c) { $azExe = $c.Source }
if (-not $azExe) {
  foreach ($ruta in @('C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd',
                      'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd')) {
    if (Test-Path $ruta) { $azExe = $ruta; break }
  }
}
if (-not $azExe) {
  Avisar 'Mayrit - cortafuegos' "Falta la herramienta de Azure en este equipo.`n`nInstalala con:  winget install Microsoft.AzureCLI"
  exit 1
}
$cuenta = & $azExe account show --output json 2>$null
if (-not $cuenta) {
  Avisar 'Mayrit - cortafuegos' ("Tu sesion de Azure ha caducado, por eso no puedo abrir el cortafuegos.`n`n" +
    "ARREGLO (una vez): abre PowerShell y escribe:`n`n    az login`n`n" +
    "Mientras tanto, a mano: Portal de Azure -> alea-db -> Redes ->`n" +
    "'Agregar la direccion IPv4 del cliente actual' -> Guardar.`n`nTu IP de ahora es $ip")
  exit 1
}

# --- 5. Grupo de recursos (se descubre solo la primera vez) ---
if (-not $GrupoRecursos) {
  Apuntar 'buscando el grupo de recursos...'
  $j = & $azExe postgres flexible-server list --query "[?name=='$ServidorAzure'].resourceGroup" --output tsv 2>$null
  if ($j) { $GrupoRecursos = ($j | Select-Object -First 1).Trim(); Apuntar "grupo de recursos: $GrupoRecursos" }
}
if (-not $GrupoRecursos) {
  Avisar 'Mayrit - cortafuegos' "No encuentro el servidor '$ServidorAzure' en tu cuenta de Azure.`n`nRevisa que la sesion sea la correcta:  az account show"
  exit 1
}

# --- 6. Meter la IP en el cortafuegos (una regla por equipo, se pisa a si misma) ---
$regla = 'auto-' + ($env:COMPUTERNAME -replace '[^A-Za-z0-9\-_]', '-')
Apuntar "actualizando la regla '$regla' -> $ip"
# OJO con los nombres de los parametros: aqui --name es el nombre de LA REGLA
# y el servidor va en --server-name (no al reves, que es lo que uno espera).
$salida = & $azExe postgres flexible-server firewall-rule create `
            --resource-group $GrupoRecursos --server-name $ServidorAzure `
            --name $regla --start-ip-address $ip --end-ip-address $ip `
            --output none 2>&1
if ($LASTEXITCODE -ne 0) {
  Avisar 'Mayrit - cortafuegos' ("Azure no me ha dejado actualizar el cortafuegos.`n`nMotivo:`n$salida`n`n" +
    "A mano: Portal -> alea-db -> Redes -> 'Agregar la direccion IPv4 del cliente actual' -> Guardar.`n`nTu IP es $ip")
  exit 1
}

# --- 7. Comprobar que de verdad se llega ahora ---
Start-Sleep -Seconds 3
if (LlegaALaBD 8) {
  Apuntar "LISTO - cortafuegos abierto para $ip, la BD responde"
  exit 0
}
Avisar 'Mayrit - cortafuegos' ("He metido tu IP ($ip) en el cortafuegos, pero la base de datos sigue sin responder.`n`n" +
  "Azure tarda a veces medio minuto en aplicarlo. Espera un poco y vuelve a arrancar.`n" +
  "Si sigue igual, el problema es otro (mira logs\firewall.log).")
exit 1
