# 🏭 Hướng Dẫn Triển Khai Factory Alert System trong Mạng LAN

## 📋 Tổng Quan Hệ Thống

```
┌─────────────────────────────────────────────────────────────────┐
│                        MẠNG LAN NHÀ MÁY                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐         ┌──────────────────────┐             │
│   │   Máy Sản    │ ──────► │   MQTT Broker        │             │
│   │   Xuất/PLC   │  MQTT   │   (Server Windows)   │             │
│   └──────────────┘         │   IP: 192.168.1.100  │             │
│                            │   Port: 1883 (TCP)   │             │
│   ┌──────────────┐         │   Port: 8000 (WS)    │             │
│   │   Máy Sản    │ ──────► │                      │             │
│   │   Xuất/PLC   │         └──────────┬───────────┘             │
│   └──────────────┘                    │                         │
│                                       │ MQTT Subscribe          │
│                    ┌──────────────────┼──────────────────┐      │
│                    ▼                  ▼                  ▼      │
│            ┌─────────────┐    ┌─────────────┐    ┌─────────────┐│
│            │  Tablet 1   │    │  Tablet 2   │    │  Tablet 3   ││
│            │  Supervisor │    │  Supervisor │    │  Supervisor ││
│            │  Line A     │    │  Line B     │    │  Line C     ││
│            └─────────────┘    └─────────────┘    └─────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🖥️ PHẦN 1: CÀI ĐẶT MQTT BROKER TRÊN SERVER

### Lựa Chọn 1: Mosquitto (Khuyến Nghị - Ổn Định)

#### Bước 1: Tải và Cài Đặt Mosquitto

1. Tải Mosquitto cho Windows: https://mosquitto.org/download/
2. Chạy installer với quyền Administrator
3. Cài đặt vào: `C:\Program Files\mosquitto`

#### Bước 2: Cấu Hình Mosquitto

Mở file `C:\Program Files\mosquitto\mosquitto.conf` và thêm:

```conf
# ===================================
# FACTORY ALERT SYSTEM - MQTT CONFIG
# ===================================

# Cho phép kết nối từ tất cả IP trong LAN
listener 1883 0.0.0.0
protocol mqtt

# WebSocket listener (cho React Native)
listener 8000 0.0.0.0
protocol websockets

# Tắt anonymous nếu cần bảo mật
allow_anonymous true

# Hoặc bật authentication
# allow_anonymous false
# password_file C:\Program Files\mosquitto\passwords.txt

# Logging
log_dest file C:\Program Files\mosquitto\logs\mosquitto.log
log_type all

# Giữ messages cho clients reconnect
persistence true
persistence_location C:\Program Files\mosquitto\data\

# Số connections tối đa
max_connections 100
```

#### Bước 3: Tạo User/Password (Tùy Chọn)

```powershell
cd "C:\Program Files\mosquitto"
.\mosquitto_passwd -c passwords.txt factory_user
# Nhập password: FactoryAlert@2026
```

#### Bước 4: Cài Đặt Mosquitto Service

```powershell
# Mở PowerShell với quyền Admin
cd "C:\Program Files\mosquitto"

# Cài đặt service
.\mosquitto install

# Khởi động service
net start mosquitto

# Hoặc khởi động thủ công để test
.\mosquitto -c mosquitto.conf -v
```

#### Bước 5: Mở Firewall

```powershell
# Mở PowerShell với quyền Admin
netsh advfirewall firewall add rule name="MQTT Broker TCP" dir=in action=allow protocol=tcp localport=1883
netsh advfirewall firewall add rule name="MQTT Broker WebSocket" dir=in action=allow protocol=tcp localport=8000
```

---

### Lựa Chọn 2: EMQX (Nhiều Tính Năng Hơn)

#### Cài Đặt EMQX

1. Tải EMQX: https://www.emqx.io/downloads
2. Giải nén vào `C:\emqx`
3. Chạy:

```powershell
cd C:\emqx\bin
.\emqx start
```

4. Truy cập Dashboard: http://192.168.1.100:18083
   - Username: admin
   - Password: public

---

## 📱 PHẦN 2: CẤU HÌNH ỨNG DỤNG CHO MẠNG LAN

### Cập Nhật Cấu Hình Mặc Định

Mở file `src/utils/constants.ts` và cập nhật:

```typescript
// MQTT Configuration cho LAN
export const DEFAULT_MQTT_CONFIG: MqttConfig = {
  brokerAddress: '192.168.1.100',  // IP của server MQTT
  port: 8000,                       // WebSocket port
  protocol: 'websocket',
  useSSL: false,
  username: 'factory_user',         // Nếu có authentication
  password: 'FactoryAlert@2026',    // Nếu có authentication
  topics: ['factory/alerts/#', 'factory/+/alerts'],
  keepAlive: 60,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
};
```

---

## 📲 PHẦN 3: TRIỂN KHAI APK CHO NHIỀU THIẾT BỊ

### Phương Pháp 1: Chia Sẻ Qua Mạng LAN (Đơn Giản)

#### Bước 1: Tạo Web Server Đơn Giản

Trên server, cài Python và chạy:

```powershell
# Di chuyển đến thư mục chứa APK
cd D:\APK_Downloads

