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

API cho máy AVI/AOI gửi dữ liệu inspection và đồng bộ điểm đo.

### 10.1 machineApi.submitInspection
Gửi kết quả inspection sau mỗi chu kỳ. **API này đã được đồng bộ hóa với AOI Package API** (xem [UNIFIED_API_STRUCTURE.md](./UNIFIED_API_STRUCTURE.md)).

**⚠️ Important Fix (Feb 2026):** 
- Trước đây: Measurement với pointId/pointCode không tồn tại trong hệ thống sẽ bị **bỏ qua hoàn toàn**
- **Bây giờ:** Measurement vẫn được **lưu với pointDefId = 0** ngay cả khi point definition chưa tồn tại
- **Lợi ích:** Không mất dữ liệu, có thể map point definition sau, log warning để admin biết

**Type:** Mutation  
**Auth:** Machine API Key hoặc `machineCode`

**Input:**
```typescript
{
  // Authentication
  apiKey?: string;
  machineCode?: string;
  
  // Product identification (REQUIRED)
  serialNumber: string;          // Số serial sản phẩm (BẮT BUỘC)
  productModel?: string;          // Model sản phẩm
  batchNumber?: string;           // Số lô sản xuất
  
  // Inspection timing
  inspectionTime?: string;        // ISO 8601 datetime
  cycleTime?: number;             // Thời gian chu kỳ (giây)
  
  // Enterprise hierarchy (NEW - đồng bộ với AOI Package)
  companyCode?: string;           // Mã tập đoàn/công ty
  factoryCode?: string;           // Mã nhà máy
  workshopCode?: string;          // Mã nhà xưởng
  lineCode?: string;              // Mã dây chuyền
  stageCode?: string;             // Mã công đoạn
  
  // Production context (NEW - đồng bộ với AOI Package)
  productionOrderCode?: string;   // Mã lệnh sản xuất
  operatorId?: string;            // Mã công nhân vận hành
  
  // Overall result (optional - auto-calculated from measurements)
  overallResult?: "OK" | "NG" | "NTF";
  
  // Measurements - UNIFIED structure (đồng bộ với AOI Package)
  measurements: Array<{
    pointId?: string;             // ID điểm đo (khuyến nghị)
    pointCode?: string;           // Mã điểm đo (fallback)
    measuredValue?: number | string;  // Giá trị đo
    result: "OK" | "NG" | "NTF";  // Kết quả điểm đo
    remark?: string;              // Ghi chú
    imageBase64?: string;         // Ảnh base64 inline (data URL hoặc raw)
  }>;
}
```

**Response:** `{ success: true; inspectionId: number; }`

**Example Request:**
```json
{
  "machineCode": "AOI-LINE1-01",
  "apiKey": "your-api-key",
  
  "serialNumber": "SN-20240115-001",
  "productModel": "PCB-V2-Standard",
  "batchNumber": "BATCH-2024-001",
  
  "inspectionTime": "2024-01-15T10:30:00Z",
  "cycleTime": 150.5,
  
  "companyCode": "COMPANY-A",
  "factoryCode": "FACTORY-HN",
  "workshopCode": "WORKSHOP-SMT",
  "lineCode": "LINE-3",
  "stageCode": "STAGE-AOI",
  
  "productionOrderCode": "PO-2024-0115-001",
  "operatorId": "OP-0023",
  
  "measurements": [
    {
      "pointId": "POINT-001",
      "pointCode": "R1-IC1-PIN1",
      "measuredValue": 1023.5,
      "result": "OK",
      "remark": "In spec",
      "imageBase64": "data:image/jpeg;base64,/9j/4AAQ..."
    },
    {
      "pointId": "POINT-002",
      "pointCode": "R2-IC2-PIN5",
      "measuredValue": 0,
      "result": "NG",
      "remark": "Short circuit - Replace IC2",
      "imageBase64": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
}
```

### 10.2 machineApi.uploadImage
Đính kèm lại ảnh cho một measurement sau khi đã gửi inspection.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:**
```typescript
{
  apiKey: string;
  inspectionId: number;
  pointCode: string;
  imageBase64: string; // base64 hoặc data URL
  mimeType?: string;   // mặc định image/jpeg
}
```

