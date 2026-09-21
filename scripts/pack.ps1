# Packages the extension for the Chrome Web Store and Microsoft Edge Add-ons
# (one zip for both). Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts/pack.ps1
# Output: dist/sitelemetry-audit-<version>.zip
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root 'dist'
$out = Join-Path $dist "sitelemetry-audit-$version.zip"

# Verify before packaging.
Push-Location $root
try {
  node scripts/validate-manifest.mjs
  if ($LASTEXITCODE -ne 0) { throw 'manifest validation failed' }
  node scripts/check-no-remote-code.mjs
  if ($LASTEXITCODE -ne 0) { throw 'remote code check failed' }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

# Only runtime files go into the package: no tests, scripts, docs or dist.
$items = @('manifest.json', '_locales', 'icons', 'src', 'LICENSE') | ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $items -DestinationPath $out -CompressionLevel Optimal

# Entry names must use forward slashes; older Compress-Archive builds wrote
# backslashes, which the stores reject. Rewrite the archive if that happened.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($out)
$names = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()
if ($names | Where-Object { $_ -like '*\*' }) {
  $stage = Join-Path $dist 'stage'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force $stage | Out-Null
  foreach ($item in $items) { Copy-Item $item -Destination $stage -Recurse }
  Remove-Item $out -Force
  $fixed = New-Object System.IO.Compression.ZipArchive((New-Object System.IO.FileStream($out, [System.IO.FileMode]::Create)), [System.IO.Compression.ZipArchiveMode]::Create)
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($fixed, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  $fixed.Dispose()
  Remove-Item $stage -Recurse -Force
  $zip = [System.IO.Compression.ZipFile]::OpenRead($out)
  $names = $zip.Entries | ForEach-Object { $_.FullName }
  $zip.Dispose()
}

Write-Host "Packaged $($names.Count) entries into $out"
$names | Sort-Object | ForEach-Object { Write-Host "  $_" }
