# Guarda las credenciales T3 en Firebase Secrets (no van al codigo ni al APK).
# Uso: clic derecho > Ejecutar con PowerShell
#   o:  powershell -ExecutionPolicy Bypass -File .\set-t3-secrets.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "=== Credenciales Tencloud T3 (Firebase Secrets) ===" -ForegroundColor Cyan
Write-Host "Proyecto: taemsa-app"
Write-Host ""

$user = Read-Host "Usuario T3 (Enter = Admin)"
if ([string]::IsNullOrWhiteSpace($user)) { $user = 'Admin' }

$secure = Read-Host "Contrasena T3" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

$org = Read-Host "Organization / Id organizacion (Enter = 1)"
if ([string]::IsNullOrWhiteSpace($org)) { $org = '1' }

$company = Read-Host "Company / Id empresa (Enter = 8)"
if ([string]::IsNullOrWhiteSpace($company)) { $company = '8' }

if ([string]::IsNullOrWhiteSpace($password)) {
  Write-Host "ERROR: la contrasena no puede estar vacia." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Guardando secrets..." -ForegroundColor Yellow

$tmp = Join-Path $env:TEMP 'taemsa-t3-set'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
function Set-T3Secret([string]$name, [string]$value) {
  $file = Join-Path $tmp "$name.txt"
  # WriteAllText no añade salto de línea (el pipe de PowerShell sí y rompe el login)
  [System.IO.File]::WriteAllText($file, $value.Trim())
  npx --yes firebase-tools functions:secrets:set $name --project taemsa-app --data-file $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Set-T3Secret 'T3_USER' $user
Set-T3Secret 'T3_PASSWORD' $password
Set-T3Secret 'T3_ORGANIZATION' $org
Set-T3Secret 'T3_COMPANY' $company
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Secrets guardados. Redeploy de functions..." -ForegroundColor Yellow
npx --yes firebase-tools deploy --only functions --project taemsa-app
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Listo. Las incidencias ya pueden autenticarse en T3." -ForegroundColor Green
Read-Host "Pulsa Enter para cerrar"
