# Product API — Tra cứu sản phẩm và điểm đo

**Router**: `publicProductApi`  
**Base URL**: `http://<server>:<port>/api/trpc/publicProductApi.<endpoint>`  
**Xác thực**: API Key hoặc Machine Code trong input

---

## Mục lục

1. [listProducts](#1-listproducts) — Danh sách sản phẩm
2. [getProductByCode](#2-getproductbycode) — Chi tiết sản phẩm theo code
3. [getProductById](#3-getproductbyid) — Chi tiết sản phẩm theo ID
4. [getMeasurementPoints](#4-getmeasurementpoints) — Danh sách điểm đo
5. [getProductImage](#5-getproductimage) — Ảnh tham chiếu sản phẩm
6. [getPointImage](#6-getpointimage) — Ảnh tham chiếu điểm đo
7. [getPointStatsByStation](#7-getpointstatsbystation) — Thống kê điểm đo theo trạm
8. [getPointImagesByStation](#8-getpointimagesbystation) — Ảnh đo thực tế điểm đo theo trạm

---

## 1. listProducts

Lấy danh sách sản phẩm với tìm kiếm và phân trang.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.listProducts?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  search?: string,                   // Tìm theo tên/code
  lifecycleStatus?: "development" | "active" | "eol" | "archived",
  limit?: number,                    // 1-100, default: 50
  offset?: number,                   // default: 0
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "data": [
          {
            "id": 5,
            "code": "PROD-A",
            "name": "Product A",
            "description": "Mô tả sản phẩm",
            "category": "Electronics",
            "productLine": "Line X",
            "variant": "v1",
            "lifecycleStatus": "active",
            "referenceImageUrl": "/uploads/...",
            "imageWidth": 1920,
            "imageHeight": 1080,
            "targetYieldRate": "95.00",
            "minYieldRate": "90.00"
          }
        ],
        "total": 1
      }
    }
  }
}
```

> **Lưu ý**: Chỉ trả về sản phẩm đang active (`isActive = true`). Sắp xếp theo tên (A→Z).

### Ví dụ cURL

```bash
INPUT='{"json":{"apiKey":"your-api-key","search":"PROD","limit":10}}'
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$INPUT")
curl "http://localhost:3000/api/trpc/publicProductApi.listProducts?input=$ENCODED"
```

---

## 2. getProductByCode

Lấy chi tiết sản phẩm kèm danh sách tất cả điểm đo.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getProductByCode?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  code: string                       // Mã sản phẩm (BẮT BUỘC)
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
          "product": {
            "id": 5,
            "code": "PROD-A",
            "name": "Product A",
            "description": "...",
            "category": "Electronics",
            "productLine": "Line X",
            "variant": "v1",
            "lifecycleStatus": "active",
            "referenceImageUrl": "/uploads/...",
            "imageWidth": 1920,
            "imageHeight": 1080,
            "targetYieldRate": "95.00",
            "minYieldRate": "90.00"
          },
          "measurementPoints": [
            {
              "id": 101,
              "code": "CHECK-01",
              "name": "Điểm kiểm tra 1",
              "description": "Kiểm tra kích thước",
              "measurementType": "DIMENSION",
              "unit": "mm",
              "lowerLimit": "4.5",
              "upperLimit": "5.5",
              "nominalValue": "5.0",
              "positionX": 500,
              "positionY": 300,
              "radius": 25,
              "normalizedX": 0.26041667,
              "normalizedY": 0.27777778,
              "normalizedRadius": 0.01302083,
              "referenceImageUrl": "/uploads/...",
              "cropWidth": 100,
              "cropHeight": 100,
              "orderIndex": 0
            }
          ]
        }
      }
    }
  }
}
```

---

## 3. getProductById

Giống `getProductByCode` nhưng tìm theo ID số.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getProductById?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  id: number                         // ID sản phẩm (BẮT BUỘC)
}
```

### Output

Cấu trúc giống [getProductByCode](#2-getproductbycode).

---

## 4. getMeasurementPoints

Lấy danh sách điểm đo của sản phẩm theo code.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getMeasurementPoints?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productCode: string               // Mã sản phẩm (BẮT BUỘC)
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "imageWidth": 1920,
        "imageHeight": 1080,
        "data": [
          {
            "id": 101,
            "code": "CHECK-01",
            "name": "Điểm kiểm tra 1",
            "measurementType": "VISUAL",
            "unit": null,
            "lowerLimit": null,
            "upperLimit": null,
            "nominalValue": null,
            "positionX": 500,
            "positionY": 300,
            "radius": 25,
            "normalizedX": 0.26041667,
            "normalizedY": 0.27777778,
            "normalizedRadius": 0.01302083,
            "referenceImageUrl": "/uploads/...",
            "cropWidth": 100,
            "cropHeight": 100,
            "orderIndex": 0
          }
        ],
        "total": 20
      }
    }
  }
}
```

> **Lưu ý**: `imageWidth` và `imageHeight` ở top-level cho biết kích thước ảnh tham chiếu sản phẩm gốc. Các `positionX/Y` tương ứng với kích thước này.

---

## 5. getProductImage

Lấy ảnh tham chiếu sản phẩm dưới dạng **base64 Data URL**.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getProductImage?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  productCode: string               // Mã sản phẩm (BẮT BUỘC)
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
          "productCode": "PROD-A",
          "productName": "Product A",
          "imageUrl": "data:image/jpeg;base64,/9j/4AAQ...",
          "imageWidth": 1920,
          "imageHeight": 1080
        }
      }
    }
  }
}
```

> Ảnh được chuyển đổi sang base64 Data URL để client bên thứ 3 sử dụng trực tiếp mà không cần truy cập file system server.

---

## 6. getPointImage

Lấy ảnh tham chiếu điểm đo.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getPointImage?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  // Cách 1: Theo pointId
  pointId?: number,
  // Cách 2: Theo pointCode + productCode
  pointCode?: string,
  productCode?: string,
}
```

