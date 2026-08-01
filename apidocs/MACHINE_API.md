# Machine API — Tích hợp máy kiểm tra AOI

**Router**: `machineApi`  
**Base URL**: `http://<server>:<port>/api/trpc/machineApi.<endpoint>`  
**Xác thực**: khóa `mk_` qua `Authorization: Bearer` / `X-API-Key` (khuyến nghị), hoặc `apiKey` /
`machineCode` trong input (đường cũ, DEPRECATED). Xem [AUTHENTICATION.md](AUTHENTICATION.md).

> **Cập nhật doc 51 (P0/P1):** `submitInspection` thêm `idempotencyKey`, `pointsConfigVersion`, enum
> kết quả `OK|NG|NTF`, 11 field đo 3D, panel context, defect catalog. `deltaSyncPoints` thêm
> `deletedCodes` (tombstone). Tài liệu hóa 5 procedure Edge Deploy + 4 procedure quản lý khóa. Mọi
> mô tả dưới đây khớp zod THẬT trong `server/routers/machineApiRouters.ts`.

---

## Mục lục

**Ingest & sync**
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

**Edge model deploy / OTA** (scope `edge:sync`)
13. [checkModelVersion](#13-checkmodelversion) — Poll deployment cho máy
14. [getModelPackage](#14-getmodelpackage) — Lấy metadata tải gói model
15. [confirmDeployment](#15-confirmdeployment) — Báo hash sau khi tải + verify
16. [edgeHeartbeat](#16-edgeheartbeat) — Liveness của deployment
17. [syncEdgeResults](#17-syncedgeresults) — Đẩy kết quả suy luận offline

**Quản lý khóa (admin)** — [Key Management](#key-management-khóa-per-máy): `listKeys` · `issueKey` · `rotateKey` · `revokeKey`

---

## 1. submitInspection

Gửi kết quả kiểm tra từ máy AOI/AVI.

- **Loại**: Mutation (POST)
- **URL**: `POST /api/trpc/machineApi.submitInspection`
- **Scope**: `ingest:write`

### Input (khớp zod THẬT)

```typescript
{
  // ── Xác thực: body phải có 1 trong 2 (header Bearer/X-API-Key được ưu tiên nếu có) ──
  apiKey?: string,
  machineCode?: string,

  // ── Sản phẩm ──
  serialNumber: string,             // BẮT BUỘC — trim, 1..100 ký tự, KHÔNG được rỗng
  productModel?: string,            // Mã model sản phẩm (LƯU Ý tên: productModel)
  batchNumber?: string,             // Số lô

  // ── Kết quả ──
  overallResult: "OK" | "NG" | "NTF",   // BẮT BUỘC (enum 3 giá trị — MỚI có NTF)
  cycleTime?: number,               // Thời gian chu kỳ (giây)
  inspectionTime?: string,          // ISO-8601. NÊN kèm offset UTC (vd ...+07:00 / ...Z)

  // ── Chống ghi trùng (MỚI P1) ──
  idempotencyKey?: string,          // 8..200 ký tự — client sinh, ỔN ĐỊNH qua mọi lần retry
  pointsConfigVersion?: number,     // int ≥ 0 — version điểm đo máy đang chấm (khai báo)

  // ── Cấu trúc doanh nghiệp ──
  companyCode?, factoryCode?, workshopCode?, lineCode?, stageCode?: string,

  // ── Ngữ cảnh sản xuất ──
  productionOrderCode?: string,     // Mã lệnh sản xuất
  operatorId?: string,              // Mã thẻ công nhân (badge code)

  // ── Panel multi-up (MỚI) ──
  panelId?: string,                 // ≤ 100 ký tự — serial panel
  boardIndex?: number,              // int ≥ 1 — vị trí board trong panel

  // ── Dữ liệu đo ──
  measurements: [{
    pointId?: string,               // ID/mã điểm đo (thử pointId rồi pointCode)
    pointCode?: string,
    measuredValue?: number | string,
    result: "OK" | "NG" | "NTF",    // BẮT BUỘC
    remark?: string,
    imageBase64?: string,           // Ảnh crop — ≤ MACHINE_INGEST_MAX_IMAGE_B64 ký tự

    // 11 field đo 3D (number|string, đều optional):
    valueZ?, valueHeight?, valueArea?, valueVolume?, valueVoidPct?,
    valueCoplanarity?, valueWarpage?, valueOffsetX?, valueOffsetY?,
    valueTilt?, valueThickness?,

    // Defect catalog:
    defectCatalogCode?: string,     // ≤ 50 ký tự
    defectSeverity?: "critical" | "major" | "minor" | "cosmetic",
  }]
}
```

> **`serverReceivedAt` / `timeSource`** do SERVER tự đóng dấu — máy KHÔNG gửi được (nếu gửi sẽ bị ghi đè).

### Quy tắc `inspectionTime` (CASE #3)

- **Luôn** bị kiểm tra parse được — chuỗi không parse được → `BAD_REQUEST`.
- **Nên** kèm offset UTC. Không có offset → vẫn nhận nhưng gắn cờ `timeSource='machine_naive'`; khi bật
  `INGEST_REQUIRE_TIME_OFFSET=true` (mặc định TẮT) thì thiếu offset → `BAD_REQUEST`.
- Server đo độ lệch đồng hồ (skew) so với giờ nhận; lệch quá `INGEST_CLOCK_SKEW_WARN_SECONDS`
  (mặc định 300s) → gắn cờ `clockSkewFlagged` + cảnh báo ops (board KHÔNG bị từ chối — QĐ#3).

### Idempotency (chống ghi trùng — quan trọng)

Máy nào **retry** một board (mất mạng, DB flap…) PHẢI gửi **cùng `idempotencyKey`** cho mọi lần retry
của board đó. Nếu không gửi và cũng không gửi `inspectionTime`, mỗi lần nhận server đóng dấu thời gian
mới → khóa tự nhiên `(machineId, serialNumber, inspectionTime)` khác nhau → **ghi trùng**. Khuyến nghị:
sinh 1 UUID khi board được kiểm và tái dùng cho mọi retry.

### Output — CÓ 3 DẠNG, client phải xử lý CẢ BA

**(a) Bình thường:**
```json
{ "result": { "data": { "json": { "success": true, "inspectionId": 12345 } } } }
```

**(b) Retry của board ĐÃ ghi (idempotency hit):** trả về `inspectionId` GỐC + `duplicate:true`.
Client NGỪNG retry, không coi là lỗi.
```json
{ "result": { "data": { "json": { "success": true, "inspectionId": 12345, "duplicate": true } } } }
```

**(c) DB tạm sập, đã đệm store-forward (khi `INSPECTION_STORE_FORWARD_ENABLED`):** đã NHẬN, worker sẽ
replay khi DB hồi phục. Client coi như thành công, **KHÔNG** retry với `idempotencyKey` mới.
```json
{ "result": { "data": { "json": {
  "success": true, "queued": true, "submissionId": "…", "inspectionId": null } } } }
```

> Response KHÔNG có field `overallResult` (tài liệu cũ ghi sai). Chỉ có `success`/`inspectionId`
> (+ `duplicate` hoặc `queued`/`submissionId`).

### Hành vi

- Cập nhật heartbeat máy; nếu có `productionOrderCode` → cộng số lượng OK/NG lệnh sản xuất.
- `measuredValue` là số → lưu `measuredValue` (decimal); là chuỗi → `measuredValueText`.
- `pointCode`/`pointId` chưa có định nghĩa → **auto-provision** một point-def thật (không còn `pointDefId=0`).
- Server có thể **hạ OK→NG** một điểm khi vi phạm limit (spec-gate, khi bật `POINT_LIMIT_EVAL_ENABLED`);
  nếu có điểm bị hạ, `overallResult` của board được nâng lên NG (`originalResult` giữ nguyên để audit).
- Ảnh upload thất bại → row đo bị đánh dấu `[IMG_UPLOAD_FAILED]` trong `remark` (không im lặng).
- Kết quả NG → phát cảnh báo Socket.io + MQTT; yield < 90% → cảnh báo yield thấp.

### Ví dụ cURL

```bash
curl -X POST "http://localhost:3000/api/trpc/machineApi.submitInspection" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_xxxxxxxx..." \
  -d '{
    "json": {
      "apiKey": "mk_xxxxxxxx...",
      "serialNumber": "SN-2024-001",
      "productModel": "PROD-A",
      "overallResult": "OK",
      "cycleTime": 2.5,
      "inspectionTime": "2026-07-16T08:00:00+07:00",
      "idempotencyKey": "3f9c1a7e-8b2d-4e11-9c33-aa0011223344",
      "pointsConfigVersion": 6,
      "measurements": [
        { "pointCode": "CHECK-01", "measuredValue": 5.02, "result": "OK", "valueHeight": 0.21 },
        { "pointCode": "CHECK-02", "measuredValue": "PASS", "result": "OK" }
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

    // Hình học đa dạng (optional, additive) — xem measurement-geometry-and-fiducials.md
    shape?: "circle" | "rect" | "polygon" | "line" | "ring" | "mask" | "array",
    geometry?: object,              // discriminated union theo `shape`
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
        "limitChangesBlocked": 2,
        "points": [
          { "code": "P1", "id": 101, "action": "created", "coordTransformed": true },
          { "code": "P2", "id": 102, "action": "updated", "coordTransformed": false, "limitBlocked": true }
        ],
        "errors": []
      }
    }
  }
}
```

### ⚠️ Cổng ghi limit (B.6) — limit có thể bị ÂM THẦM strip

Một `POINTS_PUSH` từ máy có thể mang `lowerLimit`/`upperLimit`/`nominalValue` mới. Nhưng nếu điểm thuộc
sản phẩm đang ở lifecycle được **bảo vệ** (active/eol/archived, hoặc dev có program đã release) và limit
thực sự THAY ĐỔI, cổng governance sẽ **strip riêng các field limit** (geometry/ảnh/tên vẫn sync) rồi vẫn
trả `success: true`. Máy KHÔNG bị lỗi — nhưng limit **không được lưu**.

**Integrator PHẢI kiểm tra:**
- `points[i].limitBlocked === true` → limit của điểm đó bị chặn.
- `limitChangesBlocked` (số nguyên top-level) → tổng số điểm bị chặn limit trong lần sync này.

Nếu `limitChangesBlocked > 0`, sửa limit phải đi qua quy trình phê duyệt trên UI, không push từ máy.

### Hành vi

- Mỗi `code`: đã tồn tại → update, chưa có → create.
- Sau sync có thay đổi, tự tăng `pointsConfigVersion` + phát MQTT notification.
- Lưu log đồng bộ (`fromVersion → toVersion`, số lượng, trạng thái).

### Output — các field đầy đủ

`success, machineId, productModelId, productModelCode, pointsConfigVersion, total, created, updated,
failed, coordTransformed, serverImageWidth, serverImageHeight, limitChangesBlocked,
points[{code,id,action,coordTransformed?,limitBlocked?}], errors[{code,message}]`.

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

### Output (có thay đổi) — đầy đủ ~30 field/điểm

```json
{
  "result": { "data": { "json": {
    "success": true,
    "hasChanges": true,
    "currentVersion": 5,
    "sinceVersion": 3,
    "serverImageWidth": 1920,
    "serverImageHeight": 1080,
    "coordinateMode": "pixel",
    "fiducials": [
      {
        "id": 1, "code": "F1", "name": "Top-Left", "type": "cross",
        "positionX": 50, "positionY": 50,
        "normalizedX": 0.026, "normalizedY": 0.046,
        "searchWindowW": 64, "searchWindowH": 64,
        "templateImageUrl": null, "orderIndex": 0
      }
    ],
    "points": [
      {
        "id": 101, "code": "CHECK-01", "name": "Điểm 1", "description": null,
        "measurementType": "VISUAL", "measurementTypeCode": null, "unit": null,
        "lowerLimit": "4.5", "upperLimit": "5.5", "nominalValue": "5.0",
        "positionX": 500, "positionY": 300, "radius": 25,
        "normalizedX": "0.26041667", "normalizedY": "0.27777778", "normalizedRadius": "0.01302083",
        "cropWidth": 100, "cropHeight": 100, "orderIndex": 0, "isActive": true,
        "shape": "circle", "geometry": null,

        "positionZ": null, "heightMin": null, "heightMax": null, "heightNominal": null,
        "areaMin": null, "areaMax": null, "volumeMin": null, "volumeMax": null,
        "coplanarityMax": null, "warpageMax": null, "voidPctMax": null,
        "offsetXMax": null, "offsetYMax": null, "tiltMax": null,
        "thicknessMin": null, "thicknessMax": null, "criteria": null,

        "lighting": [
          {
            "shotIndex": 0, "name": null, "lightSource": "RING", "color": "WHITE",
            "colorHex": null, "intensityPct": 80, "angleDeg": null, "exposureUs": null,
            "gain": null, "focusOffsetUm": null, "opticalFilter": null, "purpose": null
          }
        ],
        "lastModifiedAt": "2024-01-15T08:30:00.000Z"
      }
    ],
    "deletedCodes": ["OLD-P07"],
    "deletedPoints": [
      { "id": 88, "code": "OLD-P07", "deletedAt": "2026-07-10T02:11:00.000Z", "deletedAtVersion": 4 }
    ]
  } } }
}
```

**Điểm cần lưu ý:**
- `shape: "array"` sẽ kèm thêm mảng `cells` (kết quả expand — mỗi phần tử
  `{ rowIndex, colIndex, shape, geometry }`). Xem [measurement-geometry-and-fiducials.md](measurement-geometry-and-fiducials.md).
- Các limit 3D (`heightMin/Max`, `areaMin/Max`, `coplanarityMax`…) transport CÙNG bộ limit mà spec-gate
  server dùng để chấm — máy nên áp cùng để không lệch verdict.
- `lighting` là recipe multi-shot (có thể `[]`).
- `lowerLimit/upperLimit/nominalValue/normalized*` trả về dạng **chuỗi** (decimal).

### `deletedCodes` — tombstone (MỚI P1, CASE #4)

`deletedCodes` (mảng string) và `deletedPoints` liệt kê các điểm đã **bị xóa/nghỉ** kể từ `sinceVersion`.
Máy nào MERGE point-set (hoặc cache theo `code`) PHẢI **NGỪNG kiểm** các code trong danh sách này —
trước đây chúng chỉ biến mất khỏi `points`, khiến máy tiếp tục chấm board theo spec không còn tồn tại.
Additive: consumer cũ chỉ đọc `points` không bị ảnh hưởng.

### Output (không có thay đổi)

```json
{
  "result": { "data": { "json": {
    "success": true,
    "hasChanges": false,
    "currentVersion": 3,
    "sinceVersion": 3,
    "points": [],
    "deletedCodes": [],
    "deletedPoints": []
  } } }
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

## Edge Model Deploy / OTA (scope `edge:sync`)

Nhóm 5 procedure cho phép server đẩy model AI xuống máy edge và máy đồng bộ ngược kết quả suy luận
offline. Đều xác thực như phần còn lại của router (`apiKey`/`machineCode`/header). Luồng chuẩn:

```
checkModelVersion  → getModelPackage  → (tải theo hash)  → confirmDeployment  → edgeHeartbeat
   (poll)             (download meta)     GET downloadUrl      (verify hash)        (liveness, lặp)
                                                                                        │
                                                                          syncEdgeResults (đẩy kết quả offline)
```

### 13. checkModelVersion

Máy poll các deployment READY/DEPLOYED/ACTIVE dành cho nó để so `packageHash` local.

- **Loại**: Query (GET) · **Scope**: `edge:sync`
- **Input**: `{ apiKey?, machineCode? }` (1 trong 2)
- **Output**:
```json
{
  "success": true, "machineId": 1, "machineCode": "AOI-01",
  "deployments": [
    { "deploymentId": 7, "modelId": 3, "modelVersion": "1.4.0",
      "packageVersion": "1.4.0-b12", "packageHash": "sha256:…", "packageSize": 10485760,
      "status": "READY" }
  ]
}
```
Chỉ trả deployment ở trạng thái `READY|DOWNLOADING|DEPLOYED|ACTIVE|OUTDATED` (khớp máy theo `machineId`
hoặc `deviceId === machineCode`).

### 14. getModelPackage

Lấy metadata tải cho 1 deployment; lật `READY → DOWNLOADING`. KHÔNG trả URL storage thô — chỉ trả
đường proxy đã xác thực qua apiKey.

- **Loại**: Mutation (POST) · **Scope**: `edge:sync`
- **Input**: `{ apiKey?, machineCode?, deploymentId: number }`
- **Output**:
```json
{
  "success": true, "deploymentId": 7,
  "downloadUrl": "/api/edge/download/7",
  "packageHash": "sha256:…", "packageSize": 10485760, "packageVersion": "1.4.0-b12",
  "modelId": 3, "modelVersion": "1.4.0", "deployConfig": null
}
```
Deployment không thuộc máy → `FORBIDDEN`; gói chưa sẵn sàng (`packageKey`/`packageHash` rỗng) → `CONFLICT` (`Package not ready`).
Tải nội dung tại `GET <downloadUrl>` (gửi khóa qua header apiKey).

### 15. confirmDeployment

Máy báo hash local sau khi tải + verify. Khớp → `DEPLOYED`; lệch → `FAILED`.

- **Loại**: Mutation (POST) · **Scope**: `edge:sync`
- **Input**: `{ apiKey?, machineCode?, deploymentId: number, localHash: string }` (`localHash` 1..128 ký tự)
- **Output**: `{ "success": <matched>, ... }` (`success=true` khi hash khớp).

### 16. edgeHeartbeat

Liveness định kỳ của deployment. `DEPLOYED → ACTIVE`; refresh `lastHeartbeat` của máy.

- **Loại**: Mutation (POST) · **Scope**: `edge:sync`
- **Input**: `{ apiKey?, machineCode?, deploymentId: number }`
- **Output**: `{ "success": true, ... }`

### 17. syncEdgeResults

Máy đẩy kết quả suy luận offline. **Idempotent theo `localResultId`** (gửi lại cùng batch không nhân đôi row).

- **Loại**: Mutation (POST) · **Scope**: `edge:sync` · bị rate-limit ingest như `submitInspection`.
- **Input**:
```typescript
{
  apiKey?: string, machineCode?: string,
  deploymentId: number,
  results: [{                         // tối đa 500 phần tử
    localResultId: string,            // 1..100 ký tự — khóa idempotency
    inputReference?: string,
    predictions: [{ label: string, confidence: number }],
    confidence: number,
    topLabel: string,                 // ≤ 100 ký tự
    processingTimeMs?: number,        // int ≥ 0
    inferredAt: string | Date,
    inspectionId?: number,            // int > 0 (liên kết inspection nếu có)
  }]
}
```
- **Output**: `{ "success": true, ... }`.

---

## Key Management (khóa per-máy)

Quản lý khóa `mk_` (admin — quyền `admin_system`). Bản rõ khóa trả **đúng một lần**. Xem
[AUTHENTICATION.md](AUTHENTICATION.md).

| Procedure | Loại | Quyền | Input | Output |
|-----------|------|-------|-------|--------|
| `listKeys` | Query | `admin_system` · canView | `{ machineId: number }` | `PublicMachineKeyRow[]` (không có hash/plaintext) |
| `issueKey` | Mutation | `admin_system` · canCreate | `{ machineId, name?, scopes?: string[], expiresAt? }` | `PublicMachineKeyRow & { plaintextKey }` |
| `rotateKey` | Mutation | `admin_system` · canEdit | `{ keyId: number }` | thu hồi cũ + `{ …, plaintextKey }` mới cùng scope/expiry |
| `revokeKey` | Mutation | `admin_system` · canEdit | `{ keyId: number }` | `PublicMachineKeyRow` (isActive=false) |

- `scopes` mặc định khi cấp mới: `["ingest:write", "equipment:read", "edge:sync"]`. Grant ngoài từ vựng → `BAD_REQUEST`.
- `PublicMachineKeyRow`: `id, machineId, name, description, keyPrefix, scopes, isActive, revokedAt, expiresAt, lastUsedAt, createdBy, createdAt` — **không bao giờ** lộ `keyHash`/plaintext.

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
