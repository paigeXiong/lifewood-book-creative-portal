@echo off
setlocal
cd /d "%~dp0"
echo [Lifewood] Backing up platform data...
set "BACKUP_SCRIPT=scripts\backup-platform.ps1"
if not exist "%BACKUP_SCRIPT%" set "BACKUP_SCRIPT=backup-platform.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BACKUP_SCRIPT%" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Backup failed. Stop local services and retry.
  pause
  exit /b 1
)
echo.
pause
