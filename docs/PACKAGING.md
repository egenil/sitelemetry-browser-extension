# Packaging

The stores take a plain zip of the extension root: `manifest.json` at the top level, next to `_locales/`, `icons/`, `src/` and `LICENSE`. Tests, scripts, docs and `dist/` stay out of the package.

## With the script (PowerShell, Windows)

```powershell
npm run pack
# or
powershell -ExecutionPolicy Bypass -File scripts/pack.ps1
```

`scripts/pack.ps1` runs the manifest validation and the no-remote-code scan first, writes `dist/sitelemetry-audit-<version>.zip` with `Compress-Archive`, then opens the archive and checks that every entry name uses forward slashes. Windows PowerShell 5.1's `Compress-Archive` used to write backslashes into entry names, which the Chrome Web Store rejects with a "could not unzip" style error; when the script sees a backslash it rebuilds the archive with `System.IO.Compression` and forward slashes. The script prints the entry list at the end; it should look like `src/popup/popup.js`, never `src\popup\popup.js`.

## By hand

```powershell
Compress-Archive -Path manifest.json, _locales, icons, src, LICENSE -DestinationPath dist/sitelemetry-audit-0.1.0.zip -CompressionLevel Optimal
```

Verify the entry names:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::OpenRead("dist/sitelemetry-audit-0.1.0.zip").Entries.FullName
```

On PowerShell 7 (`pwsh`) or with the built-in `tar` (`tar -a -c -f dist/sitelemetry-audit-0.1.0.zip manifest.json _locales icons src LICENSE`) the names are already correct.

## Checklist before uploading

1. `npm test` and `npm run check` pass.
2. `manifest.json`, `src/shared/version.js` and `package.json` carry the same, increased version.
3. The zip has `manifest.json` at its root (not inside a folder).
4. Load the zip's content unpacked once (`chrome://extensions` > Load unpacked on an extracted copy) and click through: settings, test connection, audit, badge.
5. Upload the same zip to the Chrome Web Store and to Edge Add-ons (see SUBMISSION.md).