**Response:** `{ success: true; imageUrl: string; }

### 10.3 machineApi.syncMeasurementPoints
Đồng bộ định nghĩa điểm đo (tọa độ, ngưỡng, ảnh mẫu) từ máy lên server.

**Type:** Mutation  
**Auth:** Machine API Key hoặc `machineCode`

**Input:**
```typescript
{
  apiKey?: string;
  machineCode?: string;
  productModelCode: string;
  points: Array<{
    code: string;
    name: string;
    description?: string;
    measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
    unit?: string;
    lowerLimit?: number | string;
    upperLimit?: number | string;
    nominalValue?: number | string;
    positionX: number;
    positionY: number;
    radius?: number;
    cropWidth?: number;
    cropHeight?: number;
    orderIndex?: number;
    workstationCode?: string;
    isActive?: boolean;
    imageBase64?: string;
    imageMimeType?: string;
    imageUrl?: string;
  }>;
}
```

**Response:**
```typescript
{
  success: boolean;
  productModelId: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ code: string; message: string }>;
}
```

### 10.4 machineApi.heartbeat
Đánh dấu máy đang hoạt động.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:** `{ apiKey: string; }`

**Response:** `{ success: true; machineId: number; }`

---

## 11. AOI Package Upload (aoiPackage)

Hệ thống hỗ trợ upload ZIP package từ AOI machines với cấu trúc đồng bộ với submitInspection API. Xem chi tiết: [UNIFIED_API_STRUCTURE.md](./UNIFIED_API_STRUCTURE.md)

### 11.1 aoiPackage.presign
Tạo URL upload cho inspection package mới.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:**
```typescript
{
  apiKey: string;
  machineCode?: string;
  inspectionId?: string;  // ID từ máy AOI
  metadata?: {
    serialNumber?: string;
    productModel?: string;
    expectedImages?: number;
  };
}
```

**Response:**
```typescript
{
  success: true;
  packageId: string;
  uploadUrl: string;  // URL để upload ZIP file
}
```

### 11.2 Upload ZIP File (HTTP POST)
Upload file ZIP đến URL từ presign.

> ⚠ **Hướng sắp tới (đã quyết định, CHƯA triển khai — BG-85):** `meta.json` sẽ được
> hợp nhất thành CÙNG hình dạng với payload kết quả v2.0 (`machineDataContractV2` +
> thêm mảng `images[]`, khoá nối `captureId`) — xem `docs/UNIFIED_API_STRUCTURE.md`
> và `docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md`. Cấu trúc
> `measurements[]`/`points[]` dưới đây vẫn là hợp đồng ĐANG CHẠY hôm nay; bên tích
> hợp máy nên đọc spec trên trước khi đầu tư nhiều vào engine sinh `meta.json`.

**Method:** POST  
**URL:** `{uploadUrl}` từ presign response  
**Content-Type:** `multipart/form-data`  
**Body:** ZIP file

**ZIP Structure:**
```
package.zip
├── meta.json          // Required - inspection metadata
└── images/           // Required - folder chứa ảnh
    ├── image_001.jpg
    ├── image_002.jpg
    └── image_003.jpg
