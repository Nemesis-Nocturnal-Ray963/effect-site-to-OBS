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

if not exist "node_modules" (
  call corepack pnpm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call corepack pnpm build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

start "OBS Effect App Server" cmd /k "cd /d %cd% && corepack pnpm --filter @obs-effect/server start"

echo Waiting for http://127.0.0.1:3190/health ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:3190/health' -TimeoutSec 1; if ($r.status -eq 'ok') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Server did not become healthy. Check the server window above.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3190/control"
echo Control UI: http://127.0.0.1:3190/control
echo OBS Overlay: http://127.0.0.1:3190/overlay
pause
