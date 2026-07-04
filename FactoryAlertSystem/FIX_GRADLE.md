# 🔧 FIX NHANH - Lỗi gradlew.bat not found

## Cách 1: Tạo Project Mới (Khuyến nghị - 5 phút)

### Bước 1: Tạo React Native project mới
```powershell
cd D:\1.ST4I\FOxconn\files

# Tạo project mới
npx react-native@latest init FactoryAlertNew --version 0.73.2

cd FactoryAlertNew
```

### Bước 2: Copy source code từ project cũ
```powershell
# Copy thư mục src
xcopy /E /I "..\FactoryAlertSystem\src" ".\src"

# Copy các file config
copy "..\FactoryAlertSystem\App.tsx" ".\App.tsx"
copy "..\FactoryAlertSystem\index.js" ".\index.js"
copy "..\FactoryAlertSystem\shim.js" ".\shim.js"
copy "..\FactoryAlertSystem\babel.config.js" ".\babel.config.js"
copy "..\FactoryAlertSystem\metro.config.js" ".\metro.config.js"
copy "..\FactoryAlertSystem\tsconfig.json" ".\tsconfig.json"

# Copy Android resources
xcopy /E /I "..\FactoryAlertSystem\android\app\src\main\res" ".\android\app\src\main\res"
```

### Bước 3: Cài dependencies
```powershell
npm install react-native-paper react-native-vector-icons react-native-safe-area-context react-native-screens @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack @react-native-async-storage/async-storage mqtt @notifee/react-native zustand uuid date-fns react-native-gesture-handler react-native-reanimated react-native-sound react-native-svg buffer events process stream-browserify url
```

### Bước 4: Chạy app
```powershell
# Terminal 1
npm start

# Terminal 2
npm run android
```

---

## Cách 2: Download Gradle Wrapper (Nếu muốn giữ project cũ)

### Chạy trong PowerShell (Admin):
```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem

# Tạo thư mục nếu chưa có
New-Item -ItemType Directory -Force -Path "android\gradle\wrapper"

# Download gradle-wrapper.jar
$url = "https://github.com/nickcoutsos/react-native-jetifier/raw/main/gradle-wrapper.jar"
$output = "android\gradle\wrapper\gradle-wrapper.jar"
Invoke-WebRequest -Uri $url -OutFile $output
```

### Hoặc tải thủ công:
1. Download từ: https://services.gradle.org/distributions/gradle-8.3-all.zip
2. Giải nén
3. Copy file `lib/gradle-wrapper.jar` vào `android/gradle/wrapper/`

---

## Cách 3: Dùng Android Studio

1. Mở Android Studio
2. File → Open → Chọn thư mục `FactoryAlertSystem/android`
3. Đợi Android Studio sync
4. Android Studio sẽ tự động download Gradle
5. Build → Build APK

---

## Sau khi fix, chạy lại:

```powershell
# Terminal 1: Metro Bundler
npm start

# Terminal 2: Build Android
npm run android
```

Hoặc build APK trực tiếp:
```powershell
cd android
.\gradlew.bat assembleDebug
```
