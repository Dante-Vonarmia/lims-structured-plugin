param(
    [string]$PythonExe = "python",
    [string]$OutDir = "release-win11"
)

$ErrorActionPreference = "Stop"

$bundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $bundleDir

Write-Host "[1/6] Backend dir: $backendDir"
Set-Location $backendDir

$venvDir = Join-Path $backendDir ".build-win11"
if (Test-Path $venvDir) {
    Write-Host "[2/6] Removing old build venv"
    Remove-Item -Recurse -Force $venvDir
}

Write-Host "[3/6] Creating build venv"
& $PythonExe -m venv $venvDir

$py = Join-Path $venvDir "Scripts\python.exe"

Write-Host "[4/6] Installing dependencies"
& $py -m pip install --upgrade pip
& $py -m pip install -r (Join-Path $backendDir "requirements.txt")
& $py -m pip install pyinstaller

Write-Host "[5/6] Building executable bundle"
& $py -m PyInstaller --noconfirm --clean (Join-Path $bundleDir "lims_backend.spec")

$releaseDir = Join-Path $backendDir $OutDir
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

Copy-Item -Recurse -Force (Join-Path $backendDir "dist\lims-backend") $releaseDir
Copy-Item -Force (Join-Path $bundleDir "run_lims_backend.bat") $releaseDir
Copy-Item -Force (Join-Path $bundleDir "stop_lims_backend.bat") $releaseDir
Copy-Item -Force (Join-Path $bundleDir "README.md") $releaseDir

Write-Host "[6/6] Done"
Write-Host "Output: $releaseDir"
