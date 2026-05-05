# 🚀 Quick Start: MQTT Integration

> Hướng dẫn nhanh 5 phút để kết nối MQTT với hệ thống AVI-AOI

## 📦 Yêu cầu

- ✅ Master API Key (liên hệ admin)
- ✅ MQTT Broker credentials (username/password)
- ✅ Broker URL (ví dụ: `mqtt://broker.hivemq.com:1883`)

## 🔧 Setup nhanh (Node.js)

### Bước 1: Install dependencies

```bash
npm install axios mqtt
```

### Bước 2: Tạo file `mqtt-client.js`

```javascript
const axios = require('axios');
const mqtt = require('mqtt');

// ⚙️ CẤU HÌNH - Thay đổi các giá trị này
const CONFIG = {
  API_URL: 'http://localhost:3001',
  MASTER_KEY: 'your_master_api_key_here',  // ⬅️ Thay đổi
  MQTT_BROKER: 'mqtt://broker.hivemq.com',  // ⬅️ Thay đổi
  MQTT_USERNAME: 'your_username',            // ⬅️ Thay đổi
  MQTT_PASSWORD: 'your_password',            // ⬅️ Thay đổi
  FACTORY_ID: 1                              // ⬅️ Thay đổi (hoặc bỏ để subscribe all)
};

// 1️⃣ Lấy topics từ REST API
async function getTopics() {
  const response = await axios.get(
    `${CONFIG.API_URL}/api/external/hierarchy/mqtt-topics`, {
      params: { 
        level: 'factory',                    // all | factory | workshop | line | station
        factoryId: CONFIG.FACTORY_ID,
        messageTypes: 'errors,inspection'     // Bỏ dòng này để nhận all message types
      },
      headers: { 'X-Master-Key': CONFIG.MASTER_KEY }
    }
  );
  return response.data.data;
}

// 2️⃣ Kết nối MQTT và subscribe
async function start() {
  const topics = await getTopics();
  console.log(`✅ Found ${topics.length} topics to subscribe`);
  
  const client = mqtt.connect(CONFIG.MQTT_BROKER, {
    username: CONFIG.MQTT_USERNAME,
    password: CONFIG.MQTT_PASSWORD,
    clientId: `client-${Date.now()}`
  });
  
  client.on('connect', () => {
    console.log('✅ MQTT Connected');
    topics.forEach(t => client.subscribe(t.topic, { qos: t.qos }));
  });
  
  client.on('message', (topic, message) => {
    const data = JSON.parse(message.toString());
    console.log(`\n📨 ${data.type} từ ${topic}:`);
    console.log(JSON.stringify(data, null, 2));
  });
}

start().catch(console.error);
```

### Bước 3: Chạy

```bash
node mqtt-client.js
```

## 🐍 Setup nhanh (Python)

### Bước 1: Install dependencies

```bash
pip install paho-mqtt requests
```

### Bước 2: Tạo file `mqtt_client.py`

```python
import json
import requests
import paho.mqtt.client as mqtt

# ⚙️ CẤU HÌNH
CONFIG = {
    'API_URL': 'http://localhost:3001',
    'MASTER_KEY': 'your_master_api_key_here',  # ⬅️ Thay đổi
    'MQTT_BROKER': 'broker.hivemq.com',        # ⬅️ Thay đổi
    'MQTT_PORT': 1883,
    'MQTT_USERNAME': 'your_username',           # ⬅️ Thay đổi
    'MQTT_PASSWORD': 'your_password',           # ⬅️ Thay đổi
    'FACTORY_ID': 1
}

def get_topics():
    """Lấy topics từ REST API"""
    response = requests.get(
        f"{CONFIG['API_URL']}/api/external/hierarchy/mqtt-topics",
        params={'level': 'factory', 'factoryId': CONFIG['FACTORY_ID'], 'messageTypes': 'errors,inspection'},
        headers={'X-Master-Key': CONFIG['MASTER_KEY']}
    )
    return response.json()['data']

def on_connect(client, userdata, flags, rc):
    """Khi kết nối thành công"""
    if rc == 0:
        print('✅ MQTT Connected')
        topics = get_topics()
        for t in topics:
            client.subscribe(t['topic'], t['qos'])
            print(f"✅ Subscribed: {t['topic']}")

def on_message(client, userdata, msg):
    """Khi nhận message"""
    data = json.loads(msg.payload.decode())
    print(f"\n📨 {data['type']} từ {msg.topic}:")
    print(json.dumps(data, indent=2, ensure_ascii=False))

# Kết nối
client = mqtt.Client(client_id=f"client-{int(time.time())}")
client.username_pw_set(CONFIG['MQTT_USERNAME'], CONFIG['MQTT_PASSWORD'])
client.on_connect = on_connect
client.on_message = on_message
client.connect(CONFIG['MQTT_BROKER'], CONFIG['MQTT_PORT'])
client.loop_forever()
```

