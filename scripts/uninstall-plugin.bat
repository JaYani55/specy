@echo off
:: uninstall-plugin.bat
:: Windows wrapper for scripts/uninstall-plugin.mjs
::
:: Usage:
::   uninstall-plugin.bat <plugin-id>               Remove a plugin
::   uninstall-plugin.bat <plugin-id> --prune-deps  Remove + uninstall its npm packages
::   uninstall-plugin.bat <plugin-id> --yes         Skip confirmation prompt
::   uninstall-plugin.bat --list                    List registered plugins
::   uninstall-plugin.bat --help                    Show full usage

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
node scripts/uninstall-plugin.mjs %*
exit /b %errorlevel%
