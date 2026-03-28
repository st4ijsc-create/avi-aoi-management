# Machine API — Tích hợp máy kiểm tra AOI

**Router**: `machineApi`  
**Base URL**: `http://<server>:<port>/api/trpc/machineApi.<endpoint>`  
**Xác thực**: API Key hoặc Machine Code trong input

> **v2.0 (Migration 0071 + 0072)**: Thêm `normalizedX/Y/Radius`, `pointsConfigVersion`, `imageHash` dedup, `deltaSyncPoints`, `getSyncHistory`, `sync_logs`. Xem chi tiết tổng hợp tại [SYNC_API.md](SYNC_API.md).

---

## Mục lục

1. [submitInspection](#1-submitinspection) — Gửi kết quả kiểm tra
2. [uploadImage](#2-uploadimage) — Upload ảnh đo sau kiểm tra
3. [syncMeasurementPoints](#3-syncmeasurementpoints) — Đồng bộ điểm đo (App → Server)
4. [syncProductImage](#4-syncproductimage) — Đồng bộ ảnh sản phẩm (App → Server)
5. [syncPointImage](#5-syncpointimage) — Upload ảnh tham chiếu điểm đo
6. [heartbeat](#6-heartbeat) — Gửi tín hiệu hoạt động
7. [checkPointsVersion](#7-checkpointsversion) — Kiểm tra version điểm đo
8. [getPoints](#8-getpoints) — Tải xuống định nghĩa điểm đo
9. [getProductImage](#9-getproductimage) — Tải ảnh tham chiếu sản phẩm
10. [getPointImage](#10-getpointimage) — Tải ảnh tham chiếu điểm đo
11. [deltaSyncPoints](#11-deltasyncpoints) — Đồng bộ delta (chỉ điểm thay đổi)
12. [getSyncHistory](#12-getsynchistory) — Lịch sử đồng bộ

---

## 1. submitInspection

Gửi kết quả kiểm tra từ máy AOI.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.submitInspection`

### Input

```typescript
{
  // Xác thực (bắt buộc 1 trong 2)
  apiKey?: string,
  machineCode?: string,

  // Thông tin sản phẩm
  serialNumber: string,             // Số serial sản phẩm (BẮT BUỘC)
  productModel?: string,            // Mã model sản phẩm
  batchNumber?: string,             // Số lô sản xuất
  
  // Kết quả kiểm tra
  overallResult: "OK" | "NG",       // Kết quả tổng thể (BẮT BUỘC)
  cycleTime?: number,               // Thời gian chu kỳ (giây)
  inspectionTime?: string,          // Thời điểm kiểm tra (ISO 8601)
  
  // Cấu trúc doanh nghiệp
  companyCode?: string,             // Mã tập đoàn/công ty
  factoryCode?: string,             // Mã nhà máy
  workshopCode?: string,            // Mã nhà xưởng
  lineCode?: string,                // Mã dây chuyền
  stageCode?: string,               // Mã công đoạn
  
  // Ngữ cảnh sản xuất
  productionOrderCode?: string,     // Mã lệnh sản xuất
  operatorId?: string,              // Mã công nhân

  // Dữ liệu đo lường
  measurements: [{
    pointId?: string,               // ID điểm đo
    pointCode?: string,             // Mã điểm đo
    measuredValue?: number | string, // Giá trị đo
    result: "OK" | "NG",            // Kết quả điểm đo (BẮT BUỘC)
    remark?: string,                // Ghi chú
    imageBase64?: string,           // Ảnh chụp (tự động upload)
  }]
}
```

> **Lưu ý**: Nếu `pointCode` không tồn tại trên server, dữ liệu đo vẫn được lưu với `pointDefId = 0`.

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "inspectionId": 12345
      }
    }
  }
}
```

### Hành vi

- Tự động cập nhật heartbeat máy
- Nếu có `productionOrderCode`, cập nhật số lượng OK/NG của lệnh sản xuất
- Nếu `measuredValue` là số → lưu vào `measuredValue` (decimal), nếu là chuỗi → lưu vào `measuredValueText`
- Nếu `imageBase64` được cung cấp → tự động upload lên storage
- Nếu kết quả NG → phát cảnh báo qua Socket.io và MQTT
- Nếu tỷ lệ yield < 90% → phát cảnh báo yield thấp

### Ví dụ cURL

```bash
curl -X POST "http://localhost:3000/api/trpc/machineApi.submitInspection" \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "apiKey": "your-api-key",
      "serialNumber": "SN-2024-001",
      "productModel": "PROD-A",
      "overallResult": "OK",
      "cycleTime": 2.5,
      "measurements": [
        {
          "pointCode": "CHECK-01",
          "measuredValue": 5.02,
          "result": "OK"
        },
        {
          "pointCode": "CHECK-02",
          "measuredValue": "PASS",
          "result": "OK"
        }
      ]
    }
  }'
```

---

## 2. uploadImage

Upload ảnh sau kiểm tra cho một điểm đo cụ thể.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.uploadImage`

### Input

```typescript
{
  apiKey: string,              // API Key (BẮT BUỘC)
  inspectionId: number,        // ID kiểm tra (BẮT BUỘC)
  pointCode: string,           // Mã điểm đo (BẮT BUỘC)
  imageBase64: string,         // Dữ liệu ảnh base64 (BẮT BUỘC)
  mimeType?: string            // MIME type (default: "image/jpeg")
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "imageUrl": "/uploads/inspections/12345/CHECK-01-abc123.jpg"
      }
    }
  }
}
```

---

## 3. syncMeasurementPoints

Đồng bộ điểm đo từ app AOI lên server. Hỗ trợ tạo mới và cập nhật, với chuyển đổi tọa độ tự động khi khác độ phân giải.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.syncMeasurementPoints`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,         // Mã sản phẩm (BẮT BUỘC)
  
  // Kích thước ảnh nguồn (optional, dùng để chuyển đổi tọa độ)
  sourceImageWidth?: number,
  sourceImageHeight?: number,
  clientVersion?: string,           // Version phần mềm client
  
  points: [{                        // Danh sách điểm đo (≥ 1)
    code: string,                   // Mã điểm đo (1-50 ký tự, BẮT BUỘC)
    name: string,                   // Tên (1-255 ký tự, BẮT BUỘC)
    description?: string,
    measurementType?: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER",
    unit?: string,
    lowerLimit?: number | string,   // Giới hạn dưới
    upperLimit?: number | string,   // Giới hạn trên
    nominalValue?: number | string, // Giá trị danh nghĩa

    // Tọa độ tuyệt đối (pixel)
    positionX: number,              // BẮT BUỘC (int)
    positionY: number,              // BẮT BUỘC (int)
    radius?: number,

    // Tọa độ chuẩn hóa (0.0 - 1.0) — ưu tiên nếu có
    normalizedX?: number,
    normalizedY?: number,
    normalizedRadius?: number,

    cropWidth?: number,
    cropHeight?: number,
    orderIndex?: number,
    workstationCode?: string,
    isActive?: boolean,

    // Ảnh tham chiếu
    imageBase64?: string,
    imageMimeType?: string,
    imageUrl?: string,
  }]
}
```

### Chuyển đổi tọa độ

Khi tọa độ pixel từ app và server sử dụng khác kích thước ảnh, hệ thống tự động chuyển đổi:

| Trường hợp | Điều kiện | Hành vi |
|-------------|-----------|---------|
| **Normalized** | Client gửi `normalizedX/Y` | Tính tọa độ tuyệt đối từ kích thước ảnh server |
| **Cross-resolution** | `sourceImageWidth/Height` ≠ server | Tự động scale tọa độ theo tỷ lệ |
| **Same resolution** | Cùng kích thước hoặc không có thông tin | Dùng tọa độ gốc, tính normalized |

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "productModelId": 5,
        "productModelCode": "PROD-A",
        "pointsConfigVersion": 3,
        "total": 10,
        "created": 3,
        "updated": 7,
        "failed": 0,
        "coordTransformed": 5,
        "serverImageWidth": 1920,
        "serverImageHeight": 1080,
        "points": [
          { "code": "P1", "id": 101, "action": "created", "coordTransformed": true },
          { "code": "P2", "id": 102, "action": "updated", "coordTransformed": false }
        ],
        "errors": []
      }
    }
  }
}
```

### Hành vi

- Mỗi `code` kiểm tra: đã tồn tại → update, chưa có → create
- Sau sync, tự động tăng `pointsConfigVersion` và phát MQTT notification
- Lưu log đồng bộ (thời gian, số lượng, trạng thái)

---

## 4. syncProductImage

Upload ảnh tham chiếu sản phẩm lên server. Hỗ trợ deduplication bằng image hash.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.syncProductImage`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,     // Mã sản phẩm (BẮT BUỘC)
  imageBase64?: string,         // Dữ liệu ảnh (bắt buộc 1 trong 2)
  imageUrl?: string,            // URL ảnh (bắt buộc 1 trong 2)
  imageMimeType?: string,       // MIME type
  imageWidth?: number,          // Kích thước ảnh (pixel)
  imageHeight?: number,
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "productModelId": 5,
        "productModelCode": "PROD-A",
        "imageUrl": "/uploads/product-models/5/reference.jpg",
        "imageHash": "abc123...",
        "imageSkipped": false
      }
    }
  }
}
```

> **Dedup**: Nếu ảnh giống ảnh hiện tại (hash match), trả về `imageSkipped: true` và không upload lại.

---

## 5. syncPointImage

Upload ảnh tham chiếu cho một điểm đo cụ thể.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.syncPointImage`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,     // Mã sản phẩm (BẮT BUỘC)
  pointCode: string,            // Mã điểm đo (BẮT BUỘC)
  imageBase64?: string,         // Bắt buộc 1 trong 2
  imageUrl?: string,            // Bắt buộc 1 trong 2
  imageMimeType?: string,
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "productModelId": 5,
        "productModelCode": "PROD-A",
        "pointId": 101,
        "pointCode": "CHECK-01",
        "referenceImageUrl": "/uploads/...",
        "referenceImageKey": "product-models/5/points/CHECK-01/ref.jpg"
      }
    }
  }
}
```

---

## 6. heartbeat

Gửi tín hiệu hoạt động từ máy.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.heartbeat`

### Input

```typescript
{
  apiKey: string   // BẮT BUỘC
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1
      }
    }
  }
}
```

---

## 7. checkPointsVersion

Kiểm tra nhanh version cấu hình điểm đo. Client so sánh với version đã cache để quyết định có cần sync lại không.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.checkPointsVersion?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string     // Optional — nếu không truyền lấy tất cả products đã map
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "productModels": [
          {
            "productModelCode": "PROD-A",
            "pointsConfigVersion": 5,
            "imageWidth": 1920,
            "imageHeight": 1080
          }
        ]
      }
    }
  }
}
```

### Ví dụ cURL

```bash
INPUT='{"json":{"apiKey":"your-api-key","productModelCode":"PROD-A"}}'
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$INPUT'))")
curl "http://localhost:3000/api/trpc/machineApi.checkPointsVersion?input=$ENCODED"
```

---

## 8. getPoints

Tải xuống định nghĩa điểm đo đầy đủ, bao gồm tọa độ, giới hạn, ảnh tham chiếu.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.getPoints?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string   // Optional — không truyền lấy tất cả products đã map
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "machineCode": "AOI-01",
        "productModels": [
          {
            "productModelId": 5,
            "productModelCode": "PROD-A",
            "productModelName": "Product A",
            "referenceImageUrl": "/uploads/...",
            "imageWidth": 1920,
            "imageHeight": 1080,
            "pointsConfigVersion": 5,
            "totalPoints": 20,
            "points": [
              {
                "id": 101,
                "code": "CHECK-01",
                "name": "Điểm kiểm tra 1",
                "measurementType": "VISUAL",
                "positionX": 500,
                "positionY": 300,
                "radius": 25,
                "normalizedX": 0.26041667,
                "normalizedY": 0.27777778,
                "normalizedRadius": 0.01302083,
                "lowerLimit": "4.5",
                "upperLimit": "5.5",
                "nominalValue": "5.0",
                "cropWidth": 100,
                "cropHeight": 100,
                "referenceImageUrl": "/uploads/...",
                "isActive": true
              }
            ]
          }
        ]
      }
    }
  }
}
```

---

## 9. getProductImage

Tải ảnh tham chiếu sản phẩm. Ảnh được trả về dưới dạng **base64 Data URL** để client bên thứ 3 có thể nhận trực tiếp.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.getProductImage?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string     // BẮT BUỘC
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "data": {
          "productModelId": 5,
          "productModelCode": "PROD-A",
          "productModelName": "Product A",
          "imageUrl": "data:image/jpeg;base64,/9j/4AAQ...",
          "imageWidth": 1920,
          "imageHeight": 1080
        }
      }
    }
  }
}
```

---

## 10. getPointImage

Tải ảnh tham chiếu điểm đo, bao gồm cả ảnh sản phẩm.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.getPointImage?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,    // BẮT BUỘC
  pointCode: string,           // BẮT BUỘC
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "productModelId": 5,
        "productModelCode": "PROD-A",
        "pointId": 101,
        "pointCode": "CHECK-01",
        "pointName": "Điểm kiểm tra 1",
        "referenceImageUrl": "data:image/jpeg;base64,...",
        "position": {
          "x": 500,
          "y": 300,
          "radius": 25,
          "cropWidth": 100,
          "cropHeight": 100
        },
        "productReferenceImageUrl": "data:image/jpeg;base64,..."
      }
    }
  }
}
```

---

## 11. deltaSyncPoints

Lấy danh sách điểm đo đã thay đổi kể từ version chỉ định. Giúp tiết kiệm băng thông khi chỉ có vài điểm thay đổi.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.deltaSyncPoints?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,    // BẮT BUỘC
  sinceVersion: number,        // Version client đang cache (BẮT BUỘC)
}
```

