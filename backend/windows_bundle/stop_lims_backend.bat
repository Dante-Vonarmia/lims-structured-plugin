@echo off
setlocal

taskkill /IM lims-backend.exe /F >nul 2>&1

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :18081 ^| findstr LISTENING') do (
  taskkill /PID %%p /F >nul 2>&1
)

echo Backend stopped.
endlocal
