# External Inspection API — Third-party Integration

REST API cho phép các ứng dụng bên thứ 3 truy vấn dữ liệu kiểm tra AOI.

## ⚠️ LƯU Ý VỀ XÁC THỰC

Tất cả API đều hỗ trợ **Master Key** (`x-master-key`). Ngoài ra, Product APIs còn hỗ trợ Machine API Key / Machine Code.

### Xác thực bằng Master Key (tất cả API)

Áp dụng cho: **Stations**, **Products**, **Inspection APIs** — tất cả endpoints

| Cách gửi | Ví dụ |
|-----------|-------|
| Header `x-master-key` | `x-master-key: YOUR_MASTER_KEY` |
| Query param | `?masterKey=YOUR_MASTER_KEY` |
| Header `Authorization` | `Authorization: Bearer <jwt_token>` |

### Xác thực bằng Machine API Key (chỉ Product APIs `/api/public/*`)

Product APIs cũng hỗ trợ xác thực bằng Machine API Key hoặc Machine Code:

| Cách gửi | Ví dụ |
|-----------|-------|
| Header `x-api-key` | `x-api-key: MACHINE_API_KEY` |
| Header `x-machine-code` | `x-machine-code: M001` |
| Query param | `?apiKey=MACHINE_API_KEY` hoặc `?machineCode=M001` |

> **Tóm tắt**: Dùng `x-master-key` cho tất cả API là đơn giản nhất.
> Product APIs chấp nhận cả 3 loại: `x-master-key`, `x-api-key`, hoặc `x-machine-code`.

---

## Mục lục

