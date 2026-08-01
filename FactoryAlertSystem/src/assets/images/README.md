# Android Notification Icons

Để hiển thị notification icons trên Android, bạn cần tạo các file sau:

## Required Files

### 1. ic_notification.png (Notification small icon)
- Đặt tại: `android/app/src/main/res/drawable-*/`
- Sizes:
  - mdpi: 24x24px
  - hdpi: 36x36px
  - xhdpi: 48x48px
  - xxhdpi: 72x72px
  - xxxhdpi: 96x96px
- Format: PNG with transparency
- Color: White (#FFFFFF) only - Android will tint it

### 2. ic_launcher.png (App icon)
- Đặt tại: `android/app/src/main/res/mipmap-*/`
- Sizes:
  - mdpi: 48x48px
  - hdpi: 72x72px
  - xhdpi: 96x96px
  - xxhdpi: 144x144px
  - xxxhdpi: 192x192px

## Quick Setup

1. Use Android Asset Studio: https://romannurik.github.io/AndroidAssetStudio/
2. Or use this command to generate from a source image:

```bash
# Install imagemagick first
# brew install imagemagick (macOS)
# apt-get install imagemagick (Linux)

# Generate notification icon
convert source_icon.png -resize 24x24 android/app/src/main/res/drawable-mdpi/ic_notification.png
convert source_icon.png -resize 36x36 android/app/src/main/res/drawable-hdpi/ic_notification.png
convert source_icon.png -resize 48x48 android/app/src/main/res/drawable-xhdpi/ic_notification.png
convert source_icon.png -resize 72x72 android/app/src/main/res/drawable-xxhdpi/ic_notification.png
convert source_icon.png -resize 96x96 android/app/src/main/res/drawable-xxxhdpi/ic_notification.png
```

## Temporary Solution

Nếu chưa có icon, bạn có thể sử dụng vector drawable. Tạo file:
`android/app/src/main/res/drawable/ic_notification.xml`

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
```
