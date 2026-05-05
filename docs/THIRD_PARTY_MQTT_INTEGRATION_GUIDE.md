# Hướng dẫn Tích hợp MQTT cho Ứng dụng Bên Thứ 3

> **Third-Party MQTT Integration Guide for AVI-AOI Management System**

## 📋 Mục lục

1. [Tổng quan](#tổng-quan)
2. [Kiến trúc Hệ thống](#kiến-trúc-hệ-thống)
3. [Chuẩn bị Môi trường](#chuẩn-bị-môi-trường)
4. [REST API cho Khám phá Topic](#rest-api-cho-khám-phá-topic)
5. [Hai Phương án Tích hợp](#hai-phương-án-tích-hợp)
6. [Định dạng Message](#định-dạng-message)
7. [Ví dụ Mã nguồn](#ví-dụ-mã-nguồn)
8. [Kiểm thử & Xác nhận](#kiểm-thử--xác-nhận)
9. [Khắc phục Sự cố](#khắc-phục-sự-cố)

---

## Tổng quan

Hệ thống AVI-AOI Management cung cấp hai cơ chế để ứng dụng bên thứ 3 kết nối và nhận dữ liệu real-time:

1. **REST API + MQTT** (Khuyến nghị): Sử dụng REST API để khám phá topics động, sau đó subscribe qua MQTT
2. **Direct MQTT**: Kết nối trực tiếp và subscribe topics theo pattern cố định

### Dữ liệu nhận được

- **Kết quả kiểm tra** (inspection results) từ máy AVI/AOI
- **Cảnh báo NG** (defect alerts) real-time
- **Trạng thái máy** (machine status)
- **Heartbeat** (keep-alive signals)
- **Báo cáo tổng hợp** (daily/weekly summaries)

---

## Kiến trúc Hệ thống

```
┌─────────────────────┐
│  Máy AVI/AOI        │
│  (Publisher)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  External MQTT      │◄────┐
│  Broker             │     │ Forward
│  (HiveMQ/Mosquitto) │     │ Messages
└──────────┬──────────┘     │
           │                │
           ▼                │
┌─────────────────────┐     │
│  MES Server         │─────┘
│  - REST API         │
│  - Local Broker     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Third-party Apps   │
│  - Mobile/Web       │
│  - MES Integration  │
│  - Dashboard        │
└─────────────────────┘
```

### Dual Broker Architecture

Hệ thống chạy hai MQTT brokers song song:

1. **Local Broker** (Aedes - built-in):
   - TCP: Port `1883`
   - WebSocket: Port `8883`
   - Dành cho Android apps và local clients
   - Authentication qua database
   
2. **External Broker** (HiveMQ Cloud/Mosquitto/EMQX):
   - Cloud hoặc self-hosted
   - Server kết nối như một MQTT client
   - Nhận messages từ máy AVI/AOI
   - Forward tới local broker và REST API

---

## Chuẩn bị Môi trường

### Bước 1: Lấy Thông tin Kết nối

Liên hệ quản trị viên để nhận:

1. **MQTT Broker URL**: 
   - External broker: `mqtt://broker.hivemq.com` hoặc IP của Mosquitto server
   - Local broker: `mqtt://<server-ip>:1883`

2. **Master API Key**: 
   - Dùng để authenticate REST API
   - Format: String 32-64 ký tự
   - Ví dụ: `change_this_master_api_key`

3. **MQTT Credentials** (nếu broker yêu cầu):
   - Username
   - Password
   - TLS certificates (nếu dùng mqtts://)

### Bước 2: Cấu hình Environment Variables (cho Server)

Nếu bạn là quản trị viên, cấu hình các biến sau trong `.env`:

```bash
# Master API Key
MASTER_API_KEY=your_secure_master_api_key_here

# Local MQTT Broker
MQTT_ENABLED=true
MQTT_PORT=1883
MQTT_WS_PORT=8883

# External MQTT Broker
EXTERNAL_MQTT_ENABLED=true
EXTERNAL_MQTT_BROKER=mqtt://broker.hivemq.com
EXTERNAL_MQTT_PORT=1883
EXTERNAL_MQTT_USERNAME=your_username
EXTERNAL_MQTT_PASSWORD=your_password
EXTERNAL_MQTT_TOPIC_PREFIX=avi-aoi

# TLS Configuration (optional)
EXTERNAL_MQTT_USE_TLS=false
# EXTERNAL_MQTT_CA_CERT=/path/to/ca.crt
# EXTERNAL_MQTT_CLIENT_CERT=/path/to/client.crt
# EXTERNAL_MQTT_CLIENT_KEY=/path/to/client.key
```

### Bước 3: Test Kết nối

Dùng MQTT Explorer hoặc mosquitto_sub để test:

```bash
# Test với MQTT Explorer (GUI)
# 1. Tải MQTT Explorer: http://mqtt-explorer.com/
# 2. Nhập broker URL và credentials
# 3. Connect và xem topics

# Hoặc dùng mosquitto_sub (CLI)
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "avi/#" -v
```

---

## REST API cho Khám phá Topic

### 🔑 Authentication

Tất cả REST API endpoints yêu cầu **Master API Key** trong header:

```http
X-Master-Key: your_master_api_key_here
```

### Endpoint 1: Lấy danh sách MQTT Topics

**GET** `/api/external/hierarchy/mqtt-topics`

Sinh danh sách topics để subscribe dựa trên cấp phân cấp.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | string | Yes | Cấp độ: `all`, `factory`, `workshop`, `line`, `station` |
| `factoryId` | number | Conditional | ID của factory (bắt buộc nếu level >= factory) |
| `workshopId` | number | Conditional | ID của workshop (bắt buộc nếu level >= workshop) |
| `lineId` | number | Conditional | ID của line (bắt buộc nếu level = line) |
| `stationId` | number | Conditional | ID của station (bắt buộc nếu level = station) |
| `messageTypes` | string | No | Loại message cần lọc (comma-separated): `inspection,errors,status` |

#### Response

```json
{
  "success": true,
  "data": [
    {
      "topic": "avi/1/workshop/+/station/+/errors",
      "description": "Factory ABC - errors",
      "qos": 2
    },
    {
      "topic": "avi/1/workshop/2/station/+/inspection",
      "description": "Factory ABC / Workshop X - inspection",
      "qos": 1
    }
  ]
}
```

#### Ví dụ cURL

```bash
# Lấy tất cả error topics trong factory ID = 1
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-topics?level=factory&factoryId=1&messageTypes=errors" \
  -H "X-Master-Key: your_master_api_key_here"

# Lấy tất cả topics cho một station cụ thể
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-topics?level=station&stationId=5" \
  -H "X-Master-Key: your_master_api_key_here"

# Lấy inspection và errors topics cho workshop ID = 2
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-topics?level=workshop&factoryId=1&workshopId=2&messageTypes=inspection,errors" \
  -H "X-Master-Key: your_master_api_key_here"
```

### Endpoint 2: Lấy danh sách Message Types

**GET** `/api/external/hierarchy/mqtt-message-types`

Trả về danh sách tất cả loại message hỗ trợ.

#### Response

```json
{
  "success": true,
  "data": [
    {
      "type": "inspection",
      "qos": 1,
      "description": "Kết quả kiểm tra"
    },
    {
      "type": "errors",
      "qos": 2,
      "description": "Cảnh báo NG"
    },
    {
      "type": "status",
      "qos": 0,
      "description": "Trạng thái máy"
    },
    {
      "type": "heartbeat",
      "qos": 0,
      "description": "Heartbeat"
    },
    {
      "type": "summary/daily",
      "qos": 1,
      "description": "Báo cáo ngày"
    },
    {
      "type": "summary/weekly",
      "qos": 1,
      "description": "Báo cáo tuần"
    }
  ]
}
```

#### Ví dụ cURL

```bash
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-message-types" \
  -H "X-Master-Key: your_master_api_key_here"
```

---

## Hai Phương án Tích hợp

### Phương án 1: REST API + MQTT (Khuyến nghị) 🌟

**Ưu điểm:**
- ✅ Topics được sinh tự động dựa trên cấu trúc nhà máy
- ✅ Dễ bảo trì khi thêm/xóa stations
- ✅ Hỗ trợ lọc theo messageTypes
- ✅ Mô tả rõ ràng về topic

**Quy trình:**

```
1. Call REST API để lấy topics
   ▼
2. Parse response để lấy topic list
   ▼
3. Kết nối MQTT broker
   ▼
4. Subscribe các topics đã lấy
   ▼
5. Xử lý messages nhận được
```

### Phương án 2: Direct MQTT (Đơn giản)

**Ưu điểm:**
- ✅ Đơn giản, không cần REST API
- ✅ Phù hợp khi biết chính xác cấu trúc

**Nhược điểm:**
- ❌ Phải tự xây dựng topic pattern
- ❌ Khó bảo trì khi thay đổi cấu trúc

**Topic Pattern:**

```
avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}
```

**Wildcards:**

- `+` : Khớp một cấp bất kỳ
- `#` : Khớp tất cả cấp còn lại

**Ví dụ:**

```
avi/1/workshop/+/station/+/errors       # Tất cả errors trong factory 1
avi/+/workshop/+/station/+/inspection   # Tất cả inspection ở tất cả factories
avi/1/workshop/2/station/5/#            # Tất cả messages từ station 5
```

---

## Định dạng Message

### Message Type 1: INSPECTION_RESULT

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/inspection`

**QoS:** 1

**Payload:**

```json
{
  "type": "INSPECTION_RESULT",
  "timestamp": "2025-01-26T10:00:00Z",
  "machineCode": "AVI-001",
  "stationId": 1,
  "serialNumber": "SN20250126001",
  "productModel": "MODEL-A",
  "result": "OK",
  "cycleTime": 2.5,
  "inspectionPoints": [
    {
      "pointId": 1,
      "pointName": "Solder Joint 1",
      "result": "OK",
      "actualValue": "98.5",
      "standardValue": "95-100",
      "unit": "%"
    }
  ],
  "imageUrl": "https://storage.example.com/images/inspection_001.jpg"
}
```

### Message Type 2: NG_ALERT

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/errors`

**QoS:** 2 (Highest - đảm bảo không mất message)

**Payload:**

```json
{
  "type": "NG_ALERT",
  "timestamp": "2025-01-26T10:00:00Z",
  "alertId": "ALERT-20250126-001",
  "machineCode": "AVI-001",
  "stationId": 1,
  "station": {
    "id": "1",
    "name": "Station A",
    "line": "Line 1",
    "area": "Assembly Area"
  },
  "product": {
    "id": "PROD-123",
    "name": "Product XYZ",
    "serialNumber": "SN20250126002",
    "model": "MODEL-A",
    "customer": "Customer ABC"
  },
  "error": {
    "code": "E001",
    "type": "INSUFFICIENT_SOLDER",
    "description": "Thiếu thiếc hàn",
    "imageUrl": "https://storage.example.com/errors/e001.jpg"
  },
  "severity": "high",
  "machine": {
    "id": 1,
    "name": "AVI Machine 1",
    "code": "AVI-001"
  },
  "ngPoints": [
    {
      "pointId": 2,
      "pointName": "Solder Joint 2",
      "result": "NG",
      "actualValue": "85.2",
      "expectedValue": "95-100",
      "defectType": "INSUFFICIENT_SOLDER",
      "imageUrl": "https://storage.example.com/ng/point_002.jpg",
      "workstationId": 1,
      "normalizedX": 0.45,
      "normalizedY": 0.67,
      "normalizedRadius": 0.05
    }
  ],
  "totalNG": 1,
  "imageUrl": "https://storage.example.com/ng_001.jpg",
  "inspectionId": 12345,
  "overallResult": "NG"
}
```

### Message Type 3: MACHINE_STATUS

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/status`

**QoS:** 0

**Payload:**

```json
{
  "type": "MACHINE_STATUS",
  "timestamp": "2025-01-26T10:00:00Z",
  "machineCode": "AVI-001",
  "status": "running",
  "uptime": 28800,
  "temperature": 25.5,
  "humidity": 45.0,
  "errorCode": null
}
```

**Status values:** `running`, `idle`, `error`, `maintenance`, `offline`

### Message Type 4: HEARTBEAT

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/heartbeat`

**QoS:** 0

**Payload:**

```json
{
  "type": "HEARTBEAT",
  "timestamp": "2025-01-26T10:00:00Z",
  "machineCode": "AVI-001",
  "sequence": 12345,
  "stationId": 1
}
```

### Message Type 5: DAILY_SUMMARY

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/summary/daily`

**QoS:** 1

**Payload:**

```json
{
  "type": "DAILY_SUMMARY",
  "stationId": 1,
  "stationName": "Station A",
  "period": {
    "start": "2025-01-26T00:00:00Z",
    "end": "2025-01-26T23:59:59Z"
  },
  "statistics": {
    "totalInspections": 1500,
    "totalNG": 45,
    "totalNTF": 5,
    "ngRate": 3.0
  },
  "topNGPoints": [
    {
      "pointId": 2,
      "pointName": "Solder Joint 2",
      "ngCount": 15,
      "percentage": 33.3
    },
    {
      "pointId": 5,
      "pointName": "Component Position",
      "ngCount": 10,
      "percentage": 22.2
    }
  ],
  "timestamp": "2025-01-27T00:00:00Z"
}
```

### Message Type 6: WEEKLY_SUMMARY

**Topic:** `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/summary/weekly`

**QoS:** 1

**Payload:** (Tương tự DAILY_SUMMARY nhưng period là 7 ngày)

```json
{
  "type": "WEEKLY_SUMMARY",
  "stationId": 1,
  "stationName": "Station A",
  "period": {
    "start": "2025-01-20T00:00:00Z",
    "end": "2025-01-26T23:59:59Z"
  },
  "statistics": {
    "totalInspections": 10500,
    "totalNG": 315,
    "totalNTF": 35,
    "ngRate": 3.0
  },
  "topNGPoints": [...],
  "timestamp": "2025-01-27T00:00:00Z"
}
```

---

## Ví dụ Mã nguồn

### JavaScript / Node.js

#### Phương án 1: REST API + MQTT

```javascript
const axios = require('axios');
const mqtt = require('mqtt');

// Configuration
const API_BASE_URL = 'http://localhost:3001';
const MASTER_API_KEY = 'your_master_api_key_here';
const MQTT_BROKER_URL = 'mqtt://broker.hivemq.com';
const MQTT_PORT = 1883;
const MQTT_USERNAME = 'your_username';
const MQTT_PASSWORD = 'your_password';

// Step 1: Get topics from REST API
async function getTopics(level, params = {}) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/external/hierarchy/mqtt-topics`,
      {
        params: { level, ...params },
        headers: { 'X-Master-Key': MASTER_API_KEY }
      }
    );
    
    if (response.data.success) {
      return response.data.data;
    } else {
      throw new Error('Failed to fetch topics');
    }
  } catch (error) {
    console.error('Error fetching topics:', error.message);
    throw error;
  }
}

// Step 2: Connect to MQTT and subscribe
async function startMqttClient() {
  // Get topics for factory ID = 1, only errors and inspection
  const topics = await getTopics('factory', {
    factoryId: 1,
    messageTypes: 'errors,inspection'
  });
  
  console.log('Topics to subscribe:', topics);
  
  // Connect to MQTT broker
  const client = mqtt.connect(MQTT_BROKER_URL, {
    port: MQTT_PORT,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: `third-party-app-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000
  });
  
  client.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    
    // Subscribe to all topics
    topics.forEach(({ topic, qos }) => {
      client.subscribe(topic, { qos }, (err) => {
        if (err) {
          console.error(`❌ Subscribe error for ${topic}:`, err);
        } else {
          console.log(`✅ Subscribed to ${topic} (QoS ${qos})`);
        }
      });
    });
  });
  
  client.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log(`\n📨 Message from ${topic}:`);
      console.log(JSON.stringify(payload, null, 2));
      
      // Handle different message types
      switch (payload.type) {
        case 'NG_ALERT':
          handleNGAlert(payload);
          break;
        case 'INSPECTION_RESULT':
          handleInspectionResult(payload);
          break;
        default:
          console.log('Unknown message type:', payload.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  client.on('error', (error) => {
    console.error('❌ MQTT error:', error.message);
  });
  
  client.on('close', () => {
    console.log('⚠️ Connection closed');
  });
  
  client.on('reconnect', () => {
    console.log('🔄 Reconnecting...');
  });
}

// Handle NG Alert
function handleNGAlert(alert) {
  console.log('\n🚨 NG ALERT DETECTED:');
  console.log(`- Alert ID: ${alert.alertId}`);
  console.log(`- Station: ${alert.station.name}`);
  console.log(`- Product: ${alert.product.serialNumber}`);
  console.log(`- Severity: ${alert.severity}`);
  console.log(`- Total NG: ${alert.totalNG}`);
  
  // Your custom logic here (send notification, update dashboard, etc.)
}

// Handle Inspection Result
function handleInspectionResult(result) {
  console.log('\n✅ INSPECTION RESULT:');
  console.log(`- Serial Number: ${result.serialNumber}`);
  console.log(`- Result: ${result.result}`);
  console.log(`- Cycle Time: ${result.cycleTime}s`);
  
  // Your custom logic here
}

// Start the client
startMqttClient().catch(console.error);
```

#### Phương án 2: Direct MQTT

```javascript
const mqtt = require('mqtt');

const MQTT_BROKER_URL = 'mqtt://broker.hivemq.com';
const MQTT_PORT = 1883;
const MQTT_USERNAME = 'your_username';
const MQTT_PASSWORD = 'your_password';

// Connect to MQTT broker
const client = mqtt.connect(MQTT_BROKER_URL, {
  port: MQTT_PORT,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: `third-party-app-${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  
  // Subscribe to topics directly with wildcards
  const topics = [
    { topic: 'avi/1/workshop/+/station/+/errors', qos: 2 },
    { topic: 'avi/1/workshop/+/station/+/inspection', qos: 1 },
    { topic: 'avi/1/workshop/+/station/+/status', qos: 0 }
  ];
  
  topics.forEach(({ topic, qos }) => {
    client.subscribe(topic, { qos }, (err) => {
      if (err) {
        console.error(`❌ Subscribe error for ${topic}:`, err);
      } else {
        console.log(`✅ Subscribed to ${topic} (QoS ${qos})`);
      }
    });
  });
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    console.log(`\n📨 Message from ${topic}:`);
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

client.on('error', (error) => {
  console.error('❌ MQTT error:', error.message);
});
```

### Python

```python
#!/usr/bin/env python3
"""
Third-party MQTT Client - Python Example
"""

import json
import time
import requests
import paho.mqtt.client as mqtt

# Configuration
API_BASE_URL = 'http://localhost:3001'
MASTER_API_KEY = 'your_master_api_key_here'
MQTT_BROKER = 'broker.hivemq.com'
MQTT_PORT = 1883
MQTT_USERNAME = 'your_username'
MQTT_PASSWORD = 'your_password'

def get_topics(level, **params):
    """Lấy topics từ REST API"""
    url = f'{API_BASE_URL}/api/external/hierarchy/mqtt-topics'
    headers = {'X-Master-Key': MASTER_API_KEY}
    params['level'] = level
    
    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    
    data = response.json()
    if data['success']:
        return data['data']
    else:
        raise Exception('Failed to fetch topics')

def on_connect(client, userdata, flags, rc):
    """Callback khi kết nối thành công"""
    if rc == 0:
        print('✅ Connected to MQTT broker')
        
        # Lấy topics từ API
        try:
            topics = get_topics('factory', factoryId=1, messageTypes='errors,inspection')
            print(f'Topics to subscribe: {len(topics)}')
            
            # Subscribe các topics
            for topic_info in topics:
                topic = topic_info['topic']
                qos = topic_info['qos']
                client.subscribe(topic, qos)
                print(f'✅ Subscribed to {topic} (QoS {qos})')
        except Exception as e:
            print(f'❌ Error fetching topics: {e}')
    else:
        print(f'❌ Connection failed with code {rc}')

def on_message(client, userdata, msg):
    """Callback khi nhận message"""
    try:
        payload = json.loads(msg.payload.decode())
        print(f'\n📨 Message from {msg.topic}:')
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        
        # Xử lý theo loại message
        msg_type = payload.get('type')
        
        if msg_type == 'NG_ALERT':
            handle_ng_alert(payload)
        elif msg_type == 'INSPECTION_RESULT':
            handle_inspection_result(payload)
            
    except json.JSONDecodeError as e:
        print(f'❌ Error parsing message: {e}')
    except Exception as e:
        print(f'❌ Error handling message: {e}')

def handle_ng_alert(alert):
    """Xử lý NG Alert"""
    print('\n🚨 NG ALERT DETECTED:')
    print(f"- Alert ID: {alert['alertId']}")
    print(f"- Station: {alert['station']['name']}")
    print(f"- Product: {alert['product']['serialNumber']}")
    print(f"- Severity: {alert['severity']}")
    print(f"- Total NG: {alert['totalNG']}")
    
    # Custom logic của bạn ở đây

def handle_inspection_result(result):
    """Xử lý Inspection Result"""
    print('\n✅ INSPECTION RESULT:')
    print(f"- Serial Number: {result['serialNumber']}")
    print(f"- Result: {result['result']}")
    print(f"- Cycle Time: {result['cycleTime']}s")
    
    # Custom logic của bạn ở đây

def on_disconnect(client, userdata, rc):
    """Callback khi disconnect"""
    print(f'⚠️ Disconnected from broker (code {rc})')

def on_subscribe(client, userdata, mid, granted_qos):
    """Callback khi subscribe thành công"""
    print(f'✅ Subscription confirmed (mid: {mid}, QoS: {granted_qos})')

def main():
    """Main function"""
    # Tạo MQTT client
    client = mqtt.Client(
        client_id=f'third-party-app-{int(time.time())}',
        clean_session=True
    )
    
    # Set callbacks
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    client.on_subscribe = on_subscribe
    
    # Set credentials
    if MQTT_USERNAME and MQTT_PASSWORD:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    
    # Connect
    try:
        print(f'Connecting to {MQTT_BROKER}:{MQTT_PORT}...')
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        
        # Start loop
        client.loop_forever()
        
    except KeyboardInterrupt:
        print('\n⚠️ Interrupted by user')
        client.disconnect()
    except Exception as e:
        print(f'❌ Error: {e}')

if __name__ == '__main__':
    main()
```

### Java

```java
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

public class ThirdPartyMqttClient {
    
    private static final String API_BASE_URL = "http://localhost:3001";
    private static final String MASTER_API_KEY = "your_master_api_key_here";
    private static final String MQTT_BROKER = "tcp://broker.hivemq.com:1883";
    private static final String MQTT_USERNAME = "your_username";
    private static final String MQTT_PASSWORD = "your_password";
    
    public static void main(String[] args) {
        try {
            // Step 1: Get topics from REST API
            List<TopicInfo> topics = getTopics("factory", "factoryId=1&messageTypes=errors,inspection");
            
            System.out.println("Topics to subscribe: " + topics.size());
            
            // Step 2: Connect to MQTT broker
            String clientId = "third-party-app-" + System.currentTimeMillis();
            MqttClient client = new MqttClient(MQTT_BROKER, clientId, new MemoryPersistence());
            
            MqttConnectOptions options = new MqttConnectOptions();
            options.setCleanSession(true);
            if (MQTT_USERNAME != null && !MQTT_USERNAME.isEmpty()) {
                options.setUserName(MQTT_USERNAME);
                options.setPassword(MQTT_PASSWORD.toCharArray());
            }
            options.setAutomaticReconnect(true);
            options.setKeepAliveInterval(60);
            
            // Set callback
            client.setCallback(new MqttCallback() {
                @Override
                public void connectionLost(Throwable cause) {
                    System.out.println("⚠️ Connection lost: " + cause.getMessage());
                }
                
                @Override
                public void messageArrived(String topic, MqttMessage message) throws Exception {
                    String payload = new String(message.getPayload());
                    JSONObject json = new JSONObject(payload);
                    
                    System.out.println("\n📨 Message from " + topic + ":");
                    System.out.println(json.toString(2));
                    
                    String type = json.optString("type");
                    
                    if ("NG_ALERT".equals(type)) {
                        handleNGAlert(json);
                    } else if ("INSPECTION_RESULT".equals(type)) {
                        handleInspectionResult(json);
                    }
                }
                
                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                    // Not used for subscriber
                }
            });
            
            // Connect
            System.out.println("Connecting to MQTT broker...");
            client.connect(options);
            System.out.println("✅ Connected to MQTT broker");
            
            // Subscribe to topics
            for (TopicInfo topicInfo : topics) {
                client.subscribe(topicInfo.topic, topicInfo.qos);
                System.out.println("✅ Subscribed to " + topicInfo.topic + " (QoS " + topicInfo.qos + ")");
            }
            
            // Keep running
            System.out.println("\nListening for messages... Press Ctrl+C to exit.");
            
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    private static List<TopicInfo> getTopics(String level, String queryParams) throws Exception {
        String urlStr = API_BASE_URL + "/api/external/hierarchy/mqtt-topics?level=" + level + "&" + queryParams;
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("X-Master-Key", MASTER_API_KEY);
        
        int responseCode = conn.getResponseCode();
        if (responseCode != 200) {
            throw new Exception("Failed to fetch topics: HTTP " + responseCode);
        }
        
        BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
        String inputLine;
        StringBuilder response = new StringBuilder();
        
        while ((inputLine = in.readLine()) != null) {
            response.append(inputLine);
        }
        in.close();
        
        JSONObject json = new JSONObject(response.toString());
        if (!json.getBoolean("success")) {
            throw new Exception("API returned success=false");
        }
        
        JSONArray data = json.getJSONArray("data");
        List<TopicInfo> topics = new ArrayList<>();
        
        for (int i = 0; i < data.length(); i++) {
            JSONObject item = data.getJSONObject(i);
            topics.add(new TopicInfo(
                item.getString("topic"),
                item.getInt("qos"),
                item.getString("description")
            ));
        }
        
        return topics;
    }
    
    private static void handleNGAlert(JSONObject alert) {
        System.out.println("\n🚨 NG ALERT DETECTED:");
        System.out.println("- Alert ID: " + alert.optString("alertId"));
        System.out.println("- Station: " + alert.optJSONObject("station").optString("name"));
        System.out.println("- Product: " + alert.optJSONObject("product").optString("serialNumber"));
        System.out.println("- Severity: " + alert.optString("severity"));
        System.out.println("- Total NG: " + alert.optInt("totalNG"));
    }
    
    private static void handleInspectionResult(JSONObject result) {
        System.out.println("\n✅ INSPECTION RESULT:");
        System.out.println("- Serial Number: " + result.optString("serialNumber"));
        System.out.println("- Result: " + result.optString("result"));
        System.out.println("- Cycle Time: " + result.optDouble("cycleTime") + "s");
    }
    
    static class TopicInfo {
        String topic;
        int qos;
        String description;
        
        TopicInfo(String topic, int qos, String description) {
            this.topic = topic;
            this.qos = qos;
            this.description = description;
        }
    }
}
```

---

## Kiểm thử & Xác nhận

### Bước 1: Test REST API

```bash
# Test authentication
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-message-types" \
  -H "X-Master-Key: wrong_key"
# ❌ Expected: 401 Unauthorized

# Test với key đúng
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-message-types" \
  -H "X-Master-Key: your_master_api_key_here"
# ✅ Expected: JSON với danh sách message types

# Test topic generation
curl -X GET "http://localhost:3001/api/external/hierarchy/mqtt-topics?level=all" \
  -H "X-Master-Key: your_master_api_key_here"
# ✅ Expected: JSON với danh sách topics
```

### Bước 2: Test MQTT Connection với MQTT Explorer

1. **Tải MQTT Explorer**: https://mqtt-explorer.com/
2. **Cấu hình connection**:
   - Name: `AVI-AOI Test`
   - Host: `broker.hivemq.com` (hoặc IP server)
   - Port: `1883`
   - Username: `your_username`
   - Password: `your_password`
3. **Connect** và xem topics trong hierarchy
4. **Subscribe** vào `avi/#` để xem tất cả messages

### Bước 3: Test Message Reception

Dùng mosquitto_sub để test subscribe:

```bash
# Subscribe tất cả messages
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "avi/#" -v

# Subscribe chỉ errors
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "avi/+/workshop/+/station/+/errors" -v

# Subscribe với QoS 2
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "avi/1/workshop/1/station/1/#" -q 2 -v
```

### Bước 4: Validation Checklist

- [ ] REST API authentication hoạt động (401 với key sai, 200 với key đúng)
- [ ] Lấy được danh sách message types
- [ ] Lấy được danh sách topics theo level (all/factory/workshop/line/station)
- [ ] MQTT broker connection thành công
- [ ] Subscribe topics thành công
- [ ] Nhận được messages (test với MQTT Explorer hoặc mosquitto_sub)
- [ ] Message format đúng với specification
- [ ] QoS levels đúng (errors = QoS 2, status/heartbeat = QoS 0, còn lại = QoS 1)
- [ ] Reconnection tự động hoạt động

---

## Khắc phục Sự cố

### Lỗi 1: Authentication Failed (401 Unauthorized)

**Nguyên nhân:**
- Master API Key sai hoặc không đúng

**Giải pháp:**
```bash
# Kiểm tra key trong .env
grep MASTER_API_KEY .env

# Test với curl
curl -v -X GET "http://localhost:3001/api/external/hierarchy/mqtt-message-types" \
  -H "X-Master-Key: your_key_here"

# Đảm bảo header name đúng: "X-Master-Key" (case-sensitive)
```

### Lỗi 2: MQTT Connection Refused

**Nguyên nhân:**
- Broker URL/port sai
- Credentials sai
- Firewall chặn port
- Broker không chạy

**Giải pháp:**
```bash
# 1. Kiểm tra broker có chạy không
telnet broker.hivemq.com 1883

# 2. Test với mosquitto_sub
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t test/topic -v

# 3. Kiểm tra firewall
# Windows:
netstat -an | findstr :1883

# Linux:
sudo netstat -tuln | grep 1883

# 4. Kiểm tra env vars
grep EXTERNAL_MQTT .env
```

### Lỗi 3: TLS/SSL Connection Error

**Nguyên nhân:**
- TLS certificates không đúng
- CA certificate không tin cậy
- Protocol mismatch (mqtt vs mqtts)

**Giải pháp:**
```bash
# 1. Kiểm tra broker URL protocol
# Nếu dùng TLS, phải dùng mqtts:// hoặc wss://
EXTERNAL_MQTT_BROKER=mqtts://your-broker.com
EXTERNAL_MQTT_USE_TLS=true

# 2. Cung cấp CA certificate
EXTERNAL_MQTT_CA_CERT=/path/to/ca.crt

# 3. Test TLS connection
openssl s_client -connect your-broker.com:8883 -showcerts
```

### Lỗi 4: No Messages Received

**Nguyên nhân:**
- Topics không đúng pattern
- QoS không khớp
- Messages không được publish
- Subscription failed

**Giải pháp:**
```bash
# 1. Dùng MQTT Explorer để xem tất cả topics hiện có
# 2. Test subscribe với wildcard rộng
mosquitto_sub -h broker.hivemq.com -p 1883 \
  -u your_username -P your_password \
  -t "#" -v

# 3. Kiểm tra subscription callback
# Trong code, log ra khi subscribe thành công
client.on('subscribe', (mid, granted_qos) => {
  console.log('Subscribed:', mid, granted_qos);
});

# 4. Kiểm tra có messages đang được publish không
# Dùng MQTT Explorer subscribe vào avi/# và monitor
```

### Lỗi 5: Messages Missing/Duplicated

**Nguyên nhân:**
- QoS levels không đúng
- Clean session = false với clientId cũ
- Network unstable

**Giải pháp:**
```javascript
// 1. Sử dụng QoS đúng
// - QoS 0: At most once (có thể mất message)
// - QoS 1: At least once (có thể duplicate)
// - QoS 2: Exactly once (chính xác, nhưng chậm hơn)

// 2. Dùng clean session = true để tránh nhận messages cũ
const client = mqtt.connect(broker, {
  clean: true,  // ✅ Recommended cho third-party apps
  clientId: `app-${Date.now()}` // Unique clientId mỗi lần connect
});

// 3. Handle duplicates trong code
const seenMessageIds = new Set();

client.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());
  const messageId = payload.alertId || payload.inspectionId;
  
  if (seenMessageIds.has(messageId)) {
    console.log('Duplicate message, skipping');
    return;
  }
  
  seenMessageIds.add(messageId);
  // Process message...
});
```

### Lỗi 6: Port Conflict (Local Broker)

**Nguyên nhân:**
- Port 1883 hoặc 8883 đã được dùng bởi process khác

**Giải pháp:**
```bash
# Windows: Tìm process đang dùng port
netstat -ano | findstr :1883
taskkill /PID <PID> /F

# Linux: Tìm và kill process
sudo lsof -i :1883
sudo kill -9 <PID>

# Hoặc đổi port trong .env
MQTT_PORT=11883
MQTT_WS_PORT=18883
```

### Lỗi 7: Memory Leak / High CPU

**Nguyên nhân:**
- Không cleanup connections
- Reconnect loop không có delay
- Message processing quá chậm

**Giải pháp:**
```javascript
// 1. Cleanup khi thoát
process.on('SIGINT', () => {
  console.log('Shutting down...');
  client.end(true, () => {
    process.exit(0);
  });
});

// 2. Limit reconnect rate
const client = mqtt.connect(broker, {
  reconnectPeriod: 5000,  // 5 giây
  connectTimeout: 30000   // 30 giây timeout
});

// 3. Process messages async để không block
client.on('message', async (topic, message) => {
  // Xử lý trong background
  setImmediate(async () => {
    try {
      await processMessage(topic, message);
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
});
```

---

## Tài liệu Tham khảo

### MQTT Specifications
- **MQTT v3.1.1**: http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html
- **MQTT v5.0**: https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html

### Client Libraries
- **JavaScript/Node.js**: https://github.com/mqttjs/MQTT.js
- **Python**: https://pypi.org/project/paho-mqtt/
- **Java**: https://www.eclipse.org/paho/clients/java/
- **C#/.NET**: https://github.com/dotnet/MQTTnet

### Tools
- **MQTT Explorer**: http://mqtt-explorer.com/ (GUI client)
- **Mosquitto**: https://mosquitto.org/ (Broker + CLI tools)
- **HiveMQ**: https://www.hivemq.com/ (Cloud MQTT broker)
- **EMQX**: https://www.emqx.io/ (Enterprise MQTT broker)

### Related Documentation
- [MQTT_CONFIGURATION.md](./MQTT_CONFIGURATION.md) - Cấu hình broker chi tiết
- [API_REFERENCE.md](./API_REFERENCE.md) - REST API reference

---

## Hỗ trợ

Nếu gặp vấn đề, vui lòng:

1. ✅ Kiểm tra [Khắc phục Sự cố](#khắc-phục-sự-cố) phía trên
2. ✅ Xem logs từ server và client
3. ✅ Test với MQTT Explorer để xác định vấn đề
4. ✅ Liên hệ team quản trị hệ thống

---

**Phiên bản:** 1.0.0  
**Ngày cập nhật:** 2025-01-26  
**Người viết:** AVI-AOI Development Team
