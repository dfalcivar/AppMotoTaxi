param(
  [ValidateSet("apk", "appbundle", "all")]
  [string]$Target = "all",
  [string]$Flutter = "C:\Proyectos\flutter\bin\flutter.bat",
  [ValidateSet("development", "staging", "production")]
  [string]$Environment = "staging",
  [string]$ApiBaseUrl = "https://mototaxi-atacames-api.onrender.com",
  [string]$SentryDsn = "",
  [switch]$Production
)

$repo = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = "Stop"
$gradleCache = [Environment]::GetEnvironmentVariable("GRADLE_USER_HOME")
if ([string]::IsNullOrWhiteSpace($gradleCache)) {
  $userProfile = [Environment]::GetEnvironmentVariable("USERPROFILE")
  $gradleCache = if ([string]::IsNullOrWhiteSpace($userProfile)) { Join-Path $repo ".gradle-cache" } else { Join-Path $userProfile ".gradle" }
  [Environment]::SetEnvironmentVariable("GRADLE_USER_HOME", $gradleCache, "Process")
}
New-Item -ItemType Directory -Force -Path $gradleCache | Out-Null
$mobile = Join-Path $repo "apps\mobile"
$release = Join-Path $mobile "release"
New-Item -ItemType Directory -Force -Path $release | Out-Null

if ($Production) {
  $required = @("COSTA_GO_KEYSTORE_PATH", "COSTA_GO_KEYSTORE_PASSWORD", "COSTA_GO_KEY_ALIAS", "COSTA_GO_KEY_PASSWORD")
  $missing = $required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
  if ($missing.Count -gt 0) { throw "Firma de producción incompleta. Faltan: $($missing -join ', ')." }
}

$defines = @(
  "--dart-define=MAP_PROVIDER=google",
  "--dart-define=API_BASE_URL=$ApiBaseUrl",
  "--dart-define=APP_ENVIRONMENT=$Environment"
)
if (-not [string]::IsNullOrWhiteSpace($SentryDsn)) { $defines += "--dart-define=SENTRY_DSN=$SentryDsn" }

Push-Location $mobile
try {
  if ($Target -in @("apk", "all")) {
    & $Flutter build apk --release @defines
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación APK." }
    $apkSource = "build\app\outputs\flutter-apk\app-release.apk"
    if (-not (Test-Path $apkSource)) { throw "Flutter terminó sin producir el APK universal esperado." }
    Copy-Item $apkSource (Join-Path $release "Costa-Go-universal.apk") -Force
    Copy-Item $apkSource (Join-Path $release "Costa-Go-release.apk") -Force
  }
  if ($Target -in @("appbundle", "all")) {
    & $Flutter build appbundle --release @defines
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación AAB." }
    Copy-Item "build\app\outputs\bundle\release\app-release.aab" (Join-Path $release "Costa-Go-release.aab") -Force
  }
} finally {
  Pop-Location
}

Write-Host "Artefactos Costa-Go disponibles en $release"