# Copy APK vào đây
copy "D:\1.ST4I\FOxconn\FactoryAlertSystem (1)\FactoryAlertSystem\android\app\build\outputs\apk\release\app-release.apk" .

# Chạy HTTP server
python -m http.server 8080
```

#### Bước 2: Tải APK Trên Tablet

Trên mỗi tablet, mở trình duyệt và truy cập:
```
http://192.168.1.100:8080/app-release.apk
```

### Phương Pháp 2: Dùng ADB Cài Đặt Hàng Loạt

```powershell
# Kết nối tablet qua WiFi
adb tcpip 5555
adb connect 192.168.1.101:5555
adb connect 192.168.1.102:5555
adb connect 192.168.1.103:5555

# Cài đặt APK cho tất cả thiết bị
adb devices | ForEach-Object {
    if ($_ -match "(\d+\.\d+\.\d+\.\d+:\d+)") {
        adb -s $matches[1] install -r app-release.apk
    }
}
```

### Phương Pháp 3: MDM (Mobile Device Management)

Sử dụng các giải pháp MDM như:
- Microsoft Intune
- VMware Workspace ONE
- SOTI MobiControl
- Samsung Knox (nếu dùng tablet Samsung)

---

## 🔧 PHẦN 4: CẤU HÌNH TỪNG THIẾT BỊ

### Cấu Hình Trong App

Mỗi tablet khi mở app lần đầu, vào **Settings** và cấu hình:

| Thiết Bị | Line Filter | MQTT Topic |
|----------|-------------|------------|
| Tablet 1 | Line A | `factory/lineA/alerts` |
| Tablet 2 | Line B | `factory/lineB/alerts` |
| Tablet 3 | Line C | `factory/lineC/alerts` |
| Tablet All | All Lines | `factory/+/alerts` |

### Cấu Hình MQTT Trong App

```
MQTT Broker: 192.168.1.100
Port: 8000
Protocol: WebSocket
SSL: Off
Username: factory_user (nếu có)
Password: ******** (nếu có)
```

---

## �icing PHẦN 5: GỬI ALERT TỪ MÁY SẢN XUẤT

### Format JSON Alert (Đầy đủ)

```json
{
  "alertId": "ALT-2026-000094",
  "timestamp": "2026-02-05T10:30:00.000Z",
  "station": {
    "id": "ST-94",
    "name": "Wire Cutting Station A1",
    "line": "Line A",
    "area": "Workshop Zone 1"
  },
  "product": {
    "id": "PRD-WH-12345",
    "name": "Wire Harness Model X",
    "serialNumber": "SN-12345-ABC",
    "model": "WH-12345"
  },
  "error": {
    "code": "E-POINT-001",
    "type": "Inspection Error",
    "description": "POINT-001 - Result: NG, Value: 145",
    "imageUrl": "http://192.168.1.100:8080/images/error_001.jpg"
  },
  "severity": "high",
  "machine": {
    "id": 1,
    "name": "AVI Machine 01",
    "code": "AVI-01"
  },
  "ngPoints": [
    {
      "pointId": 0,
      "pointName": "POINT-001",
      "result": "NG",
      "actualValue": "145",
      "imageUrl": "http://192.168.1.100:8080/images/point1.jpg"
    },
    {
      "pointId": 1,
      "pointName": "POINT-002",
      "result": "NG",
      "actualValue": "132",
      "imageUrl": "http://192.168.1.100:8080/images/point2.jpg"
    }
  ],
  "totalNG": 2,
  "imageUrl": "http://192.168.1.100:8080/images/error_001.jpg",
  "inspectionId": 94
}
```

### Mô tả các trường

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `alertId` | ✅ | ID duy nhất của alert |
| `timestamp` | ✅ | Thời gian lỗi xảy ra (ISO 8601) |
| `station.id` | ✅ | ID trạm làm việc |
| `station.name` | ✅ | Tên trạm |
| `station.line` | ✅ | Dây chuyền sản xuất |
| `station.area` | ❌ | Khu vực (optional) |
| `product.id` | ✅ | ID sản phẩm |
| `product.name` | ✅ | Tên sản phẩm |
| `product.serialNumber` | ❌ | Serial Number (optional) |
| `product.model` | ❌ | Model sản phẩm (optional) |
| `error.code` | ✅ | Mã lỗi |
| `error.type` | ✅ | Loại lỗi |
| `error.description` | ✅ | Mô tả chi tiết |
| `error.imageUrl` | ❌ | URL hình ảnh lỗi |
| `severity` | ✅ | Mức độ: critical, high, medium, low, info |
| `machine` | ❌ | Thông tin máy kiểm tra |
| `ngPoints` | ❌ | Danh sách các điểm NG |
| `totalNG` | ❌ | Tổng số điểm NG |
| `imageUrl` | ❌ | URL hình ảnh chính |
| `inspectionId` | ❌ | ID của lần kiểm tra |
```

