@echo off
setlocal
cd /d "%~dp0"
echo.
echo [Lifewood] Building verified production release...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts/build-release.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Release build failed.
  pause
  exit /b 1
)
echo.
echo Release build completed. See artifacts/release.
pause
