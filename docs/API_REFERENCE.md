# API Reference - Hệ Thống MES AVI/AOI

**Phiên bản:** 1.0.0  
**Base URL:** `/api/trpc`  
**Authentication:** JWT Cookie-based

---

## Tổng Quan

Hệ thống sử dụng tRPC cho API communication. Tất cả các endpoints đều được gọi qua `/api/trpc/{router}.{procedure}`.

---

## 1. Authentication (auth)

### 1.1 auth.me
Lấy thông tin user hiện tại.

**Type:** Query  
**Auth:** Public  
**Response:**
```typescript
{
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  twoFactorEnabled: boolean;
}
```

### 1.2 auth.logout
Đăng xuất khỏi hệ thống.

**Type:** Mutation  
**Auth:** Protected  
**Response:** `{ success: true }`

### 1.3 auth.localLogin
Đăng nhập bằng username/password.

**Type:** Mutation  
**Auth:** Public  
**Input:**
```typescript
{
  username: string;
  password: string;
  totpCode?: string; // Required if 2FA enabled
}
```

### 1.4 auth.setupAdmin
Tạo admin user đầu tiên (chỉ khi chưa có admin).

**Type:** Mutation  
**Auth:** Public  
**Input:**
```typescript
{
  username: string;
  email: string;
  name: string;
  password: string;
}
```

---

## 2. Factory Management (factory)

### 2.1 factory.list
Lấy danh sách tất cả nhà máy.

**Type:** Query  
**Auth:** Protected  
**Response:** `Factory[]`

### 2.2 factory.getById
Lấy thông tin chi tiết nhà máy.

**Type:** Query  
**Auth:** Protected  
**Input:** `{ id: number }`

### 2.3 factory.create
Tạo nhà máy mới.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  code: string;
  name: string;
  description?: string;
  address?: string;
}
```

### 2.4 factory.update
Cập nhật thông tin nhà máy.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  id: number;
  code?: string;
  name?: string;
  description?: string;
  address?: string;
  isActive?: boolean;
  mapPositionX?: number;
  mapPositionY?: number;
}
```

### 2.5 factory.delete
Xóa nhà máy.

**Type:** Mutation  
**Auth:** Admin  
**Input:** `{ id: number }`

---

## 3. Machine Management (machine)

### 3.1 machine.list
Lấy danh sách tất cả máy.

**Type:** Query  
**Auth:** Protected  
**Response:** `Machine[]`

### 3.2 machine.getById
Lấy thông tin chi tiết máy.

**Type:** Query  
**Auth:** Protected  
**Input:** `{ id: number }`

### 3.3 machine.getStats
Lấy thống kê của máy.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  id: number;
  startDate?: Date;
  endDate?: Date;
}
```

### 3.4 machine.create
Tạo máy mới.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  stationId: number;
  code: string;
  name: string;
  machineType: "AVI" | "AOI" | "AUTOMATION";
  model?: string;
  manufacturer?: string;
  description?: string;
}
```
**Response:** `{ id: number; apiKey: string }`

### 3.5 machine.regenerateApiKey
Tạo lại API key cho máy.

**Type:** Mutation  
**Auth:** Admin  
**Input:** `{ id: number }`  
**Response:** `{ apiKey: string }`

---

## 4. Inspection (inspection)

### 4.1 inspection.list
Lấy danh sách inspection records.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  machineId?: number;
  productModelId?: number;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  serialNumber?: string;
  limit?: number;
  offset?: number;
}
```

### 4.2 inspection.getById
Lấy chi tiết inspection.

**Type:** Query  
**Auth:** Protected  
**Input:** `{ id: number }`

### 4.3 inspection.updateNTF
Cập nhật trạng thái NTF (false positive).

**Type:** Mutation  
**Auth:** Protected  
**Input:**
```typescript
{
  id: number;
  isNTF: boolean;
  ntfReason?: string;
}
```

### 4.4 inspection.bulkAcknowledge
Xác nhận hàng loạt inspections.

**Type:** Mutation  
**Auth:** Protected  
**Input:** `{ ids: number[] }`

---

## 5. Dashboard (dashboard)

### 5.1 dashboard.stats
Lấy thống kê tổng quan.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
}
```
**Response:**
```typescript
{
  totalOutput: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  fpy: number;
  yieldRate: number;
}
```

