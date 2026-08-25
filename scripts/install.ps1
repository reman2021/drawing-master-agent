$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $ProjectRoot "scripts/install.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Drawing Master installation failed with exit code $LASTEXITCODE."
}
