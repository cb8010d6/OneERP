@echo off
setlocal

echo ===================================================
echo   EIP Startup Script (Enhanced)
echo ===================================================

:: Check for Administrator privileges
NET SESSION >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Not running as Administrator!
    echo Please right-click start.bat and select "Run as administrator"
    echo Otherwise, it cannot automatically fix port 5432 conflicts.
    echo.
    pause
) else (
    echo [1/5] Resetting Windows NAT to free Docker ports...
    net stop winnat >nul 2>&1
    net start winnat >nul 2>&1
)

cd /d "%~dp0"

echo [2/5] Killing zombie processes on ports 3000, 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do taskkill /F /PID %%a 2>nul

echo [3/5] Starting infrastructure containers...
docker compose up -d

echo [4/5] Starting NestJS API...
cd apps\api
call npx prisma generate
start "EIP Backend API" cmd /k "npm run start:dev"

echo [5/5] Starting Next.js Web App...
cd ..\web
start "EIP Web App" cmd /k "npm run dev"

echo.
echo ===================================================
echo  Startup commands executed!
echo  API Swagger: http://localhost:8000/api/docs
echo  Web Dashboard: http://localhost:3000
echo ===================================================
pause
