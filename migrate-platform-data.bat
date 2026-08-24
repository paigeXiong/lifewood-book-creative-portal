@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\migrate-test-api-data.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Data migration failed. The original data was not removed.
  pause
  exit /b 1
)

echo.
echo Data migration check completed. The original data is retained as a backup.
exit /b 0
