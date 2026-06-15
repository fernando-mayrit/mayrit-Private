# Concede a la app 'Alea-SharePoint' permiso de LECTURA sobre el sitio
# Mayrit-Negocio (permiso Sites.Selected por sitio). Ejecutar UNA sola vez,
# con una cuenta ADMINISTRADORA de SharePoint/Entra del tenant.
#
# Uso:   pwsh -File backend\tools\conceder_permiso_sharepoint.ps1
#        (o desde Windows PowerShell:  powershell -File backend\tools\conceder_permiso_sharepoint.ps1)
#
# Abrira el navegador para iniciar sesion. Acepta el consentimiento si lo pide.

$ErrorActionPreference = "Stop"

$AppId       = "35b41519-2690-4365-bfd3-b60303cb7f24"   # app 'Alea-SharePoint'
$AppName     = "Alea-SharePoint"
$SiteRef     = "mayritbroker.sharepoint.com:/sites/Mayrit-Negocio"

Write-Host "1/4  Comprobando modulo Microsoft.Graph.Sites..." -ForegroundColor Cyan
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Sites)) {
    Write-Host "     Instalando Microsoft.Graph.Sites (solo la primera vez)..." -ForegroundColor Yellow
    Install-Module Microsoft.Graph.Sites -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Sites

Write-Host "2/4  Iniciando sesion (se abrira el navegador)..." -ForegroundColor Cyan
Connect-MgGraph -Scopes "Sites.FullControl.All" -NoWelcome

Write-Host "3/4  Localizando el sitio Mayrit-Negocio..." -ForegroundColor Cyan
$site = Get-MgSite -SiteId $SiteRef
Write-Host "     Sitio: $($site.DisplayName)  [$($site.Id)]" -ForegroundColor Green

Write-Host "4/4  Concediendo permiso de LECTURA a la app '$AppName'..." -ForegroundColor Cyan
$params = @{
    roles = @("read")
    grantedToIdentities = @(
        @{ application = @{ id = $AppId; displayName = $AppName } }
    )
}
$perm = New-MgSitePermission -SiteId $site.Id -BodyParameter $params

Write-Host ""
Write-Host "LISTO. Permiso concedido (id: $($perm.Id))." -ForegroundColor Green
Write-Host "Ya puedes volver a Claude y relanzar la inspeccion." -ForegroundColor Green

Disconnect-MgGraph | Out-Null
