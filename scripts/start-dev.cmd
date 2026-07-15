@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-dev.ps1"
