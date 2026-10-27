@echo off
rem ============================================================
rem  GoGo IDE 引擎 - 本地进程启动脚本（无 Docker）
rem  端口: 18080   入口: http://localhost:18080
rem  数据: ide\runtime\openvscode-server\data
rem  扩展: ide\runtime\openvscode-server\extensions (含 gogo-ai)
rem ============================================================
setlocal
set "RUNTIME=%~dp0..\ide\runtime\openvscode-server"
for %%I in ("%RUNTIME%") do set "RUNTIME=%%~fI"

if not exist "%RUNTIME%\out\server-main.js" (
  echo [GoGo IDE] ERROR: runtime not found at %RUNTIME%
  exit /b 1
)

rem 检查 18080 是否已占用（已跑则直接提示并退出）
netstat -ano | findstr ":18080" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo [GoGo IDE] engine already running on :18080
  echo [GoGo IDE] open http://localhost:18080
  exit /b 0
)

cd /d "%RUNTIME%"

rem 确保数据目录存在
if not exist "%RUNTIME%\data\logs" mkdir "%RUNTIME%\data\logs"

start "GoGo IDE Engine" /min node "out\server-main.js" --port 18080 --without-connection-token --locale=zh-cn "--user-data-dir=%RUNTIME%\data" "--extensions-dir=%RUNTIME%\extensions"
echo [GoGo IDE] engine starting on http://localhost:18080
exit /b 0
