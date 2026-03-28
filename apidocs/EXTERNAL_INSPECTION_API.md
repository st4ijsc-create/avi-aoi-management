# External Inspection API — Third-party Integration

REST API cho phép các ứng dụng bên thứ 3 truy vấn dữ liệu kiểm tra AOI.

## Authentication

Tất cả endpoints yêu cầu xác thực bằng **một trong hai** cách:

1. **Master Key**: Header `x-master-key` hoặc query param `?masterKey=`
2. **Bearer Token**: Header `Authorization: Bearer <jwt_token>`

---

## Endpoints

### 1. Inspection Summary

```
GET /api/external/inspections/summary
```

Tổng hợp kết quả kiểm tra theo station/product/khoảng thời gian.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `stationId` | number | ❌ | Lọc theo station |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm (thay thế productModelId) |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "totals": {
      "totalInspections": 1500,
      "okCount": 1350,
      "ngCount": 120,
      "ntfCount": 30,
      "yieldRate": 90.0
    },
    "details": [
      {
        "machineId": 1,
        "machineCode": "M001",
        "machineName": "Machine 1",
        "stationId": 1,
        "stationCode": "ST001",
        "stationName": "Station 1",
        "productModelId": 5,
        "productCode": "PRD001",
        "productName": "Product A",
        "totalInspections": 500,
        "okCount": 450,
        "ngCount": 40,
        "ntfCount": 10,
        "yieldRate": 90.0,
        "firstInspection": "2024-01-01T08:00:00Z",
        "lastInspection": "2024-01-31T17:30:00Z",
        "avgCycleTime": 2.35
      }
    ]
  }
}
```

---

### 2. Inspection Trend

```
GET /api/external/inspections/trend
```

Xu hướng OK/NG theo thời gian, hỗ trợ nhóm theo giờ/ngày/tuần.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `groupBy` | string | ❌ | `hour` \| `day` \| `week` (default: `day`) |
| `stationId` | number | ❌ | Lọc theo station |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm |
| `pointDefId` | number | ❌ | Lọc theo điểm đo (trả về chi tiết measurement-level) |

**Response (inspection-level):**

```json
{
  "success": true,
  "data": {
    "groupBy": "day",
    "dateRange": { "startDate": "...", "endDate": "..." },
    "trend": [
      {
        "period": "2024-01-15T00:00:00Z",
        "totalInspections": 200,
        "okCount": 180,
        "ngCount": 15,
        "ntfCount": 5,
        "yieldRate": 90.0
      }
    ]
  }
}
```

**Response (measurement-level — khi có `pointDefId`):**

```json
{
  "success": true,
  "data": {
    "groupBy": "hour",
    "dateRange": { "startDate": "...", "endDate": "..." },
    "pointDefId": 42,
    "trend": [
      {
        "period": "2024-01-15T08:00:00Z",
        "totalCount": 50,
        "okCount": 45,
        "ngCount": 5,
        "ntfCount": 0,
        "ngRate": 10.0,
        "avgValue": 5.234,
        "minValue": 4.891,
        "maxValue": 5.612
      }
    ]
  }
}
```

---

### 3. Defect Pareto

```
GET /api/external/inspections/defect-pareto
```

Phân tích Pareto lỗi — xếp hạng các điểm đo có tỉ lệ NG cao nhất.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `stationId` | number | ❌ | Lọc theo station |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm |
| `limit` | number | ❌ | Số lượng top items (default: 20, max: 100) |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "totalNGCount": 250,
    "items": [
      {
        "pointDefId": 12,
        "pointCode": "P001",
        "pointName": "Solder Joint A",
        "measurementType": "VISUAL",
        "ngCount": 80,
        "totalCount": 500,
        "ngRate": 16.0,
        "percentage": 32.0,
        "cumulativePercentage": 32.0
      },
      {
        "pointDefId": 15,
        "pointCode": "P002",
        "pointName": "Component Height B",
        "measurementType": "MEASUREMENT",
        "ngCount": 60,
        "totalCount": 500,
        "ngRate": 12.0,
        "percentage": 24.0,
        "cumulativePercentage": 56.0
      }
    ]
  }
}
```

---

### 4. Inspection Images

```
GET /api/external/inspections/images
```

