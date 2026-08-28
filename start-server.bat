@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "LIFEWOOD_SERVER=%~dp0server\Lifewood.BookPortal.Server.exe"
set "LIFEWOOD_DATA=%~dp0data"
set "LIFEWOOD_URL=http://127.0.0.1:5077"
set "LIFEWOOD_LOG=%~dp0server.log"

if not exist "%LIFEWOOD_SERVER%" (
  echo [Lifewood] Server executable was not found. / 未找到服务端程序。
  pause
  exit /b 1
)

where curl.exe >nul 2>&1
if errorlevel 1 (
  echo [Lifewood] Windows curl.exe is required for startup verification. / 启动检查需要 Windows curl.exe。
  pause
  exit /b 1
)

curl.exe --silent --fail --max-time 2 "%LIFEWOOD_URL%/api/health" >nul 2>&1
if not errorlevel 1 goto already_running

>"%LIFEWOOD_LOG%" echo [Lifewood] Server log / 服务端日志
start "Lifewood Book Creative Portal Server" /b "%LIFEWOOD_SERVER%" --urls "%LIFEWOOD_URL%" --Lifewood:DataDirectory "%LIFEWOOD_DATA%" --Lifewood:AllowInsecureHttp true 1>>"%LIFEWOOD_LOG%" 2>&1

echo [Lifewood] Waiting for the web server... / 正在等待网页服务端...
for /l %%I in (1,1,30) do (
  curl.exe --silent --fail --max-time 2 "%LIFEWOOD_URL%/api/health" >nul 2>&1
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo [ERROR] The web server did not start. Check server.log. / 网页服务端启动失败，请检查 server.log。
pause
exit /b 1

:already_running
echo [Lifewood] The web server is already running. / 网页服务端已在运行。
goto open_portal

:ready
echo [Lifewood] Web server started. / 网页服务端已启动。

:open_portal
start "" "%LIFEWOOD_URL%/"
echo [Lifewood] Customer portal / 客户门户: %LIFEWOOD_URL%/
echo [Lifewood] Admin center / 管理中心: %LIFEWOOD_URL%/admin/
endlocal
exit /b 0