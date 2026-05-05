# Đánh giá Hiệu suất Hệ thống cho 20 Máy trên Mạng LAN

**Ngày đánh giá**: 2025-01-26  
**Mục tiêu**: Đánh giá khả năng xử lý của server cho 20 máy AVI/AOI kết nối đồng thời qua mạng LAN

---

## 1. THÔNG SỐ HỆ THỐNG HIỆN TẠI

### 1.1. Upload Size Limits
- **JSON/Form data**: 50 MB (body parser)
- **Binary packages** (AOI upload): 200 MB
- **Voice transcription**: 16 MB
- **AI uploads**: Cấu hình được, mặc định 100 MB max

### 1.2. Rate Limiting
- **API endpoints**: 1,000 requests/15 phút mỗi IP
- **Auth endpoints**: 30 requests/15 phút mỗi IP

### 1.3. MQTT Configuration
- **QoS mặc định**: 1 (at least once delivery)
- **Broker port**: 1883 (MQTT), 9001 (WebSocket)
- **Message retention**: Có thể cấu hình
- **Kích thước MQTT message điển hình**:
  - NG Alert: **1-2 KB** (metadata + ngPoints array)
  - Heartbeat: **~200 bytes**
  - Machine Status: **~500 bytes**
  - Daily Summary: **2-5 KB**

### 1.4. Hardware Requirements
#### Minimum (Development/Testing)
- CPU: 4 cores
- RAM: 8 GB
- Storage: 100 GB SSD
- Network: **100 Mbps**

#### Recommended (Production)
- CPU: 8+ cores
- RAM: 16+ GB
- Storage: 500+ GB SSD
- Network: **1 Gbps**

---

## 2. PHÂN TÍCH BĂNG THÔNG CHO 20 MÁY

### 2.1. Tính toán Upload Ảnh 30 MB

#### Scenario 1: Upload tuần tự (Sequential)
- **Tổng data**: 20 máy × 30 MB = **600 MB**
- **Trên mạng 100 Mbps** (12.5 MB/s thực tế):
  - Thời gian lý thuyết: 600 MB ÷ 12.5 MB/s = **48 giây**
  - Thời gian thực tế (overhead): **~60 giây**
- **Trên mạng 1 Gbps** (125 MB/s thực tế):
  - Thời gian lý thuyết: 600 MB ÷ 125 MB/s = **4.8 giây**
  - Thời gian thực tế (overhead): **~7 giây**

#### Scenario 2: Upload đồng thời (Concurrent - 20 máy cùng lúc)
- **Trên mạng 100 Mbps**:
  - Bandwidth mỗi máy: 100 Mbps ÷ 20 = **5 Mbps** (0.625 MB/s)
  - Thời gian upload 30 MB: 30 MB ÷ 0.625 MB/s = **48 giây**
  - ⚠️ **CẢNH BÁO**: Tắc nghẽn nghiêm trọng khi 20 máy upload cùng lúc!

- **Trên mạng 1 Gbps**:
  - Bandwidth mỗi máy: 1000 Mbps ÷ 20 = **50 Mbps** (6.25 MB/s)
  - Thời gian upload 30 MB: 30 MB ÷ 6.25 MB/s = **4.8 giây**
  - ✅ **OK**: Mỗi máy vẫn có đủ băng thông

### 2.2. MQTT Message Traffic

#### Tần suất MQTT Messages (giả định)
- **NG Alerts**: 1-5 lần/phút mỗi máy (khi có lỗi)
- **Heartbeat**: 1 lần/10 giây
- **Machine Status**: 1 lần/30 giây

#### Băng thông MQTT cho 20 máy
- **NG Alerts** (worst case): 20 máy × 5 msg/min × 2 KB = **200 KB/phút** = **3.3 KB/s**
- **Heartbeat**: 20 máy × 6 msg/min × 200 bytes = **24 KB/phút** = **400 bytes/s**
- **Machine Status**: 20 máy × 2 msg/min × 500 bytes = **20 KB/phút** = **333 bytes/s**
- **Tổng MQTT**: **~4 KB/s** (0.032 Mbps)

✅ **KẾT LUẬN**: MQTT traffic rất nhỏ, không ảnh hưởng băng thông

### 2.3. API Data Traffic

#### Giả định API Requests
- **Dashboard refresh**: 1 req/5s × 5 clients = **12 req/phút**
- **Statistics queries**: ~50 req/phút
- **Data fetch**: ~100 req/phút
- **Tổng**: **~162 req/phút** = **2.7 req/s**

#### Băng thông API (giả định response size 10 KB average)
- **Băng thông**: 162 req/min × 10 KB = **1.62 MB/phút** = **27 KB/s** (0.216 Mbps)

✅ **KẾT LUẬN**: API traffic nhỏ, không ảnh hưởng băng thông

---

## 3. ĐÁNH GIÁ KHẢ NĂNG XỬ LÝ

### 3.1. Bottleneck Chính: **UPLOAD ẢNH 30 MB**

