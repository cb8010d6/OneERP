@echo off
setlocal

echo ===================================================
echo   Enterprise ERP (EIP) - Safe Stop Script
echo ===================================================

cd /d "%~dp0"

echo [1/3] Closing NestJS and Web processes...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "0.0.0.0:8000" ') DO (
  taskkill /f /pid %%T > nul 2>&1
)
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "0.0.0.0:3000" ') DO (
  taskkill /f /pid %%T > nul 2>&1
)

echo [2/3] Suspending Docker containers...
docker compose stop

NET SESSION >nul 2>&1
if %errorlevel% neq 0 (
    echo [3/3] (Skipped) No Admin rights, skipping port reset.
) else (
    echo [3/3] Cleaning up Windows NAT locks...
    net stop winnat >nul 2>&1
    net start winnat >nul 2>&1
)

echo.
echo ===================================================
echo  System successfully stopped!
echo ===================================================
pause
