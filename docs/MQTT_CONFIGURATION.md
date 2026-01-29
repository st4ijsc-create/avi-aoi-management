# Hướng dẫn Cấu hình MQTT Broker

## Tổng quan

Hệ thống MES AVI/AOI sử dụng MQTT protocol để nhận dữ liệu real-time từ các máy kiểm tra AVI/AOI. Tài liệu này hướng dẫn cách cấu hình MQTT broker và kết nối với hệ thống.

## Kiến trúc MQTT

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Máy AVI/AOI   │────▶│   MQTT Broker   │────▶│   MES Server    │
│   (Publisher)   │     │ (Mosquitto/     │     │   (Subscriber)  │
│                 │     │  HiveMQ)        │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Cấu hình Environment Variables

### Server-side Variables

```bash
# Bật/tắt MQTT (mặc định: false)
MQTT_ENABLED=true

# Bật/tắt kết nối External MQTT Broker
EXTERNAL_MQTT_ENABLED=true

# External MQTT Broker Configuration
EXTERNAL_MQTT_URL=mqtt://broker.hivemq.com
EXTERNAL_MQTT_PORT=1883
EXTERNAL_MQTT_USERNAME=your_username
EXTERNAL_MQTT_PASSWORD=your_password

# TLS/SSL Configuration (optional)
EXTERNAL_MQTT_USE_TLS=true
EXTERNAL_MQTT_CA_CERT=/path/to/ca.crt
EXTERNAL_MQTT_CLIENT_CERT=/path/to/client.crt
EXTERNAL_MQTT_CLIENT_KEY=/path/to/client.key
```

## Cấu hình MQTT Broker

### Option 1: Mosquitto (Self-hosted)

#### Cài đặt trên Ubuntu/Debian

```bash
# Cài đặt Mosquitto
sudo apt update
sudo apt install mosquitto mosquitto-clients

# Khởi động service
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

#### Cấu hình Mosquitto (`/etc/mosquitto/mosquitto.conf`)

```conf
# Basic Configuration
listener 1883
protocol mqtt

# WebSocket Support (optional)
listener 9001
protocol websockets

# Authentication
allow_anonymous false
password_file /etc/mosquitto/passwd

# Logging
log_dest file /var/log/mosquitto/mosquitto.log
log_type all

# Persistence
persistence true
persistence_location /var/lib/mosquitto/
```

#### Tạo User Authentication

```bash
# Tạo password file
sudo mosquitto_passwd -c /etc/mosquitto/passwd avi_user

# Thêm user mới
sudo mosquitto_passwd -b /etc/mosquitto/passwd avi_machine password123

# Restart Mosquitto
sudo systemctl restart mosquitto
```

### Option 2: HiveMQ Cloud (Managed)

1. Đăng ký tài khoản tại [HiveMQ Cloud](https://www.hivemq.com/cloud/)
2. Tạo cluster mới
3. Lấy thông tin kết nối:
   - Host: `your-cluster.hivemq.cloud`
   - Port: `8883` (TLS) hoặc `1883` (non-TLS)
   - Username/Password từ dashboard

### Option 3: EMQX (Enterprise)

```bash
# Docker installation
docker run -d --name emqx \
  -p 1883:1883 \
  -p 8083:8083 \
  -p 8084:8084 \
  -p 8883:8883 \
  -p 18083:18083 \
  emqx/emqx:latest
```

## MQTT Topics Structure

### Topic Naming Convention

```
avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}
```

### Message Types

| Topic | Description | QoS |
|-------|-------------|-----|
| `.../inspection` | Kết quả kiểm tra | 1 |
| `.../errors` | Cảnh báo NG | 2 |
| `.../status` | Trạng thái máy | 0 |
| `.../heartbeat` | Heartbeat | 0 |
| `.../summary/daily` | Báo cáo ngày | 1 |
| `.../summary/weekly` | Báo cáo tuần | 1 |

### Wildcard Subscriptions

```
# Subscribe tất cả stations trong factory
avi/1/workshop/+/station/+/inspection

# Subscribe tất cả messages từ một station
avi/1/workshop/1/station/1/#

