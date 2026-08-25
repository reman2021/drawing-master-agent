$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $ProjectRoot "scripts/uninstall.mjs") @args
if ($LASTEXITCODE -ne 0) {
    throw "Drawing Master uninstallation failed with exit code $LASTEXITCODE."
}