Danh sách ảnh kiểm tra, hỗ trợ lọc theo station/product/điểm đo/kết quả.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `stationId` | number | ❌ | Lọc theo station |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm |
| `pointDefId` | number | ❌ | Lọc theo điểm đo |
| `result` | string | ❌ | `OK` \| `NG` \| `ALL` (default: `ALL`) |
| `limit` | number | ❌ | Số ảnh trả về (default: 50, max: 200) |
| `offset` | number | ❌ | Offset phân trang (default: 0) |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "pagination": { "total": 350, "limit": 50, "offset": 0, "hasMore": true },
    "images": [
      {
        "measurementResultId": 1234,
        "pointDefId": 12,
        "pointCode": "P001",
        "pointName": "Solder Joint A",
        "result": "NG",
        "measuredValue": "5.23",
        "measuredValueText": null,
        "imageUrl": "/uploads/inspections/...",
        "remark": null,
        "inspectionId": 100,
        "serialNumber": "SN20240115001",
        "inspectionResult": "NG",
        "inspectionTime": "2024-01-15T10:30:00Z",
        "productModelId": 5,
        "productCode": "PRD001",
        "productName": "Product A",
        "machineId": 1,
        "machineCode": "M001",
        "stationId": 1,
        "stationCode": "ST001",
        "stationName": "Station 1"
      }
    ]
  }
}
```

---

### 5. Inspection Events

```
GET /api/external/inspections/events
```

Sự kiện liên quan đến quá trình kiểm tra (upload, commit, retry, ...).

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `stationId` | number | ❌ | Lọc theo station |
| `machineId` | number | ❌ | Lọc theo machine |
| `packageId` | string | ❌ | Lọc theo package ID |
| `eventType` | string | ❌ | Loại sự kiện (xem bảng dưới) |
| `limit` | number | ❌ | Số events trả về (default: 50, max: 500) |
| `offset` | number | ❌ | Offset phân trang (default: 0) |

**Event Types:**

| Event | Description |
|-------|-------------|
| `presign` | Yêu cầu tạo URL upload |
| `upload_start` | Bắt đầu upload |
| `upload_success` | Upload thành công |
| `upload_fail` | Upload thất bại |
| `commit_start` | Bắt đầu commit package |
| `commit_success` | Commit thành công |
| `commit_fail` | Commit thất bại |
| `retry` | Thử lại |
| `image_view` | Xem ảnh |
| `zip_download` | Tải ZIP |
| `status_change` | Thay đổi trạng thái |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "pagination": { "total": 120, "limit": 50, "offset": 0, "hasMore": true },
    "events": [
      {
        "id": 456,
        "packageId": "pkg-abc-123",
        "machineId": 1,
        "machineCode": "M001",
        "machineName": "Machine 1",
        "stationId": 1,
        "stationCode": "ST001",
        "event": "upload_success",
        "level": "info",
        "message": "Package uploaded successfully",
        "detail": null,
        "source": "aoi-client",
        "fileSizeBytes": 2048576,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

---

### 6. Measurements

```
GET /api/external/inspections/measurements
```

Giá trị đo thực tế của một điểm đo theo thời gian.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pointDefId` | number | ✅ | ID điểm đo |
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |
| `stationId` | number | ❌ | Lọc theo station |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm |
| `limit` | number | ❌ | Số kết quả (default: 100, max: 1000) |
| `offset` | number | ❌ | Offset phân trang (default: 0) |

**Response:**

```json
{
  "success": true,
  "data": {
    "pointDef": {
      "id": 42,
      "code": "P042",
      "name": "Component Height",
      "measurementType": "MEASUREMENT",
      "unit": "mm",
      "lowerLimit": 4.5,
      "upperLimit": 5.5,
      "nominalValue": 5.0
    },
    "dateRange": { "startDate": "...", "endDate": "..." },
    "pagination": { "total": 500, "limit": 100, "offset": 0, "hasMore": true },
    "measurements": [
      {
        "measurementResultId": 789,
        "measuredValue": "5.23",
        "measuredValueText": null,
        "result": "OK",
        "remark": null,
        "hasImage": true,
        "imageUrl": "/uploads/...",
        "inspectionId": 100,
        "serialNumber": "SN20240115001",
        "inspectionResult": "OK",
        "inspectionTime": "2024-01-15T10:30:00Z",
        "machineId": 1,
        "machineCode": "M001",
        "stationId": 1,
        "stationCode": "ST001"
      }
    ]
  }
}
```

---

### 7. Products List

```
GET /api/external/products
```