```

**meta.json Structure (BG-85, 2026-09-02 — MỘT hợp đồng, hai đường vận chuyển):**

`meta.json` KHÔNG còn là một hợp đồng riêng — nó là **chính** payload kết quả v2.0
(`machineDataContractV2`: cây `surfaces[].positions[].captures[].components[]`) mà
`submitInspection` (đường trực tiếp) nhận, cộng thêm **đúng một** trường `images[]`
(tham chiếu ảnh — `captureId` là khoá join sang `captures[]` trong CHÍNH cây đó).

```json
{
  "identity": {
    "station": "AIC-LINE1-01", "machine": "AOI-LINE1-01", "line": "LINE-3",
    "plant": "FACTORY-HN", "country": "VN", "solutionName": "PCB-V2-SOLUTION", "appVersion": "1.0.0"
  },
  "productId": "b3f1c2a0-1111-4a2b-9c3d-000000000001",
  "serialNumber": "SN-20240115-001",
  "productModel": "PCB-V2-Standard",
  "overallResult": "NG",
  "ntf": false,
  "startedAt": "2024-01-15T10:30:00.000",
  "completedAt": "2024-01-15T10:32:30.400",

  "summary": {
    "surfaces":   { "total": 1, "pass": 0, "ng": 1, "ntf": 0 },
    "positions":  { "total": 1, "pass": 0, "ng": 1, "ntf": 0 },
    "captures":   { "total": 2, "pass": 1, "ng": 1, "ntf": 0 },
    "components": { "total": 2, "pass": 1, "ng": 1, "ntf": 0 }
  },

  "surfaces": [
    {
      "name": "TOP", "result": "NG", "ntf": false,
      "positions": [
        {
          "positionId": "P01", "result": "NG", "ntf": false,
          "captures": [
            {
              "captureId": "cap-R1-IC1-PIN1", "captureName": "IC1 Pin 1 Resistance", "result": "OK", "ntf": false,
              "components": [{ "componentId": "comp-R1-IC1-PIN1", "result": "OK", "ntf": false, "value": "1023.5" }]
            },
            {
              "captureId": "cap-R2-IC2-PIN5", "captureName": "IC2 Pin 5 Resistance", "result": "NG", "ntf": false,
              "components": [{ "componentId": "comp-R2-IC2-PIN5", "result": "NG", "ntf": false, "value": "0", "errorDesc": "Short circuit - Replace IC2" }]
            }
          ]
        }
      ]
    }
  ],

  "images": [
    { "captureId": "cap-R1-IC1-PIN1", "fileName": "image_001.jpg" },
    { "captureId": "cap-R2-IC2-PIN5", "fileName": "image_002.jpg" }
  ]
}
```

⚠️ **Hợp đồng PHẲNG cũ (`measurements[]`/`points[]`, không có `surfaces`) KHÔNG còn
được server chấp nhận.** `identity`/`productId`/`ntf`/`summary`/`surfaces` đều **bắt
buộc** — thiếu bất kỳ trường nào ở trên bị từ chối (`invalid_type`). Gói **không** bị
khoá vĩnh viễn (`'dead'`) vì lệch hình dạng — nó ở lại `'failed'` chờ retry, nhưng sẽ
**không bao giờ tự commit được** cho tới khi Agent gửi đúng hình dạng CÂY ở trên. Mọi
`images[].captureId` **phải khớp đúng** một `captureId` có thật trong `surfaces[]` —
không khớp thì **cả gói** bị từ chối, không âm thầm bỏ ảnh; mọi `images[].fileName`
phải có tệp thật trong thư mục `images/` của ZIP.

### 11.3 aoiPackage.commit
Xác nhận package đã upload hoàn tất và parse dữ liệu.

**Type:** Mutation  
**Auth:** Machine API Key  
**Input:**
```typescript
{
  apiKey: string;
  packageId: string;
}
```

**Response:**
```typescript
{
  success: true;
  packageId: string;
  inspectionId: number;  // ID của productInspection được tạo
  status: "committed";
  stats: {
    totalPoints: number;
    okCount: number;
    ngCount: number;
    imageCount: number;
  };
  imageUrls: string[];  // URLs của ảnh đã upload
}
```

### 11.4 aoiPackage.getImage
Lấy ảnh từ package (internal use).

**Type:** Query  
**Auth:** Protected  
**Input:**
```typescript
{
  packageId: string;
  fileName: string;
}
```

**Response:** Binary image data

**URL Format:** `/api/aoi/image/{packageId}/{fileName}`

### 11.5 Field Mapping - So sánh submitInspection vs AOI Package

| Field | submitInspection | AOI meta.json | Notes |
|-------|------------------|---------------|-------|
| **Point ID** | `measurements[].pointId` | `measurements[].pointId` | Unified ✅ |
| **Point Code** | `measurements[].pointCode` | `measurements[].pointCode` | Unified ✅ |
| **Value** | `measurements[].measuredValue` | `measurements[].measuredValue` | Unified ✅ |
| **Result** | `measurements[].result` | `measurements[].result` | Unified ✅ |
| **Remark** | `measurements[].remark` | `measurements[].remark` | Unified ✅ |
| **Image** | `measurements[].imageBase64` | `measurements[].fileName` | Different method |
| **Factory** | `factoryCode` | `factoryCode` | Unified ✅ |
| **Line** | `lineCode` | `lineCode` | Unified ✅ |
| **Workshop** | `workshopCode` | `workshopCode` | Unified ✅ |
| **Stage** | `stageCode` | `stageCode` | Unified ✅ |
| **Batch** | `batchNumber` | `batchNumber` | Unified ✅ |
| **Prod. Order** | `productionOrderCode` | `productionOrderCode` | Unified ✅ |
| **Operator** | `operatorId` | `operatorId` | Unified ✅ |

**Benefits of Unified Structure:**
- ✅ Same field names → Easy client code
- ✅ Consistent history queries
- ✅ Full traceability (company → factory → workshop → line → stage)
- ✅ Backward compatible với legacy structure

---

## 12. External Machine Registration API

API cho phép AVI/AOI Client tự động đăng ký máy vào hệ thống mà không cần tạo thủ công trên web dashboard.

**Base URL:** `/api/external`  
**Authentication:** Master API Key (Header: `X-Master-Key`)

### 12.1 Authentication

Tất cả requests đến External API đều yêu cầu header `X-Master-Key`:

```http
X-Master-Key: <your-master-api-key>
```

Master API Key được cấu hình trong `.env`:
```env
MASTER_API_KEY=your_secure_master_key_here
```

**Error Response (401):**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing Master API Key"
}
```

