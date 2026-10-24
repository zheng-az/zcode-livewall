@echo off
setlocal EnableExtensions
rem ============================================================
rem  zcode-livewall one-shot bootstrap for new devices
rem
rem  usage:
rem    start-livewall.cmd                          (no wallpaper yet)
rem    start-livewall.cmd "D:\video.mp4" --dim 35  (apply + start)
rem
rem  Prefers the bundled standalone executables (no Node.js needed);
rem  falls back to any Node >= 18 on the machine. Applies the
rem  wallpaper given as arguments, starts ZCode with the CDP debug
rem  port (auto-picks a free port), then starts the resident service.
rem  Afterwards use the crystal button in ZCode's bottom-right
rem  corner, or just ask the AI.
rem ============================================================
set "HERE=%~dp0"
set "DIST=%HERE%..\dist\"

rem --- prefer the standalone exe: zero dependencies ---
if exist "%DIST%zcode-livewall.exe" (
  set "LW=%DIST%zcode-livewall.exe"
  goto :have-lw
)

rem --- fallback: find Node >= 18 ---
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE call :trynode "%%~N"
if not defined NODE_EXE for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%SystemDrive%\nodejs\node.exe"
  "C:\nodejs\node.exe"
) do if exist %%P if not defined NODE_EXE call :trynode %%P
if not defined NODE_EXE (
  echo [zcode-livewall] No standalone exe and no Node.js 18+ found.
  echo                  Install Node from https://nodejs.org and re-run.
  exit /b 1
)
set "LW=%NODE_EXE% %DIST%cli.js"
echo [zcode-livewall] node = %NODE_EXE% (exe missing, using Node fallback)

:have-lw
if not "%~1"=="" (
  echo [zcode-livewall] applying wallpaper: %*
  %LW% apply %*
)
echo [zcode-livewall] starting ZCode with the CDP debug port...
%LW% launch
echo [zcode-livewall] starting the resident service...
%LW% serve --detach
%LW% status
echo.
echo [zcode-livewall] done. If the crystal button appeared in ZCode's bottom-right
echo                  corner, everything is live. It now survives every restart.
exit /b 0

:trynode
set "CAND=%~1"
"%CAND%" -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
if not errorlevel 1 set "NODE_EXE=%CAND%"
exit /b 0
