@echo off
call "%~dp0stop-local.bat" %*
exit /b %errorlevel%