# Subscribe tất cả errors
avi/+/workshop/+/station/+/errors
```

## Message Formats

### Inspection Result

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

### NG Alert

```json
{
  "type": "NG_ALERT",
  "timestamp": "2025-01-26T10:00:00Z",
  "machineCode": "AVI-001",
  "stationId": 1,
  "serialNumber": "SN20250126002",
  "productModel": "MODEL-A",
  "ngPoints": [
    {
      "pointId": 2,
      "pointName": "Solder Joint 2",
      "result": "NG",
      "actualValue": "85.2",
      "standardValue": "95-100",
      "defectType": "INSUFFICIENT_SOLDER"
    }
  ],
  "totalNG": 1,
  "imageUrl": "https://storage.example.com/images/ng_001.jpg"
}
```

### Machine Status

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

### Heartbeat

```json
{
  "type": "HEARTBEAT",
  "timestamp": "2025-01-26T10:00:00Z",
  "machineCode": "AVI-001",
  "sequence": 12345
}
```

## Sample Code cho Máy AVI/AOI

### Python Client

```python
#!/usr/bin/env python3
"""
AVI/AOI MQTT Client - Gửi dữ liệu kiểm tra lên MES
"""

import json
import time
import random
from datetime import datetime
import paho.mqtt.client as mqtt

# Configuration
BROKER_HOST = "broker.hivemq.com"  # Hoặc IP của Mosquitto server
BROKER_PORT = 1883
USERNAME = "avi_machine"
PASSWORD = "your_password"

FACTORY_ID = 1
WORKSHOP_ID = 1
STATION_ID = 1
MACHINE_CODE = "AVI-001"

# Topic prefix
TOPIC_PREFIX = f"avi/{FACTORY_ID}/workshop/{WORKSHOP_ID}/station/{STATION_ID}"

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[{datetime.now()}] Connected to MQTT Broker!")
    else:
        print(f"[{datetime.now()}] Failed to connect, return code {rc}")

def on_disconnect(client, userdata, rc):
    print(f"[{datetime.now()}] Disconnected from MQTT Broker")

def on_publish(client, userdata, mid):
    print(f"[{datetime.now()}] Message {mid} published")

def create_client():
    client = mqtt.Client(client_id=f"avi_machine_{MACHINE_CODE}_{int(time.time())}")
    client.username_pw_set(USERNAME, PASSWORD)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_publish = on_publish
    return client

def send_inspection_result(client, serial_number, result, inspection_points):
    """Gửi kết quả kiểm tra"""
    payload = {
        "type": "INSPECTION_RESULT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "stationId": STATION_ID,
        "serialNumber": serial_number,
        "productModel": "MODEL-A",
        "result": result,
        "cycleTime": round(random.uniform(2.0, 3.5), 2),
        "inspectionPoints": inspection_points
    }
    
    topic = f"{TOPIC_PREFIX}/inspection"
    client.publish(topic, json.dumps(payload), qos=1)
    print(f"[{datetime.now()}] Sent inspection: {serial_number} - {result}")

def send_ng_alert(client, serial_number, ng_points):
    """Gửi cảnh báo NG"""
    payload = {
        "type": "NG_ALERT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "stationId": STATION_ID,
        "serialNumber": serial_number,
        "productModel": "MODEL-A",
        "ngPoints": ng_points,
        "totalNG": len(ng_points)
    }
    
    topic = f"{TOPIC_PREFIX}/errors"
    client.publish(topic, json.dumps(payload), qos=2)
    print(f"[{datetime.now()}] Sent NG Alert: {serial_number} - {len(ng_points)} NG points")

def send_heartbeat(client, sequence):
    """Gửi heartbeat"""
    payload = {
        "type": "HEARTBEAT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "sequence": sequence
    }
    
    topic = f"{TOPIC_PREFIX}/heartbeat"
    client.publish(topic, json.dumps(payload), qos=0)

def send_machine_status(client, status):
    """Gửi trạng thái máy"""
    payload = {
        "type": "MACHINE_STATUS",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "status": status,
        "uptime": int(time.time()) % 86400,
        "temperature": round(random.uniform(24.0, 26.0), 1),
        "humidity": round(random.uniform(40.0, 50.0), 1),
        "errorCode": None
    }
    
    topic = f"{TOPIC_PREFIX}/status"
    client.publish(topic, json.dumps(payload), qos=0)