Danh sách sản phẩm với tìm kiếm và phân trang.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `search` | string | ❌ | Tìm kiếm theo code hoặc name |
| `lifecycleStatus` | string | ❌ | Lọc theo trạng thái (active, archived, ...) |
| `limit` | number | ❌ | Số kết quả (default: 50, max: 200) |
| `offset` | number | ❌ | Offset phân trang (default: 0) |

**Response:**

```json
{
  "success": true,
  "data": {
    "pagination": { "total": 25, "limit": 50, "offset": 0, "hasMore": false },
    "products": [
      {
        "id": 5,
        "code": "PRD001",
        "name": "Product A",
        "description": "Description...",
        "category": "PCB",
        "lifecycleStatus": "active",
        "targetYieldRate": 95.0,
        "minYieldRate": 90.0,
        "imageWidth": 1920,
        "imageHeight": 1080,
        "pointsConfigVersion": 3,
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-10T12:00:00Z"
      }
    ]
  }
}
```

---

### 8. Product Detail

```
GET /api/external/products/:id
```

Chi tiết sản phẩm kèm danh sách tất cả điểm đo (measurement points).

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Product model ID |

**Response:**

```json
{
  "success": true,
  "data": {
    "product": {
      "id": 5,
      "code": "PRD001",
      "name": "Product A",
      "description": "Description...",
      "category": "PCB",
      "lifecycleStatus": "active",
      "targetYieldRate": 95.0,
      "minYieldRate": 90.0,
      "hasReferenceImage": true,
      "imageWidth": 1920,
      "imageHeight": 1080,
      "pointsConfigVersion": 3,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-10T12:00:00Z"
    },
    "measurementPoints": [
      {
        "id": 42,
        "code": "P042",
        "name": "Component Height",
        "measurementType": "MEASUREMENT",
        "unit": "mm",
        "lowerLimit": 4.5,
        "upperLimit": 5.5,
        "nominalValue": 5.0,
        "isActive": true,
        "orderIndex": 1,
        "machineId": 1,
        "machineCode": "M001",
        "hasReferenceImage": true,
        "cropWidth": 200,
        "cropHeight": 200
      }
    ],
    "totalPoints": 15,
    "activePoints": 12
  }
}
```

---

## Error Responses

Tất cả lỗi trả về format thống nhất:

```json
{
  "success": false,
  "message": "Error description"
}
```

**Common HTTP Status Codes:**

| Code | Description |
|------|-------------|
| 400 | Bad Request — Thiếu hoặc sai tham số |
| 401 | Unauthorized — Không có hoặc sai authentication |
| 404 | Not Found — Không tìm thấy resource |
| 500 | Internal Server Error — Lỗi server |

---

## Usage Examples

### cURL

```bash
# Summary — sử dụng Master Key
curl -H "x-master-key: YOUR_KEY" \
  "https://your-server/api/external/inspections/summary?startDate=2024-01-01&endDate=2024-01-31"

# Defect Pareto — sử dụng Bearer Token
curl -H "Authorization: Bearer YOUR_JWT" \
  "https://your-server/api/external/inspections/defect-pareto?startDate=2024-01-01&endDate=2024-01-31&limit=10"

# Images lọc NG
curl -H "x-master-key: YOUR_KEY" \
  "https://your-server/api/external/inspections/images?startDate=2024-01-01&endDate=2024-01-31&result=NG&limit=20"

# Measurements cho điểm đo cụ thể
curl -H "x-master-key: YOUR_KEY" \
  "https://your-server/api/external/inspections/measurements?pointDefId=42&startDate=2024-01-01&endDate=2024-01-31"

# Trend theo giờ cho 1 station
curl -H "x-master-key: YOUR_KEY" \
  "https://your-server/api/external/inspections/trend?startDate=2024-01-15&endDate=2024-01-15&groupBy=hour&stationId=1"
```

### C# HttpClient

```csharp
using var client = new HttpClient();
client.DefaultRequestHeaders.Add("x-master-key", "YOUR_KEY");

// Get summary
var response = await client.GetAsync(
    "https://your-server/api/external/inspections/summary" +
    "?startDate=2024-01-01&endDate=2024-01-31&stationId=1");
var json = await response.Content.ReadAsStringAsync();
```

### Python requests

```python
import requests

headers = {"x-master-key": "YOUR_KEY"}
params = {
    "startDate": "2024-01-01",
    "endDate": "2024-01-31",
    "stationId": 1,
    "groupBy": "day",
}
resp = requests.get(
    "https://your-server/api/external/inspections/trend",
    headers=headers,
    params=params,
)
data = resp.json()
```
