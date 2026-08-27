@echo off
setlocal
cd /d "%~dp0"
echo [Lifewood] Building localized Windows MSI installers...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-msi.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] MSI build failed. Review the message above.
  pause
  exit /b 1
)
echo.
echo [Lifewood] MSI installers are available in artifacts\installer.
pause
