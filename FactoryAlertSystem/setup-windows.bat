@echo off
echo ========================================
echo  Factory Alert System - Windows Setup
echo ========================================
echo.

:: Check Node.js
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install from: https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js OK

:: Check npm
echo [2/5] Checking npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed!
    pause
    exit /b 1
)
echo npm OK

:: Check Java
echo [3/5] Checking Java...
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Java is not installed!
    echo Please install JDK 17 from: https://adoptium.net/
    pause
    exit /b 1
)
echo Java OK

:: Check ANDROID_HOME
echo [4/5] Checking Android SDK...
if "%ANDROID_HOME%"=="" (
    echo WARNING: ANDROID_HOME is not set!
    echo Please set ANDROID_HOME environment variable to your Android SDK path
    echo Example: C:\Users\YourUser\AppData\Local\Android\Sdk
)
echo Android SDK path: %ANDROID_HOME%

:: Install dependencies
echo.
echo [5/5] Installing dependencies...
echo This may take a few minutes...
call npm install

if %errorlevel% neq 0 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Setup Complete!
echo ========================================
echo.
echo Next steps:
echo.
echo 1. Open Terminal 1 and run:
echo    npm start
echo.
echo 2. Open Terminal 2 and run:
echo    npm run android
echo.
echo If using physical device:
echo    adb reverse tcp:8081 tcp:8081
echo.
pause
