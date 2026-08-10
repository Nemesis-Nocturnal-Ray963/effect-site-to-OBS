@echo off
setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

where corepack >nul 2>nul
if errorlevel 1 (
  echo Corepack is required.
  pause
  exit /b 1
)

set "PNPM_STORE=%LOCALAPPDATA%\pnpm\store\v3"

echo Installing dependencies...
echo TikTok LIVE real connector dependency: tiktok-live-connector
corepack pnpm install --store-dir "%PNPM_STORE%"
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)

echo Install complete.
pause