- [Hướng dẫn quy đổi tọa độ](#hướng-dẫn-quy-đổi-tọa-độ-điểm-đo-coordinate-scaling-guide) — Cách tính scale factor từ imageWidth/imageHeight
- [A. Station APIs](#a-station-apis) — `/api/external/stations` — Auth: Master Key
  - [A3. Inspection Points](#a3-inspection-points-theo-station) — Điểm đo + ảnh tham chiếu + vị trí
  - [A4. Ảnh tham chiếu Station](#a4-ảnh-tham-chiếu-station) — Reference image station
  - [A5. Resolve Station từ MQTT Topic](#a5-resolve-station-từ-mqtt-topic) — Phân giải MQTT topic → station info
  - [A6. Sản phẩm theo Station](#a6-sản-phẩm-theo-station) — Products mapped cho station
  - [A8. Measurement Stats](#a8-thống-kê-theo-điểm-đo-measurement-stats) — Thống kê từng điểm đo
  - [A9. Fail History](#a9-lịch-sử-lỗi-ng-fail-history) — Lịch sử NG + ảnh lỗi
  - [A10. Point Detail](#a10-chi-tiết-điểm-đo--ảnh-lỗi-point-detail) — Chi tiết điểm đo + ảnh lỗi NG
- [A11. Workstation APIs](#a11-workstation-apis) — `/api/external/workstations` — Auth: Master Key
- [B. Public Product APIs](#b-public-product-apis) — `/api/public/products` — Auth: Machine API Key
  - [B4. Điểm đo theo sản phẩm](#b4-danh-sách-điểm-đo-theo-sản-phẩm) — Measurement points
  - [B5. Ảnh sản phẩm](#b5-ảnh-sản-phẩm) — Product reference image
  - [B6. Ảnh điểm đo](#b6-ảnh-điểm-đo) — Cropped point image
- [C. Inspection APIs](#c-inspection-apis) — `/api/external/inspections` — Auth: Master Key
  - [C4. Inspection Images](#4-inspection-images) — Ảnh kiểm tra (lọc OK/NG)
  - [C6. Measurements](#6-measurements) — Giá trị đo thực tế + ảnh
- [D. Advanced Analytical APIs](#d-advanced-analytical-apis-spc--ai) — SPC / AI — Auth: Master Key
- [E. Statistics APIs](#e-statistics-apis) — `/api/external/statistics` — Auth: Master Key
  - [E1. Measurement Point Stats by Product](#e1-thống-kê-điểm-đo-theo-sản-phẩm-measurement-point-stats) — Thống kê + ảnh OK/NG theo sản phẩm
- [🖼️ Tham chiếu nhanh: API Ảnh & Điểm đo](#-tham-chiếu-nhanh-api-ảnh--điểm-đo) — Quick Reference cho bên thứ 3

---

## Hướng dẫn quy đổi tọa độ điểm đo (Coordinate Scaling Guide)

Các API trả về tọa độ điểm đo (`positionX`, `positionY`, `radius`) theo **pixel gốc** trên ảnh tham chiếu sản phẩm.
Để hiển thị chính xác trên canvas/view có kích thước khác, ứng dụng cần tính **hệ số tỷ lệ (scale factor)** dựa vào kích thước ảnh gốc.

### Gốc tọa độ

- Gốc `(0, 0)` nằm ở **góc trên bên trái (top-left)** — chuẩn cho cả web canvas, image, và WinForms/WPF.
- Trục X hướng sang phải, trục Y hướng xuống dưới.

### Công thức quy đổi theo kiểu hiển thị ảnh (Display Mode)

Mỗi API trả về điểm đo đều kèm `imageWidth` và `imageHeight` (kích thước pixel gốc của ảnh tham chiếu).
Cách tính tọa độ hiển thị **phụ thuộc vào kiểu hiển thị ảnh** mà ứng dụng sử dụng:

| Kiểu hiển thị | Mô tả | Scale | Offset |
|----------------|-------|-------|--------|
| **Stretch** | Kéo giãn ảnh lấp đầy canvas (có thể méo) | scaleX ≠ scaleY | 0 |
| **Fit (Contain)** | Thu/phóng giữ tỉ lệ, vừa khung, có viền đen | uniform scale | có offset |
| **Fill (Cover)** | Thu/phóng giữ tỉ lệ, phủ kín canvas, có thể cắt | uniform scale | có offset (âm) |
| **Center (None)** | Hiển thị nguyên kích thước, căn giữa | scale = 1 | có offset |

---

#### 1. Stretch — Kéo giãn lấp đầy

Ảnh bị kéo giãn theo cả 2 trục để lấp đầy canvas. **Đơn giản nhất** nhưng ảnh có thể bị méo nếu tỉ lệ canvas khác tỉ lệ ảnh.

```
scaleX = canvasWidth  / imageWidth
scaleY = canvasHeight / imageHeight

displayX      = positionX * scaleX
displayY      = positionY * scaleY
displayRadius = radius    * scaleX
```

#### 2. Fit (Contain) — Giữ tỉ lệ, vừa khung ⭐ Khuyến nghị

Ảnh được thu/phóng **đều** (uniform scale) sao cho vừa khít trong canvas mà không bị cắt. Phần thừa là viền đen (letterbox/pillarbox).

```
scale   = min(canvasWidth / imageWidth, canvasHeight / imageHeight)
offsetX = (canvasWidth  - imageWidth  * scale) / 2
offsetY = (canvasHeight - imageHeight * scale) / 2

displayX      = positionX * scale + offsetX
displayY      = positionY * scale + offsetY
displayRadius = radius    * scale
```

> **Tại sao Fit được khuyến nghị?** Vì ảnh không bị méo, không bị cắt, mọi điểm đo đều hiển thị đúng vị trí.

#### 3. Fill (Cover) — Giữ tỉ lệ, phủ kín

Ảnh được phóng to **đều** sao cho phủ kín canvas. Phần ảnh vượt ngoài canvas bị cắt (crop).

```
scale   = max(canvasWidth / imageWidth, canvasHeight / imageHeight)
offsetX = (canvasWidth  - imageWidth  * scale) / 2    // có thể âm
offsetY = (canvasHeight - imageHeight * scale) / 2    // có thể âm

displayX      = positionX * scale + offsetX
displayY      = positionY * scale + offsetY
displayRadius = radius    * scale
```

> ⚠️ Với Fill, các điểm đo gần rìa ảnh có thể bị cắt ngoài khung hiển thị.

#### 4. Center (None) — Nguyên kích thước, căn giữa

Ảnh giữ nguyên pixel gốc, đặt giữa canvas. Nếu ảnh lớn hơn canvas thì bị cắt; nếu nhỏ hơn thì có viền.

```
scale   = 1.0
offsetX = (canvasWidth  - imageWidth)  / 2
offsetY = (canvasHeight - imageHeight) / 2

displayX      = positionX + offsetX
displayY      = positionY + offsetY
displayRadius = radius
```

---

### Ví dụ minh họa (Fit mode)

Ảnh gốc **1920×1080** hiển thị trên canvas **800×500**:

```
scale   = min(800/1920, 500/1080) = min(0.4167, 0.4630) = 0.4167
offsetX = (800 - 1920 × 0.4167) / 2 = (800 - 800) / 2 = 0
offsetY = (500 - 1080 × 0.4167) / 2 = (500 - 450) / 2 = 25
```

| Giá trị gốc (API) | Kết quả (Fit) |
|--------------------|---------------|
| positionX = 960 | displayX = 960 × 0.4167 + 0 = **400** |
| positionY = 540 | displayY = 540 × 0.4167 + 25 = **250** |
| radius = 50 | displayRadius = 50 × 0.4167 = **20.83** |

### Code mẫu (C# — Fit mode)

```csharp
double scale = Math.Min(
    (double)pictureBox.Width  / imageWidth,
    (double)pictureBox.Height / imageHeight);
double offsetX = (pictureBox.Width  - imageWidth  * scale) / 2;
double offsetY = (pictureBox.Height - imageHeight * scale) / 2;

int drawX = (int)(positionX * scale + offsetX);
int drawY = (int)(positionY * scale + offsetY);
int drawR = (int)(radius * scale);

g.DrawEllipse(pen, drawX - drawR, drawY - drawR, drawR * 2, drawR * 2);
```

### Code mẫu (JavaScript / Canvas — Fit mode)

```javascript
const scale = Math.min(
    canvas.width  / imageWidth,
    canvas.height / imageHeight);
const offsetX = (canvas.width  - imageWidth  * scale) / 2;
const offsetY = (canvas.height - imageHeight * scale) / 2;

const drawX = positionX * scale + offsetX;
const drawY = positionY * scale + offsetY;
const drawR = radius * scale;

ctx.beginPath();
ctx.arc(drawX, drawY, drawR, 0, Math.PI * 2);
ctx.stroke();
```

> **Lưu ý:** API còn trả về `normalizedX`, `normalizedY`, `normalizedRadius` (giá trị 0.0–1.0). Với **Stretch**: `displayX = normalizedX × canvasWidth`. Với **Fit/Fill/Center**: vẫn cần tính offset nên dùng `positionX` + `imageWidth` sẽ chính xác hơn.

---

## A. Station APIs

> **Auth**: Master Key (`x-master-key`) hoặc Bearer Token

### A1. Danh sách Stations

```
GET /api/external/stations
```

Lấy toàn bộ danh sách trạm kiểm tra.

**Headers:**

```
x-master-key: YOUR_MASTER_KEY
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "ST001",
      "name": "Station 1",
      "description": "Trạm kiểm tra AOI Line 1",
      "location": "Building A, Floor 2",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-10T12:00:00Z"
    },
    {
      "id": 2,
      "code": "ST002",
      "name": "Station 2",
      "description": "Trạm kiểm tra AOI Line 2",
      "location": "Building A, Floor 2",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T08:00:00Z"
    }
  ]
}
```

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations"
```

---

### A2. Chi tiết Station

```
GET /api/external/stations/:id
```

Lấy thông tin chi tiết một station.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "code": "ST001",
    "name": "Station 1",
    "description": "Trạm kiểm tra AOI Line 1",
    "location": "Building A, Floor 2",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-10T12:00:00Z"
  }
}
```

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1"
```

---

### A3. Inspection Points theo Station

```
GET /api/external/stations/:id/inspection-points?productModelId={number}
```

Lấy danh sách tất cả điểm kiểm tra (measurement point definitions) của một station.
Hỗ trợ lọc theo sản phẩm cụ thể qua `productModelId`.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `productModelId` | number | ❌ | Lọc theo sản phẩm cụ thể (product model ID). Nếu không truyền sẽ trả tất cả sản phẩm. |

**Response:**

```json
{
  "success": true,
  "total": 15,
  "data": [
    {
      "id": 42,
      "code": "P042",
      "name": "Component Height",
      "description": "Đo chiều cao linh kiện",
      "measurementType": "MEASUREMENT",
      "unit": "mm",
      "lowerLimit": 4.5,
      "upperLimit": 5.5,
      "nominalValue": 5.0,
      "positionX": 500,
      "positionY": 300,
      "radius": 25,
      "normalizedX": 0.26041667,
      "normalizedY": 0.27777778,
      "normalizedRadius": 0.01302083,
      "productModelId": 10,
      "imageWidth": 1920,
      "imageHeight": 1080,
      "imageDisplayMode": "contain",
      "cropWidth": 100,
      "cropHeight": 100,
      "referenceImageUrl": "/uploads/...",
      "workstationId": 3,
      "machineId": 1,
      "machineCode": "M001",
      "machineName": "Machine 1"
    }
  ]
}
```

> **Kích thước ảnh gốc:** Mỗi điểm đo trả về `imageWidth`, `imageHeight` — kích thước pixel gốc của ảnh tham chiếu sản phẩm. Dùng để tính scale factor khi hiển thị trên canvas khác kích thước (xem [Hướng dẫn quy đổi tọa độ](#hướng-dẫn-quy-đổi-tọa-độ-điểm-đo-coordinate-scaling-guide)).
>
> **Normalized Coordinates:** `normalizedX`, `normalizedY`, `normalizedRadius` là tọa độ chuẩn hóa trong khoảng [0.0, 1.0], được tính từ pixel position chia cho kích thước ảnh gốc (`normalizedX = positionX / imageWidth`, `normalizedY = positionY / imageHeight`, `normalizedRadius = radius / imageWidth`). Sử dụng normalized coordinates để vẽ điểm đo chính xác trên ảnh bất kể kích thước hiển thị.

**cURL:**

```bash
# Tất cả điểm đo
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/inspection-points"

# Lọc theo sản phẩm cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/inspection-points?productModelId=10"
```

---

### A4. Ảnh tham chiếu Station

```
GET /api/external/stations/:id/reference-image
```

Lấy ảnh tham chiếu (reference image) của station thông qua sản phẩm đang gán cho máy.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Response:**

```json
{
  "success": true,
  "data": {
    "stationId": 1,
    "referenceImage": {
      "imageUrl": "data:image/png;base64,...",
      "width": 1920,
      "height": 1080
    }
  }
}
```

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/reference-image"
```

---

### A5. Resolve Station từ MQTT Topic

```
GET /api/external/stations/resolve-topic?topic={mqttTopic}
```

Phân giải chuỗi MQTT topic thành thông tin station kèm đầy đủ phân cấp (factory → workshop → line → station).
App bên thứ 3 subscribe MQTT topic dạng `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}` và cần biết topic đó thuộc station nào.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | string | ✅ | Chuỗi MQTT topic, ví dụ: `avi/1/workshop/2/station/3/errors` |

**Response:**

```json
{
  "success": true,
  "data": {
    "station": {
      "id": 3,
      "code": "ST003",
      "name": "Station AOI Line 1",
      "description": "Trạm kiểm tra tự động"
    },
    "line": {
      "id": 5,
      "code": "L001",
      "name": "Production Line 1"
    },
    "workshop": {
      "id": 2,
      "code": "WS001",
      "name": "Workshop SMT"
    },
    "factory": {
      "id": 1,
      "code": "F001",
      "name": "Factory Bắc Ninh"
    },
    "mqttTopic": "avi/1/workshop/2/station/3/errors",
    "messageType": "errors"
  }
}
```

**Lỗi trả về:**

| Status | Mô tả |
|--------|--------|
| 400 | Thiếu `topic` hoặc sai format MQTT topic |
| 400 | Hierarchy mismatch (factoryId/workshopId trong topic không khớp DB) |
| 404 | Station không tồn tại |

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/resolve-topic?topic=avi/1/workshop/2/station/3/errors"
```

---

### A6. Sản phẩm theo Station

```
GET /api/external/stations/:id/products
```

Lấy danh sách sản phẩm (product models) đang được gán cho station thông qua các máy (machines) của station đó.
Quan hệ: Station → Machines → ProductMachineMappings → ProductModels.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Response:**

```json
{
  "success": true,
  "data": {
    "station": {
      "id": 1,
      "code": "ST001",
      "name": "Station 1"
    },
    "products": [
      {
        "id": 10,
        "code": "PRD-001",
        "name": "PCB Model A",
        "description": "Main PCB board",
        "category": "PCB",
        "lifecycleStatus": "active",
        "hasReferenceImage": true,
        "imageWidth": 1920,
        "imageHeight": 1080,
        "imageDisplayMode": "contain",
        "targetYieldRate": 99.5,
        "minYieldRate": 98.0,
        "machines": [
          {
            "id": 1,
            "code": "M001",
            "name": "AOI Machine 1",
            "priority": 1
          }
        ]
      }
    ],
    "total": 1
  }
}
```

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/products"
```

---

### A7. Thống kê KPI Station (Statistics)

```
GET /api/external/stations/:id/statistics?startDate={ISO}&endDate={ISO}&productModelId={number}
```

Lấy thống kê tổng hợp KPI cho station: FPY (First Pass Yield), Final Yield, Retest Rate, và thay đổi yield so với kỳ trước.
Tương đương chức năng "Station Summary" trong trang Station Analysis nội bộ.
Hỗ trợ lọc theo sản phẩm cụ thể qua `productModelId`.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startDate` | string | ✅ | Ngày bắt đầu (ISO 8601), ví dụ: `2024-01-01T00:00:00Z` |
| `endDate` | string | ✅ | Ngày kết thúc (ISO 8601), ví dụ: `2024-01-31T23:59:59Z` |
| `productModelId` | number | ❌ | Lọc theo sản phẩm cụ thể (product model ID). Nếu không truyền sẽ trả thống kê tất cả sản phẩm. |

**Response:**

```json
{
  "success": true,
  "data": {
    "station": { "id": 1, "code": "ST001", "name": "Station 1" },
    "factory": { "id": 1, "code": "F001", "name": "Factory BN" },
    "workshop": { "id": 2, "code": "WS001", "name": "Workshop SMT" },
    "line": { "id": 5, "code": "L001", "name": "Line 1" },
    "dateRange": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z"
    },
    "machineCount": 3,
    "totalInspections": 15000,
    "okCount": 14500,
    "ngCount": 350,
    "ntfCount": 150,
    "firstPassYield": 96.67,
    "finalYield": 97.67,
    "retestRate": 1.0,
    "yieldChange": 2.15
  }
}
```

**Giải thích các chỉ số:**

| Chỉ số | Công thức | Mô tả |
|--------|-----------|--------|
| `firstPassYield` | `OK / Total * 100` | Tỉ lệ đạt lần đầu (FPY) |
| `finalYield` | `(OK + NTF) / Total * 100` | Tỉ lệ đạt cuối cùng |
| `retestRate` | `NTF / Total * 100` | Tỉ lệ kiểm tra lại |
| `yieldChange` | `FPY(hiện tại) - FPY(kỳ trước)` | Thay đổi FPY so với kỳ trước (cùng độ dài) |

**cURL:**

```bash
# Thống kê tất cả sản phẩm
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/statistics?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z"

# Lọc theo sản phẩm cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/statistics?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z&productModelId=10"
```

---

### A8. Thống kê theo điểm đo (Measurement Stats)

```
GET /api/external/stations/:id/measurement-stats?startDate={ISO}&endDate={ISO}&groupBy={none|hour|day|week}&productModelId={number}
```

Lấy thống kê chi tiết cho TẤT CẢ các điểm đo (measurement points) của một station: OK/NG/NTF counts, tỉ lệ lỗi, giá trị trung bình/min/max.
Hỗ trợ nhóm theo thời gian (hour/day/week) để xem xu hướng từng điểm đo.
Mỗi điểm đo đều kèm thông tin sản phẩm (`productModelId`, `productCode`, `productName`) để phân biệt khi nhiều sản phẩm có điểm đo trùng code.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `startDate` | string | ✅ | — | Ngày bắt đầu (ISO 8601) |
| `endDate` | string | ✅ | — | Ngày kết thúc (ISO 8601) |
| `groupBy` | string | ❌ | `none` | Nhóm theo thời gian: `none` (tổng hợp), `hour`, `day`, `week` |
| `productModelId` | number | ❌ | — | Lọc theo sản phẩm cụ thể (product model ID). Nếu không truyền sẽ trả tất cả sản phẩm. |

**Response (groupBy=none):**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "2024-01-01...", "endDate": "2024-01-31..." },
    "station": { "id": 1, "code": "ST001", "name": "Station 1" },
    "points": [
      {
        "pointDefId": 5,
        "pointCode": "MP005",
        "pointName": "Solder Joint Check",
        "measurementType": "VISUAL",
        "workstationId": 3,
        "productModelId": 10,
        "productCode": "PCB-A100",
        "productName": "Main Board A100",
        "totalChecks": 5000,
        "okCount": 4800,
        "ngCount": 180,
        "ntfCount": 20,
        "ngRate": 3.60,
        "avgValue": 0.125,
        "minValue": 0.001,
        "maxValue": 0.998,
        "ngImageCount": 150
      }
    ]
  }
}
```

**Response (groupBy=day):**

```json
{
  "success": true,
  "data": {
    "groupBy": "day",
    "dateRange": { "startDate": "...", "endDate": "..." },
    "station": { "id": 1, "code": "ST001", "name": "Station 1" },
    "points": [
      {
        "pointDefId": 5,
        "pointCode": "MP005",
        "pointName": "Solder Joint Check",
        "measurementType": "VISUAL",
        "workstationId": 3,
        "productModelId": 10,
        "productCode": "PCB-A100",
        "productName": "Main Board A100",
        "trend": [
          {
            "period": "2024-01-01T00:00:00.000Z",
            "totalChecks": 200,
            "okCount": 190,
            "ngCount": 10,
            "ngRate": 5.00,
            "avgValue": 0.130
          }
        ]
      }
    ]
  }
}
```

**cURL:**

```bash
# Tổng hợp tất cả điểm đo
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/measurement-stats?startDate=2024-01-01&endDate=2024-01-31"

# Lọc theo sản phẩm cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/measurement-stats?startDate=2024-01-01&endDate=2024-01-31&productModelId=10"

# Xu hướng theo ngày
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/measurement-stats?startDate=2024-01-01&endDate=2024-01-31&groupBy=day"
```

---

### A9. Lịch sử lỗi NG (Fail History)

```
GET /api/external/stations/:id/fail-history?startDate={ISO}&endDate={ISO}&limit=50&offset=0&productModelId={number}
```

Lấy danh sách các lần kiểm tra NG gần đây của station, kèm chi tiết các điểm đo bị lỗi (point code, tên, giá trị đo, ảnh lỗi).
Tương đương chức năng "Fail History" trong trang Station Analysis nội bộ.
Hỗ trợ lọc theo sản phẩm cụ thể qua `productModelId`.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Station ID |

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `startDate` | string | ✅ | — | Ngày bắt đầu (ISO 8601) |
| `endDate` | string | ✅ | — | Ngày kết thúc (ISO 8601) |
| `limit` | number | ❌ | 50 | Số lượng kết quả tối đa (1-200) |
| `offset` | number | ❌ | 0 | Bỏ qua bao nhiêu kết quả (phân trang) |
| `productModelId` | number | ❌ | — | Lọc theo sản phẩm cụ thể (product model ID). Nếu không truyền sẽ trả tất cả sản phẩm. |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z"
    },
    "pagination": {
      "total": 120,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    },
    "inspections": [
      {
        "inspectionId": 12345,
        "serialNumber": "PCB20240101001",
        "inspectionTime": "2024-01-15T10:30:00.000Z",
        "machineId": 5,
        "machineCode": "M001",
        "machineName": "AOI Machine 1",
        "productModelId": 10,
        "imageWidth": 1920,
        "imageHeight": 1080,
        "imageDisplayMode": "contain",
        "failedPoints": [
          {
            "pointDefId": 8,
            "pointCode": "MP008",
            "pointName": "IC Pin Alignment",
            "workstationId": 3,
            "measuredValue": "0.85",
            "imageUrl": "/uploads/inspections/12345_mp008.jpg",
            "positionX": 500,
            "positionY": 300,
            "radius": 25,
            "normalizedX": 0.26041667,
            "normalizedY": 0.27777778,
            "normalizedRadius": 0.01302083
          },
          {
            "pointDefId": 12,
            "pointCode": "MP012",
            "pointName": "Solder Bridge",
            "workstationId": 5,
            "measuredValue": "FAIL",
            "imageUrl": "/uploads/inspections/12345_mp012.jpg",
            "positionX": 800,
            "positionY": 600,
            "radius": 30,
            "normalizedX": 0.41666667,
            "normalizedY": 0.55555556,
            "normalizedRadius": 0.015625
          }
        ]
      }
    ]
  }
}
```

**cURL:**

```bash
# Lấy 50 lỗi NG gần nhất trong tháng 1/2024
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/fail-history?startDate=2024-01-01&endDate=2024-01-31&limit=50"

# Lọc theo sản phẩm cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/fail-history?startDate=2024-01-01&endDate=2024-01-31&limit=50&productModelId=10"

# Phân trang — lấy trang 2
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/fail-history?startDate=2024-01-01&endDate=2024-01-31&limit=50&offset=50"
```

---

### A10. Chi tiết điểm đo + Ảnh lỗi (Point Detail)

```
GET /api/external/stations/:id/point-detail?startDate={ISO}&endDate={ISO}
```

Lấy **toàn bộ thông tin chi tiết** cho từng điểm đo bao gồm: thống kê (tổng kiểm tra, NG, NTF, tỷ lệ lỗi, tỷ lệ NTF), trạng thái, giới hạn đo, vị trí trên board, và **ảnh lỗi NG gần nhất** cho mỗi điểm — tương đương tab "Station Detail" trong StationAnalysis.

**Đây là endpoint kết hợp dữ liệu của A8 (measurement-stats) + ảnh lỗi (error images) theo từng điểm đo, hỗ trợ lọc theo sản phẩm.**

#### Path Parameters

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `id` | number | ID station |

#### Query Parameters

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `startDate` | string (ISO 8601) | ✅ | Ngày bắt đầu |
| `endDate` | string (ISO 8601) | ✅ | Ngày kết thúc |
| `productModelId` | number | ❌ | Lọc theo ID sản phẩm |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm (thay thế productModelId) |
| `pointDefId` | number | ❌ | Lọc 1 điểm đo cụ thể (nếu bỏ trống → tất cả) |
| `imageLimit` | number | ❌ | Số ảnh lỗi tối đa mỗi điểm (mặc định: 10, tối đa: 50) |

#### Response

```json
{
  "success": true,
  "data": {
    "dateRange": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z"
    },
    "station": {
      "id": 1,
      "code": "ST001",
      "name": "Station Line 1"
    },
    "productImage": {
      "url": "/uploads/products/board-ref.png",
      "width": 1920,
      "height": 1080
    },
    "boardInfo": {
      "model": "Main Board v2",
      "code": "MB-V2"
    },
    "points": [
      {
        "id": 5,
        "code": "MP005",
        "name": "Solder Joint R12",
        "type": "VISUAL",
        "workstationId": 3,
        "positionX": 120,
        "positionY": 300,
        "radius": 15,
        "normalizedX": 0.0625,
        "normalizedY": 0.27777778,
        "normalizedRadius": 0.0078125,
        "cropWidth": 100,
        "cropHeight": 100,
        "status": "fail",
        "defectRate": 3.60,
        "totalInspected": 5000,
        "ngCount": 180,
        "ntfCount": 12,
        "ntfRate": 0.24,
        "lowerLimit": null,
        "upperLimit": null,
        "nominalValue": null,
        "unit": null,
        "lastValue": "0.85",
        "lastResult": "NG",
        "errorImages": [
          {
            "id": 1234,
            "imageUrl": "/uploads/inspections/2024-01/img_001.jpg",
            "measuredValue": "0.85",
            "result": "NG",
            "inspectionTime": "2024-01-15T10:30:00.000Z",
            "serialNumber": "SN20240115001"
          },
          {
            "id": 1230,
            "imageUrl": "/uploads/inspections/2024-01/img_002.jpg",
            "measuredValue": "0.92",
            "result": "NG",
            "inspectionTime": "2024-01-14T09:15:00.000Z",
            "serialNumber": "SN20240114003"
          }
        ]
      },
      {
        "id": 8,
        "code": "MP008",
        "name": "Component C5",
        "type": "DIMENSION",
        "workstationId": 7,
        "positionX": 450,
        "positionY": 200,
        "radius": 10,
        "normalizedX": 0.234375,
        "normalizedY": 0.18518519,
        "normalizedRadius": 0.00520833,
        "cropWidth": 80,
        "cropHeight": 80,
        "status": "pass",
        "defectRate": 0.12,
        "totalInspected": 5000,
        "ngCount": 6,
        "ntfCount": 2,
        "ntfRate": 0.04,
        "lowerLimit": 1.2,
        "upperLimit": 1.8,
        "nominalValue": 1.5,
        "unit": "mm",
        "lastValue": "1.52",
        "lastResult": "OK",
        "errorImages": []
      }
    ]
  }
}
```

#### Trường `status` cho mỗi điểm

| Giá trị | Điều kiện |
|---------|-----------|
| `"fail"` | Tỷ lệ lỗi ≥ 2% |
| `"warn"` | Tỷ lệ lỗi ≥ 0.5% và < 2% |
| `"pass"` | Tỷ lệ lỗi < 0.5% |

#### Trường NTF (No Trouble Found)

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `ntfCount` | number | Số lần đo được xác nhận là NTF (báo lỗi nhầm / false call) |
| `ntfRate` | number | Tỷ lệ NTF (%) = ntfCount / totalInspected × 100, làm tròn 2 chữ số |

#### Các trường trong `errorImages[]`

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `id` | number | ID measurement result |
| `imageUrl` | string | URL ảnh thực tế tại điểm đo lỗi |
| `measuredValue` | string | Giá trị đo được |
| `result` | string | Kết quả ("NG") |
| `inspectionTime` | string (ISO 8601) | Thời điểm kiểm tra |
| `serialNumber` | string | Serial number sản phẩm |

#### Ghi chú

- Nếu không truyền `productModelId` hoặc `productCode`, hệ thống tự chọn sản phẩm được kiểm tra nhiều nhất trong khoảng thời gian.
- `productImage` và `boardInfo` trả về ảnh tham chiếu + thông tin board của sản phẩm chính (primary product model).
- `errorImages` được sắp xếp theo thời gian giảm dần (mới nhất trước).
- Có thể tải ảnh qua URL: `GET {server}{imageUrl}` với cùng Master Key header.

#### cURL

```bash
# Lấy chi tiết tất cả điểm đo + ảnh lỗi (default 10 ảnh/điểm)
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/point-detail?startDate=2024-01-01&endDate=2024-01-31"

# Lọc theo sản phẩm + tăng giới hạn ảnh
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/point-detail?startDate=2024-01-01&endDate=2024-01-31&productCode=MB-V2&imageLimit=20"

# Lấy chi tiết 1 điểm đo cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/point-detail?startDate=2024-01-01&endDate=2024-01-31&pointDefId=5&imageLimit=50"
```

---

### A11. Workstation APIs

API lấy thông tin công trạm (workstation) để các ứng dụng bên thứ 3 cấu hình cài đặt workstation cho điểm đo.

#### A11a. Danh sách Workstations

```
GET /api/external/workstations
```

Lấy danh sách tất cả workstations đang hoạt động (`isActive = true`). Hỗ trợ lọc theo nhà máy, xưởng, dây chuyền.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `factoryId` | number | ❌ | — | Lọc theo nhà máy |
| `workshopId` | number | ❌ | — | Lọc theo xưởng |
| `lineId` | number | ❌ | — | Lọc theo dây chuyền |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "code": "WS-A01",
      "name": "Workstation A01",
      "description": "Công trạm hàn SMT Line 1",
      "processType": "SMT",
      "orderIndex": 1,
      "lineId": 1,
      "workshopId": 2,
      "factoryId": 1,
      "factoryName": "Factory HN",
      "workshopName": "Workshop SMT",
      "lineName": "Line 1"
    }
  ]
}
```

**cURL:**

```bash
# Lấy tất cả workstations
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/workstations"

# Lọc theo dây chuyền
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/workstations?lineId=1"
```

#### A11b. Chi tiết Workstation

```
GET /api/external/workstations/:id
```

Lấy thông tin chi tiết một workstation theo ID.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Workstation ID |

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 3,
    "code": "WS-A01",
    "name": "Workstation A01",
    "description": "Công trạm hàn SMT Line 1",
    "processType": "SMT",
    "orderIndex": 1,
    "isActive": true,
    "lineId": 1,
    "workshopId": 2,
    "factoryId": 1,
    "factoryName": "Factory HN",
    "workshopName": "Workshop SMT",
    "lineName": "Line 1"
  }
}
```

**cURL:**

```bash
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/workstations/3"
```

---

## B. Public Product APIs

> **Auth**: Master Key (`x-master-key`), Machine API Key (`x-api-key`), hoặc Machine Code (`x-machine-code`)
>
> Hỗ trợ cả 3 phương thức xác thực. Dùng `x-master-key` là đơn giản nhất.

### B1. Danh sách sản phẩm

```
GET /api/public/products
```

Lấy danh sách sản phẩm có hỗ trợ tìm kiếm và phân trang.

**Headers (chọn 1 trong 2):**

```
x-api-key: MACHINE_API_KEY
```
hoặc
```
x-machine-code: M001
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `search` | string | ❌ | Tìm kiếm theo tên hoặc mã sản phẩm |
| `lifecycleStatus` | string | ❌ | `development` \| `active` \| `eol` \| `archived` |
| `limit` | number | ❌ | Số sản phẩm trả về (default: 50, max: 100) |
| `offset` | number | ❌ | Offset phân trang (default: 0) |

**Response:**

```json
{
  "success": true,
  "total": 12,
  "data": [
    {
      "id": 5,
      "code": "PRD001",
      "name": "Product A",
      "description": "PCB Board Model A",
      "category": "PCB",
      "productLine": "Line A",
      "variant": "v1",
      "lifecycleStatus": "active",
      "referenceImageUrl": "/uploads/products/...",
      "imageWidth": 1920,
      "imageHeight": 1080,
      "imageDisplayMode": "contain",
      "targetYieldRate": 95.0,
      "minYieldRate": 90.0
    }
  ]
}
```

**cURL:**

```bash
# Sử dụng Master Key (đơn giản nhất)
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/public/products"

# Hoặc sử dụng Machine API Key
curl -H "x-api-key: MACHINE_API_KEY" \
  "https://your-server/api/public/products"

# Hoặc sử dụng Machine Code
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products"

# Tìm kiếm sản phẩm
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products?search=PCB&lifecycleStatus=active&limit=10"

# Hoặc dùng query param
curl "https://your-server/api/public/products?machineCode=M001&search=PCB"
```

**C# HttpClient:**

```csharp
using var client = new HttpClient();
// Cách 1: Master Key (đơn giản nhất)
client.DefaultRequestHeaders.Add("x-master-key", "YOUR_MASTER_KEY");
// Cách 2: Machine API Key
// client.DefaultRequestHeaders.Add("x-api-key", "MACHINE_API_KEY");
// Cách 3: Machine Code
// client.DefaultRequestHeaders.Add("x-machine-code", "M001");

var response = await client.GetAsync("https://your-server/api/public/products?lifecycleStatus=active");
var json = await response.Content.ReadAsStringAsync();
Console.WriteLine(json);
```

**Python:**

```python
import requests

# Cách 1: Master Key (đơn giản nhất)
headers = {"x-master-key": "YOUR_MASTER_KEY"}
# Cách 2: Machine API Key
# headers = {"x-api-key": "MACHINE_API_KEY"}
# Cách 3: Machine Code
# headers = {"x-machine-code": "M001"}

resp = requests.get(
    "https://your-server/api/public/products",
    headers=headers,
    params={"lifecycleStatus": "active", "limit": 20},
)
print(resp.json())
```

---

### B2. Chi tiết sản phẩm theo Code

```
GET /api/public/products/by-code/:code
```

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Mã sản phẩm (ví dụ: `PRD001`) |

**Response:**

```json
{
  "success": true,
  "data": {
    "product": {
      "id": 5,
      "code": "PRD001",
      "name": "Product A",
      "description": "PCB Board Model A",
      "category": "PCB",
      "productLine": "Line A",
      "variant": "v1",
      "lifecycleStatus": "active",
      "referenceImageUrl": "/uploads/products/...",
      "imageWidth": 1920,
      "imageHeight": 1080,
      "imageDisplayMode": "contain",
      "targetYieldRate": 95.0,
      "minYieldRate": 90.0
    },
    "measurementPoints": [
      {
        "id": 42,
        "code": "P042",
        "name": "Component Height",
        "description": "Đo chiều cao linh kiện",
        "measurementType": "MEASUREMENT",
        "unit": "mm",
        "lowerLimit": 4.5,
        "upperLimit": 5.5,
        "nominalValue": 5.0,
        "positionX": 100,
        "positionY": 200,
        "radius": 15,
        "normalizedX": 0.052,
        "normalizedY": 0.185,
        "normalizedRadius": 0.008,
        "referenceImageUrl": "/uploads/...",
        "cropWidth": 200,
        "cropHeight": 200,
        "orderIndex": 1
      }
    ]
  }
}
```

**cURL:**

```bash
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products/by-code/PRD001"
```

---

### B3. Chi tiết sản phẩm theo ID

```
GET /api/public/products/by-id/:id
```

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Product model ID |

**cURL:**

```bash
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products/by-id/5"
```

Response giống B2.

---

### B4. Danh sách điểm đo theo sản phẩm

```
GET /api/public/products/:productCode/measurement-points
```

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `productCode` | string | Mã sản phẩm |

**Response:**

```json
{
  "success": true,
  "imageWidth": 1920,
  "imageHeight": 1080,
  "imageDisplayMode": "contain",
  "data": [
    {
      "id": 42,
      "code": "P042",
      "name": "Component Height",
      "measurementType": "MEASUREMENT",
      "unit": "mm",
      "lowerLimit": 4.5,
      "upperLimit": 5.5,
      "nominalValue": 5.0,
      "positionX": 100,
      "positionY": 200,
      "orderIndex": 1
    }
  ]
}
```

**cURL:**

```bash
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products/PRD001/measurement-points"
```

---

### B5. Ảnh sản phẩm

```
GET /api/public/products/:productCode/image
```

Lấy ảnh tham chiếu (reference image) của sản phẩm.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `productCode` | string | Mã sản phẩm |

**cURL:**

```bash
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products/PRD001/image"
```

---

### B6. Ảnh điểm đo

```
GET /api/public/measurement-points/:pointId/image
```

Lấy ảnh tham chiếu (cropped) của một điểm đo cụ thể.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `pointId` | number | Measurement point definition ID |

**cURL:**

```bash
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/measurement-points/42/image"
```

---

## C. Inspection APIs

> **Auth**: Master Key (`x-master-key`) hoặc Bearer Token

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
        "imageDisplayMode": "contain",
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
      "imageDisplayMode": "contain",
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

## D. Advanced Analytical APIs (SPC / AI)

Tất cả endpoint trong nhóm D đều yêu cầu `x-master-key` auth và chia sẻ các query parameters chung:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `stationId` | number | ✅ | ID station cần phân tích |
| `productModelId` | number | ❌ | Lọc theo product model ID |
| `productCode` | string | ❌ | Lọc theo mã sản phẩm (thay cho productModelId) |
| `startDate` | ISO 8601 | ✅ | Ngày bắt đầu |
| `endDate` | ISO 8601 | ✅ | Ngày kết thúc |

---

### D1. Control Chart (SPC)

```
GET /api/external/inspections/control-chart
```

Biểu đồ kiểm soát X-bar với Western Electric 8 rules, chỉ số năng lực quy trình (Cpk/Ppk).

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "statistics": {
      "mean": 96.52,
      "stddev": 2.15,
      "ucl": 102.97,
      "lcl": 90.07,
      "cpk": 1.28,
      "ppk": 1.28,
      "mrMean": 1.85,
      "n": 30
    },
    "points": [
      {
        "day": "2024-01-01T00:00:00.000Z",
        "yield": 97.5,
        "total": 200,
        "ok": 195,
        "ng": 5,
        "zone": "C",
        "movingRange": 0,
        "outOfControl": false,
        "violatedRules": [],
        "ruleDescriptions": []
      }
    ],
    "ruleViolations": [
      {
        "ruleNumber": 1,
        "description": "Point beyond 3σ limit",
        "count": 2
      }
    ]
  }
}
```

**Western Electric Rules (8 rules):**

| Rule | Mô tả |
|------|--------|
| 1 | Point beyond 3σ limit |
| 2 | 9 consecutive points on same side of center |
| 3 | 6 consecutive points trending in one direction |
| 4 | 14 consecutive alternating points |
| 5 | 2 of 3 points in Zone A or beyond |
| 6 | 4 of 5 points in Zone B or beyond |
| 7 | 15 consecutive points within 1σ (stratification) |
| 8 | 8 consecutive points beyond 1σ (mixture) |

**Zone Classification:** A+ (>2σ), A- (<-2σ), B+ (>1σ), B- (<-1σ), C (within 1σ), above (>3σ), below (<-3σ)

---

### D2. Histogram

```
GET /api/external/inspections/histogram
```

Phân phối yield dạng histogram với thống kê nâng cao.

**Additional Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `bins` | number | ❌ | Số bins (mặc định: 20, phạm vi: 5-50) |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "bins": [
      {
        "binStart": 88.50,
        "binEnd": 91.00,
        "count": 3,
        "frequency": 10.00
      }
    ],
    "statistics": {
      "n": 30,
      "mean": 96.52,
      "median": 97.00,
      "mode": 97.50,
      "stddev": 2.15,
      "skewness": -0.325,
      "kurtosis": 0.182,
      "min": 88.50,
      "max": 100.00
    },
    "normalDistribution": [
      { "x": 89.75, "pdf": 0.0125 }
    ]
  }
}
```

---

### D3. Stratification

```
GET /api/external/inspections/stratification
```

Phân tầng dữ liệu theo máy, ca làm việc, hoặc ngày trong tuần.

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "byMachine": [
      {
        "machineId": 1,
        "machineCode": "M001",
        "machineName": "Machine 1",
        "total": 500,
        "ok": 480,
        "ng": 15,
        "ntf": 5,
        "yield": 96.00
      }
    ],
    "byShift": [
      {
        "shift": "Morning",
        "hours": "06:00-14:00",
        "total": 350,
        "ok": 340,
        "ng": 8,
        "ntf": 2,
        "yield": 97.14
      },
      {
        "shift": "Afternoon",
        "hours": "14:00-22:00",
        "total": 300,
        "ok": 285,
        "ng": 12,
        "ntf": 3,
        "yield": 95.00
      },
      {
        "shift": "Night",
        "hours": "22:00-06:00",
        "total": 150,
        "ok": 140,
        "ng": 8,
        "ntf": 2,
        "yield": 93.33
      }
    ],
    "byDayOfWeek": [
      {
        "dayOfWeek": 1,
        "dayName": "Monday",
        "total": 120,
        "ok": 115,
        "ng": 4,
        "ntf": 1,
        "yield": 95.83
      }
    ]
  }
}
```

---

### D4. Fail History (Chi tiết)

```
GET /api/external/inspections/fail-history
```

Lịch sử kiểm tra NG chi tiết kèm danh sách các điểm đo lỗi.

**Additional Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | number | ❌ | Số kết quả (mặc định: 50, tối đa: 200) |

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "totalFails": 25,
    "failHistory": [
      {
        "inspectionId": 1001,
        "serialNumber": "PCB20240115001",
        "overallResult": "NG",
        "inspectionTime": "2024-01-15T10:30:00Z",
        "cycleTime": 12.5,
        "machineCode": "M001",
        "machineName": "Machine 1",
        "productCode": "PRD001",
        "productName": "Product A",
        "failedPoints": [
          {
            "pointDefId": 42,
            "pointCode": "P042",
            "pointName": "Component Height",
            "productModelId": 5,
            "productCode": "PRD001",
            "productName": "Product A",
            "measuredValue": "5.85",
            "measuredValueText": null,
            "result": "NG",
            "lowerLimit": 4.5,
            "upperLimit": 5.5,
            "nominalValue": 5.0,
            "unit": "mm",
            "hasImage": true
          }
        ]
      }
    ]
  }
}
```

---

### D5. Diagnostics (AI)

```
GET /api/external/inspections/diagnostics
```

Chẩn đoán thông minh — cảnh báo tự động, phát hiện mẫu (pattern), đề xuất cải thiện.

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "overallStats": {
      "total": 1000,
      "ok": 960,
      "ng": 30,
      "ntf": 10,
      "fpy": 96.00,
      "retestRate": 1.00
    },
    "alerts": [
      {
        "level": "warning",
        "title": "Below Target Yield",
        "description": "FPY is 96.0% — below the 95% target."
      }
    ],
    "patterns": [
      {
        "name": "Shift Variation",
        "description": "NG rate varies 12.5% between hours 3 and 10",
        "confidence": 0.75
      },
      {
        "name": "Dominant Defect",
        "description": "\"[PRD001] Component Height\" accounts for 55% of all NG results",
        "confidence": 0.9
      }
    ],
    "recommendations": [
      {
        "priority": "medium",
        "action": "Focus on measurement point \"[PRD001] Component Height\"",
        "rationale": "This point has 18 NG occurrences — the highest contributor"
      }
    ],
    "topDefects": [
      {
        "pointCode": "P042",
        "pointName": "Component Height",
        "productModelId": 5,
        "productCode": "PRD001",
        "productName": "Product A",
        "count": 18
      }
    ],
    "dailyYieldTrend": [
      { "day": "2024-01-15T00:00:00.000Z", "yield": 97.5 }
    ]
  }
}
```

---

### D6. Scatter / Correlation

```
GET /api/external/inspections/scatter
```

Biểu đồ phân tán — tương quan giữa sản lượng theo giờ và tỷ lệ NG.

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "points": [
      {
        "period": "2024-01-15T10:00:00.000Z",
        "x": 45,
        "y": 2.22
      }
    ],
    "statistics": {
      "n": 120,
      "correlation": -0.352,
      "rSquared": 0.124,
      "trendLine": {
        "slope": -0.0234,
        "intercept": 4.56
      }
    },
    "xLabel": "Output Volume (inspections/hour)",
    "yLabel": "NG Rate (%)"
  }
}
```

---

### D7. Check Sheet

```
GET /api/external/inspections/check-sheet
```

Ma trận lỗi loại defect × ngày (Check Sheet truyền thống trong QC 7 tools).

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "periods": ["2024-01-15T00:00:00.000Z", "2024-01-16T00:00:00.000Z"],
    "defects": [
      {
        "pointDefId": 42,
        "pointCode": "P042",
        "pointName": "Component Height",
        "productModelId": 5,
        "productCode": "PRD001",
        "productName": "Product A",
        "byDay": [
          { "day": "2024-01-15T00:00:00.000Z", "count": 3 },
          { "day": "2024-01-16T00:00:00.000Z", "count": 1 }
        ],
        "total": 4
      }
    ],
    "totalByPeriod": [
      { "day": "2024-01-15T00:00:00.000Z", "count": 8 },
      { "day": "2024-01-16T00:00:00.000Z", "count": 5 }
    ],
    "grandTotal": 13
  }
}
```

---

### D8. Cause-Effect (Ishikawa 6M)

```
GET /api/external/inspections/cause-effect
```

Dữ liệu biểu đồ nhân quả (xương cá) theo mô hình 6M — dẫn xuất từ dữ liệu thực.

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "categories": [
      {
        "name": "Man",
        "label": "Operator / Shift",
        "causes": [
          {
            "cause": "Morning shift",
            "detail": "NG rate: 2.5% (5/200)",
            "severity": "low",
            "dataValue": 2.50
          },
          {
            "cause": "Night shift",
            "detail": "NG rate: 8.3% (10/120)",
            "severity": "medium",
            "dataValue": 8.30
          }
        ]
      },
      {
        "name": "Machine",
        "label": "Equipment",
        "causes": [
          {
            "cause": "M001 — Machine 1",
            "detail": "NG rate: 3.0% (15/500)",
            "severity": "low",
            "dataValue": 3.00
          }
        ]
      },
      {
        "name": "Material",
        "label": "Material / Components",
        "causes": [
          {
            "cause": "Incoming material quality",
            "detail": "Requires manual inspection data",
            "severity": "info",
            "dataValue": null
          }
        ]
      },
      {
        "name": "Method",
        "label": "Process / Procedure",
        "causes": [
          {
            "cause": "Standard operating procedure",
            "detail": "Requires process audit data",
            "severity": "info",
            "dataValue": null
          }
        ]
      },
      {
        "name": "Measurement",
        "label": "Inspection Points",
        "causes": [
          {
            "cause": "[PRD001] P042 — Component Height",
            "detail": "18 NG occurrences",
            "severity": "medium",
            "dataValue": 18
          }
        ]
      },
      {
        "name": "Environment",
        "label": "Working Conditions",
        "causes": [
          {
            "cause": "Temperature / Humidity",
            "detail": "Requires environmental sensor data",
            "severity": "info",
            "dataValue": null
          }
        ]
      }
    ]
  }
}
```

**Severity levels:** `low` (< 5% NG), `medium` (5-10% NG), `high` (> 10% NG), `info` (không có dữ liệu tự động)

---

### D9. AI Analysis

```
GET /api/external/inspections/ai-analysis
```

Phân tích AI nâng cao — phát hiện bất thường (anomaly), dự báo (forecast), phân cụm (clustering), năng lực quy trình (process capability).

**Response:**

```json
{
  "success": true,
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "anomalies": [
      {
        "day": "2024-01-18T00:00:00.000Z",
        "yield": 82.35,
        "zScore": -4.12,
        "isAnomaly": true,
        "type": "unusually_low"
      }
    ],
    "forecast": [
      {
        "day": "2024-02-01",
        "predicted": 96.50,
        "lower": 91.28,
        "upper": 100.00
      }
    ],
    "clusters": [
      {
        "id": 0,
        "label": "Low Performance",
        "centroid": 88.50,
        "count": 3,
        "days": ["2024-01-18T00:00:00.000Z"]
      },
      {
        "id": 1,
        "label": "Normal Performance",
        "centroid": 96.80,
        "count": 22,
        "days": ["2024-01-15T00:00:00.000Z"]
      },
      {
        "id": 2,
        "label": "High Performance",
        "centroid": 99.50,
        "count": 5,
        "days": ["2024-01-20T00:00:00.000Z"]
      }
    ],
    "insights": [
      {
        "type": "trend",
        "title": "Downward yield trend detected",
        "description": "Yield is declining at ~0.75% per day.",
        "confidence": 0.68,
        "severity": "warning"
      },
      {
        "type": "capability",
        "title": "Marginal process capability",
        "description": "Cpk = 1.15 — below 1.33 target.",
        "confidence": 0.9,
        "severity": "warning"
      }
    ],
    "processCapability": {
      "cp": 1.25,
      "cpk": 1.15,
      "ppm": 2350,
      "usl": 100,
      "lsl": 85,
      "mean": 96.52,
      "stddev": 2.00
    }
  }
}
```

**Anomaly Detection:** Modified Z-Score sử dụng MAD (Median Absolute Deviation), ngưỡng: |z| > 3.5

**Forecast:** Exponential Smoothing (α=0.3), dự báo 7 ngày tới kèm khoảng tin cậy 95%

**Clustering:** 3 nhóm — Low (< mean-1σ), Normal (mean±1σ), High (> mean+1σ)

**Insight types:** `trend`, `volatility`, `periodicity`, `anomaly`, `capability`

---

### D10. Yield Comparison

```
GET /api/external/inspections/yield-comparison
```

So sánh yield giữa kỳ hiện tại và kỳ trước (period-over-period). Kỳ trước tự động tính bằng khoảng thời gian tương đương trước `startDate`.

**Response:**

```json
{
  "success": true,
  "data": {
    "currentPeriod": {
      "startDate": "2024-01-15T00:00:00.000Z",
      "endDate": "2024-01-31T00:00:00.000Z",
      "total": 1000,
      "ok": 960,
      "ng": 30,
      "ntf": 10,
      "yield": 96.00,
      "avgCycleTime": 11.25
    },
    "previousPeriod": {
      "startDate": "2023-12-30T00:00:00.000Z",
      "endDate": "2024-01-15T00:00:00.000Z",
      "total": 950,
      "ok": 900,
      "ng": 40,
      "ntf": 10,
      "yield": 94.74,
      "avgCycleTime": 12.10
    },
    "changes": {
      "yieldChange": 1.26,
      "yieldChangeDirection": "improved",
      "volumeChange": 5.26,
      "ngChange": -25.00,
      "cycleTimeChange": -0.85
    }
  }
}
```

**Change Direction:** `improved` (yield tăng), `declined` (yield giảm), `unchanged` (không đổi)

---

## E. Statistics APIs

> **Auth**: Master Key (`x-master-key`) hoặc Bearer Token

### E1. Thống kê điểm đo theo sản phẩm (Measurement Point Stats)

```
GET /api/external/statistics/measurement-points?productModelId={number}&startDate={ISO}&endDate={ISO}&includeImages={boolean}
```

Lấy thống kê chi tiết cho **tất cả điểm đo** của một sản phẩm (product model): tổng kiểm tra, OK/NG count, tỷ lệ lỗi. Hỗ trợ trả về danh sách ảnh OK và NG cho từng điểm đo khi bật `includeImages=true`.

**Khác với A8 (Measurement Stats):** A8 lấy thống kê điểm đo theo **station**, còn E1 lấy theo **sản phẩm** (product model) — bao gồm dữ liệu từ tất cả stations/machines đang kiểm tra sản phẩm đó.

#### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `productModelId` | number | ⚡ | — | ID sản phẩm. Bắt buộc nếu không có `productCode` |
| `productCode` | string | ⚡ | — | Mã sản phẩm. Bắt buộc nếu không có `productModelId` |
| `startDate` | string | ✅ | — | Ngày bắt đầu (ISO 8601) |
| `endDate` | string | ✅ | — | Ngày kết thúc (ISO 8601) |
| `includeImages` | string | ❌ | `false` | `true` hoặc `1` — trả kèm danh sách ảnh OK/NG cho từng điểm đo |

> ⚡ Phải truyền **ít nhất một** trong `productModelId` hoặc `productCode`.

#### Response (includeImages=false)

```json
{
  "success": true,
  "data": {
    "productModel": {
      "id": 10,
      "code": "PCB-A100",
      "name": "Main Board A100"
    },
    "dateRange": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z"
    },
    "totalPoints": 15,
    "points": [
      {
        "pointDefId": 42,
        "pointCode": "P042",
        "pointName": "Component Height",
        "measurementType": "MEASUREMENT",
        "totalChecks": 5000,
        "okCount": 4850,
        "ngCount": 150,
        "ngRate": 3.00
      },
      {
        "pointDefId": 43,
        "pointCode": "P043",
        "pointName": "Solder Joint Check",
        "measurementType": "VISUAL",
        "totalChecks": 5000,
        "okCount": 4920,
        "ngCount": 80,
        "ngRate": 1.60
      }
    ]
  }
}
```

#### Response (includeImages=true)

Khi bật `includeImages=true`, mỗi điểm đo sẽ có thêm trường `images` chứa danh sách ảnh OK và NG:

```json
{
  "success": true,
  "data": {
    "productModel": {
      "id": 10,
      "code": "PCB-A100",
      "name": "Main Board A100"
    },
    "dateRange": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z"
    },
    "totalPoints": 15,
    "points": [
      {
        "pointDefId": 42,
        "pointCode": "P042",
        "pointName": "Component Height",
        "measurementType": "MEASUREMENT",
        "totalChecks": 5000,
        "okCount": 4850,
        "ngCount": 150,
        "ngRate": 3.00,
        "images": {
          "okImages": [
            {
              "measurementResultId": 1001,
              "imageUrl": "/uploads/inspections/2024-01/ok_001.jpg",
              "measuredValue": "5.02",
              "result": "OK",
              "inspectionTime": "2024-01-15T10:30:00.000Z",
              "serialNumber": "SN20240115001"
            }
          ],
          "ngImages": [
            {
              "measurementResultId": 1234,
              "imageUrl": "/uploads/inspections/2024-01/ng_001.jpg",
              "measuredValue": "5.85",
              "result": "NG",
              "inspectionTime": "2024-01-14T09:15:00.000Z",
              "serialNumber": "SN20240114003"
            }
          ]
        }
      }
    ]
  }
}
```

#### Các trường trong `images.okImages[]` / `images.ngImages[]`

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `measurementResultId` | number | ID kết quả đo |
| `imageUrl` | string | URL ảnh kiểm tra — tải qua `GET {server}{imageUrl}` với cùng auth header |
| `measuredValue` | string | Giá trị đo được |
| `result` | string | Kết quả: `"OK"` hoặc `"NG"` |
| `inspectionTime` | string (ISO 8601) | Thời điểm kiểm tra |
| `serialNumber` | string | Serial number sản phẩm |

#### cURL

```bash
# Thống kê điểm đo theo product model ID
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/statistics/measurement-points?productModelId=10&startDate=2024-01-01&endDate=2024-01-31"

# Thống kê theo product code
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/statistics/measurement-points?productCode=PCB-A100&startDate=2024-01-01&endDate=2024-01-31"

# Kèm ảnh OK/NG cho từng điểm đo
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/statistics/measurement-points?productModelId=10&startDate=2024-01-01&endDate=2024-01-31&includeImages=true"
```

---

## 🖼️ Tham chiếu nhanh: API Ảnh & Điểm đo

> Bảng tổng hợp tất cả API liên quan đến **ảnh kiểm tra**, **ảnh tham chiếu**, và **điểm đo (measurement points)** — phục vụ tích hợp bên thứ 3.

### Nhóm 1: Lấy ảnh tham chiếu sản phẩm (Reference Images)

| API | URL | Auth | Mô tả |
|-----|-----|------|-------|
| **A4** | `GET /api/external/stations/:id/reference-image` | Master Key | Ảnh tham chiếu sản phẩm đang gán cho station — trả base64 |
| **B5** | `GET /api/public/products/:productCode/image` | Master Key / Machine Code | Ảnh tham chiếu sản phẩm theo mã sản phẩm |
| **B6** | `GET /api/public/measurement-points/:pointId/image` | Master Key / Machine Code | Ảnh tham chiếu (cropped) của một điểm đo cụ thể |

### Nhóm 2: Lấy danh sách điểm đo (Measurement Point Definitions)

| API | URL | Auth | Mô tả |
|-----|-----|------|-------|
| **A3** | `GET /api/external/stations/:id/inspection-points` | Master Key | Tất cả điểm đo theo station — kèm `referenceImageUrl`, vị trí (`positionX/Y`, `radius`), `imageWidth/Height` |
| **B4** | `GET /api/public/products/:productCode/measurement-points` | Master Key / Machine Code | Điểm đo theo mã sản phẩm — kèm limits, vị trí |
| **C8** | `GET /api/external/products/:id` | Master Key | Chi tiết sản phẩm + toàn bộ measurement points — kèm `hasReferenceImage`, `cropWidth/Height` |

### Nhóm 3: Lấy ảnh kiểm tra thực tế (Inspection Images)

| API | URL | Auth | Mô tả |
|-----|-----|------|-------|
| **C4** | `GET /api/external/inspections/images` | Master Key | Danh sách ảnh kiểm tra — lọc theo station, product, điểm đo, kết quả (OK/NG) — phân trang |
| **A9** | `GET /api/external/stations/:id/fail-history` | Master Key | Lịch sử NG — mỗi inspection kèm `failedPoints[]` có `imageUrl` + vị trí điểm lỗi |
| **A10** | `GET /api/external/stations/:id/point-detail` | Master Key | Chi tiết từng điểm đo + `errorImages[]` (ảnh NG gần nhất) + `productImage` (ảnh board) |
| **E1** | `GET /api/external/statistics/measurement-points` | Master Key | Thống kê theo sản phẩm + `includeImages=true` trả `okImages[]` và `ngImages[]` cho từng điểm |

### Nhóm 4: Giá trị đo & Thống kê điểm đo

| API | URL | Auth | Mô tả |
|-----|-----|------|-------|
| **C6** | `GET /api/external/inspections/measurements` | Master Key | Giá trị đo thực tế của 1 điểm đo theo thời gian — kèm `imageUrl` nếu có ảnh |
| **A8** | `GET /api/external/stations/:id/measurement-stats` | Master Key | Thống kê tất cả điểm đo theo **station** — OK/NG/NTF counts, ngRate, avg/min/max, nhóm theo thời gian |
| **E1** | `GET /api/external/statistics/measurement-points` | Master Key | Thống kê tất cả điểm đo theo **sản phẩm** — OK/NG counts, ngRate, kèm ảnh (optional) |
| **A10** | `GET /api/external/stations/:id/point-detail` | Master Key | Thống kê + trạng thái + ảnh lỗi + NTF rate — kết hợp A8 + ảnh |

### Nhóm 5: Thông tin sản phẩm (có liên quan ảnh/điểm đo)

| API | URL | Auth | Mô tả |
|-----|-----|------|-------|
| **A6** | `GET /api/external/stations/:id/products` | Master Key | Sản phẩm theo station — kèm `hasReferenceImage`, `imageWidth/Height`, `imageDisplayMode` |
| **C7** | `GET /api/external/products` | Master Key | Danh sách sản phẩm — kèm `imageWidth/Height`, `imageDisplayMode` |
| **C8** | `GET /api/external/products/:id` | Master Key | Chi tiết sản phẩm + measurement points — kèm `hasReferenceImage` |
| **B2** | `GET /api/public/products/by-code/:code` | Master Key / Machine Code | Sản phẩm theo code — kèm `referenceImageUrl`, measurement points với vị trí |

### Cách tải ảnh từ `imageUrl`

Tất cả `imageUrl` (ví dụ: `/uploads/inspections/2024-01/img_001.jpg`) là đường dẫn tương đối trên server. Để tải ảnh:

```bash
# Qua cURL
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/uploads/inspections/2024-01/img_001.jpg" \
  --output image.jpg
```

```csharp
// C# HttpClient
client.DefaultRequestHeaders.Add("x-master-key", "YOUR_MASTER_KEY");
var imageBytes = await client.GetByteArrayAsync(
    "https://your-server/uploads/inspections/2024-01/img_001.jpg");
File.WriteAllBytes("image.jpg", imageBytes);
```

```python
# Python requests
resp = requests.get(
    "https://your-server/uploads/inspections/2024-01/img_001.jpg",
    headers={"x-master-key": "YOUR_MASTER_KEY"})
with open("image.jpg", "wb") as f:
    f.write(resp.content)
```

### Workflow tích hợp đề xuất

**Bước 1 — Lấy danh sách sản phẩm:**
- Gọi **A6** (theo station) hoặc **C7** (tất cả) → biết `productModelId`, `imageWidth`, `imageHeight`

**Bước 2 — Lấy điểm đo sản phẩm:**
- Gọi **A3** (theo station) hoặc **B4** (theo product code) → có `positionX/Y`, `radius`, `referenceImageUrl`

**Bước 3 — Lấy ảnh tham chiếu:**
- Gọi **A4** (ảnh board theo station) hoặc **B5** (ảnh board theo product code) hoặc **B6** (ảnh crop điểm đo)

**Bước 4 — Vẽ điểm đo lên ảnh:**
- Dùng `positionX`, `positionY`, `radius` + `imageWidth`, `imageHeight` → tính scale theo [Coordinate Scaling Guide](#hướng-dẫn-quy-đổi-tọa-độ-điểm-đo-coordinate-scaling-guide)

**Bước 5 — Xem kết quả kiểm tra:**
- Gọi **C4** (ảnh kiểm tra) hoặc **C6** (giá trị đo) hoặc **A9** (lịch sử NG) hoặc **A10** (chi tiết + ảnh lỗi)

**Bước 6 — Thống kê & Phân tích:**
- Gọi **A8** (thống kê theo station) hoặc **E1** (thống kê theo sản phẩm + ảnh)

---

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
# ===== STATION APIs (auth: x-master-key) =====

# Lấy danh sách stations
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations"

# Lấy chi tiết station
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1"

# Lấy inspection points của station
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/stations/1/inspection-points"

# ===== PRODUCT APIs (auth: x-master-key, x-api-key, hoặc x-machine-code) =====

# Lấy danh sách sản phẩm (dùng master key)
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/public/products"

# Hoặc dùng machine code
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products"

# Tìm kiếm sản phẩm active
curl -H "x-api-key: MACHINE_API_KEY" \
  "https://your-server/api/public/products?search=PCB&lifecycleStatus=active"

# Lấy chi tiết sản phẩm theo code
curl -H "x-machine-code: M001" \
  "https://your-server/api/public/products/by-code/PRD001"

# ===== INSPECTION APIs (auth: x-master-key) =====

# Summary
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/inspections/summary?startDate=2024-01-01&endDate=2024-01-31"

# Defect Pareto
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/inspections/defect-pareto?startDate=2024-01-01&endDate=2024-01-31&limit=10"

# Images lọc NG
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/inspections/images?startDate=2024-01-01&endDate=2024-01-31&result=NG&limit=20"

# Measurements cho điểm đo cụ thể
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/inspections/measurements?pointDefId=42&startDate=2024-01-01&endDate=2024-01-31"

# Trend theo giờ cho 1 station
curl -H "x-master-key: YOUR_MASTER_KEY" \
  "https://your-server/api/external/inspections/trend?startDate=2024-01-15&endDate=2024-01-15&groupBy=hour&stationId=1"
```

### C# HttpClient

```csharp
using var client = new HttpClient();

// ===== Gọi Station API (Master Key) =====
client.DefaultRequestHeaders.Add("x-master-key", "YOUR_MASTER_KEY");

var stationsResponse = await client.GetAsync("https://your-server/api/external/stations");
var stationsJson = await stationsResponse.Content.ReadAsStringAsync();
Console.WriteLine("Stations: " + stationsJson);

// ===== Gọi Product API (Master Key hoặc Machine Code) =====
// Có thể dùng cùng master key cho tất cả API
var productsResponse = await client.GetAsync(
    "https://your-server/api/public/products?lifecycleStatus=active");
var productsJson = await productsResponse.Content.ReadAsStringAsync();
Console.WriteLine("Products: " + productsJson);

// ===== Gọi Inspection API (Master Key) =====
var summaryResponse = await client.GetAsync(
    "https://your-server/api/external/inspections/summary" +
    "?startDate=2024-01-01&endDate=2024-01-31&stationId=1");
var summaryJson = await summaryResponse.Content.ReadAsStringAsync();
Console.WriteLine("Summary: " + summaryJson);
```

### Python requests

```python
import requests

# ===== Station API (Master Key) =====
station_headers = {"x-master-key": "YOUR_MASTER_KEY"}
stations = requests.get(
    "https://your-server/api/external/stations",
    headers=station_headers,
).json()
print("Stations:", stations)

# ===== Product API (Master Key hoặc Machine Code) =====
# Có thể dùng cùng master key cho tất cả API
products = requests.get(
    "https://your-server/api/public/products",
    headers=station_headers,
    params={"lifecycleStatus": "active", "limit": 20},
).json()
print("Products:", products)

# ===== Inspection API (Master Key) =====
trend = requests.get(
    "https://your-server/api/external/inspections/trend",
    headers=station_headers,
    params={
        "startDate": "2024-01-01",
        "endDate": "2024-01-31",
        "stationId": 1,
        "groupBy": "day",
    },
).json()
print("Trend:", trend)
```

---

## Tổng hợp tất cả Endpoints

| # | Method | URL | Auth | Mô tả |
|---|--------|-----|------|-------|
| A1 | GET | `/api/external/stations` | Master Key | Danh sách stations |
| A2 | GET | `/api/external/stations/:id` | Master Key | Chi tiết station |
| A3 | GET | `/api/external/stations/:id/inspection-points?productModelId={n}` | Master Key | Điểm kiểm tra theo station (lọc theo sản phẩm) |
| A4 | GET | `/api/external/stations/:id/reference-image` | Master Key | Ảnh tham chiếu station |
| A5 | GET | `/api/external/stations/resolve-topic` | Master Key | Resolve MQTT topic → station |
| A6 | GET | `/api/external/stations/:id/products` | Master Key | Sản phẩm theo station |
| A7 | GET | `/api/external/stations/:id/statistics?productModelId={n}` | Master Key | Thống kê KPI station (FPY, yield change, lọc theo sản phẩm) |
| A8 | GET | `/api/external/stations/:id/measurement-stats` | Master Key | Thống kê theo từng điểm đo |
| A9 | GET | `/api/external/stations/:id/fail-history?productModelId={n}` | Master Key | Lịch sử lỗi NG + chi tiết điểm lỗi (lọc theo sản phẩm) |
| A10 | GET | `/api/external/stations/:id/point-detail` | Master Key | Chi tiết điểm đo + ảnh lỗi NG + tỷ lệ NTF (Point Detail) |
| A11a | GET | `/api/external/workstations` | Master Key | Danh sách workstations (lọc factory/workshop/line) |
| A11b | GET | `/api/external/workstations/:id` | Master Key | Chi tiết workstation |
| C1 | GET | `/api/external/inspections/summary` | Master Key | Tổng hợp kiểm tra |
| C2 | GET | `/api/external/inspections/trend` | Master Key | Xu hướng OK/NG |
| C3 | GET | `/api/external/inspections/defect-pareto` | Master Key | Pareto lỗi |
| C4 | GET | `/api/external/inspections/images` | Master Key | Ảnh kiểm tra |
| C5 | GET | `/api/external/inspections/events` | Master Key | Sự kiện |
| C6 | GET | `/api/external/inspections/measurements` | Master Key | Giá trị đo chi tiết |
| C7 | GET | `/api/external/products` | Master Key | Danh sách sản phẩm (external) |
| C8 | GET | `/api/external/products/:id` | Master Key | Chi tiết sản phẩm (external) |
| D1 | GET | `/api/external/inspections/control-chart` | Master Key | Biểu đồ kiểm soát SPC (Western Electric 8 rules, Cpk/Ppk) |
| D2 | GET | `/api/external/inspections/histogram` | Master Key | Phân phối yield (histogram + thống kê nâng cao) |
| D3 | GET | `/api/external/inspections/stratification` | Master Key | Phân tầng theo máy / ca / ngày trong tuần |
| D4 | GET | `/api/external/inspections/fail-history` | Master Key | Lịch sử NG chi tiết kèm failed measurement points |
| D5 | GET | `/api/external/inspections/diagnostics` | Master Key | Chẩn đoán AI — cảnh báo, pattern, recommendations |
| D6 | GET | `/api/external/inspections/scatter` | Master Key | Biểu đồ phân tán — tương quan sản lượng vs NG rate |
| D7 | GET | `/api/external/inspections/check-sheet` | Master Key | Ma trận lỗi defect × ngày (QC7 Check Sheet) |
| D8 | GET | `/api/external/inspections/cause-effect` | Master Key | Biểu đồ Ishikawa 6M — nhân quả (Cause-Effect) |
| D9 | GET | `/api/external/inspections/ai-analysis` | Master Key | Phân tích AI — anomaly, forecast, clustering, Cp/Cpk |
| D10 | GET | `/api/external/inspections/yield-comparison` | Master Key | So sánh yield kỳ hiện tại vs kỳ trước |
| **E1** | **GET** | **`/api/external/statistics/measurement-points`** | **Master Key** | **Thống kê điểm đo theo sản phẩm + ảnh OK/NG (includeImages)** |