| Kịch bản | Mạng 100 Mbps | Mạng 1 Gbps | Đánh giá |
|----------|---------------|-------------|----------|
| **20 máy upload tuần tự** | ~60 giây | ~7 giây | 100 Mbps: Chậm nhưng chấp nhận được |
| **20 máy upload đồng thời** | 48-60 giây/máy | 5-7 giây/máy | **100 Mbps: TẮC NGHẼN** <br> 1 Gbps: OK |
| **10 máy upload đồng thời** | 24-30 giây/máy | 5-7 giây/máy | 100 Mbps: Chậm <br> 1 Gbps: OK |
| **5 máy upload đồng thời** | 12-15 giây/máy | 5-7 giây/máy | 100 Mbps: Chấp nhận được <br> 1 Gbps: Tốt |

### 3.2. Rate Limiting Analysis

#### Current Limit: 1,000 req/15 phút = 66.7 req/phút = 1.11 req/giây
- **20 máy**: Nếu mỗi máy gửi 3 API req/phút → Tổng **60 req/phút** ✅ **OK**
- **Margin**: Còn 940 requests cho dashboard, admin, monitoring

⚠️ **LƯU Ý**: Nếu mỗi máy tăng tần suất API lên **>3 req/phút** → CẦN TĂNG rate limit

### 3.3. Server Resource Capacity

#### CPU Load (ước tính)
- **Image processing** (20 máy × 30 MB): High CPU khi concurrent
- **MQTT broker**: Low CPU (~5% cho 20 clients)
- **API requests**: Medium CPU
- **Khuyến nghị**: **8+ cores** cho production

#### RAM Usage (ước tính)
- **Express.js**: ~500 MB base
- **MQTT buffers** (20 connections): ~200 MB
- **Redis cache**: ~500 MB
- **Database pool**: ~300 MB
- **Image processing buffers**: 20 × 30 MB = **600 MB** (concurrent upload)
- **Tổng**: **~2.1 GB** (runtime), peaks **~3-4 GB**
- **Khuyến nghị**: **16 GB RAM** để an toàn

#### Disk I/O
- **Write speed**: Cần **SSD** để xử lý 20 concurrent uploads
- **IOPS requirement**: ~1000 IOPS (SSD thường ≥10,000 IOPS) ✅ **OK**

---

## 4. KẾT LUẬN VÀ KHUYẾN NGHỊ

### 4.1. CÂU TRẢ LỜI: "Server có bị chậm hay đơ mạng không?"

#### ❌ **KHÔNG KHUYẾN NGHỊ** với 100 Mbps:
- Upload ảnh 30 MB từ 20 máy đồng thời sẽ **TẮC NGHẼN** nghiêm trọng
- Mỗi máy chỉ được **~5 Mbps** → Upload mất **48-60 giây**
- MQTT và API sẽ bị **delay** do upload chiếm dụng băng thông
- Hệ thống sẽ **cảm giác chậm, đơ**, đặc biệt khi nhiều máy upload cùng lúc

#### ✅ **KHUYẾN NGHỊ** với 1 Gbps:
- Upload ảnh 30 MB từ 20 máy đồng thời: **5-7 giây/máy**
- Mỗi máy có **~50 Mbps** → Đủ băng thông
- MQTT real-time alerts **không bị delay**
- API response **nhanh**, không tắc nghẽn
- Hệ thống **mượt mà**, đáp ứng tốt

### 4.2. Khuyến nghị Cấu hình

#### Mạng LAN (BẮT BUỘC)
1. **Switch 1 Gbps** cho tất cả 20 máy + server
2. **Cat6 cables** trở lên
3. **Isolated network** cho hệ thống AVI/AOI (tránh tranh chấp với mạng văn phòng)

#### Server Hardware
```
CPU:      8 cores (Intel Xeon hoặc AMD Ryzen Pro)
RAM:      16 GB DDR4
Storage:  500 GB NVMe SSD
Network:  1 Gbps Ethernet (onboard hoặc card rời)
```

#### Network Quality of Service (QoS)
```
Priority 1 (Highest):  MQTT traffic (port 1883)
Priority 2:            API requests (port 3000)
Priority 3:            Image uploads (HTTP POST)
```

**Lý do**: Đảm bảo MQTT alerts real-time không bị delay bởi bulk uploads

#### Rate Limiting Adjustments
```javascript
// Tăng rate limit nếu thấy 429 errors
API endpoints:  2,000 requests/15 phút  (hiện tại: 1,000)
Auth endpoints: 100 requests/15 phút    (hiện tại: 30)
```

### 4.3. Monitoring Checklist

Theo dõi các metric sau khi triển khai:

- [ ] **Network throughput**: Đảm bảo không vượt **80% capacity** (800 Mbps on 1 Gbps)
- [ ] **MQTT latency**: Phải **<100 ms** cho NG alerts
- [ ] **Upload time**: 30 MB upload phải **<10 giây**
- [ ] **API response time**: p95 **<500 ms**
- [ ] **CPU usage**: Average **<70%**, peak **<90%**
- [ ] **RAM usage**: **<12 GB** (trên server 16 GB)
- [ ] **Disk I/O**: Write speed **>100 MB/s**

