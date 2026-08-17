param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $RepoRoot "docs\google-play\assets"
$foregroundPath = Join-Path $RepoRoot "apps\mobile\android\app\src\main\res\drawable-xxxhdpi\ic_launcher_foreground.png"
$backgroundPath = Join-Path $assets "feature-background-source.png"
$iconPath = Join-Path $assets "costa-go-play-icon-512.png"
$featurePath = Join-Path $assets "costa-go-feature-graphic-1024x500.png"

New-Item -ItemType Directory -Force -Path $assets | Out-Null

function New-Canvas([int]$width, [int]$height) {
  return [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Enable-Quality([System.Drawing.Graphics]$graphics) {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
}

function Get-AlphaBounds([System.Drawing.Bitmap]$bitmap) {
  $minX = $bitmap.Width
  $minY = $bitmap.Height
  $maxX = -1
  $maxY = -1
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      if ($bitmap.GetPixel($x, $y).A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) { throw "El emblema no contiene píxeles visibles." }
  return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

$foreground = [System.Drawing.Bitmap]::new($foregroundPath)
$logoBounds = Get-AlphaBounds $foreground

try {
  $icon = New-Canvas 512 512
  $iconGraphics = [System.Drawing.Graphics]::FromImage($icon)
  try {
    Enable-Quality $iconGraphics
    $iconGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#032B49"))
    $iconDestination = [System.Drawing.Rectangle]::new(46, 46, 420, 420)
    $iconGraphics.DrawImage($foreground, $iconDestination, $logoBounds, [System.Drawing.GraphicsUnit]::Pixel)
    $icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $iconGraphics.Dispose()
    $icon.Dispose()
  }

  $source = [System.Drawing.Bitmap]::new($backgroundPath)
  try {
    $feature = New-Canvas 1024 500
    $featureGraphics = [System.Drawing.Graphics]::FromImage($feature)
    try {
      Enable-Quality $featureGraphics
      $sourceRatio = $source.Width / $source.Height
      $targetRatio = 1024 / 500
      if ($sourceRatio -gt $targetRatio) {
        $cropWidth = [int]($source.Height * $targetRatio)
        $crop = [System.Drawing.Rectangle]::new([int](($source.Width - $cropWidth) / 2), 0, $cropWidth, $source.Height)
      } else {
        $cropHeight = [int]($source.Width / $targetRatio)
        $crop = [System.Drawing.Rectangle]::new(0, [int](($source.Height - $cropHeight) / 2), $source.Width, $cropHeight)
      }
      $featureGraphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1024, 500), $crop, [System.Drawing.GraphicsUnit]::Pixel)

      $overlay = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.Rectangle]::new(0, 0, 680, 500),
        [System.Drawing.Color]::FromArgb(238, 3, 43, 73),
        [System.Drawing.Color]::FromArgb(0, 3, 43, 73),
        [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
      )
      $featureGraphics.FillRectangle($overlay, 0, 0, 680, 500)
      $overlay.Dispose()

      $featureGraphics.DrawImage(
        $foreground,
        [System.Drawing.Rectangle]::new(58, 104, 248, 248),
        $logoBounds,
        [System.Drawing.GraphicsUnit]::Pixel
      )

      $family = [System.Drawing.FontFamily]::new("Segoe UI")
      $bold = [System.Drawing.Font]::new($family, 58, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $tagline = [System.Drawing.Font]::new($family, 23, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      try {
        $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        $cyan = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#00AEEF"))
        try {
          $featureGraphics.DrawString("Costa-", $bold, $white, 294, 167)
          $featureGraphics.DrawString("Go", $bold, $cyan, 458, 167)
          $featureGraphics.DrawString("TU VIAJE, NUESTRA PRIORIDAD", $tagline, $white, 299, 242)
        } finally {
          $white.Dispose()
          $cyan.Dispose()
        }
      } finally {
        $bold.Dispose()
        $tagline.Dispose()
        $family.Dispose()
      }
      $feature.Save($featurePath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $featureGraphics.Dispose()
      $feature.Dispose()
    }
  } finally {
    $source.Dispose()
  }
} finally {
  $foreground.Dispose()
}

Write-Host "Recursos de Google Play generados en $assets"
