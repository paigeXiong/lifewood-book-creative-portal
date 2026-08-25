@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="/no-browser" set "LIFEWOOD_NO_BROWSER=1"

echo.
echo [Lifewood] Starting local development services...
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

rem Normalize the inherited path variable. Some launchers provide both Path and PATH,
rem which makes Windows PowerShell Start-Process reject the child environment.
set "LIFEWOOD_INHERITED_PATH=%PATH%"
set "PATH="
set "Path=%LIFEWOOD_INHERITED_PATH%"
set "LIFEWOOD_INHERITED_PATH="

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed. Check the message above or artifacts\dev-logs.
  pause
  exit /b 1
)

if /i not "%LIFEWOOD_NO_BROWSER%"=="1" start "" "http://127.0.0.1:5173/zh-CN/tasks"

echo.
echo Customer page: http://127.0.0.1:5173/zh-CN/tasks
echo Admin center:  http://127.0.0.1:5174/zh-CN/projects
echo.
echo Services are running in the background. This window can be closed.
exit /b 0