### Bước 3: Chạy

```bash
python mqtt_client.py
```

## 📋 Message Types

| Type | Topic Suffix | QoS | Mô tả |
|------|-------------|-----|-------|
| `INSPECTION_RESULT` | `/inspection` | 1 | Kết quả kiểm tra |
| `NG_ALERT` | `/errors` | 2 | Cảnh báo NG |
| `MACHINE_STATUS` | `/status` | 0 | Trạng thái máy |
| `HEARTBEAT` | `/heartbeat` | 0 | Heartbeat |
| `DAILY_SUMMARY` | `/summary/daily` | 1 | Báo cáo ngày |
| `WEEKLY_SUMMARY` | `/summary/weekly` | 1 | Báo cáo tuần |

## 🎯 Topic Pattern

```
avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}

Ví dụ:
- avi/1/workshop/2/station/5/errors
- avi/1/workshop/+/station/+/inspection
- avi/+/workshop/+/station/+/#
```

## ✅ Kiểm tra Setup

### 1. Test REST API

```bash
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-message-types" \
  -H "X-Master-Key: your_master_api_key_here"
```

Kết quả mong đợi: JSON với 6 message types

### 2. Test MQTT với MQTT Explorer

1. Tải: http://mqtt-explorer.com/
2. Connect với broker credentials
3. Subscribe: `avi/#`
4. Xem messages trong real-time

### 3. Test với mosquitto_sub

```bash
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "avi/#" -v
```

## 🆘 Troubleshooting nhanh

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `401 Unauthorized` | Master API Key sai | Kiểm tra key trong header `X-Master-Key` |
| `Connection refused` | Broker URL/port sai | Test với `telnet broker.hivemq.com 1883` |
| `No messages` | Topics sai hoặc chưa có data | Dùng MQTT Explorer subscribe `#` để xem tất cả |
| `TLS error` | Protocol mismatch | Dùng `mqtts://` cho TLS, không phải `mqtt://` |

## 📚 Tài liệu đầy đủ

Xem [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md) để biết:

- ✅ Kiến trúc hệ thống chi tiết
- ✅ REST API reference đầy đủ
- ✅ Message format specifications
- ✅ Code examples: JavaScript, Python, Java
- ✅ Troubleshooting guide chi tiết
- ✅ Best practices & security

## 🔐 Security Checklist

- [ ] Không commit credentials vào Git
- [ ] Dùng HTTPS cho REST API (production)
- [ ] Dùng TLS/SSL cho MQTT (production)
- [ ] Rotate Master API Key định kỳ
- [ ] Limit topic subscriptions theo nhu cầu (không subscribe `#` toàn bộ)
- [ ] Implement rate limiting trong message handler
- [ ] Log errors nhưng không log credentials

---

**🎉 Hoàn thành!** Bây giờ ứng dụng của bạn đã kết nối với hệ thống AVI-AOI và nhận dữ liệu real-time.

Cần hỗ trợ? Liên hệ team quản trị hoặc xem docs đầy đủ.
