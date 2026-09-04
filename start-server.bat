@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "LIFEWOOD_START_SCRIPT=%~dp0ops\start-portable.ps1"
if not exist "%LIFEWOOD_START_SCRIPT%" set "LIFEWOOD_START_SCRIPT=%~dp0scripts\start-portable.ps1"
if not exist "%LIFEWOOD_START_SCRIPT%" (
  echo [ERROR] Startup helper was not found. / 未找到启动辅助脚本。
  pause
  exit /b 1
)

set "LIFEWOOD_START_ARGS="
if /i "%~1"=="/no-browser" set "LIFEWOOD_START_ARGS=-NoBrowser"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LIFEWOOD_START_SCRIPT%" %LIFEWOOD_START_ARGS%
if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed. Check server.log and server.error.log. / 启动失败，请检查服务端日志。
  pause
  exit /b 1
)

endlocal
exit /b 0