### 5.2 dashboard.yieldTrend
Lấy xu hướng yield theo thời gian.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  factoryId?: number;
  period: "hour" | "day" | "week" | "month";
  startDate?: Date;
  endDate?: Date;
}
```

### 5.3 dashboard.machineStatus
Lấy trạng thái tất cả máy.

**Type:** Query  
**Auth:** Protected  
**Response:**
```typescript
{
  online: number;
  offline: number;
  error: number;
  machines: MachineStatus[];
}
```

---

## 6. MQTT Client (mqttClient)

### 6.1 mqttClient.status
Lấy trạng thái MQTT broker.

**Type:** Query  
**Auth:** Protected  
**Response:**
```typescript
{
  connected: boolean;
  brokerUrl: string;
  clientsOnline: number;
  messagesPerMinute: number;
}
```

### 6.2 mqttClient.list
Lấy danh sách MQTT clients.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  connectionStatus?: "ONLINE" | "OFFLINE" | "DISCONNECTED";
}
```

### 6.3 mqttClient.approve
Phê duyệt MQTT client.

**Type:** Mutation  
**Auth:** Admin  
**Input:** `{ id: number }`

### 6.4 mqttClient.reject
Từ chối MQTT client.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  id: number;
  reason?: string;
}
```

---

## 7. OEE (oee)

### 7.1 oee.calculate
Tính toán OEE cho máy/dây chuyền.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  machineId?: number;
  lineId?: number;
  startDate: Date;
  endDate: Date;
}
```
**Response:**
```typescript
{
  availability: number; // 0-100
  performance: number;  // 0-100
  quality: number;      // 0-100
  oee: number;          // 0-100
  details: {
    plannedTime: number;
    runTime: number;
    idealCycleTime: number;
    actualCycleTime: number;
    totalCount: number;
    goodCount: number;
  }
}
```

### 7.2 oee.targets
Lấy OEE targets.

**Type:** Query  
**Auth:** Protected  
**Response:**
```typescript
{
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}
```

### 7.3 oee.setTargets
Cập nhật OEE targets.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}
```

---

## 8. Alerts (alert)

### 8.1 alert.list
Lấy danh sách cảnh báo.

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  type?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  acknowledged?: boolean;
  startDate?: Date;
  endDate?: Date;
}
```

### 8.2 alert.acknowledge
Xác nhận cảnh báo.

**Type:** Mutation  
**Auth:** Protected  
**Input:** `{ id: number }`

### 8.3 alert.resolve
Đánh dấu cảnh báo đã giải quyết.

**Type:** Mutation  
**Auth:** Protected  
**Input:**
```typescript
{
  id: number;
  resolutionNote?: string;
}
```

---

## 9. Reports (scheduledReport)

### 9.1 scheduledReport.list
Lấy danh sách báo cáo đã lên lịch.

**Type:** Query  
**Auth:** Protected

### 9.2 scheduledReport.create
Tạo báo cáo tự động.

**Type:** Mutation  
**Auth:** Admin  
**Input:**
```typescript
{
  name: string;
  reportType: string;
  schedule: "DAILY" | "WEEKLY" | "MONTHLY";
  scheduleTime: string; // HH:mm
  recipients: string[];
  filters?: object;
}
```

### 9.3 scheduledReport.trigger
Chạy báo cáo ngay lập tức.

**Type:** Mutation  
**Auth:** Admin  
**Input:** `{ id: number }`

---

## 10. Machine API (machineApi)

API cho máy AVI/AOI gửi dữ liệu inspection.

### 10.1 machineApi.submitInspection
Gửi kết quả inspection từ máy.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:**
```typescript
{
  apiKey: string;
  serialNumber: string;
  productModelCode: string;
  result: "OK" | "NG";
  inspectionTime: Date;
  cycleTime?: number;
  measurements?: Array<{
    pointCode: string;
    value: number;
    result: "OK" | "NG";
    imageUrl?: string;
  }>;
  images?: Array<{
    url: string;
    type: "MAIN" | "DETAIL" | "DEFECT";
  }>;
}
```

### 10.2 machineApi.heartbeat
Gửi heartbeat từ máy.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:**
```typescript
{
  apiKey: string;
  status: "running" | "stopped" | "error" | "maintenance";
  cpuUsage?: number;
  memoryUsage?: number;
  temperature?: number;
}
```

---

## Error Codes

| Code | Mô tả |
|------|-------|
| UNAUTHORIZED | Chưa đăng nhập |
| FORBIDDEN | Không có quyền truy cập |
| NOT_FOUND | Không tìm thấy resource |
| BAD_REQUEST | Request không hợp lệ |
| CONFLICT | Dữ liệu bị trùng lặp |
| INTERNAL_SERVER_ERROR | Lỗi server |

---

## Rate Limiting

| Endpoint Type | Limit |
|---------------|-------|
| Query | 100 requests/minute |
| Mutation | 30 requests/minute |
| Machine API | 1000 requests/minute |

---

*Tài liệu này được tạo tự động. Phiên bản: 1.0.0*