def simulate_inspection():
    """Mô phỏng kết quả kiểm tra"""
    # 95% OK, 5% NG
    is_ok = random.random() > 0.05
    
    inspection_points = []
    ng_points = []
    
    for i in range(1, 6):
        point_result = "OK" if is_ok or random.random() > 0.3 else "NG"
        actual_value = round(random.uniform(90, 100) if point_result == "OK" else random.uniform(70, 90), 1)
        
        point = {
            "pointId": i,
            "pointName": f"Solder Joint {i}",
            "result": point_result,
            "actualValue": str(actual_value),
            "standardValue": "95-100",
            "unit": "%"
        }
        inspection_points.append(point)
        
        if point_result == "NG":
            ng_points.append({
                **point,
                "defectType": random.choice(["INSUFFICIENT_SOLDER", "EXCESS_SOLDER", "BRIDGE", "VOID"])
            })
    
    result = "OK" if len(ng_points) == 0 else "NG"
    return result, inspection_points, ng_points

def main():
    client = create_client()
    
    try:
        print(f"Connecting to {BROKER_HOST}:{BROKER_PORT}...")
        client.connect(BROKER_HOST, BROKER_PORT, 60)
        client.loop_start()
        
        # Wait for connection
        time.sleep(2)
        
        # Send initial status
        send_machine_status(client, "running")
        
        sequence = 0
        inspection_count = 0
        
        while True:
            # Send heartbeat every 10 seconds
            sequence += 1
            send_heartbeat(client, sequence)
            
            # Simulate inspection every 3 seconds
            if sequence % 3 == 0:
                inspection_count += 1
                serial_number = f"SN{datetime.now().strftime('%Y%m%d')}{inspection_count:04d}"
                
                result, inspection_points, ng_points = simulate_inspection()
                send_inspection_result(client, serial_number, result, inspection_points)
                
                if ng_points:
                    send_ng_alert(client, serial_number, ng_points)
            
            # Send status every 60 seconds
            if sequence % 60 == 0:
                send_machine_status(client, "running")
            
            time.sleep(10)
            
    except KeyboardInterrupt:
        print("\nStopping...")
        send_machine_status(client, "stopped")
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
```

### Node.js Client

```javascript
/**
 * AVI/AOI MQTT Client - Node.js
 * Gửi dữ liệu kiểm tra lên MES
 */

const mqtt = require('mqtt');

// Configuration
const config = {
  brokerUrl: 'mqtt://broker.hivemq.com',
  port: 1883,
  username: 'avi_machine',
  password: 'your_password',
  factoryId: 1,
  workshopId: 1,
  stationId: 1,
  machineCode: 'AVI-001'
};

const topicPrefix = `avi/${config.factoryId}/workshop/${config.workshopId}/station/${config.stationId}`;

// Create MQTT client
const client = mqtt.connect(config.brokerUrl, {
  port: config.port,
  username: config.username,
  password: config.password,
  clientId: `avi_machine_${config.machineCode}_${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000
});

client.on('connect', () => {
  console.log(`[${new Date().toISOString()}] Connected to MQTT Broker!`);
  sendMachineStatus('running');
});

client.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] MQTT Error:`, err.message);
});

client.on('close', () => {
  console.log(`[${new Date().toISOString()}] Disconnected from MQTT Broker`);
});

function sendInspectionResult(serialNumber, result, inspectionPoints) {
  const payload = {
    type: 'INSPECTION_RESULT',
    timestamp: new Date().toISOString(),
    machineCode: config.machineCode,
    stationId: config.stationId,
    serialNumber,
    productModel: 'MODEL-A',
    result,
    cycleTime: Math.round((Math.random() * 1.5 + 2) * 100) / 100,
    inspectionPoints
  };
  
  client.publish(`${topicPrefix}/inspection`, JSON.stringify(payload), { qos: 1 });
  console.log(`[${new Date().toISOString()}] Sent inspection: ${serialNumber} - ${result}`);
}

function sendNGAlert(serialNumber, ngPoints) {
  const payload = {
    type: 'NG_ALERT',
    timestamp: new Date().toISOString(),
    machineCode: config.machineCode,
    stationId: config.stationId,
    serialNumber,
    productModel: 'MODEL-A',
    ngPoints,
    totalNG: ngPoints.length
  };
  
  client.publish(`${topicPrefix}/errors`, JSON.stringify(payload), { qos: 2 });
  console.log(`[${new Date().toISOString()}] Sent NG Alert: ${serialNumber} - ${ngPoints.length} NG points`);
}

function sendHeartbeat(sequence) {
  const payload = {
    type: 'HEARTBEAT',
    timestamp: new Date().toISOString(),
    machineCode: config.machineCode,
    sequence
  };
  
  client.publish(`${topicPrefix}/heartbeat`, JSON.stringify(payload), { qos: 0 });
}

