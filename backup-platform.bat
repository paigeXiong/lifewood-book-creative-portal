@echo off
setlocal
cd /d "%~dp0"
echo [Lifewood] Backing up platform data...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\backup-platform.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Backup failed. Stop local services and retry.
  pause
  exit /b 1
)
echo.
pause
