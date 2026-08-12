param(
  [string]$Source = "C:\Users\dalcivar\.codex\generated_images\019fae3a-4d88-7082-a8a4-906841518d0b\exec-cc744845-3635-4f90-9a5d-5f33ced75814.png"
)

Add-Type -AssemblyName System.Drawing

$repo = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $repo "apps\mobile\assets\images"
$transparentPath = Join-Path $assetDir "costa-go-emblem.png"

function New-Canvas([int]$size, [bool]$transparent = $false) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($transparent) { $graphics.Clear([System.Drawing.Color]::Transparent) }
  else { $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#032B49")) }
  return @($bitmap, $graphics)
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($Source)
$transparent = [System.Drawing.Bitmap]::new($sourceBitmap.Width, $sourceBitmap.Height)
for ($y = 0; $y -lt $sourceBitmap.Height; $y++) {
  for ($x = 0; $x -lt $sourceBitmap.Width; $x++) {
    $pixel = $sourceBitmap.GetPixel($x, $y)
    $magenta = [Math]::Min(255, [Math]::Max(0, [Math]::Min($pixel.R, $pixel.B) - $pixel.G))
    $alpha = 255 - [int]([Math]::Min(255, $magenta * 4.0))
    if ($alpha -lt 18) { $alpha = 0 }
    elseif ($alpha -gt 238) { $alpha = 255 }
    $transparent.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
  }
}
$transparent.Save($transparentPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sourceBitmap.Dispose()

function Save-Icon([string]$path, [int]$size, [double]$scale, [bool]$transparentCanvas = $false) {
  $canvas = New-Canvas $size $transparentCanvas
  $bitmap = $canvas[0]
  $graphics = $canvas[1]
  $drawSize = [int]($size * $scale)
  $offset = [int](($size - $drawSize) / 2)
  $graphics.DrawImage($transparent, $offset, $offset, $drawSize, $drawSize)
  $directory = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$android = Join-Path $repo "apps\mobile\android\app\src\main\res"
@{
  "mipmap-mdpi\ic_launcher.png" = 48
  "mipmap-hdpi\ic_launcher.png" = 72
  "mipmap-xhdpi\ic_launcher.png" = 96
  "mipmap-xxhdpi\ic_launcher.png" = 144
  "mipmap-xxxhdpi\ic_launcher.png" = 192
}.GetEnumerator() | ForEach-Object { Save-Icon (Join-Path $android $_.Key) $_.Value 0.82 }

@{
  "drawable-mdpi\ic_launcher_foreground.png" = 108
  "drawable-hdpi\ic_launcher_foreground.png" = 162
  "drawable-xhdpi\ic_launcher_foreground.png" = 216
  "drawable-xxhdpi\ic_launcher_foreground.png" = 324
  "drawable-xxxhdpi\ic_launcher_foreground.png" = 432
}.GetEnumerator() | ForEach-Object { Save-Icon (Join-Path $android $_.Key) $_.Value 0.72 $true }

$ios = Join-Path $repo "apps\mobile\ios\Runner\Assets.xcassets\AppIcon.appiconset"
@{
  "Icon-App-20x20@1x.png"=20; "Icon-App-20x20@2x.png"=40; "Icon-App-20x20@3x.png"=60
  "Icon-App-29x29@1x.png"=29; "Icon-App-29x29@2x.png"=58; "Icon-App-29x29@3x.png"=87
  "Icon-App-40x40@1x.png"=40; "Icon-App-40x40@2x.png"=80; "Icon-App-40x40@3x.png"=120
  "Icon-App-60x60@2x.png"=120; "Icon-App-60x60@3x.png"=180
  "Icon-App-76x76@1x.png"=76; "Icon-App-76x76@2x.png"=152
  "Icon-App-83.5x83.5@2x.png"=167; "Icon-App-1024x1024@1x.png"=1024
}.GetEnumerator() | ForEach-Object { Save-Icon (Join-Path $ios $_.Key) $_.Value 0.82 }

Save-Icon (Join-Path $repo "apps\admin\public\costa-go-emblem.png") 256 0.92 $true

$transparent.Dispose()
Write-Host "Recursos Costa-Go generados en $assetDir, Android e iOS."
