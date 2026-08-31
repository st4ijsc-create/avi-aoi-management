# Unified API Structure - Cấu trúc JSON đồng bộ

## Tổng quan

Document này mô tả cấu trúc JSON đã được **đồng bộ hóa** giữa:
- **HTTP REST AOI Package Upload** (meta.json)
- **tRPC submitInspection API**

Mục tiêu: Client có thể sử dụng cùng một cấu trúc JSON để gửi dữ liệu qua cả hai API, giúp đồng bộ dữ liệu và dễ tra cứu history.

---

## ⚠ Hướng sắp tới (đã quyết định, CHƯA triển khai) — BG-85

Chủ dự án đã quyết định (`docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md`):
`meta.json` trong gói ZIP sẽ **không còn là một hợp đồng riêng**. Nó sẽ trở thành
**chính payload kết quả v2.0** (`machineDataContractV2` — cây
`surfaces[].positions[].captures[].components[]`) **cộng thêm đúng một trường**
`images[]` (tham chiếu ảnh, nối bằng `captureId`). Cấu trúc `measurements[]`/
`points[]` mà tài liệu này mô tả bên dưới **sẽ bị thay thế** khi BG-85 hoàn tất —
máy di trú theo 3 giai đoạn (nhận cả hai hình dạng → đếm được → cắt hình dạng cũ
khi số máy về 0). Bên tích hợp máy nên xem spec trên trước khi đầu tư nhiều vào
engine sinh `meta.json` theo hình dạng hiện tại, để tránh viết lại hai lần. Chi
tiết `images[]`/lịch trình di trú **CHƯA CHỐT** — không suy đoán thêm ngoài spec.

---

## 1. Inspection Metadata - Thông tin kiểm tra

### Thông tin sản phẩm (REQUIRED)

```json
{
  "serialNumber": "SN123456789",          // Số serial sản phẩm (BẮT BUỘC)
  "productModel": "ModelA-V2",            // Model sản phẩm (BẮT BUỘC)
  "batchNumber": "BATCH-2024-001"         // Số lô (optional)
}
```

### Thông tin máy móc

```json
{
  "machineCode": "AOI-LINE1-01",          // Mã máy kiểm tra
  "inspectionId": "INS-20240101-001"      // ID inspection tạo từ máy (optional)
}
```

### Thời gian kiểm tra

```json
{
  "inspectionTime": "2024-01-15T10:30:00Z",  // ISO 8601 datetime (submitInspection compat)
  "startedAt": "2024-01-15T10:30:00Z",       // Alias (AOI package compat)
  "finishedAt": "2024-01-15T10:32:30Z",      // Thời gian kết thúc
  "cycleTime": 150.5                          // Thời gian chu kỳ (giây)
}
```

**Lưu ý:** Hệ thống tự động dùng `inspectionTime` hoặc `startedAt` (ưu tiên `inspectionTime`).

---

## 2. Enterprise Hierarchy - Cấp bậc doanh nghiệp

Cấu trúc từ trên xuống (top-down):

```json
{
  "companyCode": "COMPANY-A",           // Mã tập đoàn/công ty
  "factoryCode": "FACTORY-HN",          // Mã nhà máy (ưu tiên)
  "factory": "FACTORY-HN",              // Backward compatible (old field)
  "workshopCode": "WORKSHOP-01",        // Mã nhà xưởng
  "lineCode": "LINE-3",                 // Mã dây chuyền (ưu tiên)
  "line": "LINE-3",                     // Backward compatible (old field)
  "stageCode": "STAGE-AOI"              // Mã công đoạn
}
```

**Khuyến nghị:** 
- Dùng fields mới: `factoryCode`, `lineCode`, `workshopCode`, `stageCode`
- Fields cũ (`factory`, `line`) vẫn hỗ trợ để tương thích ngược

---

## 3. Production Context - Bối cảnh sản xuất

