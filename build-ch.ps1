Add-Type -Assembly System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = "$root\dist"
$zip  = "$dist\vnproxy_chrome.zip"

$files = @{
  'manifest.json'          = "$root\manifest_ch.json"
  'background_chrome.js'   = "$root\background_chrome.js"
  'polyfill.js'            = "$root\polyfill.js"
  'error.html'             = "$root\error.html"
  'error.js'               = "$root\error.js"
  'popup/popup.html'       = "$root\popup\popup.html"
  'popup/popup.js'         = "$root\popup\popup.js"
  'options/options.html'   = "$root\options\options.html"
  'options/options.js'     = "$root\options\options.js"
  'icons/icon48.png'       = "$root\icons\icon48.png"
  'icons/icon96.png'       = "$root\icons\icon96.png"
}

if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $zip) { Remove-Item $zip -Force }

$arc = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
foreach ($entry in $files.GetEnumerator()) {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $arc, $entry.Value, $entry.Key,
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
}
$arc.Dispose()

Write-Host "Built Chrome/Brave: $zip" -ForegroundColor Green
Write-Host "  -> Upload .zip len Chrome Web Store (MV3)" -ForegroundColor Cyan
