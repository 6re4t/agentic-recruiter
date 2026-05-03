$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPath = Join-Path $root "frontend"

if (-not (Test-Path $frontendPath)) {
    throw "Frontend folder not found at: $frontendPath"
}

$backendCommand = @"
Set-Location '$root'
# Clear any session-level env vars that would override .env
foreach (`$v in @('OPENROUTER_API_KEY','OPENROUTER_BASE_URL','OPENROUTER_MODEL',
  'SMTP_ENABLED','SMTP_HOST','SMTP_PORT','SMTP_USERNAME','SMTP_PASSWORD',
  'SMTP_USE_TLS','SMTP_USE_SSL','SMTP_FROM_EMAIL','SMTP_FROM_NAME',
  'SMTP_AUTO_SEND_APPROVED','DATABASE_URL','UPLOAD_DIR','CORS_ORIGINS',
  'CHECKPOINT_DB_PATH','OCR_MAX_PAGES','TEXT_MIN_CHARS_FOR_NO_OCR')) {
  Remove-Item "Env:\`$v" -ErrorAction SilentlyContinue
}
conda activate agentic
uvicorn backend.app.main:app --reload
"@
$frontendCommand = "Set-Location '$frontendPath'; npm run dev"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand

Write-Host "Started backend and frontend in separate PowerShell windows."
Write-Host "Backend: uvicorn backend.app.main:app --reload"
Write-Host "Frontend: npm run dev"
