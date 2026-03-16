@echo off
:: install-plugins.bat
:: Windows wrapper for scripts/install-plugins.mjs
::
:: Usage:
::   install-plugins.bat                     Install all plugins
::   install-plugins.bat --add <github-url>  Register + install from GitHub
::   install-plugins.bat --list              List registered plugins
::   install-plugins.bat --help              Show full usage

setlocal

:: Check that Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js was not found in PATH.
    echo  Please install Node.js ^>=20 from https://nodejs.org/ and try again.
    echo.
    exit /b 1
)

:: Move to repo root (the parent of the directory this batch file lives in)
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."

:: Forward all arguments to the Node script
node scripts/install-plugins.mjs %*
exit /b %errorlevel%
