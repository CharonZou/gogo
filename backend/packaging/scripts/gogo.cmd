@echo off
setlocal EnableExtensions
set "DIR=%~dp0"
set "GW=%DIR%..\..\gogo-gateway.exe"
if not exist "%GW%" set "GW=%DIR%..\gogo-gateway.exe"
if exist "%GW%" (
  "%GW%" --mode cli %*
  exit /b %ERRORLEVEL%
)
echo gogo: gogo-gateway.exe not found next to bundled CLI (expected under tools\gogo) 1>&2
exit /b 127
