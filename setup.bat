@echo off
setlocal

echo.
echo  service-cms setup
echo  -----------------
echo.

:: ── Check Node.js ───────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo.
    echo  Download it from: https://nodejs.org/
    echo  Recommended: LTS version 20 or higher.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>^&1') do set NODE_VERSION=%%v
echo  [OK] Node.js %NODE_VERSION% found.

:: ── Check npm ────────────────────────────────────────────────────────────────
where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] npm is not available. Re-install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: ── Install dependencies if node_modules is missing ─────────────────────────
if not exist "node_modules\" (
    echo.
    echo  [INFO] node_modules not found — running npm install first...
    echo.
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: ── Run the setup wizard ─────────────────────────────────────────────────────
echo.
call npm run setup
if errorlevel 1 (
    echo.
    echo  [ERROR] Setup exited with an error.
    pause
    exit /b 1
)

echo.
echo  Setup finished successfully.
echo  Press any key to close this window.
pause

endlocal