function sendMachineStatus(status) {
  const payload = {
    type: 'MACHINE_STATUS',
    timestamp: new Date().toISOString(),
    machineCode: config.machineCode,
    status,
    uptime: Math.floor(Date.now() / 1000) % 86400,
    temperature: Math.round((Math.random() * 2 + 24) * 10) / 10,
    humidity: Math.round((Math.random() * 10 + 40) * 10) / 10,
    errorCode: null
  };
  
  client.publish(`${topicPrefix}/status`, JSON.stringify(payload), { qos: 0 });
}

function simulateInspection() {
  const isOK = Math.random() > 0.05;
  const inspectionPoints = [];
  const ngPoints = [];
  
  for (let i = 1; i <= 5; i++) {
    const pointResult = isOK || Math.random() > 0.3 ? 'OK' : 'NG';
    const actualValue = pointResult === 'OK' 
      ? Math.round((Math.random() * 10 + 90) * 10) / 10
      : Math.round((Math.random() * 20 + 70) * 10) / 10;
    
    const point = {
      pointId: i,
      pointName: `Solder Joint ${i}`,
      result: pointResult,
      actualValue: String(actualValue),
      standardValue: '95-100',
      unit: '%'
    };
    inspectionPoints.push(point);
    
    if (pointResult === 'NG') {
      ngPoints.push({
        ...point,
        defectType: ['INSUFFICIENT_SOLDER', 'EXCESS_SOLDER', 'BRIDGE', 'VOID'][Math.floor(Math.random() * 4)]
      });
    }
  }
  
  return {
    result: ngPoints.length === 0 ? 'OK' : 'NG',
    inspectionPoints,
    ngPoints
  };
}

// Main loop
let sequence = 0;
let inspectionCount = 0;

setInterval(() => {
  sequence++;
  sendHeartbeat(sequence);
  
  // Simulate inspection every 3 heartbeats
  if (sequence % 3 === 0) {
    inspectionCount++;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const serialNumber = `SN${date}${String(inspectionCount).padStart(4, '0')}`;
    
    const { result, inspectionPoints, ngPoints } = simulateInspection();
    sendInspectionResult(serialNumber, result, inspectionPoints);
    
    if (ngPoints.length > 0) {
      sendNGAlert(serialNumber, ngPoints);
    }
  }
  
  // Send status every 60 heartbeats
  if (sequence % 60 === 0) {
    sendMachineStatus('running');
  }
}, 10000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping...');
  sendMachineStatus('stopped');
  setTimeout(() => {
    client.end();
    process.exit(0);
  }, 1000);
});

console.log('AVI/AOI MQTT Client started. Press Ctrl+C to stop.');
```

## Kiểm tra Kết nối

### Test với mosquitto_pub/sub

```bash
# Subscribe để nhận messages
mosquitto_sub -h broker.hivemq.com -t "avi/#" -v

# Publish test message
mosquitto_pub -h broker.hivemq.com -t "avi/1/workshop/1/station/1/test" -m '{"test": true}'
```

### Test với MQTT Explorer

1. Download [MQTT Explorer](http://mqtt-explorer.com/)
2. Kết nối với broker
3. Subscribe topic `avi/#`
4. Xem messages real-time

## Troubleshooting

### Không kết nối được MQTT Broker

1. Kiểm tra firewall cho phép port 1883/8883
2. Kiểm tra username/password đúng
3. Kiểm tra broker đang chạy: `systemctl status mosquitto`

### Messages không được nhận

1. Kiểm tra topic name đúng format
2. Kiểm tra QoS level phù hợp
3. Kiểm tra client đã subscribe đúng topic

### Connection bị ngắt liên tục

1. Kiểm tra network stability
2. Tăng keepalive interval
3. Kiểm tra client ID không bị trùng

## Bảo mật

### TLS/SSL Configuration

```bash
# Generate certificates
openssl req -new -x509 -days 365 -extensions v3_ca -keyout ca.key -out ca.crt
openssl genrsa -out server.key 2048
openssl req -new -out server.csr -key server.key
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365
```

### Mosquitto TLS Configuration

```conf
listener 8883
protocol mqtt

cafile /etc/mosquitto/certs/ca.crt
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key

require_certificate false
```

## Liên hệ Hỗ trợ

- Email: support@avi-aoi.com
- Documentation: https://docs.avi-aoi.com
- GitHub Issues: https://github.com/your-org/avi-aoi-management/issues
