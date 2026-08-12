param(
  [ValidateSet("apk", "appbundle", "all")]
  [string]$Target = "all",
  [string]$Flutter = "C:\Proyectos\flutter\bin\flutter.bat"
)

$repo = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = "Stop"
$mobile = Join-Path $repo "apps\mobile"
$release = Join-Path $mobile "release"
New-Item -ItemType Directory -Force -Path $release | Out-Null

Push-Location $mobile
try {
  if ($Target -in @("apk", "all")) {
    & $Flutter build apk --release --dart-define=MAP_PROVIDER=google
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación APK." }
    Copy-Item "build\app\outputs\flutter-apk\app-release.apk" (Join-Path $release "Costa-Go-release.apk") -Force
  }
  if ($Target -in @("appbundle", "all")) {
    & $Flutter build appbundle --release --dart-define=MAP_PROVIDER=google
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación AAB." }
    Copy-Item "build\app\outputs\bundle\release\app-release.aab" (Join-Path $release "Costa-Go-release.aab") -Force
  }
} finally {
  Pop-Location
}

Write-Host "Artefactos Costa-Go disponibles en $release"
