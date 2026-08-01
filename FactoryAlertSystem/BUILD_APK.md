# 📱 Hướng Dẫn Build APK - Factory Alert System

## Yêu Cầu

1. **Node.js** >= 18
2. **JDK 17** (khuyến nghị Eclipse Temurin)
3. **Android SDK** (cài qua Android Studio)
4. **Environment Variables đã set:**
   - `JAVA_HOME` → JDK path
   - `ANDROID_HOME` → Android SDK path

---

## 🚀 Cách Nhanh: Dùng Script

```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem

# Chạy script build
.\build-apk.bat
```

Chọn:
- **1** = Debug APK (test, không cần keystore)
- **2** = Release APK (production, cần keystore)

---

## 📋 Cách Thủ Công

### Build Debug APK

```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem

# Cài dependencies
npm install

# Build debug APK
cd android
.\gradlew assembleDebug
```

**Output:** `android\app\build\outputs\apk\debug\app-debug.apk`

---

### Build Release APK

#### Bước 1: Tạo Keystore (chỉ làm 1 lần)

```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem\android\app

keytool -genkeypair -v -storetype PKCS12 -keystore factory-alert-release.keystore -alias factory-alert -keyalg RSA -keysize 2048 -validity 10000
```

**Nhập thông tin:**
- Keystore password: `FactoryAlert@2026` (hoặc password của bạn)
- First and Last Name: `Factory Alert System`
- Organization: `Foxconn`
- City: `Hanoi`
- Country: `VN`

#### Bước 2: Cấu hình Password

Mở file `android\gradle.properties`, sửa:

```properties
MYAPP_UPLOAD_STORE_FILE=factory-alert-release.keystore
MYAPP_UPLOAD_KEY_ALIAS=factory-alert
MYAPP_UPLOAD_STORE_PASSWORD=<your_password>
MYAPP_UPLOAD_KEY_PASSWORD=<your_password>
```

#### Bước 3: Build Release

```powershell
cd D:\1.ST4I\FOxconn\files\FactoryAlertSystem

npm install

cd android
.\gradlew assembleRelease
```

**Output:** `android\app\build\outputs\apk\release\app-release.apk`

---

## 📲 Cài APK vào Máy Tính Bảng

### Cách 1: Copy trực tiếp

1. Kết nối tablet qua USB
2. Copy file `.apk` vào tablet
3. Mở File Manager trên tablet
4. Tìm và tap vào file APK
5. Cho phép "Install from unknown sources" nếu được hỏi
6. Nhấn Install

### Cách 2: Dùng ADB

```powershell
# Kiểm tra device đã kết nối
adb devices

# Cài APK
adb install android\app\build\outputs\apk\release\app-release.apk

# Nếu cài đè version cũ
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

### Cách 3: Wireless ADB (không cần dây)

```powershell
# Bước 1: Kết nối tablet qua USB, bật wireless debugging
adb tcpip 5555

# Bước 2: Lấy IP của tablet (Settings > About > IP Address)
# Ví dụ: 192.168.1.100

# Bước 3: Rút USB, kết nối qua WiFi
adb connect 192.168.1.100:5555

# Bước 4: Cài APK
adb install android\app\build\outputs\apk\release\app-release.apk
```

---

## 🔧 Troubleshooting

### Lỗi: "SDK location not found"

Tạo file `android\local.properties`:
```
sdk.dir=C:\\Users\\<YourUser>\\AppData\\Local\\Android\\Sdk
```

### Lỗi: "JAVA_HOME is not set"

```powershell
# Kiểm tra
echo %JAVA_HOME%

# Set (thay đổi path theo máy bạn)
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.9+9"
```

### Lỗi: "Keystore was tampered with"

Xóa keystore cũ và tạo lại:
```powershell
del android\app\factory-alert-release.keystore
# Chạy lại lệnh keytool
```

### Lỗi: Build failed - Out of memory

Sửa `android\gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
```

### Clean build

```powershell
cd android
.\gradlew clean
cd ..
```

---

## 📊 So sánh Debug vs Release APK

| Đặc điểm | Debug APK | Release APK |
|----------|-----------|-------------|
| Kích thước | Lớn hơn | Nhỏ hơn (minified) |
| Tốc độ | Chậm hơn | Nhanh hơn |
| Debugging | Có thể debug | Không debug được |
| Ký tên | Debug key | Production key |
| Mục đích | Testing | Production |

---

## 📁 Cấu trúc Output

```
android/app/build/outputs/apk/
├── debug/
│   └── app-debug.apk          # Debug build
└── release/
    └── app-release.apk        # Release build (signed)
```

---

## ⚠️ Lưu ý Quan trọng

1. **BẢO MẬT KEYSTORE:** 
   - Không commit keystore lên git
   - Backup keystore file an toàn
   - Không chia sẻ password

2. **VERSION CODE:**
   - Mỗi lần update, tăng `versionCode` trong `android/app/build.gradle`

3. **PERMISSIONS:**
   - Tablet cần bật "Install from unknown sources"
   - Settings > Security > Unknown sources

4. **MQTT CONNECTION:**
   - Đảm bảo tablet và MQTT broker cùng mạng
   - Kiểm tra firewall không block port 8000
