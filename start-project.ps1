# ==============================================================================
# SmartLift AI — Windows PowerShell Startup Helper Script
# Launches the Python FastAPI service and Node.js Express backend.
# ==============================================================================

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "       SMARTLIFT AI — STARTUP LAUNCHER (Windows 11)              " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$ROOT_DIR = $PSScriptRoot
Set-Location $ROOT_DIR

# 1. Check Python Environment
$PYTHON_BIN = Join-Path $ROOT_DIR ".venv\Scripts\python.exe"
if (-not (Test-Path $PYTHON_BIN)) {
    Write-Host "[!] Virtual environment not found at .venv\Scripts\python.exe" -ForegroundColor Yellow
    Write-Host "    Attempting to locate system python..." -ForegroundColor Gray
    $PYTHON_BIN = "python"
}

# 2. Check if models exist
$MODEL_FILE = Join-Path $ROOT_DIR "ml\models\demand_model.joblib"
if (-not (Test-Path $MODEL_FILE)) {
    Write-Host "[*] Trained model not found. Generating dataset and training model..." -ForegroundColor Yellow
    & $PYTHON_BIN (Join-Path $ROOT_DIR "ml\data\generate_dataset.py") --days 21 --seed 42
    & $PYTHON_BIN (Join-Path $ROOT_DIR "ml\src\train_model.py")
    Write-Host "[✓] Model training completed successfully." -ForegroundColor Green
}

# 3. Check Node.js Dependencies
$NODE_MODULES = Join-Path $ROOT_DIR "backend\node_modules"
if (-not (Test-Path $NODE_MODULES)) {
    Write-Host "[*] Installing backend Node.js dependencies..." -ForegroundColor Yellow
    Set-Location (Join-Path $ROOT_DIR "backend")
    npm install
    Set-Location $ROOT_DIR
    Write-Host "[✓] Node.js dependencies installed." -ForegroundColor Green
}

# 4. Launch Python FastAPI Service in a separate terminal window
Write-Host "[*] Starting Python FastAPI Microservice on port 8000..." -ForegroundColor Cyan
$pythonCommand = "cd '$ROOT_DIR'; & '$PYTHON_BIN' -m uvicorn python_service.main:app --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $pythonCommand

# Wait 2 seconds for Python service to bind port
Start-Sleep -Seconds 2

# 5. Launch Node.js Express Backend in a separate terminal window
Write-Host "[*] Starting Node.js Express Backend on port 3000..." -ForegroundColor Cyan
$nodeCommand = "cd '$ROOT_DIR\backend'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $nodeCommand

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " [✓] Services successfully launched!                             " -ForegroundColor Green
Write-Host "     - Python FastAPI Microservice: http://127.0.0.1:8000        " -ForegroundColor Gray
Write-Host "     - Node.js Express Backend:    http://127.0.0.1:3000        " -ForegroundColor Gray
Write-Host "     - SmartLift OS UI:            http://localhost:3000/smartlift.html" -ForegroundColor Cyan
Write-Host "     - Classic Baseline UI:        http://localhost:3000/INDEX.html" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""

# Optional: Open default browser
try {
    Start-Process "http://localhost:3000/smartlift.html"
} catch {
    Write-Host "Open http://localhost:3000/smartlift.html in your browser." -ForegroundColor Gray
}
