@echo off
setlocal
cd /d "%~dp0"

echo.
echo [Lifewood] Stopping local development services...
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

set "LIFEWOOD_INHERITED_PATH=%PATH%"
set "PATH="
set "Path=%LIFEWOOD_INHERITED_PATH%"
set "LIFEWOOD_INHERITED_PATH="

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" -Stop
if errorlevel 1 (
  echo.
  echo [ERROR] Stop failed. Check the message above.
  pause
  exit /b 1
)

echo.
echo Local development services have stopped.
exit /b 0
