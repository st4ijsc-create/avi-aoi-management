# 📡 MQTT Documentation - Navigation Guide

> Tài liệu đầy đủ về MQTT Integration cho hệ thống AVI-AOI Management

---

## 🎯 Bắt đầu từ đâu?

Chọn tài liệu phù hợp với vai trò của bạn:

| Vai trò | Mục tiêu | Tài liệu |
|---------|----------|----------|
| **Developer** - Tích hợp app bên thứ 3 | 5 phút setup nhanh | **[MQTT_QUICK_START.md](./MQTT_QUICK_START.md)** ⭐ |
| **Developer** - Tích hợp ứng dụng (MES, ERP, Dashboard) | Hướng dẫn đầy đủ với code examples | **[THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md)** 📖 |
| **DevOps / SysAdmin** - Cài đặt và cấu hình MQTT Broker | Setup broker (Mosquitto, HiveMQ, EMQX) | **[MQTT_CONFIGURATION.md](./MQTT_CONFIGURATION.md)** ⚙️ |
| **AVI/AOI Engineer** - Viết code cho máy publish dữ liệu | Python/JavaScript client code | **[MQTT_CONFIGURATION.md#sample-code](./MQTT_CONFIGURATION.md#sample-code-cho-máy-aviaoi)** 🔧 |
| **Mobile Developer** - Android app | React Native MQTT client | **[android-mqtt-app/README.md](../android-mqtt-app/README.md)** 📱 |

---

## 📚 Tài liệu chi tiết

### 1. 🚀 [MQTT Quick Start Guide](./MQTT_QUICK_START.md)

**Dành cho**: Developers muốn setup nhanh trong 5 phút

**Nội dung**:
- ✅ Copy-paste code (JavaScript, Python) chạy ngay
- ✅ Yêu cầu tối thiểu (3 items)
- ✅ 3 bước setup: Install → Config → Run
- ✅ Troubleshooting quick fixes
- ✅ Security checklist

**Khi nào dùng**: 
- Bạn cần PoC (Proof of Concept) nhanh
- Bạn đã biết MQTT, chỉ cần config
- First-time integration

---

### 2. 📖 [Third-Party MQTT Integration Guide](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md)

**Dành cho**: Developers tích hợp ứng dụng bên thứ 3 với hệ thống AVI-AOI

**Nội dung** (15,000+ characters):
- ✅ **Kiến trúc Hệ thống**: Dual-broker architecture (Local + External)
- ✅ **REST API Documentation**: 2 endpoints với curl examples
  - `/api/external/hierarchy/mqtt-topics` - Topic discovery
  - `/api/external/hierarchy/mqtt-message-types` - Message types
- ✅ **Integration Methods**:
  - Method 1: REST API + MQTT (recommended)
  - Method 2: Direct MQTT (simple wildcards)
- ✅ **Message Formats**: 6 types với full JSON schemas
  - INSPECTION_RESULT, NG_ALERT, MACHINE_STATUS, HEARTBEAT, DAILY_SUMMARY, WEEKLY_SUMMARY
- ✅ **Code Examples**: 470+ lines production-ready code
  - **JavaScript** (170 lines): axios + mqtt.js
  - **Python** (150 lines): requests + paho-mqtt
  - **Java** (150 lines): HttpURLConnection + Eclipse Paho
- ✅ **Testing Procedures**: MQTT Explorer, mosquitto_sub, validation checklist
- ✅ **Troubleshooting**: 7 common issues với solutions

**Khi nào dùng**:
- Bạn cần integrate MES, ERP, Analytics dashboard
- Bạn cần understand full architecture
- Bạn cần code examples cho multiple languages
- Bạn gặp lỗi và cần troubleshooting guide

---

### 3. ⚙️ [MQTT Configuration Guide](./MQTT_CONFIGURATION.md)

**Dành cho**: DevOps, SysAdmin, Infrastructure Engineers

**Nội dung**:
- ✅ **Broker Installation**: Mosquitto, HiveMQ Cloud, EMQX
- ✅ **Environment Variables**: Local + External MQTT config
- ✅ **Topics Structure**: Naming convention, wildcards, QoS levels
- ✅ **Message Formats**: JSON schemas
- ✅ **Publisher Code**: Python, JavaScript cho máy AVI/AOI
- ✅ **Security**: TLS/SSL, Authentication, Authorization
- ✅ **Testing**: MQTT Explorer, mosquitto_sub, MQTTX
- ✅ **Troubleshooting**: Quick fixes với commands

**Khi nào dùng**:
- Bạn cần setup MQTT broker infrastructure
- Bạn cần configure TLS/SSL certificates
- Bạn cần write code cho AVI/AOI machines publish data
- Bạn cần understand complete system architecture

---

### 4. 📱 [Android MQTT App](../android-mqtt-app/README.md)

**Dành cho**: Mobile Developers

**Nội dung**:
- ✅ React Native MQTT client implementation
- ✅ Firebase Push Notifications integration
- ✅ Inspection result & NG alert display
- ✅ Multi-factory/workshop support
- ✅ Setup guide và deployment

**Khi nào dùng**:
- Bạn cần build mobile app để monitor AVI/AOI
- Bạn cần push notifications cho NG alerts
- Bạn cần reference implementation cho React Native + MQTT

---

## 🔍 Tìm kiếm theo tình huống

### Tình huống 1: "Tôi muốn nhận dữ liệu từ hệ thống AVI-AOI trong app của tôi"

**Giải pháp**:
1. **Bắt đầu**: [MQTT_QUICK_START.md](./MQTT_QUICK_START.md) - Copy code, chạy ngay trong 5 phút
2. **Tìm hiểu sâu**: [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md) - Section 5 (Integration Methods)
3. **Gặp lỗi**: [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố)

### Tình huống 2: "Tôi cần cài đặt MQTT broker (Mosquitto, HiveMQ)"

**Giải pháp**:
1. **Docker/Production setup**: [MQTT_CONFIGURATION.md#cấu-hình-mqtt-broker](./MQTT_CONFIGURATION.md#cấu-hình-mqtt-broker)
2. **Environment variables**: [.env.example](../.env.example) - Search for `MQTT`
3. **TLS/SSL config**: [MQTT_CONFIGURATION.md#bảo-mật](./MQTT_CONFIGURATION.md#bảo-mật)

### Tình huống 3: "Máy AVI/AOI của tôi cần publish dữ liệu"

**Giải pháp**:
1. **Python code**: [MQTT_CONFIGURATION.md#python-client](./MQTT_CONFIGURATION.md#python-client)
2. **JavaScript code**: [MQTT_CONFIGURATION.md#nodejs-client](./MQTT_CONFIGURATION.md#nodejs-client)
3. **Message formats**: [MQTT_CONFIGURATION.md#message-formats](./MQTT_CONFIGURATION.md#message-formats)

### Tình huống 4: "Tôi cần REST API để lấy danh sách topics"

**Giải pháp**:
1. **API Documentation**: [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#4-rest-api-cho-khám-phá-topic](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#4-rest-api-cho-khám-phá-topic)
2. **Code examples**: [MQTT_QUICK_START.md](./MQTT_QUICK_START.md) - JavaScript/Python
3. **Authentication**: Cần Master API Key (xem [SETUP_ADMIN_GUIDE.md](./SETUP_ADMIN_GUIDE.md))

### Tình huống 5: "Tôi cần build mobile app để monitor"

**Giải pháp**:
1. **Android app**: [android-mqtt-app/README.md](../android-mqtt-app/README.md)
2. **Push notifications**: [FIREBASE_PUSH_NOTIFICATIONS.md](./FIREBASE_PUSH_NOTIFICATIONS.md)
3. **MQTT client setup**: [android-mqtt-app/src/services/mqttService.ts](../android-mqtt-app/src/services/mqttService.ts)

### Tình huống 6: "Connection refused, Authentication failed, Messages không nhận được"

**Giải pháp**:
1. **Quick fixes**: [MQTT_CONFIGURATION.md#troubleshooting](./MQTT_CONFIGURATION.md#troubleshooting)
2. **Detailed troubleshooting**: [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố) (7 issues)
3. **Testing tools**: [MQTT_CONFIGURATION.md#testing-với-tools](./MQTT_CONFIGURATION.md#testing-với-tools)

---

## 🛠️ Tools & Resources

### Testing Tools

| Tool | Platform | Use Case | Download |
|------|----------|----------|----------|
| **MQTT Explorer** | Desktop (Win/Mac/Linux) | Visual debugging, message inspector | [mqtt-explorer.com](http://mqtt-explorer.com/) |
| **mosquitto_sub/pub** | CLI (All platforms) | Quick testing, scripting | [mosquitto.org](https://mosquitto.org/download/) |
| **MQTTX** | Desktop + CLI | Benchmarking, advanced testing | [mqttx.app](https://mqttx.app/) |
| **HiveMQ WebSocket Client** | Browser | No-install online testing | [hivemq.com/demos](http://www.hivemq.com/demos/websocket-client/) |

### MQTT Brokers (Production-Ready)

| Broker | License | Deployment | Best For |
|--------|---------|------------|----------|
| **Mosquitto** | Open Source (EPL/EDL) | Self-hosted | Small-medium deployments, full control |
| **HiveMQ Cloud** | Managed (Free tier available) | SaaS | Quick setup, no maintenance, scalable |
| **EMQX** | Open Source + Enterprise | Docker, K8s, Cloud | High throughput, IoT, distributed |
| **VerneMQ** | Open Source (Apache 2.0) | Self-hosted | Clustering, high availability |

### MQTT Client Libraries

| Language | Library | Installation |
|----------|---------|--------------|
| **JavaScript** | mqtt.js | `npm install mqtt` |
| **Python** | paho-mqtt | `pip install paho-mqtt` |
| **Java** | Eclipse Paho | Maven: `org.eclipse.paho:paho-client-mqttv3` |
| **C#** | MQTTnet | NuGet: `Install-Package MQTTnet` |
| **Go** | paho.mqtt.golang | `go get github.com/eclipse/paho.mqtt.golang` |

---

## ❓ FAQ

### Q1: Tôi cần Master API Key để làm gì?

**A**: Master API Key dùng để authenticate với REST API khi gọi `/api/external/hierarchy/mqtt-topics`. Liên hệ admin để lấy key hoặc xem [SETUP_ADMIN_GUIDE.md](./SETUP_ADMIN_GUIDE.md).

### Q2: QoS 0, 1, 2 khác nhau thế nào?

**A**: 
- **QoS 0**: At most once - Gửi 1 lần, không đảm bảo delivery (dùng cho status, heartbeat)
- **QoS 1**: At least once - Đảm bảo delivery, có thể duplicate (dùng cho inspection, summary)
- **QoS 2**: Exactly once - Đảm bảo delivery đúng 1 lần (dùng cho errors, critical alerts)

### Q3: Tôi nên dùng Method 1 (REST API + MQTT) hay Method 2 (Direct MQTT)?

**A**:
- **Method 1** (Recommended): Dùng khi cần dynamic topic discovery, multi-factory, filter message types, dễ maintain
- **Method 2**: Dùng khi setup đơn giản, topic cố định, không cần REST API

### Q4: MQTT Broker nên chọn gì?

**A**:
- **Development/Testing**: HiveMQ Cloud (free tier, no setup)
- **Production (self-hosted)**: Mosquitto (stable, lightweight)
- **Production (high scale)**: EMQX or HiveMQ Enterprise

### Q5: Làm sao test MQTT mà không cần viết code?

**A**: Dùng MQTT Explorer (GUI):
1. Download: http://mqtt-explorer.com/
2. Connect với broker credentials
3. Subscribe: `avi/#`
4. Xem messages real-time, inspect JSON

### Q6: Tôi có thể subscribe all topics (`#`) không?

**A**: Có, nhưng **không khuyến khích** trong production:
- Nhận tất cả messages (có thể rất nhiều)
- Tốn bandwidth, memory
- **Best practice**: Subscribe specific topics theo nhu cầu (e.g., `avi/1/workshop/+/station/+/errors`)

### Q7: External MQTT Broker khác Local Broker thế nào?

**A**:
- **Local Broker (Aedes)**: Chạy trong MES server, nhận messages từ AVI/AOI machines
- **External Broker (HiveMQ/Mosquitto)**: Cloud broker, MES forward messages đến đây để third-party apps subscribe

---

## 📞 Hỗ trợ

### Gặp vấn đề?

1. **Troubleshooting**: Xem [MQTT_CONFIGURATION.md#troubleshooting](./MQTT_CONFIGURATION.md#troubleshooting)
2. **Detailed guide**: [THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố](./THIRD_PARTY_MQTT_INTEGRATION_GUIDE.md#9-khắc-phục-sự-cố)
3. **Liên hệ team**: Xem [MQTT_CONFIGURATION.md#liên-hệ-hỗ-trợ](./MQTT_CONFIGURATION.md#liên-hệ-hỗ-trợ)

### Tài liệu khác

- **[API_REFERENCE.md](./API_REFERENCE.md)** - REST API documentation
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Production deployment
- **[FIREBASE_PUSH_NOTIFICATIONS.md](./FIREBASE_PUSH_NOTIFICATIONS.md)** - Push notifications setup
- **[SETUP_ADMIN_GUIDE.md](./SETUP_ADMIN_GUIDE.md)** - Admin configuration

---

**📝 Last updated**: 2025-01-26

**✍️ Maintained by**: AVI-AOI Management Team
