@echo off
setlocal
set ROOT=%~dp0
set EXE=%ROOT%lims-backend\lims-backend.exe

if not exist "%EXE%" (
  echo [ERROR] Missing executable: %EXE%
  pause
  exit /b 1
)

start "LIMS Backend" "%EXE%"

for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18081/healthz' -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo Backend is starting. Open browser manually: http://127.0.0.1:18081/
goto end

:ready
start "" "http://127.0.0.1:18081/"

:end
endlocal