> **Quy tắc**: Cung cấp `pointId` HOẶC (`pointCode` + `productCode`).

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "data": {
          "pointId": 101,
          "pointCode": "CHECK-01",
          "pointName": "Điểm kiểm tra 1",
          "imageUrl": "data:image/jpeg;base64,...",
          "cropWidth": 100,
          "cropHeight": 100
        }
      }
    }
  }
}
```

---

## Giải thích trường dữ liệu

### Tọa độ (Coordinates)

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `positionX` | `number` | Tọa độ X tuyệt đối (pixel) trên ảnh tham chiếu |
| `positionY` | `number` | Tọa độ Y tuyệt đối (pixel) |
| `radius` | `number` | Bán kính vùng kiểm tra (pixel) |
| `normalizedX` | `number \| null` | Tọa độ X chuẩn hóa (0.0 - 1.0, tương đối với `imageWidth`) |
| `normalizedY` | `number \| null` | Tọa độ Y chuẩn hóa (0.0 - 1.0, tương đối với `imageHeight`) |
| `normalizedRadius` | `number \| null` | Bán kính chuẩn hóa (tương đối với `imageWidth`) |
| `cropWidth` | `number` | Chiều rộng vùng crop ảnh điểm đo (pixel) |
| `cropHeight` | `number` | Chiều cao vùng crop ảnh điểm đo (pixel) |

### Loại đo lường (measurementType)

| Giá trị | Mô tả |
|---------|-------|
| `DIMENSION` | Đo kích thước (mm, cm, ...) |
| `VISUAL` | Kiểm tra ngoại quan |
| `ELECTRICAL` | Kiểm tra điện |
| `POSITION` | Kiểm tra vị trí |
| `COLOR` | Kiểm tra màu sắc |
| `SURFACE` | Kiểm tra bề mặt |
| `OTHER` | Khác |

### Trạng thái vòng đời (lifecycleStatus)

| Giá trị | Mô tả |
|---------|-------|
| `development` | Đang phát triển |
| `active` | Đang sản xuất |
| `eol` | Hết vòng đời |
| `archived` | Đã lưu trữ |

---

## 7. getPointStatsByStation

Lấy thống kê tất cả các điểm đo của sản phẩm theo trạm (station). Bao gồm số lượng OK/NG, tỉ lệ NG, min/max/avg cho từng điểm đo.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getPointStatsByStation?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  stationCode: string,         // Mã trạm (bắt buộc)
  productCode?: string,        // Mã sản phẩm (tùy chọn, nếu không truyền sẽ lấy sản phẩm được kiểm tra nhiều nhất)
  startDate?: string,          // Ngày bắt đầu ISO (VD: "2026-03-01T00:00:00.000Z")
  endDate?: string,            // Ngày kết thúc ISO
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "station": { "id": 1, "code": "ST-01", "name": "Trạm kiểm tra 1" },
        "product": { "id": 5, "code": "PCB-001", "name": "Bo mạch chính" },
        "startDate": "2026-03-01T00:00:00.000Z",
        "endDate": "2026-03-21T00:00:00.000Z",
        "data": [
          {
            "pointDefId": 10,
            "pointCode": "MP-001",
            "pointName": "Khoảng cách IC U1",
            "measurementType": "DIMENSION",
            "unit": "mm",
            "lowerLimit": 0.8,
            "upperLimit": 1.2,
            "nominalValue": 1.0,
            "totalCount": 1500,
            "okCount": 1480,
            "ngCount": 20,
            "ngRate": 1.33,
            "minValue": 0.75,
            "maxValue": 1.25,
            "avgValue": 1.002
          }
        ],
        "total": 12
      }
    }
  }
}
```

