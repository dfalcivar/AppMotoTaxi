$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$manifestPath = Join-Path $PSScriptRoot "inventarios\documentos.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "No existe el manifiesto. Ejecute primero: node docs/fuentes/generar-documentacion.mjs"
}

$browserCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw "No se encontró Chrome ni Edge para generar los PDF." }

$documents = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$profile = Join-Path $env:TEMP ("costa-go-docs-chrome-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $profile -Force | Out-Null

foreach ($document in $documents) {
  $source = Join-Path $repoRoot ($document.source -replace '/', '\')
  $target = Join-Path $repoRoot ($document.pdf -replace '/', '\')
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  $uri = [System.Uri]::new($source).AbsoluteUri
  $arguments = @(
    "--headless=old",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--no-pdf-header-footer",
    "--allow-file-access-from-files",
    "--user-data-dir=$profile",
    "--print-to-pdf=$target",
    $uri
  )
  Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -Wait
  for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path -LiteralPath $target); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $target)) { throw "No se generó $target" }
}

Write-Host "PDF generados: $($documents.Count)"