```json
{
  "productionOrderCode": "PO-2024-0115-001", // Mã lệnh sản xuất
  "operatorId": "OP-0023"                     // Mã công nhân vận hành
}
```

---

## 4. Measurements - Dữ liệu đo lường (CORE)

### 4.1. Cấu trúc đồng bộ (NEW - Khuyến nghị)

```json
{
  "measurements": [
    {
      "pointId": "POINT-001",               // ID điểm đo (ưu tiên - submitInspection)
      "pointCode": "R1-IC1-PIN1",           // Mã điểm đo (fallback)
      "name": "IC1 Pin 1 Resistance",       // Tên điểm đo (optional)
      "fileName": "image_001.jpg",          // Tên file ảnh trong ZIP
      "result": "OK",                       // Kết quả: "OK" | "NG" | "NTF"
      "measuredValue": 1023.5,              // Giá trị đo (ưu tiên - submitInspection)
      "unit": "Ω",                          // Đơn vị (optional)
      "remark": "Đo lại lần 2"              // Ghi chú (optional)
    },
    {
      "pointId": "POINT-002",
      "pointCode": "R2-IC1-PIN2",
      "fileName": "image_002.jpg",
      "result": "NG",
      "measuredValue": 0,                   // Short circuit
      "unit": "Ω",
      "remark": "Short - Cần thay IC"
    }
  ]
}
```

### 4.2. Cấu trúc legacy (BG-85, 2026-09-02 — hợp đồng phẳng KHÔNG còn được nhận cho gói ZIP)

⚠️ **`meta.json` của gói ZIP (`aoiPackage.commit`) KHÔNG còn nhận hợp đồng
PHẲNG cũ nữa** (`measurements[]`/`points[]` cấp cao nhất, tên trường
`code`/`value`…). Từ BG-85, `meta.json` là CHÍNH payload cây
`machineDataContractV2` (đường trực tiếp `submitInspection` cũng dùng) cộng
thêm `images[]` — xem §6.1. Một gói ZIP gửi hình dạng phẳng như trước đây sẽ bị
**từ chối** (`invalid_type`, thiếu `surfaces`/`ntf`/`summary`/`identity` bắt
buộc), **không** bị khoá `'dead'` (vẫn `'failed'`, retry được) nhưng **không
bao giờ tự commit được**. Cấu trúc CÂY tối thiểu tương đương (đo lường của MỘT
điểm, `R1-IC1-PIN1`) trông như sau:

```json
{
  "identity": {
    "station": "AIC-01", "machine": "AOI-01", "line": "LINE-3",
    "plant": "FACTORY-HN", "country": "VN", "solutionName": "ModelA-SOL", "appVersion": "1.0.0"
  },
  "productId": "modela-v2-001",
  "serialNumber": "SN123456789",
  "productModel": "ModelA-V2",
  "overallResult": "OK",
  "ntf": false,
  "summary": {
    "surfaces": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "positions": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "captures": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "components": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 }
  },
  "surfaces": [{
    "name": "TOP", "result": "OK", "ntf": false,
    "positions": [{
      "positionId": "P01", "result": "OK", "ntf": false,
      "captures": [{
        "captureId": "cap-R1-IC1-PIN1", "captureName": "IC1 Pin 1 Resistance", "result": "OK", "ntf": false,
        "components": [{ "componentId": "comp-R1-IC1-PIN1", "result": "OK", "ntf": false, "value": "1023.5" }]
      }]
    }]
  }],
  "images": [{ "captureId": "cap-R1-IC1-PIN1", "fileName": "image_001.jpg" }]
}
```

Ghi chú: `submitInspection` (tRPC, đường trực tiếp v1.x — mục 6.2) vẫn nhận tên
trường thay thế `code`/`value` như trước cho hình dạng PHẲNG của **chính nó**
(`submitInspectionCoreObject`, không đổi bởi BG-85) — bảng này chỉ nói về
`meta.json` của gói ZIP.

---