### Gửi Alert Từ PLC/PC

#### Python Example:

```python
import paho.mqtt.client as mqtt
import json
from datetime import datetime

# Kết nối MQTT Broker
client = mqtt.Client()
client.connect("192.168.1.100", 1883, 60)

# Tạo alert
alert = {
    "alertId": f"ALT-{datetime.now().strftime('%Y%m%d%H%M%S')}",
    "timestamp": datetime.now().isoformat(),
    "station": {
        "id": "ST-A-001",
        "name": "Wire Cutting Station A1",
        "line": "Line A"
    },
    "product": {
        "id": "PRD-001",
        "name": "Wire Harness Model X"
    },
    "error": {
        "code": "E-CUT-001",
        "type": "Cutting Error",
        "description": "Wire length mismatch",
        "imageUrl": "http://192.168.1.100:8080/images/error.jpg"
    },
    "severity": "critical"
}

# Publish alert
client.publish("factory/lineA/alerts", json.dumps(alert))
client.disconnect()
```

#### Node.js Example:

```javascript
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://192.168.1.100:1883');

client.on('connect', () => {
  const alert = {
    alertId: `ALT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    station: {
      id: 'ST-A-001',
      name: 'Wire Cutting Station A1',
      line: 'Line A'
    },
    product: {
      id: 'PRD-001',
      name: 'Wire Harness Model X'
    },
    error: {
      code: 'E-CUT-001',
      type: 'Cutting Error',
      description: 'Wire length mismatch',
      imageUrl: 'http://192.168.1.100:8080/images/error.jpg'
    },
    severity: 'critical'
  };

  client.publish('factory/lineA/alerts', JSON.stringify(alert));
  client.end();
});
```

#### C# Example (cho Windows PC/PLC Software):

```csharp
using MQTTnet;
using MQTTnet.Client;
using System.Text.Json;

var factory = new MqttFactory();
var client = factory.CreateMqttClient();

var options = new MqttClientOptionsBuilder()
    .WithTcpServer("192.168.1.100", 1883)
    .Build();

await client.ConnectAsync(options);

var alert = new {
    alertId = $"ALT-{DateTime.Now:yyyyMMddHHmmss}",
    timestamp = DateTime.Now.ToString("o"),
    station = new { id = "ST-A-001", name = "Wire Cutting Station", line = "Line A" },
    product = new { id = "PRD-001", name = "Wire Harness Model X" },
    error = new { 
        code = "E-CUT-001", 
        type = "Cutting Error", 
        description = "Wire length mismatch",
        imageUrl = "http://192.168.1.100:8080/images/error.jpg"
    },
    severity = "critical"
};

var message = new MqttApplicationMessageBuilder()
    .WithTopic("factory/lineA/alerts")
    .WithPayload(JsonSerializer.Serialize(alert))
    .Build();

