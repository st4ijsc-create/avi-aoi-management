# API Đồng bộ Ảnh & Điểm đo cho bên thứ 3
# Image & Measurement Point Sync API for Third-Party Integration

> **Phiên bản**: 2.0 (cập nhật sau migration 0071 + 0072)  
> **Ngày cập nhật**: 2025-01-XX

---

## Mục lục / Table of Contents

1. [Tổng quan thay đổi / Change Summary](#1-tổng-quan-thay-đổi)
2. [Kiến trúc API / API Architecture](#2-kiến-trúc-api)
3. [Xác thực / Authentication](#3-xác-thực)
4. [Giao thức đồng bộ / Sync Protocol](#4-giao-thức-đồng-bộ)
5. [API Đồng bộ điểm đo / Measurement Point Sync](#5-api-đồng-bộ-điểm-đo)
6. [API Đồng bộ ảnh / Image Sync](#6-api-đồng-bộ-ảnh)
7. [API Truy vấn dữ liệu / Data Query API](#7-api-truy-vấn-dữ-liệu)
8. [REST Proxy Endpoints](#8-rest-proxy-endpoints)
9. [External Admin API](#9-external-admin-api)
10. [Workflow tích hợp / Integration Workflow](#10-workflow-tích-hợp)
11. [MQTT Notifications](#11-mqtt-notifications)

---

## 1. Tổng quan thay đổi

### Những gì MỚI so với phiên bản trước

| Tính năng | Trước đây | Hiện tại (v2.0) |
|-----------|-----------|-----------------|
| **Tọa độ chuẩn hóa** | Chỉ có `positionX/Y` (pixel tuyệt đối) | Thêm `normalizedX/Y/Radius` (0.0 – 1.0), tự động chuyển đổi khi khác độ phân giải |
| **Phiên bản config** | Không có versioning | `pointsConfigVersion` (integer) trên mỗi `product_model`, tăng mỗi khi điểm đo thay đổi |
| **Delta sync** | Phải tải toàn bộ điểm đo | `deltaSyncPoints` — chỉ tải điểm đã thay đổi kể từ version chỉ định |
| **Image hash dedup** | Upload lại ảnh mỗi lần sync | SHA-256 hash so sánh, bỏ qua upload nếu ảnh giống nhau (trả `imageSkipped: true`) |
| **Sync logs** | Không có lịch sử | Bảng `sync_logs` ghi nhận mọi thao tác sync kèm thông tin chi tiết |
| **lastModifiedAt** | Không có | Timestamp trên mỗi `measurement_point_def`, dùng cho delta sync |
| **imageHash trên point** | Không có | `imageHash` (varchar 64) trên `measurement_point_defs` cho dedup ảnh điểm đo |

### Cột mới trong database

**Bảng `product_models`:**
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `pointsConfigVersion` | `integer` (default: 1) | Phiên bản cấu hình điểm đo, tăng mỗi khi sync |
| `imageHash` | `varchar(64)` | SHA-256 hash ảnh tham chiếu sản phẩm |

**Bảng `measurement_point_defs`:**
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `normalizedX` | `decimal(10,8)` | Tọa độ X chuẩn hóa (0.0 – 1.0) = positionX / imageWidth |
| `normalizedY` | `decimal(10,8)` | Tọa độ Y chuẩn hóa (0.0 – 1.0) = positionY / imageHeight |
| `normalizedRadius` | `decimal(10,8)` | Bán kính chuẩn hóa (0.0 – 1.0) = radius / imageWidth |
| `imageHash` | `varchar(64)` | SHA-256 hash ảnh tham chiếu điểm đo |
| `lastModifiedAt` | `timestamp` | Thời điểm thay đổi cuối, dùng cho delta sync |

**Bảng mới `sync_logs`:**
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | `serial` | Khóa chính |
| `machineId` | `integer` | ID máy thực hiện sync |
| `machineCode` | `varchar` | Mã máy |
| `productModelId` | `integer` | ID sản phẩm |
| `productModelCode` | `varchar` | Mã sản phẩm |
| `syncOperation` | `enum` | `POINTS_PUSH`, `POINTS_PULL`, `IMAGE_PUSH`, `IMAGE_PULL`, `FULL_SYNC`, `DELTA_SYNC` |
| `syncStatus` | `enum` | `SUCCESS`, `PARTIAL`, `FAILED` |
| `pointsSynced` | `integer` | Số điểm đã đồng bộ |
| `pointsCreated` | `integer` | Số điểm tạo mới |
| `pointsUpdated` | `integer` | Số điểm cập nhật |
| `pointsFailed` | `integer` | Số điểm thất bại |
| `fromVersion` | `integer` | Version trước khi sync |
| `toVersion` | `integer` | Version sau khi sync |
| `durationMs` | `integer` | Thời gian thực hiện (ms) |
| `imageHashBefore` | `varchar(64)` | Hash ảnh trước |
| `imageHashAfter` | `varchar(64)` | Hash ảnh sau |
| `imageSkipped` | `boolean` | Ảnh bị bỏ qua do trùng hash |
| `coordTransformations` | `integer` | Số điểm được chuyển đổi tọa độ |
| `sourceImageWidth` | `integer` | Kích thước ảnh nguồn (client) |
| `sourceImageHeight` | `integer` | Kích thước ảnh nguồn (client) |
| `serverImageWidth` | `integer` | Kích thước ảnh server |
| `serverImageHeight` | `integer` | Kích thước ảnh server |
| `clientVersion` | `varchar(50)` | Phiên bản phần mềm client |
| `errorDetails` | `jsonb` | Chi tiết lỗi (nếu có) |
| `createdAt` | `timestamp` | Thời điểm ghi log |

---

## 2. Kiến trúc API

Hệ thống cung cấp 3 nhóm API chính cho bên thứ 3:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AVI-AOI Management Server                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────────────────────────────────────┐          │
│   │  Machine API (tRPC)                              │          │
│   │  Router: machineApi.*                            │          │
│   │  Auth: apiKey | machineCode                      │          │
│   │  → Đồng bộ ảnh, điểm đo, kết quả kiểm tra      │          │
│   └──────────────────────────────────────────────────┘          │
│                                                                  │
│   ┌──────────────────────────────────────────────────┐          │
│   │  REST Machine API (proxy)                        │          │
│   │  Endpoints: /api/machine/*                       │          │
│   │  Auth: X-API-Key header | X-Machine-Code header  │          │
│   │  → Cùng logic, giao thức REST chuẩn             │          │
│   └──────────────────────────────────────────────────┘          │
│                                                                  │
│   ┌──────────────────────────────────────────────────┐          │
│   │  Product API (tRPC)                              │          │
│   │  Router: publicProductApi.*                      │          │
│   │  Auth: apiKey | machineCode                      │          │
│   │  → Truy vấn sản phẩm, điểm đo (chỉ đọc)        │          │
│   └──────────────────────────────────────────────────┘          │
│                                                                  │
│   ┌──────────────────────────────────────────────────┐          │
│   │  Public REST API                                 │          │
│   │  Endpoints: /api/public/*                        │          │
│   │  Auth: X-API-Key header                          │          │
│   │  → REST proxy cho publicProductApi               │          │
│   └──────────────────────────────────────────────────┘          │
│                                                                  │
│   ┌──────────────────────────────────────────────────┐          │
│   │  External Admin API (REST)                       │          │
│   │  Endpoints: /api/external/*                      │          │
│   │  Auth: X-Master-Key header | Bearer JWT          │          │
│   │  → Quản lý máy, hierarchy, thống kê             │          │
│   └──────────────────────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Bảng tổng hợp API đồng bộ

| API | Loại | Hướng | Giao thức | Mô tả |
|-----|------|-------|-----------|-------|
| `machineApi.syncMeasurementPoints` | Mutation | App → Server | tRPC | Push danh sách điểm đo |
| `machineApi.syncProductImage` | Mutation | App → Server | tRPC | Upload ảnh sản phẩm (dedup) |
| `machineApi.syncPointImage` | Mutation | App → Server | tRPC | Upload ảnh điểm đo |
| `machineApi.checkPointsVersion` | Query | Server → App | tRPC | Kiểm tra version config |
| `machineApi.getPoints` | Query | Server → App | tRPC | Tải toàn bộ điểm đo |
| `machineApi.deltaSyncPoints` | Query | Server → App | tRPC | Tải điểm đo thay đổi (delta) |
| `machineApi.getProductImage` | Query | Server → App | tRPC | Tải ảnh sản phẩm (base64) |
| `machineApi.getPointImage` | Query | Server → App | tRPC | Tải ảnh điểm đo (base64) |
| `machineApi.getSyncHistory` | Query | Server → App | tRPC | Lịch sử đồng bộ |
| `POST /api/machine/sync-points` | Mutation | App → Server | REST | Proxy → syncMeasurementPoints |
| `POST /api/machine/sync-product-image` | Mutation | App → Server | REST | Proxy → syncProductImage |
| `POST /api/machine/sync-point-image` | Mutation | App → Server | REST | Proxy → syncPointImage |
| `GET /api/machine/get-points` | Query | Server → App | REST | Proxy → getPoints |
| `GET /api/machine/product-image` | Query | Server → App | REST | Proxy → getProductImage |
| `GET /api/machine/point-image` | Query | Server → App | REST | Proxy → getPointImage |
| `GET /api/machine/check-points-version` | Query | Server → App | REST | Proxy → checkPointsVersion |
| `GET /api/machine/delta-sync-points` | Query | Server → App | REST | Proxy → deltaSyncPoints |
| `GET /api/machine/sync-history` | Query | Server → App | REST | Proxy → getSyncHistory |

---

## 3. Xác thực

### Machine API (tRPC + REST)

| Phương thức | Header/Field | Mô tả |
|-------------|-------------|-------|
| API Key (tRPC) | `apiKey` trong input JSON | API key được cấp cho máy |
| Machine Code (tRPC) | `machineCode` trong input JSON | Mã máy đã đăng ký |
| API Key (REST) | `X-API-Key` header | API key qua HTTP header |
| Machine Code (REST) | `X-Machine-Code` header | Mã máy qua HTTP header |

> Bắt buộc cung cấp ít nhất 1 trong 2. Ưu tiên dùng `apiKey` cho bảo mật cao hơn.

### External Admin API

| Phương thức | Header | Mô tả |
|-------------|--------|-------|
| Master Key | `X-Master-Key` header | API key quản trị cấp cao |
| JWT Token | `Authorization: Bearer <token>` | Token từ `/api/external/auth/login` |

---

## 4. Giao thức đồng bộ

### 4.1 Cơ chế Versioning (pointsConfigVersion)

Mỗi `product_model` có trường `pointsConfigVersion` (integer, bắt đầu từ 1). Mỗi khi điểm đo thay đổi qua `syncMeasurementPoints`, version tự động **+1**.

```
Luồng đồng bộ:
┌──────────┐     checkPointsVersion      ┌──────────┐
│  Client  │ ─────────────────────────→  │  Server  │
│          │ ←─── version: 5 ──────────  │          │
│          │                              │          │
│ (so sánh: client cache version = 3)    │          │
│          │                              │          │
│          │     deltaSyncPoints          │          │
│          │     (sinceVersion: 3)        │          │
│          │ ─────────────────────────→  │          │
│          │ ←─── 2 points changed ────  │          │
│          │     (currentVersion: 5)      │          │
└──────────┘                              └──────────┘
```

### 4.2 Image Hash Deduplication

Khi upload ảnh qua `syncProductImage`, server tính SHA-256 hash của dữ liệu base64:
- Nếu hash **bằng** ảnh hiện tại → bỏ qua upload, trả `imageSkipped: true`
- Nếu hash **khác** → upload ảnh mới, lưu hash mới

```
Client gửi ảnh           Server kiểm tra hash
┌──────────┐              ┌──────────────────┐
│ imageB64 │──────────→  │ SHA-256(imageB64) │
└──────────┘              │ ↓                 │
                          │ hash == existing? │
                          │ ├─ YES: skip      │
                          │ └─ NO:  upload    │
                          └──────────────────┘
```

### 4.3 Chuyển đổi tọa độ (Coordinate Transformation)

Khi client và server sử dụng ảnh khác kích thước, hệ thống tự động chuyển đổi tọa độ pixel:

| Trường hợp | Điều kiện | Hành vi |
|-------------|-----------|---------|
| **Case 1: Normalized** | Client gửi `normalizedX/Y` (0.0 – 1.0) | Server tính: `positionX = round(normalizedX × serverWidth)` |
| **Case 2: Cross-resolution** | Client gửi `sourceImageWidth/Height` khác server | Server scale: `finalX = round(positionX × serverWidth / sourceWidth)` |
| **Case 3: Same resolution** | Cùng kích thước hoặc không có thông tin | Dùng tọa độ gốc, tự tính normalized: `normalizedX = positionX / serverWidth` |

> **Khuyến nghị**: Luôn gửi `normalizedX/Y/Radius` để đảm bảo tọa độ chính xác ở mọi độ phân giải.

---

## 5. API Đồng bộ điểm đo

### 5.1 syncMeasurementPoints — Push điểm đo (App → Server)

Đồng bộ danh sách điểm đo từ ứng dụng AOI lên server. Hỗ trợ tạo mới và cập nhật (upsert theo `code`).

- **tRPC**: `POST /api/trpc/machineApi.syncMeasurementPoints`
- **REST**: `POST /api/machine/sync-points`

#### Input

```typescript
{
  // Xác thực (bắt buộc 1 trong 2)
  apiKey?: string,
  machineCode?: string,

  // Mã sản phẩm
  productModelCode: string,            // BẮT BUỘC

  // Kích thước ảnh nguồn (optional — dùng cho cross-resolution transform)
  sourceImageWidth?: number,
  sourceImageHeight?: number,
  clientVersion?: string,              // Version phần mềm client (max 50 ký tự)

  // Danh sách điểm đo (tối thiểu 1)
  points: [{
    code: string,                      // Mã điểm đo (1-50 ký tự, BẮT BUỘC)
    name: string,                      // Tên điểm (1-255 ký tự, BẮT BUỘC)
    description?: string,
    measurementType?: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER",
    unit?: string,                     // Đơn vị đo (max 20 ký tự)
    lowerLimit?: number | string,
    upperLimit?: number | string,
    nominalValue?: number | string,

    // Tọa độ pixel tuyệt đối (BẮT BUỘC)
    positionX: number,                 // int
    positionY: number,                 // int
    radius?: number,                   // int, positive

    // Tọa độ chuẩn hóa (0.0 – 1.0) — ✨ MỚI, ưu tiên nếu có
    normalizedX?: number,
    normalizedY?: number,
    normalizedRadius?: number,

    // Vùng crop
    cropWidth?: number,
    cropHeight?: number,
    orderIndex?: number,
    workstationCode?: string,
    isActive?: boolean,                // default: true

    // Ảnh tham chiếu (inline)
    imageBase64?: string,
    imageMimeType?: string,
    imageUrl?: string,
  }]
}
```

#### Output

```json
{
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
```

#### Hành vi chi tiết

1. **Upsert** theo `code`: nếu `code` đã tồn tại → cập nhật, chưa có → tạo mới
2. **Tự động chuyển đổi tọa độ** theo 3 trường hợp (xem phần 4.3)
3. **Tăng `pointsConfigVersion`** mỗi khi có thay đổi
4. **Phát MQTT notification** qua topic `points-config-changed`
5. **Ghi sync log** với đầy đủ thông tin (fire-and-forget)

#### Ví dụ cURL (tRPC)

```bash
curl -X POST "http://localhost:3000/api/trpc/machineApi.syncMeasurementPoints" \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "apiKey": "your-api-key",
      "productModelCode": "PROD-A",
      "sourceImageWidth": 1280,
      "sourceImageHeight": 720,
      "points": [
        {
          "code": "P001",
          "name": "Kiểm tra kích thước",
          "measurementType": "DIMENSION",
          "unit": "mm",
          "lowerLimit": 4.5,
          "upperLimit": 5.5,
          "nominalValue": 5.0,
          "positionX": 640,
          "positionY": 360,
          "radius": 25,
          "normalizedX": 0.5,
          "normalizedY": 0.5,
          "normalizedRadius": 0.01953125
        }
      ]
    }
  }'
```

#### Ví dụ cURL (REST)

```bash
curl -X POST "http://localhost:3000/api/machine/sync-points" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "productModelCode": "PROD-A",
    "sourceImageWidth": 1280,
    "sourceImageHeight": 720,
    "points": [
      {
        "code": "P001",
        "name": "Kiểm tra kích thước",
        "positionX": 640,
        "positionY": 360,
        "normalizedX": 0.5,
        "normalizedY": 0.5
      }
    ]
  }'
```

---

### 5.2 checkPointsVersion — Kiểm tra version

Kiểm tra nhanh phiên bản cấu hình điểm đo. Client so sánh với version đã cache để quyết định có cần sync không.

- **tRPC**: `GET /api/trpc/machineApi.checkPointsVersion?input=...`
- **REST**: `GET /api/machine/check-points-version?apiKey=...&productModelCode=...`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string    // Optional — không truyền: lấy tất cả products đã map
}
```

#### Output

```json
{
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
```

#### Cách sử dụng

```
1. Client gọi checkPointsVersion → nhận currentVersion = 5
2. So sánh với version đã cache (vd: 3)
3. Nếu currentVersion > cachedVersion → gọi deltaSyncPoints(sinceVersion: 3)
4. Nếu bằng nhau → không cần sync
```

#### Ví dụ cURL (REST)

```bash
# Kiểm tra version tất cả sản phẩm đã map với máy
curl "http://localhost:3000/api/machine/check-points-version" \
  -H "X-API-Key: your-api-key"

# Kiểm tra version cho sản phẩm cụ thể
curl "http://localhost:3000/api/machine/check-points-version?productModelCode=PROD-A" \
  -H "X-API-Key: your-api-key"
```

---

### 5.3 deltaSyncPoints — Đồng bộ delta (chỉ điểm thay đổi) ✨ MỚI

Lấy chỉ những điểm đo đã thay đổi kể từ version chỉ định. Tiết kiệm đáng kể băng thông khi chỉ có vài điểm thay đổi.

- **tRPC**: `GET /api/trpc/machineApi.deltaSyncPoints?input=...`
- **REST**: `GET /api/machine/delta-sync-points?productModelCode=...&sinceVersion=...&apiKey=...`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,    // BẮT BUỘC
  sinceVersion: number,        // Version client đang cache (BẮT BUỘC, integer ≥ 0)
}
```

#### Output (có thay đổi)

```json
{
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
      "description": "...",
      "measurementType": "VISUAL",
      "unit": null,
      "lowerLimit": null,
      "upperLimit": null,
      "nominalValue": null,
      "positionX": 500,
      "positionY": 300,
      "radius": 25,
      "normalizedX": "0.26041667",
      "normalizedY": "0.27777778",
      "normalizedRadius": "0.01302083",
      "cropWidth": 100,
      "cropHeight": 100,
      "orderIndex": 0,
      "isActive": true,
      "lastModifiedAt": "2025-01-15T08:30:00.000Z"
    }
  ]
}
```

#### Output (không có thay đổi)

```json
{
  "success": true,
  "hasChanges": false,
  "currentVersion": 3,
  "sinceVersion": 3,
  "points": []
}
```

#### Ví dụ cURL (REST)

```bash
# Lấy điểm đo thay đổi kể từ version 3
curl "http://localhost:3000/api/machine/delta-sync-points?productModelCode=PROD-A&sinceVersion=3" \
  -H "X-API-Key: your-api-key"

# Lấy tất cả điểm đo (sinceVersion=0)
curl "http://localhost:3000/api/machine/delta-sync-points?productModelCode=PROD-A&sinceVersion=0" \
  -H "X-API-Key: your-api-key"
```

---

### 5.4 getPoints — Tải toàn bộ điểm đo (Server → App)

Tải danh sách đầy đủ định nghĩa điểm đo với tọa độ, giới hạn, ảnh tham chiếu.

- **tRPC**: `GET /api/trpc/machineApi.getPoints?input=...`
- **REST**: `GET /api/machine/get-points?apiKey=...&productModelCode=...`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string    // Optional — không truyền: lấy tất cả products đã map
}
```

#### Output

```json
{
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
          "orderIndex": 0,
          "referenceImageUrl": "/uploads/...",
          "isActive": true,
          "workstationId": null
        }
      ]
    }
  ]
}
```

---

### 5.5 getSyncHistory — Lịch sử đồng bộ ✨ MỚI

Truy xuất lịch sử các thao tác đồng bộ.

- **tRPC**: `GET /api/trpc/machineApi.getSyncHistory?input=...`
- **REST**: `GET /api/machine/sync-history?apiKey=...&productModelCode=...&syncOperation=...&limit=20&offset=0`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode?: string,      // Lọc theo sản phẩm
  syncOperation?: "POINTS_PUSH" | "POINTS_PULL" | "IMAGE_PUSH" | "IMAGE_PULL" | "FULL_SYNC" | "DELTA_SYNC",
  limit?: number,                 // 1-100, default: 20
  offset?: number,                // default: 0
}
```

#### Output

```json
{
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
      "createdAt": "2025-01-15T08:30:00.000Z"
    }
  ]
}
```

#### Ví dụ cURL (REST)

```bash
# Lấy 20 log gần nhất
curl "http://localhost:3000/api/machine/sync-history" \
  -H "X-API-Key: your-api-key"

# Lọc theo sản phẩm và loại thao tác
curl "http://localhost:3000/api/machine/sync-history?productModelCode=PROD-A&syncOperation=POINTS_PUSH&limit=50" \
  -H "X-API-Key: your-api-key"

# Phân trang
curl "http://localhost:3000/api/machine/sync-history?limit=20&offset=40" \
  -H "X-API-Key: your-api-key"
```

---

## 6. API Đồng bộ ảnh

### 6.1 syncProductImage — Upload ảnh sản phẩm (App → Server) ✨ CẬP NHẬT

Upload ảnh tham chiếu sản phẩm. **Hỗ trợ deduplication** — nếu ảnh giống ảnh hiện tại (hash match), bỏ qua upload.

- **tRPC**: `POST /api/trpc/machineApi.syncProductImage`
- **REST**: `POST /api/machine/sync-product-image`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,     // BẮT BUỘC
  imageBase64?: string,         // Dữ liệu ảnh base64 (bắt buộc 1 trong 2)
  imageUrl?: string,            // URL ảnh (bắt buộc 1 trong 2)
  imageMimeType?: string,       // MIME type (vd: "image/jpeg")
  imageWidth?: number,          // Kích thước ảnh (pixel)
  imageHeight?: number,
}
```

#### Output (ảnh mới — đã upload)

```json
{
  "success": true,
  "machineId": 1,
  "productModelId": 5,
  "productModelCode": "PROD-A",
  "imageUrl": "/uploads/product-models/5/reference.jpg",
  "imageKey": "product-models/5/reference.jpg",
  "imageHash": "a1b2c3d4e5f6...64chars",
  "imageSkipped": false
}
```

#### Output (ảnh trùng — bỏ qua upload)

```json
{
  "success": true,
  "machineId": 1,
  "productModelId": 5,
  "productModelCode": "PROD-A",
  "imageSkipped": true,
  "imageHash": "a1b2c3d4e5f6...64chars",
  "message": "Image unchanged (hash match), upload skipped"
}
```

> **Lưu ý**: `imageSkipped: true` khi ảnh giống ảnh hiện tại. Giúp tiết kiệm băng thông và I/O khi sync lặp lại.

#### Ví dụ cURL (REST)

```bash
curl -X POST "http://localhost:3000/api/machine/sync-product-image" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "productModelCode": "PROD-A",
    "imageBase64": "/9j/4AAQSkZJRg...",
    "imageMimeType": "image/jpeg",
    "imageWidth": 1920,
    "imageHeight": 1080
  }'
```

---

### 6.2 syncPointImage — Upload ảnh điểm đo (App → Server)

Upload ảnh tham chiếu cho một điểm đo cụ thể.

- **tRPC**: `POST /api/trpc/machineApi.syncPointImage`
- **REST**: `POST /api/machine/sync-point-image`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,     // BẮT BUỘC
  pointCode: string,            // Mã điểm đo (BẮT BUỘC)
  imageBase64?: string,         // Bắt buộc 1 trong 2
  imageUrl?: string,            // Bắt buộc 1 trong 2
  imageMimeType?: string,
}
```

#### Output

```json
{
  "success": true,
  "machineId": 1,
  "productModelId": 5,
  "productModelCode": "PROD-A",
  "pointId": 101,
  "pointCode": "CHECK-01",
  "referenceImageUrl": "/uploads/...",
  "referenceImageKey": "product-models/5/points/CHECK-01/ref.jpg"
}
```

---

### 6.3 getProductImage — Tải ảnh sản phẩm (Server → App)

Tải ảnh tham chiếu sản phẩm dưới dạng base64 Data URL.

- **tRPC**: `GET /api/trpc/machineApi.getProductImage?input=...`
- **REST**: `GET /api/machine/product-image?apiKey=...&productModelCode=...`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string     // BẮT BUỘC
}
```

#### Output

```json
{
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
```

---

### 6.4 getPointImage — Tải ảnh điểm đo (Server → App)

Tải ảnh tham chiếu điểm đo, bao gồm cả ảnh sản phẩm.

- **tRPC**: `GET /api/trpc/machineApi.getPointImage?input=...`
- **REST**: `GET /api/machine/point-image?apiKey=...&productModelCode=...&pointCode=...`

#### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productModelCode: string,    // BẮT BUỘC
  pointCode: string,           // BẮT BUỘC
}
```

#### Output

```json
{
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
```

---

## 7. API Truy vấn dữ liệu

### 7.1 Product API (tRPC — publicProductApi)

API chỉ đọc cho phép truy vấn thông tin sản phẩm và điểm đo. Dùng cho ứng dụng quản lý chất lượng, dashboard, hoặc công cụ phân tích.

| Endpoint | Mô tả | Output có normalizedX/Y ✨ |
|----------|-------|---------------------------|
| `publicProductApi.listProducts` | Danh sách sản phẩm (search + pagination) | Không (chỉ thông tin product) |
| `publicProductApi.getProductByCode` | Chi tiết sản phẩm + tất cả điểm đo | ✅ Có |
| `publicProductApi.getProductById` | Chi tiết sản phẩm theo ID | ✅ Có |
| `publicProductApi.getMeasurementPoints` | Danh sách điểm đo của sản phẩm | ✅ Có |
| `publicProductApi.getProductImage` | Ảnh sản phẩm (base64) | N/A |
| `publicProductApi.getPointImage` | Ảnh điểm đo (base64) | N/A |

### 7.2 Public REST API

Proxy REST cho `publicProductApi`, dùng HTTP headers thay vì JSON input.

| REST Endpoint | tRPC Tương ứng |
|---------------|----------------|
| `GET /api/public/products` | `publicProductApi.listProducts` |
| `GET /api/public/products/by-code/:code` | `publicProductApi.getProductByCode` |
| `GET /api/public/products/by-id/:id` | `publicProductApi.getProductById` |
| `GET /api/public/products/:code/measurement-points` | `publicProductApi.getMeasurementPoints` |
| `GET /api/public/products/:code/image` | `publicProductApi.getProductImage` |
| `GET /api/public/measurement-points/:pointId/image` | `publicProductApi.getPointImage` |

> **Auth**: Truyền `X-API-Key` header hoặc `apiKey` query parameter.

---

## 8. REST Proxy Endpoints

Các endpoint REST dưới `/api/machine/*` là proxy trực tiếp đến tRPC `machineApi.*`. Dùng cho client không hỗ trợ tRPC (C#, Python, firmware, ...).

### Bảng ánh xạ REST → tRPC

| REST | Method | tRPC Procedure | Mô tả |
|------|--------|---------------|-------|
| `/api/machine/submit-inspection` | POST | `submitInspection` | Gửi kết quả kiểm tra |
| `/api/machine/upload-image` | POST | `uploadImage` | Upload ảnh kiểm tra |
| `/api/machine/sync-points` | POST | `syncMeasurementPoints` | Push điểm đo |
| `/api/machine/sync-product-image` | POST | `syncProductImage` | Upload ảnh sản phẩm |
| `/api/machine/sync-point-image` | POST | `syncPointImage` | Upload ảnh điểm đo |
| `/api/machine/heartbeat` | POST | `heartbeat` | Heartbeat |
| `/api/machine/register` | POST | — | Đăng ký máy mới |
| `/api/machine/config` | GET | — | Tải cấu hình máy |
| `/api/machine/get-points` | GET | `getPoints` | Tải điểm đo |
| `/api/machine/product-image` | GET | `getProductImage` | Tải ảnh sản phẩm |
| `/api/machine/point-image` | GET | `getPointImage` | Tải ảnh điểm đo |
| `/api/machine/check-points-version` | GET | `checkPointsVersion` | Kiểm tra version config |
| `/api/machine/delta-sync-points` | GET | `deltaSyncPoints` | Tải điểm đo thay đổi (delta) |
| `/api/machine/sync-history` | GET | `getSyncHistory` | Lịch sử đồng bộ |

### Xác thực REST

- **POST requests**: `X-API-Key` header hoặc `apiKey` trong JSON body
- **GET requests**: `X-API-Key` header hoặc `apiKey` query parameter
- **Machine Code**: `X-Machine-Code` header

#### Ví dụ GET (REST)

```bash
curl "http://localhost:3000/api/machine/get-points?productModelCode=PROD-A" \
  -H "X-API-Key: your-api-key"
```

#### Ví dụ POST (REST)

```bash
curl -X POST "http://localhost:3000/api/machine/sync-points" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "productModelCode": "PROD-A",
    "points": [...]
  }'
```

---

## 9. External Admin API

API quản trị dành cho hệ thống cấp trên (MES, ERP, phần mềm quản lý nhà máy).

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/api/external/auth/login` | POST | Đăng nhập lấy JWT token |
| `/api/external/machines/register` | POST | Đăng ký máy mới |
| `/api/external/machines` | GET | Danh sách máy |
| `/api/external/machines/by-code/:code` | GET | Tìm máy theo mã |
| `/api/external/hierarchy/tree` | GET | Cấu trúc tổ chức |
| `/api/external/hierarchy/factory/:id` | GET | Chi tiết nhà máy |
| `/api/external/hierarchy/mqtt-topics` | GET | Danh sách MQTT topics |
| `/api/external/hierarchy/mqtt-message-types` | GET | Các loại bản tin MQTT |
| `/api/external/hierarchy/summary` | GET | Tổng quan hierarchy |
| `/api/external/statistics/measurement-points` | GET | Thống kê điểm đo |

> **Auth**: `X-Master-Key` header hoặc `Authorization: Bearer <token>`.

### Ví dụ đăng nhập

```bash
# Đăng nhập
curl -X POST "http://localhost:3000/api/external/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'

# Sử dụng token
curl "http://localhost:3000/api/external/machines" \
  -H "Authorization: Bearer eyJhbGciOi..."
```

---

## 10. Workflow tích hợp

### 10.1 Lần đầu kết nối (Initial Setup)

```
1. heartbeat                  → Xác nhận kết nối, đăng ký online
2. getPoints                  → Tải toàn bộ điểm đo + tọa độ (bao gồm normalized)
3. getProductImage            → Tải ảnh tham chiếu sản phẩm (base64)
4. getPointImage × N          → Tải ảnh tham chiếu từng điểm đo
5. Cache pointsConfigVersion  → Lưu version để kiểm tra sau
```

### 10.2 Vòng lặp kiểm tra (Inspection Loop)

```
1. submitInspection           → Gửi kết quả kiểm tra
   (tự động: heartbeat, đếm OK/NG, phát cảnh báo)
2. uploadImage                → Upload ảnh bổ sung (nếu cần)
```

### 10.3 Đồng bộ định kỳ (Periodic Sync) ✨ MỚI

```
1. checkPointsVersion         → Lấy currentVersion từ server
2. So sánh với cachedVersion:
   - Bằng nhau → Không cần sync
   - Khác → Tiếp bước 3
3. deltaSyncPoints             → Chỉ tải điểm thay đổi (tiết kiệm bandwidth)
   HOẶC getPoints             → Tải toàn bộ (nếu lần đầu hoặc version chênh nhiều)
4. Cập nhật cachedVersion     → Lưu version mới
```

### 10.4 Đồng bộ ảnh (Image Sync) ✨ CẬP NHẬT

```
1. syncProductImage           → Upload ảnh sản phẩm
   - Server kiểm tra hash → skip nếu trùng (imageSkipped: true)
2. syncPointImage × N         → Upload ảnh từng điểm đo
3. syncMeasurementPoints      → All-in-one: sync điểm + ảnh inline (imageBase64 per point)
```

### 10.5 Sequence Diagram

```
Client (AOI App)                     Server
    │                                   │
    │──── heartbeat ───────────────────→│
    │←─── {success, machineId} ────────│
    │                                   │
    │──── checkPointsVersion ──────────→│  ✨ MỚI
    │←─── {version: 5} ───────────────│
    │                                   │
    │  [version > cached?]              │
    │  YES:                             │
    │──── deltaSyncPoints(since: 3) ───→│  ✨ MỚI
    │←─── {hasChanges, points[]} ──────│
    │                                   │
    │──── syncProductImage ────────────→│
    │←─── {imageSkipped: true/false} ──│  ✨ CẬP NHẬT (dedup)
    │                                   │
    │──── syncMeasurementPoints ───────→│
    │←─── {version: 6, created, ...} ──│
    │                                   │
    │  [Inspection loop]                │
    │──── submitInspection ────────────→│
    │←─── {inspectionId} ─────────────│
    │                                   │
```

---

## 11. MQTT Notifications

Khi điểm đo thay đổi qua sync, server phát MQTT notification:

### Topic: `points-config-changed`

```json
{
  "productModelCode": "PROD-A",
  "pointsConfigVersion": 6,
  "machineCode": "AOI-01",
  "timestamp": "2025-01-15T08:30:00.000Z"
}
```

Client có thể subscribe topic này để nhận notification real-time thay vì polling `checkPointsVersion`.

---

## Giải thích trường dữ liệu

### Tọa độ (Coordinates)

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `positionX` | `integer` | Tọa độ X tuyệt đối (pixel) trên ảnh tham chiếu server |
| `positionY` | `integer` | Tọa độ Y tuyệt đối (pixel) |
| `radius` | `integer` | Bán kính vùng kiểm tra (pixel) |
| `normalizedX` | `number` (0.0 – 1.0) | ✨ Tọa độ X chuẩn hóa = positionX / imageWidth |
| `normalizedY` | `number` (0.0 – 1.0) | ✨ Tọa độ Y chuẩn hóa = positionY / imageHeight |
| `normalizedRadius` | `number` (0.0 – 1.0) | ✨ Bán kính chuẩn hóa = radius / imageWidth |
| `cropWidth` | `integer` | Chiều rộng vùng crop (pixel) |
| `cropHeight` | `integer` | Chiều cao vùng crop (pixel) |

> **Quy ước**: `normalizedX/Y` tương đối với `imageWidth/imageHeight` của sản phẩm. `normalizedRadius` tương đối với `imageWidth`.

### Loại đo lường (measurementType)

| Giá trị | Mô tả |
|---------|-------|
| `DIMENSION` | Đo kích thước |
| `VISUAL` | Kiểm tra ngoại quan |
| `ELECTRICAL` | Kiểm tra điện |
| `POSITION` | Kiểm tra vị trí |
| `COLOR` | Kiểm tra màu sắc |
| `SURFACE` | Kiểm tra bề mặt |
| `OTHER` | Khác |

### Enum đồng bộ

**syncOperation:**

| Giá trị | Mô tả |
|---------|-------|
| `POINTS_PUSH` | Client push điểm đo lên server |
| `POINTS_PULL` | Client pull điểm đo từ server |
| `IMAGE_PUSH` | Client upload ảnh lên server |
| `IMAGE_PULL` | Client tải ảnh từ server |
| `FULL_SYNC` | Đồng bộ toàn bộ (getPoints) |
| `DELTA_SYNC` | Đồng bộ delta (deltaSyncPoints) |

**syncStatus:**

| Giá trị | Mô tả |
|---------|-------|
| `SUCCESS` | Hoàn thành, không lỗi |
| `PARTIAL` | Một số điểm thất bại |
| `FAILED` | Toàn bộ thất bại |
