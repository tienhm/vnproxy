Add-Type -Assembly System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = "$root\dist"
$xpi  = "$dist\vnproxy_firefox.xpi"

$files = @{
  'manifest.json'        = "$root\manifest_ff.json"
  'background.js'        = "$root\background.js"
  'error.html'           = "$root\error.html"
  'error.js'             = "$root\error.js"
  'popup/popup.html'     = "$root\popup\popup.html"
  'popup/popup.js'       = "$root\popup\popup.js"
  'options/options.html' = "$root\options\options.html"
  'options/options.js'   = "$root\options\options.js"
  'icons/icon48.png'     = "$root\icons\icon48.png"
  'icons/icon96.png'     = "$root\icons\icon96.png"
}

if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $xpi) { Remove-Item $xpi -Force }

$zip = [System.IO.Compression.ZipFile]::Open($xpi, 'Create')
foreach ($entry in $files.GetEnumerator()) {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, $entry.Value, $entry.Key,
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
}
$zip.Dispose()

Write-Host "Built Firefox: $xpi" -ForegroundColor Green
