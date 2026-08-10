@echo off
setlocal
cd /d "%~dp0\.."
call corepack pnpm build
if errorlevel 1 pause
