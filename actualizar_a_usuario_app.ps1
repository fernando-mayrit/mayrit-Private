# ============================================================================
# Cambia ESTE equipo para que Mayrit se conecte con el usuario LIMITADO 'mayrit_app'
# (en vez del usuario dueno/admin). Edita solo PG_USER / PG_PASSWORD en el .env privado.
# NO toca el codigo ni la base. Ejecutar UNA vez por equipo.
# Requiere que el rol mayrit_app ya exista (crear_usuario_app.py) y su contrasena.
# ============================================================================
Set-Location -Path $PSScriptRoot

$envPath = Join-Path $env:USERPROFILE ".mayrit\.env"
if (-not (Test-Path $envPath)) {
    Write-Host "No existe $envPath. Configura primero la conexion PG de Mayrit." -ForegroundColor Red
    Read-Host "Pulsa Enter para cerrar"; exit
}

Write-Host ""
Write-Host "== Pasar este equipo al usuario limitado mayrit_app ==" -ForegroundColor Cyan
Write-Host ("Equipo: {0}" -f $env:COMPUTERNAME)
$pass = Read-Host "Pega la contrasena de mayrit_app"
if (-not $pass) { Write-Host "Contrasena vacia. Abortado." -ForegroundColor Red; Read-Host "Enter"; exit }

$lines = Get-Content $envPath
$out = @(); $hasUser = $false; $hasPass = $false
foreach ($l in $lines) {
    if ($l -match '^\s*PG_USER\s*=')     { $out += "PG_USER=mayrit_app"; $hasUser = $true; continue }
    if ($l -match '^\s*PG_PASSWORD\s*=') { $out += "PG_PASSWORD=$pass";  $hasPass = $true; continue }
    $out += $l
}
if (-not $hasUser) { $out += "PG_USER=mayrit_app" }
if (-not $hasPass) { $out += "PG_PASSWORD=$pass" }
[System.IO.File]::WriteAllLines($envPath, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "OK: .env actualizado (PG_USER=mayrit_app)." -ForegroundColor Green

Write-Host "Probando conexion como mayrit_app..."
python -c "import sys; sys.path.insert(0, 'backend'); from app.db import engine; from sqlalchemy import text; c=engine.connect(); n=c.execute(text('SELECT COUNT(*) FROM binders')).scalar(); print('   Conexion mayrit_app OK -', n, 'binders'); c.close()"
if (-not $?) {
    Write-Host "   No conecto/leyo. Revisa: contrasena de mayrit_app correcta, IP en el firewall de Azure," -ForegroundColor Yellow
    Write-Host "   y que el rol mayrit_app exista con permisos (crear_usuario_app.py)." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Pulsa Enter para cerrar"