await client.PublishAsync(message);
await client.DisconnectAsync();
```

---

## 🖼️ PHẦN 6: CÀI ĐẶT SERVER HÌNH ẢNH

### Tạo Image Server Đơn Giản

```powershell
# Tạo thư mục chứa hình ảnh lỗi
mkdir C:\FactoryImages
mkdir C:\FactoryImages\errors

# Chạy HTTP server
cd C:\FactoryImages
python -m http.server 8080
```

### Cấu Trúc Thư Mục

```
C:\FactoryImages\
├── errors\
│   ├── line_a\
│   │   ├── error_001.jpg
│   │   └── error_002.jpg
│   ├── line_b\
│   │   └── error_001.jpg
│   └── line_c\
│       └── error_001.jpg
└── index.html
```

### URL Hình Ảnh

Khi gửi alert, sử dụng URL:
```
http://192.168.1.100:8080/errors/line_a/error_001.jpg
```

---

## 🔄 PHẦN 7: CẬP NHẬT ỨNG DỤNG (OTA UPDATE)

### Tạo Update Server

#### Bước 1: Tạo Thư Mục Update

```powershell
mkdir C:\FactoryAlertUpdates
```

#### Bước 2: Tạo File version.json

```json
{
  "version": "1.1.0",
  "versionCode": 2,
  "releaseDate": "2026-02-05",
  "apkUrl": "http://192.168.1.100:8080/updates/app-release.apk",
  "changelog": [
    "Thêm tính năng hiển thị hình ảnh lỗi",
    "Cải thiện kết nối MQTT",
    "Sửa một số lỗi nhỏ"
  ],
  "mandatory": false
}
```

#### Bước 3: Copy APK Mới

```powershell
copy "D:\...\app-release.apk" C:\FactoryAlertUpdates\
```

#### Bước 4: Chạy Update Server

```powershell
cd C:\FactoryAlertUpdates
python -m http.server 8080
```

### Thêm Tính Năng Check Update Trong App

Tôi sẽ thêm tính năng này vào app...

---

## 📊 PHẦN 8: GIÁM SÁT VÀ BẢO TRÌ

### Kiểm Tra Kết Nối MQTT

```powershell
# Trên server, subscribe để xem messages
cd "C:\Program Files\mosquitto"
.\mosquitto_sub -h localhost -t "factory/#" -v
```

### Xem Log Mosquitto

```powershell
Get-Content "C:\Program Files\mosquitto\logs\mosquitto.log" -Wait
```

### Kiểm Tra Thiết Bị Đang Kết Nối

Nếu dùng EMQX, truy cập Dashboard:
```
http://192.168.1.100:18083
```

---

## ⚠️ LƯU Ý QUAN TRỌNG

### Bảo Mật

1. **Đặt IP tĩnh cho server**: Không dùng DHCP cho MQTT server
2. **Firewall**: Chỉ mở port cần thiết (1883, 8000, 8080)
3. **Authentication**: Bật username/password trong production
4. **Mạng riêng**: Tách mạng nhà máy khỏi mạng internet

### Hiệu Suất

1. **Số lượng thiết bị**: Mosquitto hỗ trợ hàng ngàn kết nối
2. **Tần suất alert**: Không nên gửi quá 100 alerts/giây
3. **Kích thước message**: Giữ JSON nhỏ gọn (< 10KB)

### Sao Lưu

1. Backup cấu hình Mosquitto định kỳ
2. Lưu trữ log alerts cho báo cáo

---

## 🆘 XỬ LÝ SỰ CỐ

### Tablet Không Kết Nối Được

1. Kiểm tra WiFi cùng mạng LAN
2. Ping server: `ping 192.168.1.100`
3. Kiểm tra firewall trên server
4. Kiểm tra Mosquitto đang chạy: `netstat -an | findstr 1883`

### Không Nhận Được Alert

1. Kiểm tra topic subscribe đúng chưa
2. Dùng MQTT Explorer để test
3. Kiểm tra format JSON đúng chuẩn

### App Bị Disconnect Liên Tục

1. Tăng `keepAlive` trong cấu hình
2. Kiểm tra tín hiệu WiFi
3. Kiểm tra server có quá tải không

---

## 📞 THÔNG TIN HỖ TRỢ

- **MQTT Explorer** (công cụ test): https://mqtt-explorer.com/
- **Mosquitto Docs**: https://mosquitto.org/documentation/
- **EMQX Docs**: https://docs.emqx.io/

