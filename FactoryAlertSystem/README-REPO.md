# FactoryAlertSystem — vị trí trong repo (repo positioning)

> Cập nhật 2026-07-04 (doc 27 — Đợt 6, MB1/MB10/MB13).

## Đây là app mobile PRODUCTION duy nhất

**FactoryAlertSystem** (React Native, `com.foutec.FactoryAlertSystem`, package.json v1.0.15 / build.gradle versionName 1.0.16) là app cảnh báo nhà máy đang chạy production. Từ **2026-07-04 toàn bộ SOURCE của app được đưa vào git** (trước đó bị `.gitignore` toàn thư mục — chỉ có APK được lưu, không có lịch sử source).

Những gì **không** được commit (xem `.gitignore` gốc repo):

- `node_modules/`, `android/build/`, `android/app/build/`, `android/.gradle/`, `android/tmp-wrapper/`, `ios/Pods/` — dependencies & build output
- `*.apk`, `*.aab`, `google-play-release/` — binary release (dùng OTA store, xem dưới)
- `android/gradle.properties`, `android/local.properties`, `*.keystore`, `*.jks` — **tư liệu ký (signing) và cấu hình máy cục bộ, TUYỆT ĐỐI không commit**. `gradle.properties` hiện chứa mật khẩu keystore dạng plaintext; `factory-alert-release.keystore` là khóa ký release. Sao lưu 2 file này NGOÀI git (két/secret manager). Máy dev mới cần được cấp 2 file này thủ công (hoặc tự tạo `debug.keystore` chuẩn Android để build debug).

Lưu ý: thư mục này từng chứa một repo git lồng (`FactoryAlertSystem/.git`, 0 commit — chỉ blob dangling). Nó đã được gỡ ra ngày 2026-07-04 để repo cha có thể track source; không mất lịch sử nào vì repo lồng chưa từng có commit.

## Hai app prototype cũ đã xóa

- `android-mqtt-app/` và `mobile-app/` là **prototype bị thay thế** bởi FactoryAlertSystem (lần sửa cuối 2026-05-05, topic scheme cũ).
- Cả hai đã bị **xóa khỏi working tree ngày 2026-07-04** (MB10). Chúng vẫn **khôi phục được từ lịch sử git** (`git log -- android-mqtt-app mobile-app`).

## Build

- Yêu cầu môi trường & hướng dẫn build APK: xem `BUILD_APK.md` (kèm `SETUP_WINDOWS.md`, `FIX_GRADLE.md`).
- Script deploy release: `deploy-factory-alert.mjs` ở gốc repo (đọc version từ `android/app/build.gradle`, copy APK từ `android/app/build/outputs/apk/release`).

## Phân phối release (OTA store)

- APK release **không commit vào git**. Nơi lưu chính thức: `uploads/factory-alert-releases/` (server phục vụ trực tiếp).
- Endpoint server: `/api/factory-alert/version.json`, `/api/factory-alert/versions`, `/api/factory-alert/download/:version/:filename`, `/api/factory-alert/upload`, `/api/factory-alert/push-update`, activate/deactivate theo version id.
- Kho phụ `uploads/mqtt-releases/` (module software-version MQTT) cũng đã được gitignore; file trên đĩa giữ nguyên để server phục vụ.
