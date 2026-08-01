@echo off
echo ========================================
echo  Factory Alert System - Build APK
echo ========================================
echo.

set PROJECT_DIR=%~dp0
cd /d %PROJECT_DIR%

echo [1/4] Checking environment...
if "%ANDROID_HOME%"=="" (
    echo ERROR: ANDROID_HOME is not set!
    echo Please set ANDROID_HOME to your Android SDK path
    pause
    exit /b 1
)
echo ANDROID_HOME: %ANDROID_HOME%

echo.
echo [2/4] Installing dependencies (legacy peer deps)...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Select build type:
echo  1. Debug APK (for testing)
echo  2. Release APK (for production)
echo ========================================
set /p BUILD_TYPE="Enter choice (1 or 2): "

cd android

if "%BUILD_TYPE%"=="1" (
    echo.
    echo [3/4] Building Debug APK...
    call gradlew assembleDebug
    
    if %errorlevel% neq 0 (
        echo ERROR: Build failed!
        pause
        exit /b 1
    )
    
    echo.
    echo [4/4] Build complete!
    echo.
    echo ========================================
    echo  DEBUG APK Location:
    echo  android\app\build\outputs\apk\debug\app-debug.apk
    echo ========================================
    
    if exist "app\build\outputs\apk\debug\app-debug.apk" (
        echo.
        echo Opening output folder...
        explorer "app\build\outputs\apk\debug"
    )
) else if "%BUILD_TYPE%"=="2" (
    echo.
    echo [3/4] Checking keystore...
    if not exist "app\factory-alert-release.keystore" (
        echo.
        echo Keystore not found! Creating new keystore...
        echo.
        echo Please enter the following information:
        keytool -genkeypair -v -storetype PKCS12 -keystore app\factory-alert-release.keystore -alias factory-alert -keyalg RSA -keysize 2048 -validity 10000
        
        if %errorlevel% neq 0 (
            echo ERROR: Failed to create keystore!
            pause
            exit /b 1
        )
        
        echo.
        echo IMPORTANT: Update android\gradle.properties with your keystore password!
        echo.
        pause
    )
    
    echo.
    echo [3/4] Building Release APK...
    call gradlew assembleRelease
    
    if %errorlevel% neq 0 (
        echo ERROR: Build failed!
        pause
        exit /b 1
    )
    
    echo.
    echo [4/4] Build complete!
    echo.
    echo ========================================
    echo  RELEASE APK Location:
    echo  android\app\build\outputs\apk\release\app-release.apk
    echo ========================================
    
    if exist "app\build\outputs\apk\release\app-release.apk" (
        echo.
        echo Opening output folder...
        explorer "app\build\outputs\apk\release"
    )
) else (
    echo Invalid choice!
)

cd ..
echo.
pause
