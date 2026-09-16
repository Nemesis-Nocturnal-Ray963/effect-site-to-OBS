@echo off
setlocal
chcp 65001 >nul
rem Windows locks the current directory. Leave scripts before it is backed up.
set "OBS_UPDATE_ROOT=%~dp0.."
cd /d "%OBS_UPDATE_ROOT%"
if errorlevel 1 (
  echo Could not open the application folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then try again.
  pause
  exit /b 1
)
rem Keep the launcher block parsed while the updater replaces scripts on disk.
(
  node "%~dp0update.mjs" --root "%OBS_UPDATE_ROOT%" %*
  if errorlevel 1 (
    echo.
    echo Update did not complete. Read the message and backup location above.
    pause
    exit /b 1
  )
  echo.
  pause
  exit /b 0
)
