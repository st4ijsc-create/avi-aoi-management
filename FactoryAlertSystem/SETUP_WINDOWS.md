# 🚀 Hướng Dẫn Cài Đặt Factory Alert System trên Windows

## Yêu Cầu Hệ Thống

### 1. Cài đặt các công cụ cần thiết

#### Node.js (v18 trở lên)
```powershell
# Download và cài đặt từ: https://nodejs.org/
# Kiểm tra version
node --version
npm --version
```

#### Java Development Kit (JDK 17)
```powershell
# Download từ: https://adoptium.net/
# Hoặc dùng Chocolatey:
choco install temurin17

# Set JAVA_HOME environment variable
# System Properties > Environment Variables > New
# Variable name: JAVA_HOME
# Variable value: C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot
```

#### Android Studio
1. Download từ: https://developer.android.com/studio
2. Cài đặt với các components:
   - Android SDK
   - Android SDK Platform 34
   - Android Virtual Device (AVD)
   - Intel HAXM (cho emulator)

3. Set environment variables:
```
ANDROID_HOME = C:\Users\<YourUser>\AppData\Local\Android\Sdk
Path += %ANDROID_HOME%\platform-tools
Path += %ANDROID_HOME%\tools
Path += %ANDROID_HOME%\tools\bin
```

---

## Cách 1: Tạo Project Mới (Khuyến nghị)

### Bước 1: Tạo React Native project mới
```powershell
npx react-native@latest init FactoryAlertSystem
cd FactoryAlertSystem
```

### Bước 2: Copy source code
Copy các thư mục sau từ file ZIP vào project mới:
- `src/` → copy toàn bộ
- `App.tsx` → replace
- `index.js` → replace
- `shim.js` → copy
- `babel.config.js` → replace
- `metro.config.js` → replace
- `tsconfig.json` → replace

### Bước 3: Cài đặt dependencies
```powershell
npm install react-native-paper react-native-vector-icons react-native-safe-area-context react-native-screens @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack @react-native-async-storage/async-storage mqtt @notifee/react-native zustand uuid date-fns react-native-gesture-handler react-native-reanimated react-native-sound react-native-svg buffer events process stream-browserify url
```

### Bước 4: Link native dependencies
```powershell
# Link vector icons
npx react-native-asset

# iOS only (macOS)
cd ios && pod install && cd ..
```

### Bước 5: Cấu hình Android
Edit file `android/app/build.gradle`:
```gradle
// Thêm vào dependencies
implementation project(':react-native-vector-icons')
```

Edit file `android/app/src/main/java/.../MainApplication.kt`:
```kotlin
// Import
import com.oblador.vectoricons.VectorIconsPackage

// Trong getPackages()
packages.add(VectorIconsPackage())
```

### Bước 6: Copy Android resources
Copy các files từ `android/app/src/main/res/` vào project:
- `drawable/ic_notification.xml`
- `drawable/ic_launcher.xml`
- `values/colors.xml`
- `values/strings.xml`

### Bước 7: Chạy app
```powershell
# Terminal 1: Start Metro
npm start

# Terminal 2: Run Android
npm run android
```

---

## Cách 2: Fix Project Hiện Tại

Nếu bạn muốn sử dụng project từ ZIP:

### Bước 1: Khởi tạo lại Android folder
```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem

# Xóa android folder cũ
rmdir /s /q android

# Tạo lại từ template
npx react-native eject
```

### Bước 2: Cài dependencies
```powershell
npm install
```

### Bước 3: Chạy app
```powershell
# Mở 2 terminal

# Terminal 1:
npm start

# Terminal 2:
npm run android
```

---

## Troubleshooting

### Lỗi: "Cannot start server in new window"
**Giải pháp:** Chạy Metro server và build app trong 2 terminal riêng biệt.

### Lỗi: "SDK location not found"
**Giải pháp:** Tạo file `android/local.properties`:
```
sdk.dir=C:\\Users\\<YourUser>\\AppData\\Local\\Android\\Sdk
```

### Lỗi: "JAVA_HOME is not set"
**Giải pháp:** Set environment variable JAVA_HOME trỏ đến JDK folder.

### Lỗi: Metro bundler connection
```powershell
# Reverse port cho device thật
adb reverse tcp:8081 tcp:8081
```

### Lỗi: Gradle build failed
```powershell
# Clean build
cd android
gradlew clean
cd ..
npm run android
```

### Lỗi: Module not found
```powershell
# Clear cache
npm start -- --reset-cache
```

---

## Chạy trên Device Thật

### 1. Enable USB Debugging trên điện thoại
- Settings > About Phone > Tap "Build Number" 7 times
- Settings > Developer Options > Enable USB Debugging

### 2. Kết nối và verify
```powershell
adb devices
# Phải thấy device ID
```

### 3. Reverse port
```powershell
adb reverse tcp:8081 tcp:8081
```

### 4. Build và install
```powershell
npm run android
```

---

## Build APK Release

```powershell
cd android
gradlew assembleRelease
```

APK output: `android/app/build/outputs/apk/release/app-release.apk`

---

## Liên hệ Support

Nếu gặp vấn đề, kiểm tra:
1. Node.js version >= 18
2. JDK 17 đã cài và JAVA_HOME đã set
3. Android SDK Platform 34 đã cài
4. Emulator hoặc device đã kết nối
5. Metro server đang chạy trên port 8081
