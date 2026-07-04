@echo off
echo ========================================
echo  Fix Gradle Wrapper - Factory Alert
echo ========================================
echo.

cd /d %~dp0

echo [1/3] Creating gradle wrapper directory...
if not exist "android\gradle\wrapper" mkdir "android\gradle\wrapper"

echo [2/3] Downloading gradle-wrapper.jar...
echo This may take a moment...

powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/nickcoutsos/react-native-jetifier/raw/main/gradle-wrapper.jar' -OutFile 'android\gradle\wrapper\gradle-wrapper.jar'}" 2>nul

if not exist "android\gradle\wrapper\gradle-wrapper.jar" (
    echo.
    echo Alternative download method...
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/nickcoutsos/react-native-jetifier/main/gradle-wrapper.jar', 'android\gradle\wrapper\gradle-wrapper.jar')}" 2>nul
)

if not exist "android\gradle\wrapper\gradle-wrapper.jar" (
    echo.
    echo ========================================
    echo  Manual Fix Required
    echo ========================================
    echo.
    echo Could not download gradle-wrapper.jar automatically.
    echo.
    echo Please run this command in PowerShell:
    echo.
    echo cd %~dp0
    echo npx react-native-fix-gradle-wrapper
    echo.
    echo Or manually download from:
    echo https://services.gradle.org/distributions/gradle-8.3-bin.zip
    echo.
    pause
    exit /b 1
)

echo [3/3] Verifying files...

if exist "android\gradle\wrapper\gradle-wrapper.jar" (
    echo.
    echo ========================================
    echo  SUCCESS! Gradle wrapper fixed.
    echo ========================================
    echo.
    echo Now run:
    echo   npm start        (Terminal 1)
    echo   npm run android  (Terminal 2)
    echo.
) else (
    echo.
    echo ERROR: gradle-wrapper.jar not found!
    echo.
)

pause