### 12.2 POST /api/external/machines/register

Đăng ký máy mới hoặc lấy thông tin máy đã tồn tại. Phương thức này là **idempotent** - gọi nhiều lần với cùng `code` sẽ trả về cùng kết quả.

**Request:**
```http
POST /api/external/machines/register
Content-Type: application/json
X-Master-Key: your_master_key

{
  "code": "FAC-HN-AOI-01",
  "name": "AOI Machine Line 01",     // Optional, default = code
  "machineType": "AOI"               // Optional: AOI, SPI, AVI (default: AOI)
}
```

**Input Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | ✅ Yes | Unique machine code |
| `name` | string | ❌ No | Display name (default: same as code) |
| `machineType` | string | ❌ No | Machine type: `AOI`, `SPI`, `AVI` (default: `AOI`) |

**Response (Success):**
```json
{
  "success": true,
  "created": true,
  "machine": {
    "id": 45,
    "code": "FAC-HN-AOI-01",
    "name": "AOI Machine Line 01",
    "machineType": "AOI",
    "apiKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "stationId": 1
  }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `success` | Always `true` on success |
| `created` | `true` = new machine created, `false` = existing machine returned |
| `machine.apiKey` | API key for machine authentication (use in `/api/machines/*` endpoints) |
| `machine.stationId` | Station ID assigned to machine |

**Usage in Client:**
```csharp
// C# Example
var registerRequest = new {
    code = "FAC-HN-AOI-01",
    name = "AOI Machine 01",
    machineType = "AOI"
};

var response = await httpClient.PostAsJsonAsync(
    "/api/external/machines/register", 
    registerRequest
);

var result = await response.Content.ReadFromJsonAsync<RegisterResponse>();

// Store apiKey for subsequent API calls
string machineApiKey = result.machine.apiKey;
```

### 12.3 GET /api/external/machines/by-code/:code

Lấy thông tin máy theo mã code.

**Request:**
```http
GET /api/external/machines/by-code/FAC-HN-AOI-01
X-Master-Key: your_master_key
```

**Response (Success):**
```json
{
  "success": true,
  "machine": {
    "id": 45,
    "code": "FAC-HN-AOI-01",
    "name": "AOI Machine Line 01",
    "machineType": "AOI",
    "apiKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "stationId": 1
  }
}
```

**Response (Not Found - 404):**
```json
{
  "success": false,
  "error": "Machine not found"
}
```

### 12.4 GET /api/external/machines

Lấy danh sách tất cả máy trong hệ thống.

**Request:**
```http
GET /api/external/machines
X-Master-Key: your_master_key
```

**Response:**
```json
{
  "success": true,
  "machines": [
    {
      "id": 45,
      "code": "FAC-HN-AOI-01",
      "name": "AOI Machine Line 01",
      "machineType": "AOI",
      "apiKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "stationId": 1
    },
    {
      "id": 46,
      "code": "FAC-HN-SPI-02",
      "name": "SPI Machine Line 02",
      "machineType": "SPI",
      "apiKey": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "stationId": 1
    }
  ]
}
```

### 12.5 Complete Integration Flow

**Workflow cho AVI/AOI Client kết nối lần đầu:**

```
┌─────────────────────────────────────────────────────────┐
│                    AVI/AOI Client                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  POST /api/external/machines/register │
         │  X-Master-Key: master_key            │
         │  { code: "MACHINE-001" }             │
         └─────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  Response: { machine: { apiKey } }   │
         │  → Store apiKey locally              │
         └─────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  Subsequent calls use Machine API:   │
         │  POST /api/machines/submit-inspection│
         │  X-API-Key: <machine_api_key>        │
         └─────────────────────────────────────┘
```

**C# Complete Example:**
```csharp
public class MachineAutoRegistration
{
    private readonly HttpClient _httpClient;
    private readonly string _masterApiKey;
    private readonly string _serverUrl;
    
    public MachineAutoRegistration(string serverUrl, string masterApiKey)
    {
        _serverUrl = serverUrl;
        _masterApiKey = masterApiKey;
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("X-Master-Key", masterApiKey);
    }
    
    public async Task<string> RegisterAndGetApiKey(string machineCode)
    {
        // Try to get existing machine first
        var getResponse = await _httpClient.GetAsync(
            $"{_serverUrl}/api/external/machines/by-code/{machineCode}");
        
        if (getResponse.IsSuccessStatusCode)
        {
            var existing = await getResponse.Content
                .ReadFromJsonAsync<MachineResponse>();
            return existing.machine.apiKey;
        }
        
        // Register new machine
        var registerResponse = await _httpClient.PostAsJsonAsync(
            $"{_serverUrl}/api/external/machines/register",
            new { code = machineCode, machineType = "AOI" }
        );
        
        var result = await registerResponse.Content
            .ReadFromJsonAsync<RegisterResponse>();
        
        return result.machine.apiKey;
    }
}
```

---

## 14. Code Examples

Hệ thống cung cấp code examples đầy đủ cho nhiều ngôn ngữ lập trình:

### 📘 C# (.NET)
**File:** [examples/CSharp_API_Examples.md](./examples/CSharp_API_Examples.md)

**Includes:**
- ✅ Submit Inspection with tRPC
- ✅ AOI Package Upload (Presign → Upload → Commit)
- ✅ Image conversion to Base64
- ✅ Machine Heartbeat service
- ✅ Sync Measurement Points
- ✅ Rate limiting & error handling
- ✅ Complete working examples

**Quick Start:**
```csharp
var config = new ApiConfig {
    BaseUrl = "https://your-server.com",
    MachineCode = "AOI-LINE1-01",
    ApiKey = "your-api-key"
};

using var client = new ApiClient(config);
var service = new InspectionService(client, config);

var inspection = new InspectionData {
    SerialNumber = "SN-20260210-001",
    ProductModel = "PCB-V2-Standard",
    OverallResult = "OK",
    Measurements = new List<MeasurementData> { ... }
};

await service.SubmitInspectionAsync(inspection);
```

### 📗 Python
**Coming soon:** `examples/Python_API_Examples.md`

### 📙 JavaScript/TypeScript
**Coming soon:** `examples/JavaScript_API_Examples.md`

### 📕 Java
**Coming soon:** `examples/Java_API_Examples.md`

---

## 15. Error Codes

| Code | Mô tả |
|------|-------|
| UNAUTHORIZED | Chưa đăng nhập |
| FORBIDDEN | Không có quyền truy cập |
| NOT_FOUND | Không tìm thấy resource |
| BAD_REQUEST | Request không hợp lệ |
| CONFLICT | Dữ liệu bị trùng lặp |
| INTERNAL_SERVER_ERROR | Lỗi server |

---

## 16. Rate Limiting

| Endpoint Type | Limit |
|---------------|-------|
| Query | 100 requests/minute |
| Mutation | 30 requests/minute |
| Machine API | 100 requests/minute |

---

## 17. Troubleshooting

### Problem: Measurement không được lưu

**Triệu chứng:** 
- Client gửi measurements với pointId/pointCode
- Response thành công nhưng không thấy measurement trong DB

**Nguyên nhân (trước Feb 2026):**
- PointId/pointCode chưa được định nghĩa trong hệ thống
- Measurement bị skip (không lưu)

**Giải pháp (sau Feb 2026):**
- ✅ **Fixed:** Measurement vẫn được lưu với pointDefId = 0
- System log warning: `[submitInspection] Point definition not found for: {pointCode}`
- Admin có thể map point definition sau bằng cách:
  1. Tạo point definition với cùng pointCode
  2. Update measurementResults để link với pointDefId mới

**Cách kiểm tra:**
```sql
-- Xem measurements không có point definition
SELECT * FROM measurement_results
WHERE point_def_id = 0
ORDER BY created_at DESC;

-- Xem point codes trong remark
SELECT remark FROM measurement_results
WHERE point_def_id = 0 AND remark LIKE 'Point:%';
```

### Problem: Rate limit exceeded

**Triệu chứng:**
- HTTP 429 Too Many Requests

**Giải pháp:**
- Machine API: Max 100 requests/minute
- Sử dụng heartbeat interval 30-60 seconds
- Batch measurements trong một request thay vì gửi riêng lẻ
- Implement exponential backoff

### Problem: Image too large

**Triệu chứng:**
- Request timeout hoặc 413 Payload Too Large

**Giải pháp:**
- Resize image trước khi encode base64 (khuyến nghị: 800x600 hoặc nhỏ hơn)
- Compress JPEG quality: 70-85%
- Hoặc dùng AOI Package upload (ZIP) thay vì inline base64

---

## 13. Measurement Point Statistics API (External)

API thống kê kết quả đo lường theo từng điểm đo của sản phẩm trong khoảng thời gian tùy chỉnh, bao gồm ảnh OK/NG. Dành cho bên thứ 3 tích hợp (MES, ERP, BI tools, v.v.)

**Endpoint:** `GET /api/external/statistics/measurement-points`  
**Authentication:** Master API Key (Header `X-Master-Key`) hoặc Bearer Token (Header `Authorization: Bearer <token>`)

### 13.1 Authentication

Hỗ trợ 2 phương thức xác thực:

**Phương thức 1: Master API Key** (cho server-to-server)
```http
GET /api/external/statistics/measurement-points?productModelId=1&startDate=2025-01-01&endDate=2025-12-31
X-Master-Key: your_secure_master_key_here
```

**Phương thức 2: Bearer Token** (cho ứng dụng client)
```http
GET /api/external/statistics/measurement-points?productCode=SP-001&startDate=2025-01-01&endDate=2025-12-31
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Để lấy Bearer Token, gọi API login:
```http
POST /api/external/auth/login
Content-Type: application/json

{
  "username": "your_username",
  "password": "your_password"
}
```
Token có hiệu lực 30 ngày.

### 13.2 Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `productModelId` | number | Có* | ID sản phẩm cần thống kê |
| `productCode` | string | Có* | Mã sản phẩm (thay thế cho productModelId) |
| `startDate` | string | Có | Ngày bắt đầu (ISO 8601: `YYYY-MM-DD` hoặc `YYYY-MM-DDTHH:mm:ssZ`) |
| `endDate` | string | Có | Ngày kết thúc (ISO 8601) |
| `includeImages` | string | Không | Đặt `true` hoặc `1` để bao gồm ảnh OK/NG cho từng điểm đo |

> \* Bắt buộc một trong hai: `productModelId` hoặc `productCode`

### 13.3 Response (Không có ảnh — mặc định)

**Success (200):**
```json
{
  "success": true,
  "data": {
    "productModel": {
      "id": 1,
      "code": "SP-001",
      "name": "Sản phẩm mẫu A"
    },
    "dateRange": {
      "startDate": "2025-01-01T00:00:00.000Z",
      "endDate": "2025-12-31T00:00:00.000Z"
    },
    "totalPoints": 5,
    "points": [
      {
        "pointDefId": 10,
        "pointCode": "D1",
        "pointName": "Đường kính trục chính",
        "measurementType": "DIAMETER",
        "unit": "mm",
        "lowerLimit": 9.95,
        "upperLimit": 10.05,
        "nominalValue": 10.0,
        "totalCount": 1500,
        "okCount": 1480,
        "ngCount": 20,
        "ngRate": 1.33,
        "minValue": 9.92,
        "maxValue": 10.08,
        "avgValue": 10.001
      }
    ]
  }
}
```

### 13.4 Response (Có ảnh — `includeImages=true`)

Khi truyền `includeImages=true`, mỗi điểm đo sẽ có thêm field `images` chứa danh sách ảnh OK và NG:

```json
{
  "success": true,
  "data": {
    "productModel": {
      "id": 1,
      "code": "SP-001",
      "name": "Sản phẩm mẫu A"
    },
    "dateRange": {
      "startDate": "2025-01-01T00:00:00.000Z",
      "endDate": "2025-03-31T00:00:00.000Z"
    },
    "totalPoints": 2,
    "points": [
      {
        "pointDefId": 10,
        "pointCode": "D1",
        "pointName": "Đường kính trục chính",
        "measurementType": "DIAMETER",
        "unit": "mm",
        "lowerLimit": 9.95,
        "upperLimit": 10.05,
        "nominalValue": 10.0,
        "totalCount": 100,
        "okCount": 95,
        "ngCount": 5,
        "ngRate": 5.0,
        "minValue": 9.92,
        "maxValue": 10.08,
        "avgValue": 10.001,
        "images": {
          "okImages": [
            {
              "imageUrl": "/uploads/inspections/2025-01/img_001.jpg",
              "measuredValue": 10.002,
              "serialNumber": "SN-20250115-001",
              "inspectionTime": "2025-01-15T08:30:00.000Z"
            },
            {
              "imageUrl": "/uploads/inspections/2025-02/img_045.jpg",
              "measuredValue": 9.998,
              "serialNumber": "SN-20250210-003",
              "inspectionTime": "2025-02-10T14:20:00.000Z"
            }
          ],
          "ngImages": [
            {
              "imageUrl": "/uploads/inspections/2025-01/img_023.jpg",
              "measuredValue": 10.12,
              "serialNumber": "SN-20250120-007",
              "inspectionTime": "2025-01-20T10:45:00.000Z"
            }
          ]
        }
      }
    ]
  }
}
```

**Mô tả fields trong `points[]`:**

| Field | Type | Description |
|---|---|---|
| `pointDefId` | number | ID định nghĩa điểm đo |
| `pointCode` | string | Mã điểm đo |
| `pointName` | string | Tên điểm đo |
| `measurementType` | string | Loại đo lường (DIAMETER, LENGTH, ANGLE, POSITION, OTHER...) |
| `unit` | string | Đơn vị đo |
| `lowerLimit` | number\|null | Giới hạn dưới |
| `upperLimit` | number\|null | Giới hạn trên |
| `nominalValue` | number\|null | Giá trị danh nghĩa |
| `totalCount` | number | Tổng số lần đo |
| `okCount` | number | Số lần đạt (OK) |
| `ngCount` | number | Số lần không đạt (NG) |
| `ngRate` | number | Tỷ lệ NG (%) = ngCount/totalCount × 100 |
| `minValue` | number\|null | Giá trị đo nhỏ nhất |
| `maxValue` | number\|null | Giá trị đo lớn nhất |
| `avgValue` | number\|null | Giá trị đo trung bình |
| `images` | object\|undefined | Chỉ có khi `includeImages=true` |
| `images.okImages` | array | Danh sách ảnh của kết quả OK |
| `images.ngImages` | array | Danh sách ảnh của kết quả NG |

**Mô tả fields trong `images.okImages[]` / `images.ngImages[]`:**

| Field | Type | Description |
|---|---|---|
| `imageUrl` | string | Đường dẫn ảnh (relative). Ghép với server URL để tải: `{serverUrl}{imageUrl}` |
| `measuredValue` | number\|null | Giá trị đo tại thời điểm chụp |
| `serialNumber` | string | Serial number của sản phẩm được kiểm tra |
| `inspectionTime` | string | Thời gian kiểm tra (ISO 8601) |

> **Lưu ý về URL ảnh:** `imageUrl` là đường dẫn tương đối (bắt đầu bằng `/uploads/...`). Để tải ảnh, ghép với base URL của server:  
> `http://your-server:3000/uploads/inspections/2025-01/img_001.jpg`

### 13.5 Error Responses

**400 Bad Request** — Thiếu tham số hoặc tham số không hợp lệ:
```json
{
  "success": false,
  "message": "Either productModelId or productCode is required"
}
```
```json
{
  "success": false,
  "message": "startDate and endDate are required (ISO 8601 format, e.g. 2025-01-01 or 2025-01-01T00:00:00Z)"
}
```
```json
{
  "success": false,
  "message": "startDate must be before or equal to endDate"
}
```

**401 Unauthorized** — Thiếu hoặc sai authentication:
```json
{
  "success": false,
  "message": "Unauthorized. Provide x-master-key header or Authorization: Bearer <token>"
}
```

**404 Not Found** — Không tìm thấy sản phẩm:
```json
{
  "success": false,
  "message": "Product model with code \"SP-999\" not found"
}
```

### 13.6 Ví dụ tích hợp

#### cURL
```bash
# Thống kê cơ bản (không có ảnh)
curl -X GET "http://your-server:3000/api/external/statistics/measurement-points?productModelId=1&startDate=2025-01-01&endDate=2025-03-31" \
  -H "X-Master-Key: your_secure_master_key_here"

# Thống kê kèm ảnh OK/NG
curl -X GET "http://your-server:3000/api/external/statistics/measurement-points?productCode=SP-001&startDate=2025-01-01&endDate=2025-03-31&includeImages=true" \
  -H "X-Master-Key: your_secure_master_key_here"
```

#### Python
```python
import requests

BASE_URL = "http://your-server:3000"
MASTER_KEY = "your_secure_master_key_here"

# Lấy thống kê kèm ảnh
response = requests.get(
    f"{BASE_URL}/api/external/statistics/measurement-points",
    headers={"X-Master-Key": MASTER_KEY},
    params={
        "productCode": "SP-001",
        "startDate": "2025-01-01",
        "endDate": "2025-03-31",
        "includeImages": "true",
    },
)

data = response.json()
if data["success"]:
    print(f"Sản phẩm: {data['data']['productModel']['name']}")
    for point in data["data"]["points"]:
        print(f"\n  {point['pointCode']} - {point['pointName']}:")
        print(f"    OK={point['okCount']}, NG={point['ngCount']}, NG Rate={point['ngRate']}%")

        # Hiển thị ảnh NG
        if "images" in point:
            for ng_img in point["images"]["ngImages"]:
                full_url = f"{BASE_URL}{ng_img['imageUrl']}"
                print(f"    [NG] SN={ng_img['serialNumber']} | "
                      f"Value={ng_img['measuredValue']} | URL: {full_url}")
```

#### C# (.NET)
```csharp
using var client = new HttpClient();
client.BaseAddress = new Uri("http://your-server:3000");
client.DefaultRequestHeaders.Add("X-Master-Key", "your_secure_master_key_here");

// Lấy thống kê kèm ảnh
var response = await client.GetAsync(
    "/api/external/statistics/measurement-points" +
    "?productCode=SP-001&startDate=2025-01-01&endDate=2025-03-31&includeImages=true");

var json = await response.Content.ReadAsStringAsync();
var result = JsonSerializer.Deserialize<JsonElement>(json);

// Tải ảnh NG
foreach (var point in result.GetProperty("data").GetProperty("points").EnumerateArray())
{
    if (point.TryGetProperty("images", out var images))
    {
        foreach (var ngImg in images.GetProperty("ngImages").EnumerateArray())
        {
            var imageUrl = ngImg.GetProperty("imageUrl").GetString();
            var fullUrl = $"http://your-server:3000{imageUrl}";
            Console.WriteLine($"NG Image: {fullUrl}");

            // Tải ảnh về local
            var imageBytes = await client.GetByteArrayAsync(fullUrl);
            var fileName = Path.GetFileName(imageUrl);
            await File.WriteAllBytesAsync($"ng_images/{fileName}", imageBytes);
        }
    }
}
```

#### JavaScript / Node.js
```javascript
const BASE_URL = "http://your-server:3000";

const response = await fetch(
  `${BASE_URL}/api/external/statistics/measurement-points` +
  "?productModelId=1&startDate=2025-01-01&endDate=2025-03-31&includeImages=true",
  {
    headers: { "X-Master-Key": "your_secure_master_key_here" },
  }
);

const { success, data } = await response.json();
if (success) {
  for (const point of data.points) {
    console.log(`${point.pointCode}: OK=${point.okCount}, NG=${point.ngCount}`);

    if (point.images) {
      // Hiển thị ảnh NG
      for (const img of point.images.ngImages) {
        console.log(`  [NG] ${BASE_URL}${img.imageUrl} | SN: ${img.serialNumber}`);
      }
    }
  }
}
```

### 13.7 Lưu ý khi tích hợp

- **Rate Limit:** Tối đa 100 requests / 1 phút trên `/api/` và `/trpc/` endpoints
- **Thời gian truy vấn:** Khoảng thời gian lớn (> 1 năm) có thể chậm hơn, khuyến nghị chia nhỏ theo tháng/quý
- **Định dạng ngày:** Hỗ trợ `YYYY-MM-DD` (mặc định 00:00:00 UTC) và full ISO 8601 `YYYY-MM-DDTHH:mm:ssZ`
- **Điểm đo không có dữ liệu:** Nếu một điểm đo chưa có kết quả trong khoảng thời gian, `totalCount = 0` và các giá trị thống kê sẽ là `null`
- **Bảo mật:** Không chia sẻ Master API Key cho client-side apps. Sử dụng Bearer Token (qua `/api/external/auth/login`) cho ứng dụng frontend
- **Ảnh (includeImages):** Response có thể lớn nếu có nhiều ảnh. Chỉ sử dụng `includeImages=true` khi thực sự cần xem ảnh. Với khoảng thời gian dài, nên chia nhỏ query
- **URL ảnh:** `imageUrl` là relative path. Ghép với server base URL: `{serverUrl}{imageUrl}`. Ảnh được serve tại `/uploads/` endpoint (static files)

### 13.8 AI Inspection Analytics Export Formats

- Hỗ trợ export từ biểu đồ: `CSV`, `JSON`, `PNG`
- CSV: dữ liệu bảng theo ngày (date, total, pass, fail, yieldRate, defectRate)
- JSON: payload định dạng đầy đủ để phân tích lại
- PNG: chụp snapshot của chart card đang hiển thị
- `PDF` chưa được bật ở AI Inspection Analytics page

---

*Tài liệu này được cập nhật: March 19, 2026 | Version: 2.3 - Added image support to Measurement Point Statistics API*