### Output (có thay đổi)

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "hasChanges": true,
        "currentVersion": 5,
        "sinceVersion": 3,
        "serverImageWidth": 1920,
        "serverImageHeight": 1080,
        "points": [
          {
            "id": 101,
            "code": "CHECK-01",
            "name": "Điểm 1",
            "positionX": 500,
            "positionY": 300,
            "normalizedX": "0.26041667",
            "normalizedY": "0.27777778",
            "isActive": true,
            "lastModifiedAt": "2024-01-15T08:30:00.000Z"
          }
        ]
      }
    }
  }
}
```

### Output (không có thay đổi)

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "hasChanges": false,
        "currentVersion": 3,
        "sinceVersion": 3,
        "points": []
      }
    }
  }
}
```

---

## 12. getSyncHistory

Lấy lịch sử đồng bộ của máy.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/machineApi.getSyncHistory?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string,
  syncOperation?: "POINTS_PUSH" | "POINTS_PULL" | "IMAGE_PUSH" | "IMAGE_PULL" | "FULL_SYNC" | "DELTA_SYNC",
  limit?: number,              // 1-100, default: 20
  offset?: number,             // default: 0
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "machineId": 1,
        "machineCode": "AOI-01",
        "logs": [
          {
            "id": 50,
            "syncOperation": "POINTS_PUSH",
            "syncStatus": "SUCCESS",
            "pointsSynced": 10,
            "pointsCreated": 3,
            "pointsUpdated": 7,
            "durationMs": 1250,
            "createdAt": "2024-01-15T08:30:00.000Z"
          }
        ]
      }
    }
  }
}
```

---

## Workflow đề xuất

### Lần đầu kết nối

```
1. heartbeat          → Xác nhận kết nối
2. getPoints          → Tải điểm đo đầy đủ
3. getProductImage    → Tải ảnh tham chiếu sản phẩm
4. getPointImage × N  → Tải ảnh tham chiếu từng điểm đo
```

### Vòng lặp kiểm tra

```
1. submitInspection   → Gửi kết quả kiểm tra
2. uploadImage        → Upload ảnh bổ sung (nếu cần)
```

### Đồng bộ định kỳ

```
1. checkPointsVersion → So sánh version
2. deltaSyncPoints    → Tải điểm thay đổi (nếu version mới hơn)
```

### Đồng bộ ảnh

```
1. syncProductImage   → Upload ảnh sản phẩm (dedup tự động)
2. syncPointImage     → Upload ảnh điểm đo
3. syncMeasurementPoints → Sync điểm đo + ảnh (all-in-one)
```
