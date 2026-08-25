param(
  [ValidateSet("apk", "appbundle", "all")]
  [string]$Target = "all",
  [string]$Flutter = "C:\Proyectos\flutter\bin\flutter.bat",
  [ValidateSet("development", "staging", "production")]
  [string]$Environment = "staging",
  [ValidateSet("google", "osm")]
  [string]$MapProvider = "google",
  [string]$ApiBaseUrl = "https://mototaxi-atacames-api.onrender.com",
  [string]$ApiHttpProxy = "",
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
$pubspecPath = Join-Path $mobile "pubspec.yaml"
$versionLine = Get-Content -LiteralPath $pubspecPath | Where-Object { $_ -match '^version:\s*([^+\s]+)\+(\d+)\s*$' } | Select-Object -First 1
if (-not $versionLine -or $versionLine -notmatch '^version:\s*([^+\s]+)\+(\d+)\s*$') {
  throw "No se pudo obtener versionName y versionCode desde apps/mobile/pubspec.yaml."
}
$versionName = $matches[1]
$versionCode = $matches[2]
$artifactBase = "Costa-Go-$versionName-build$versionCode"

if ($Production) {
  $googleMapsAndroidApiKey = [Environment]::GetEnvironmentVariable("GOOGLE_MAPS_ANDROID_API_KEY")
  if ([string]::IsNullOrWhiteSpace($googleMapsAndroidApiKey)) {
    throw "GOOGLE_MAPS_ANDROID_API_KEY no está configurada. Se cancela la compilación para evitar publicar una aplicación con el mapa en blanco."
  }

  $keyPropertiesPath = Join-Path $mobile "android\key.properties"
  $environmentSigningNames = @("COSTA_GO_KEYSTORE_PATH", "COSTA_GO_KEYSTORE_PASSWORD", "COSTA_GO_KEY_ALIAS", "COSTA_GO_KEY_PASSWORD")
  $environmentSigningReady = ($environmentSigningNames | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
  }).Count -eq 0
  $localSigningReady = $false

  if (Test-Path -LiteralPath $keyPropertiesPath) {
    $localSigning = @{}
    Get-Content -LiteralPath $keyPropertiesPath | ForEach-Object {
      if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
        $localSigning[$matches[1]] = $matches[2]
      }
    }
    $localSigningNames = @("storeFile", "storePassword", "keyAlias", "keyPassword")
    $localSigningReady = ($localSigningNames | Where-Object {
      -not $localSigning.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($localSigning[$_])
    }).Count -eq 0
    if ($localSigningReady) {
      $androidApp = Join-Path $mobile "android\app"
      $localKeystore = [IO.Path]::GetFullPath((Join-Path $androidApp $localSigning["storeFile"]))
      $localSigningReady = Test-Path -LiteralPath $localKeystore
    }
  }

  if (-not $environmentSigningReady -and -not $localSigningReady) {
    throw "Firma de producción incompleta. Configura las variables COSTA_GO_* o un android/key.properties válido."
  }
}

$defines = @(
  "--dart-define=MAP_PROVIDER=$MapProvider",
  "--dart-define=API_BASE_URL=$ApiBaseUrl",
  "--dart-define=APP_ENV=$Environment"
)
if (-not [string]::IsNullOrWhiteSpace($ApiHttpProxy)) {
  $defines += "--dart-define=API_HTTP_PROXY=$ApiHttpProxy"
  Write-Host "Compilando variante de red con proxy explicito (solo pruebas controladas)."
}
if ($Production -and -not [string]::IsNullOrWhiteSpace($ApiHttpProxy)) {
  throw "Una compilación de producción para Google Play no puede incluir API_HTTP_PROXY."
}
if ($Production -and $MapProvider -ne "google") {
  throw "Las compilaciones de producción de Costa-Go deben usar MAP_PROVIDER=google."
}
if (-not [string]::IsNullOrWhiteSpace($SentryDsn)) { $defines += "--dart-define=SENTRY_DSN=$SentryDsn" }

Push-Location $mobile
try {
  if ($Target -in @("apk", "all")) {
    & $Flutter build apk --release @defines
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación APK." }
    $apkSource = "build\app\outputs\flutter-apk\app-release.apk"
    if (-not (Test-Path $apkSource)) { throw "Flutter terminó sin producir el APK universal esperado." }
    if ([string]::IsNullOrWhiteSpace($ApiHttpProxy)) {
      Copy-Item $apkSource (Join-Path $release "$artifactBase-universal.apk") -Force
    } else {
      Copy-Item $apkSource (Join-Path $release "$artifactBase-lab-proxy.apk") -Force
    }
  }
  if ($Target -in @("appbundle", "all")) {
    & $Flutter build appbundle --release @defines
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación AAB." }
    Copy-Item "build\app\outputs\bundle\release\app-release.aab" (Join-Path $release "$artifactBase.aab") -Force
  }
} finally {
  Pop-Location
}

Write-Host "Artefactos Costa-Go disponibles en $release (MAP_PROVIDER=$MapProvider)"
