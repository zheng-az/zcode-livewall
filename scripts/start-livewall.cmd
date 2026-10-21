@echo off
setlocal EnableExtensions
rem ============================================================
rem  zcode-livewall one-shot bootstrap for new devices
rem
rem  usage:
rem    start-livewall.cmd                          (no wallpaper yet)
rem    start-livewall.cmd "D:\video.mp4" --dim 35  (apply + start)
rem
rem  Finds a usable Node.js, applies the wallpaper given as
rem  arguments, starts ZCode with the CDP debug port (auto-picks
rem  a free port if 9222 is taken), then starts the resident
rem  service. Afterwards use the crystal button in ZCode's
rem  bottom-right corner, or just ask the AI.
rem ============================================================
set "HERE=%~dp0"
set "CLI=%HERE%..\dist\cli.js"
if not exist "%CLI%" (
  echo [zcode-livewall] dist\cli.js not found next to this script.
  exit /b 1
)

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE for %%P in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LOCALAPPDATA%\Programs\nodejs\node.exe") do if exist "%%~P" set "NODE_EXE=%%~P"
if not defined NODE_EXE (
  echo [zcode-livewall] Node.js 20+ was not found.
  echo                   Install it from https://nodejs.org and re-run this script.
  exit /b 1
)
echo [zcode-livewall] node = %NODE_EXE%

if not "%~1"=="" (
  echo [zcode-livewall] applying wallpaper: %*
  "%NODE_EXE%" "%CLI%" apply %*
)

echo [zcode-livewall] starting ZCode with the CDP debug port...
"%NODE_EXE%" "%CLI%" launch
echo [zcode-livewall] starting the resident service...
"%NODE_EXE%" "%CLI%" serve --detach
"%NODE_EXE%" "%CLI%" status
echo.
echo [zcode-livewall] done. If a crystal button appeared in ZCode's bottom-right
echo                  corner, everything is live. It now survives every restart.
exit /b 0