### Ví dụ cURL

```bash
# Thống kê điểm đo trạm ST-01 cho sản phẩm PCB-001
curl "http://localhost:3000/api/trpc/publicProductApi.getPointStatsByStation?input=%7B%22json%22%3A%7B%22apiKey%22%3A%22your-api-key%22%2C%22stationCode%22%3A%22ST-01%22%2C%22productCode%22%3A%22PCB-001%22%2C%22startDate%22%3A%222026-03-01T00%3A00%3A00.000Z%22%2C%22endDate%22%3A%222026-03-21T00%3A00%3A00.000Z%22%7D%7D"
```

### Lưu ý

- Nếu không truyền `productCode`, API sẽ tự động lấy sản phẩm được kiểm tra nhiều nhất tại trạm đó.
- Nếu không truyền `startDate`/`endDate`, sẽ lấy toàn bộ lịch sử.
- `ngRate` tính theo phần trăm (%), làm tròn 2 chữ số thập phân.

---

## 8. getPointImagesByStation

Lấy toàn bộ ảnh đo thực tế (ảnh chụp từ máy AOI) của một điểm đo cụ thể tại trạm. Hỗ trợ lọc theo kết quả (OK/NG), phân trang.

- **Loại**: Query (GET)
- **URL**: `GET /api/trpc/publicProductApi.getPointImagesByStation?input=...`

### Input

```typescript
{
  apiKey?: string,
  machineCode?: string,
  stationCode: string,         // Mã trạm (bắt buộc)
  pointCode: string,           // Mã điểm đo (bắt buộc)
  productCode?: string,        // Mã sản phẩm (tùy chọn)
  resultFilter?: "ALL" | "OK" | "NG",  // Lọc theo kết quả, default: "ALL"
  startDate?: string,          // Ngày bắt đầu ISO
  endDate?: string,            // Ngày kết thúc ISO
  limit?: number,              // 1-200, default: 50
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
        "point": {
          "id": 10,
          "code": "MP-001",
          "name": "Khoảng cách IC U1",
          "measurementType": "DIMENSION"
        },
        "station": { "id": 1, "code": "ST-01", "name": "Trạm kiểm tra 1" },
        "data": [
          {
            "id": 5001,
            "imageUrl": "/uploads/measurements/abc123.jpg",
            "result": "NG",
            "measuredValue": "1.35",
            "serialNumber": "SN-20260321-0001",
            "inspectionTime": "2026-03-21T08:30:00.000Z"
          },
          {
            "id": 5000,
            "imageUrl": "/uploads/measurements/def456.jpg",
            "result": "OK",
            "measuredValue": "1.01",
            "serialNumber": "SN-20260321-0002",
            "inspectionTime": "2026-03-21T08:25:00.000Z"
          }
        ],
        "total": 1500,
        "limit": 50,
        "offset": 0
      }
    }
  }
}
```

### Ví dụ cURL

```bash
# Lấy ảnh NG điểm đo MP-001 tại trạm ST-01
curl "http://localhost:3000/api/trpc/publicProductApi.getPointImagesByStation?input=%7B%22json%22%3A%7B%22apiKey%22%3A%22your-api-key%22%2C%22stationCode%22%3A%22ST-01%22%2C%22pointCode%22%3A%22MP-001%22%2C%22resultFilter%22%3A%22NG%22%2C%22limit%22%3A20%7D%7D"
```

### Lưu ý

- `imageUrl` là đường dẫn tương đối trên server. Ứng dụng bên thứ 3 cần ghép với base URL để tải ảnh: `http://<server>:<port>{imageUrl}`.
- Sắp xếp theo thời gian kiểm tra mới nhất trước.
- Sử dụng `limit`/`offset` để phân trang khi có nhiều ảnh.
- Chỉ trả về các kết quả có ảnh (imageUrl không null).