## 5. Overall Result & Summary - Kết quả tổng thể

### Kết quả tổng thể

```json
{
  "overallResult": "NG"   // "OK" | "NG" | "NTF"
}
```

**Logic tự động:**
- Nếu không có `overallResult`, hệ thống tự động tính:
  - Có bất kỳ measurement nào "NG" → `overallResult = "NG"`
  - Tất cả "OK" → `overallResult = "OK"`

### Thống kê (optional - tự động tính nếu không có)

```json
{
  "summary": {
    "totalPoints": 10,
    "ok": 8,
    "ng": 2,
    "ntf": 0
  }
}
```

---

## 6. Complete Example - Ví dụ đầy đủ

### 6.1. AOI Package - meta.json

BG-85 (2026-09-02) — `meta.json` = `machineDataContractV2` (cây) + `images[]`:

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
    "captures":   { "total": 3, "pass": 2, "ng": 1, "ntf": 0 },
    "components": { "total": 3, "pass": 2, "ng": 1, "ntf": 0 }
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
            },
            {
              "captureId": "cap-CAP-C15", "captureName": "C15 Capacitance", "result": "OK", "ntf": false,
              "components": [{ "componentId": "comp-CAP-C15", "result": "OK", "ntf": false, "value": "10.2" }]
            }
          ]
        }
      ]
    }
  ],

  "images": [
    { "captureId": "cap-R1-IC1-PIN1", "fileName": "image_001.jpg" },
    { "captureId": "cap-R2-IC2-PIN5", "fileName": "image_002.jpg" },
    { "captureId": "cap-CAP-C15", "fileName": "image_003.jpg" }
  ]
}
```

### 6.2. submitInspection API (tRPC)

```typescript
// Client call
const result = await trpc.machine.submitInspection.mutate({
  machineCode: "AOI-LINE1-01",
  apiKey: "your-api-key",
  
  inspectionTime: "2024-01-15T10:30:00Z",
  cycleTime: "150.5",
  
  serialNumber: "SN-20240115-001",
  productModel: "PCB-V2-Standard",
  batchNumber: "BATCH-2024-001",
  
  companyCode: "COMPANY-A",
  factoryCode: "FACTORY-HN",
  workshopCode: "WORKSHOP-SMT",
  lineCode: "LINE-3",
  stageCode: "STAGE-AOI",
  
  productionOrderCode: "PO-2024-0115-001",
  operatorId: "OP-0023",
  
  measurements: [
    {
      pointId: "POINT-001",
      pointCode: "R1-IC1-PIN1",
      measuredValue: "1023.5",
      result: "OK",
      remark: "In spec",
      imageBase64: "data:image/jpeg;base64,/9j/4AAQ..."  // Optional inline image
    },
    {
      pointId: "POINT-002",
      pointCode: "R2-IC2-PIN5",
      measuredValue: "0",
      result: "NG",
      remark: "Short circuit - Replace IC2",
      imageBase64: "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
});
```

---

## 7. Field Mapping - Bảng mapping giữa 2 API

| Concept | AOI Package (meta.json) | submitInspection (tRPC) | Priority |
|---------|-------------------------|-------------------------|----------|
| Point ID | `measurements[].pointId` | `measurements[].pointId` | ✅ Same |
| Point Code | `measurements[].pointCode` | `measurements[].pointCode` | ✅ Same |
| Measured Value | `measurements[].measuredValue` | `measurements[].measuredValue` | ✅ Same |
| Result | `measurements[].result` | `measurements[].result` | ✅ Same |
| Remark | `measurements[].remark` | `measurements[].remark` | ✅ Same |
| Image | `measurements[].fileName` | `measurements[].imageBase64` | Different |
| Factory | `factoryCode` (new) | `factoryCode` (new) | ✅ Same |
| Line | `lineCode` (new) | `lineCode` (new) | ✅ Same |
| Workshop | `workshopCode` (new) | `workshopCode` (new) | ✅ Same |
| Stage | `stageCode` (new) | `stageCode` (new) | ✅ Same |
| Production Order | `productionOrderCode` (new) | `productionOrderCode` (new) | ✅ Same |
| Operator | `operatorId` (new) | `operatorId` (new) | ✅ Same |
| Batch | `batchNumber` (new) | `batchNumber` (new) | ✅ Same |

---

## 8. Image Handling - Xử lý ảnh

### 8.1. AOI Package (ZIP upload)

```
package.zip
├── meta.json
└── images/
    ├── image_001.jpg
    ├── image_002.jpg
    └── image_003.jpg
```

- **meta.json**: Chứa `images[].fileName` (BG-85 — KHÔNG còn `measurements[].fileName`, xem §4.2)
- **images/**: Folder chứa các file ảnh — **đường dẫn DUY NHẤT** server tìm ảnh (BG-88/BG-87:
  fallback tên trần ở gốc gói đã bị bỏ, ảnh đặt sai chỗ ⇒ 404 khi đọc lại)
- **Image URL**: `/api/aoi/image/{packageId}/{fileName}`

#### Chuẩn nén (BG-88, nguồn: `docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md` §5)

| Mục | Chuẩn |
|---|---|
| Định dạng | ZIP, DEFLATE |
| Mức nén | 6 (mặc định) — chỉ áp dụng cho `meta.json`; ảnh đã nén sẵn nên nén lại tốn CPU mà lợi <2% byte |
| Ảnh | **STORE** (không nén lại) — `CompressionLevel.NoCompression` nếu dùng `System.IO.Compression` của .NET |
| Trần kích thước gói | **200MB**, chặn cứng ở `presign` (trước khi tải byte nào lên) |

Xem ví dụ C# tạo gói đúng chuẩn (per-entry compression) tại
[`docs/examples/CSharp_API_Examples.md`](./examples/CSharp_API_Examples.md#aoi-package-upload).

### 8.2. submitInspection (Base64 inline)

```json
{
  "measurements": [
    {
      "pointId": "POINT-001",
      "imageBase64": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
}
```

- **imageBase64**: Ảnh được encode base64 inline trong JSON
- **Image URL**: Hệ thống lưu substring 100 chars đầu trong DB

---

## 9. Backward Compatibility - Tương thích ngược

⚠️ **BG-85 (2026-09-02) — mục này KHÔNG còn áp dụng cho `meta.json` của gói
ZIP.** Trước BG-85, hệ thống chấp nhận TÊN TRƯỜNG cũ (`factory`/`line`/`code`/
`value`…) miễn khoá mảng đo lường cấp cao nhất là `measurements`. Sau BG-85,
`meta.json` là hợp đồng CÂY `machineDataContractV2` + `images[]` (§6.1) — KHÔNG
còn `measurements[]`/`factory`/`line`/`code`/`value` ở bất kỳ đâu. Một gói ZIP
gửi hình dạng dưới đây bị **từ chối** (`invalid_type`), **không** khoá `'dead'`
(vẫn `'failed'`, retry được) nhưng **không bao giờ tự commit được**:

### Legacy meta.json (tên trường cũ vẫn hoạt động)

```json
{
  "serialNumber": "SN123",
  "productModel": "PCB-V1",
  "factory": "FACTORY-HN",
  "line": "LINE-3",
  "measurements": [
    {
      "code": "R1",
      "value": 1023.5,
      "fileName": "image_001.jpg",
      "result": "OK"
    }
  ]
}
```

**Hình dạng CÂY tương đương (hình dạng THẬT SỰ được chấp nhận hôm nay):**

```json
{
  "identity": {
    "station": "AIC-01", "machine": "AOI-01", "line": "LINE-3",
    "plant": "FACTORY-HN", "country": "VN", "solutionName": "PCB-V1-SOL", "appVersion": "1.0.0"
  },
  "productId": "pcb-v1-sn123",
  "serialNumber": "SN123",
  "productModel": "PCB-V1",
  "overallResult": "OK",
  "ntf": false,
  "summary": {
    "surfaces": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "positions": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "captures": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 },
    "components": { "total": 1, "pass": 1, "ng": 0, "ntf": 0 }
  },
  "surfaces": [{
    "name": "TOP", "result": "OK", "ntf": false,
    "positions": [{
      "positionId": "P01", "result": "OK", "ntf": false,
      "captures": [{
        "captureId": "cap-R1", "result": "OK", "ntf": false,
        "components": [{ "componentId": "comp-R1", "result": "OK", "ntf": false, "value": "1023.5" }]
      }]
    }]
  }],
  "images": [{ "captureId": "cap-R1", "fileName": "image_001.jpg" }]
}
```

**Ghi chú (`submitInspection` tRPC, đường trực tiếp v1.x — mục 6.2, KHÔNG đổi bởi BG-85):**
1. `pointId` missing → use `pointCode` → use `code`
2. `measuredValue` missing → use `value`
3. `factoryCode` missing → use `factory`
4. `lineCode` missing → use `line`

---

## 10. Benefits - Lợi ích của đồng bộ

### ✅ Consistency (Nhất quán)
- Cùng một field names giữa 2 API
- Client code dễ maintain

### ✅ Traceability (Khả năng truy vết)
- Đầy đủ enterprise hierarchy (company → factory → workshop → line → stage)
- Production context (production order, operator, batch)
- Dễ dàng query history theo bất kỳ level nào

### ✅ Flexibility (Linh hoạt)
- Hỗ trợ cả 2 phương thức: ZIP upload và base64 inline
- Backward compatible với cấu trúc cũ
- Auto-calculation cho summary và overallResult

### ✅ Standardization (Tiêu chuẩn hóa)
- Enum values: `"OK" | "NG" | "NTF"`
- ISO 8601 datetime format
- Consistent point identification: pointId → pointCode → code

---

## 11. Migration Guide - Hướng dẫn chuyển đổi

⚠️ **Lưu ý:** khoá `points` (dòng `-` bên dưới) chỉ minh hoạ TÊN TRƯỜNG cũ để so
sánh — một payload thật với khoá `points` mà KHÔNG có `measurements` bị server
**từ chối ngay hôm nay** (không phải "cấu trúc cũ đang chạy, nâng cấp khi rảnh").
Ưu tiên đổi khoá `measurements` trước các trường khác nếu client còn ở hình dạng
này.

### Client cũ (Old structure) → Client mới (New structure)

```diff
{
  "serialNumber": "SN123",
  "productModel": "PCB-V1",
- "factory": "FACTORY-HN",
+ "factoryCode": "FACTORY-HN",
- "line": "LINE-3",
+ "lineCode": "LINE-3",
+ "workshopCode": "WORKSHOP-SMT",
+ "stageCode": "STAGE-AOI",
+ "companyCode": "COMPANY-A",
+ "productionOrderCode": "PO-2024-001",
+ "operatorId": "OP-0023",
+ "batchNumber": "BATCH-2024-001",
  
- "points": [
+ "measurements": [
    {
-     "code": "R1",
+     "pointId": "POINT-001",
+     "pointCode": "R1",
-     "value": 1023.5,
+     "measuredValue": 1023.5,
      "fileName": "image_001.jpg",
-     "result": "OK"
+     "result": "OK",
+     "unit": "Ω",
+     "remark": "In spec"
    }
  ]
}
```

---

## 12. Query Examples - Ví dụ truy vấn

### Tìm tất cả inspection của một production order

```sql
SELECT * FROM product_inspections
WHERE production_order_code = 'PO-2024-0115-001'
ORDER BY inspection_time DESC;
```

### Tìm inspection theo enterprise hierarchy

```sql
SELECT * FROM product_inspections
WHERE company_code = 'COMPANY-A'
  AND factory_code = 'FACTORY-HN'
  AND workshop_code = 'WORKSHOP-SMT'
  AND line_code = 'LINE-3'
  AND stage_code = 'STAGE-AOI'
ORDER BY inspection_time DESC;
```

### Tìm tất cả NG inspections của một operator

```sql
SELECT * FROM product_inspections
WHERE operator_id = 'OP-0023'
  AND overall_result = 'NG'
ORDER BY inspection_time DESC;
```

### Tìm tất cả measurement results theo batch

```sql
SELECT pi.batch_number, pi.serial_number, mr.measured_value, mr.result
FROM product_inspections pi
JOIN measurement_results mr ON mr.inspection_id = pi.id
WHERE pi.batch_number = 'BATCH-2024-001'
ORDER BY pi.inspection_time, mr.id;
```

---

## 13. Validation Rules - Quy tắc validation

### Required fields
- ✅ `serialNumber` (string, min 1 char)
- ✅ `productModel` (string, min 1 char)
- ✅ `measurements` array — **BẮT BUỘC trên MỌI payload** (có thể là mảng rỗng
  `[]`, nhưng khoá này không được vắng mặt). `points` array là bí danh CŨ của
  các TÊN TRƯỜNG bên trong (`code`/`value`) — KHÔNG thay thế được khoá
  `measurements` ở cấp cao nhất (xem §4.2/§9)

### Optional but recommended
- `companyCode`, `factoryCode`, `workshopCode`, `lineCode`, `stageCode`
- `productionOrderCode`, `operatorId`, `batchNumber`
- `inspectionTime` (ISO 8601 datetime)
- `overallResult` (auto-calculated if missing)

### Measurement point rules
- Mỗi point phải có `fileName` (AOI package) hoặc `imageBase64` (submitInspection)
- `pointId` hoặc `pointCode` hoặc `code` (at least one)
- `result` phải là `"OK"` | `"NG"` | `"NTF"`

---

## 14. FAQ

### Q1: Có cần thay đổi client code ngay không?
**A:** Không bắt buộc. Hệ thống vẫn hỗ trợ cấu trúc cũ (backward compatible). Nhưng **khuyến nghị migrate** để có đầy đủ features mới.

### Q2: `measurements` và `points` khác gì nhau?
**A:** 
- `measurements`: Cấu trúc mới, đồng bộ với submitInspection, có thêm field `pointId`, `measuredValue`, `remark`
- `points`: Cấu trúc cũ, vẫn hoạt động nhưng thiếu một số fields mới

### Q3: Nếu gửi cả `measurements` và `points` thì sao?
**A:** Hệ thống ưu tiên `measurements`. Field `points` bị ignore.

### Q4: `inspectionTime` và `startedAt` khác gì?
**A:** Giống nhau, chỉ là tên khác nhau để tương thích:
- `inspectionTime`: submitInspection (tRPC)
- `startedAt`: AOI package (old field)
- Hệ thống ưu tiên `inspectionTime`

### Q5: Có thể tìm history theo production order không?
**A:** Có! Dùng field `productionOrderCode` → Query `product_inspections.production_order_code`.

### Q6: Image URL format như thế nào?
**A:**
- AOI Package: `/api/aoi/image/{packageId}/{fileName}`
- submitInspection: Chỉ lưu snippet base64 trong DB (100 chars)

---

## 15. Contact & Support

Nếu có câu hỏi hoặc cần hỗ trợ về API structure:

1. Xem chi tiết trong source code:
   - `server/routers/aoiPackageRouter.ts` (AOI Package API)
   - `server/routers.ts` (submitInspection API)
   
2. Kiểm tra schema validation:
   - Search `metaJsonSchema` trong aoiPackageRouter.ts
   - Search `submitInspection` input schema trong routers.ts

3. Test examples:
   - `docs/API_REFERENCE.md`
   - `test-api.mjs`

---

**Last Updated:** 2024-01-15  
**Version:** 2.0 (Unified Structure)
