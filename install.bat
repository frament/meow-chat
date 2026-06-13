@echo off
setlocal enabledelayedexpansion

echo ===== MeowChat Windows Install =====

:: Find Go
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Go not found. Install Go from https://go.dev/dl/
    exit /b 1
)

:: Find Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    exit /b 1
)

:: Build backend
echo.
echo [1/3] Building backend...
cd backend
set CGO_ENABLED=1
for /f "tokens=*" %%i in ('git describe --tags --always --dirty 2^>nul') do set GIT_VERSION=%%i
if "!GIT_VERSION!"=="" set GIT_VERSION=dev
go build -ldflags="-X my-chat-backend/version.Version=!GIT_VERSION!" -o meow-chat-server.exe .
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed
    exit /b 1
)
cd ..

:: Build frontend
echo.
echo [2/3] Building frontend...
cd frontend
call npm ci 2>nul || echo npm ci skipped, continuing
call npx ng build --configuration production
if %errorlevel% neq 0 (
    echo ERROR: Frontend build failed
    exit /b 1
)
cd ..

:: Create directories
echo.
echo [3/3] Creating directories...
if not exist "data" mkdir data
if not exist "uploads\avatars" mkdir uploads\avatars
if not exist "uploads\posts" mkdir uploads\posts
if not exist "uploads\messages" mkdir uploads\messages
if not exist "uploads\federation_cache" mkdir uploads\federation_cache

:: Copy binaries
copy /Y backend\meow-chat-server.exe meow-chat-server.exe >nul

echo.
echo ===== Install complete =====
echo.
echo To run: set DB_PATH=./data/chat.db ^&^& meow-chat-server.exe
echo.
echo Or register as Windows service using nssm:
echo   nssm install MeowChat "C:\path\to\meow-chat-server.exe"
echo   nssm set MeowChat AppDirectory "C:\path\to\project"
echo   nssm set MeowChat AppEnvironmentExtra "DB_PATH=./data/chat.db"
echo   nssm start MeowChat
echo.
echo Frontend build is in frontend\dist\frontend\
echo Configure nginx or IIS to serve it as SPA.
