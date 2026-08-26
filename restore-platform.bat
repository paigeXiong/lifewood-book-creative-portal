@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: restore-platform.bat backup.zip [-Replace] [-DataDirectory path]
  pause
  exit /b 2
)
echo [Lifewood] Restoring platform data...
set "RESTORE_SCRIPT=scripts\restore-platform.ps1"
if not exist "%RESTORE_SCRIPT%" set "RESTORE_SCRIPT=restore-platform.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RESTORE_SCRIPT%" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Restore failed. No verified replacement was completed.
  pause
  exit /b 1
)
echo.
pause