---

## 5. RISK MITIGATION

### 5.1. Nếu chỉ có 100 Mbps (không thể nâng cấp)

#### Giải pháp tạm thời:
1. **Upload scheduling**: Chia 20 máy thành 4 batch, mỗi batch 5 máy upload cách nhau 15 giây
2. **Image compression**: Giảm kích thước ảnh từ 30 MB → 10-15 MB (lossy compression)
3. **Off-peak upload**: Upload ảnh vào thời gian ít traffic
4. **Local caching**: Cache ảnh trên máy, upload batch vào cuối ca

#### Code implementation (Upload scheduling):
```javascript
// Phân batch upload với delay
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 15000; // 15 seconds

async function uploadWithBatching(machines) {
  for (let i = 0; i < machines.length; i += BATCH_SIZE) {
    const batch = machines.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(m => uploadImage(m)));
    
    if (i + BATCH_SIZE < machines.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
}
```

### 5.2. High Availability Setup

#### Khuyến nghị cho môi trường production quan trọng:
- **Load balancer**: NGINX reverse proxy cho 2+ server nodes
- **Redis cluster**: Shared cache giữa các nodes
- **Database replication**: PostgreSQL primary + read replicas
- **MQTT clustering**: HiveMQ cluster hoặc Mosquitto bridge

---

## 6. TESTING PLAN

### 6.1. Load Testing Scenarios

#### Test 1: Sequential Upload (20 máy lần lượt)
```bash
# Mô phỏng 20 máy upload lần lượt
for i in {1..20}; do
  curl -X POST http://server/api/upload \
    -F "file=@sample-30mb.jpg" \
    -F "machineId=$i"
  sleep 1
done
```

#### Test 2: Concurrent Upload (5 máy cùng lúc)
```bash
# Mô phỏng 5 máy upload đồng thời
for i in {1..5}; do
  curl -X POST http://server/api/upload \
    -F "file=@sample-30mb.jpg" \
    -F "machineId=$i" &
done
wait
```

#### Test 3: Full Load (20 máy + MQTT + API)
```bash
# Script mô phỏng full load
./scripts/load-test.sh --machines 20 --mqtt-rate 5 --api-rate 100
```

### 6.2. Success Criteria

- ✅ Upload 30 MB: **<10 giây** mỗi file
- ✅ MQTT latency: **<100 ms** end-to-end
- ✅ API p95 response: **<500 ms**
- ✅ No packet loss
- ✅ No 429 (rate limit) errors
- ✅ CPU usage: **<80%**
- ✅ RAM usage: **<12 GB**

---

## 7. COST ESTIMATION

### 7.1. Network Upgrade (100 Mbps → 1 Gbps)

| Item | Quantity | Unit Price | Total |
|------|----------|------------|-------|
| Switch 1 Gbps (24 ports) | 1 | $150 | $150 |
| Cat6 cables (3m) | 25 | $3 | $75 |
| Server 1 Gbps NIC | 1 | $50 | $50 |
| **TOTAL** | | | **~$275** |

### 7.2. Server Upgrade (nếu cần)

| Component | Spec | Price |
|-----------|------|-------|
| CPU upgrade | 8 cores | $300 |
| RAM upgrade | 16 GB → 32 GB | $100 |
| SSD upgrade | 500 GB NVMe | $80 |
| **TOTAL** | | **~$480** |

---

## 8. TIMELINE

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Phase 1: Preparation** | 1 week | - Mua thiết bị mạng<br>- Backup hệ thống<br>- Setup test environment |
| **Phase 2: Network Setup** | 2 days | - Lắp switch 1 Gbps<br>- Đấu dây Cat6<br>- Config QoS |
| **Phase 3: Testing** | 3 days | - Load testing<br>- MQTT latency test<br>- Tuning parameters |
| **Phase 4: Deployment** | 1 day | - Chuyển production sang mạng mới<br>- Monitor 24h |
| **TOTAL** | **~10 days** | |

---

## TÓM TẮT

### ✅ Với mạng 1 Gbps:
- **KHÔNG** bị chậm hay đơ mạng
- 20 máy upload 30 MB đồng thời: **5-7 giây/máy**
- MQTT alerts real-time không delay
- API response nhanh
- **KHUYẾN NGHỊ MẠNH**: Nâng cấp lên 1 Gbps

### ❌ Với mạng 100 Mbps:
- **CÓ** bị tắc nghẽn khi upload đồng thời
- 20 máy upload 30 MB đồng thời: **48-60 giây/máy**
- MQTT có thể bị delay khi upload
- Hệ thống cảm giác chậm, đơ
- **KHÔNG KHUYẾN NGHỊ** cho production

---

**Người đánh giá**: GitHub Copilot  
**Ngày**: 2025-01-26  
**Trạng thái**: ✅ Hoàn thành
