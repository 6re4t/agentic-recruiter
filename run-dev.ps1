$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPath = Join-Path $root "frontend"

if (-not (Test-Path $frontendPath)) {
    throw "Frontend folder not found at: $frontendPath"
}

$backendCommand = "Set-Location '$root'; conda activate agentic; uvicorn backend.app.main:app --reload"
$frontendCommand = "Set-Location '$frontendPath'; npm run dev"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand

Write-Host "Started backend and frontend in separate PowerShell windows."
Write-Host "Backend: uvicorn backend.app.main:app --reload"
Write-Host "Frontend: npm run dev"
