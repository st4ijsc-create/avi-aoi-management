# AVI-AOI Management System — API Documentation

## Tổng quan / Overview

Hệ thống AVI-AOI Management cung cấp API cho phép ứng dụng bên thứ 3 (máy kiểm tra AOI, phần mềm quản lý chất lượng, mobile app) tích hợp và trao đổi dữ liệu tự động.

The AVI-AOI Management System provides APIs for third-party applications (AOI inspection machines, quality management software, mobile apps) to integrate and exchange data automatically.

---

## Giao thức / Protocol

Hệ thống sử dụng **tRPC** qua HTTP POST/GET, không phải REST thuần túy.

- **Base URL**: `http://<server>:<port>/api/trpc`
- Queries (đọc dữ liệu): `GET /api/trpc/<router>.<procedure>?input=<urlEncodedJSON>`
- Mutations (ghi dữ liệu): `POST /api/trpc/<router>.<procedure>` với body JSON

### Ví dụ gọi API / Example API Calls

**Query (GET)**:
```
GET /api/trpc/machineApi.heartbeat?input={"json":{"apiKey":"your-api-key"}}
```

**Mutation (POST)**:
```
POST /api/trpc/machineApi.submitInspection
Content-Type: application/json

{
  "json": {
    "apiKey": "your-api-key",
    "serialNumber": "SN001",
    "overallResult": "OK",
    "measurements": []
  }
}
```

> **Lưu ý**: Tất cả request/response đều được wrap trong `{ "json": ... }` theo chuẩn tRPC superjson.

### Response Format

Tất cả response đều có dạng:
```json
{
  "result": {
    "data": {
      "json": { ... }  // Dữ liệu thực tế
    }
  }
}
```

Với lỗi:
```json
{
  "error": {
    "json": {
      "message": "Error message",
      "code": -32600,
      "data": {
        "code": "UNAUTHORIZED",
        "httpStatus": 401
      }
    }
  }
}
```

---

## Xác thực / Authentication

Tất cả API cho app bên thứ 3 sử dụng phương thức xác thực bằng **API Key** hoặc **Machine Code**.

| Phương thức | Trường | Mô tả |
|-------------|--------|-------|
| API Key | `apiKey` | API key được cấp cho từng máy |
| Machine Code | `machineCode` | Mã máy đã được đăng ký trên hệ thống |

> Phải cung cấp ít nhất 1 trong 2 trường. Dữ liệu máy được tạo và quản lý tại giao diện admin.

Chi tiết → xem [AUTHENTICATION.md](AUTHENTICATION.md)

---

## Danh sách API / API Index

### 1. Machine API — Tích hợp máy kiểm tra
Router prefix: `machineApi`

Dành cho máy AOI gửi kết quả kiểm tra, đồng bộ điểm đo, ảnh mẫu.

| Procedure | Type | Mô tả |
|-----------|------|-------|
| `submitInspection` | Mutation | Gửi kết quả kiểm tra từ máy |
| `uploadImage` | Mutation | Upload ảnh cho kết quả đo |
| `syncMeasurementPoints` | Mutation | Đồng bộ điểm đo (AOI → Server) |
| `syncProductImage` | Mutation | Đồng bộ ảnh mẫu sản phẩm (AOI → Server) |
| `syncPointImage` | Mutation | Upload ảnh mẫu cho 1 điểm đo |
| `heartbeat` | Mutation | Cập nhật trạng thái máy online |
| `checkPointsVersion` | Query | Kiểm tra phiên bản config điểm đo |
| `getPoints` | Query | Tải điểm đo từ server |
| `getProductImage` | Query | Tải ảnh mẫu sản phẩm từ server |
| `getPointImage` | Query | Tải ảnh mẫu điểm đo từ server |
| `deltaSyncPoints` | Query | Đồng bộ delta (chỉ điểm thay đổi) |
| `getSyncHistory` | Query | Lịch sử đồng bộ |

Chi tiết → xem [MACHINE_API.md](MACHINE_API.md)

### 2. Product API — Truy xuất dữ liệu sản phẩm
Router prefix: `publicProductApi`

Dành cho ứng dụng đọc thông tin sản phẩm, điểm đo, ảnh mẫu.

| Procedure | Type | Mô tả |
|-----------|------|-------|
| `listProducts` | Query | Danh sách sản phẩm (có tìm kiếm, phân trang) |
| `getProductByCode` | Query | Chi tiết sản phẩm theo mã |
| `getProductById` | Query | Chi tiết sản phẩm theo ID |
| `getMeasurementPoints` | Query | Danh sách điểm đo |
| `getProductImage` | Query | Ảnh mẫu sản phẩm (base64) |
| `getPointImage` | Query | Ảnh mẫu điểm đo (base64) |

Chi tiết → xem [PRODUCT_API.md](PRODUCT_API.md)

### 3. AI Model API — Quản lý model AI
Router prefix: `aiModel`

Dành cho quản lý model AI, chạy inference, xem kết quả. (**Yêu cầu đăng nhập**)

| Procedure | Type | Mô tả |
|-----------|------|-------|
| `list` | Query | Danh sách model AI |
| `getById` | Query | Chi tiết model theo ID |
| `getByCode` | Query | Chi tiết model theo code |
| `create` | Mutation | Tạo model mới (admin) |
| `update` | Mutation | Cập nhật model (admin) |
| `delete` | Mutation | Xóa model (admin) |
| `uploadFile` | Mutation | Upload file model (admin) |
| `listVersions` | Query | Danh sách phiên bản model |
| `createVersion` | Mutation | Tạo phiên bản mới (admin) |
| `activateVersion` | Mutation | Kích hoạt phiên bản (admin) |
| `getFileUrl` | Query | URL tải file model |
| `runInference` | Mutation | Chạy suy luận AI trên ảnh |
| `getInferenceResults` | Query | Lịch sử kết quả suy luận |
| `getInferenceStats` | Query | Thống kê hiệu suất model |
| `getActiveForProduct` | Query | Model đang active cho sản phẩm |
| `loadedModels` | Query | Danh sách model đã loaded |

Chi tiết → xem [AI_MODEL_API.md](AI_MODEL_API.md)

---

## Hướng dẫn tích hợp nhanh / Quick Start

### Bước 1: Lấy API Key
Liên hệ admin hệ thống để tạo máy và nhận API key hoặc machine code.

### Bước 2: Test kết nối
```bash
# Curl test heartbeat
curl "http://localhost:3000/api/trpc/machineApi.heartbeat" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"apiKey":"your-api-key"}}'
```

### Bước 3: Gửi inspection
```bash
curl "http://localhost:3000/api/trpc/machineApi.submitInspection" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{
    "apiKey":"your-api-key",
    "serialNumber":"SN-TEST-001",
    "overallResult":"OK",
    "measurements":[
      {"pointCode":"P001","measuredValue":25.5,"result":"OK"},
      {"pointCode":"P002","measuredValue":"PASS","result":"OK"}
    ]
  }}'
```

### Bước 4: Đọc sản phẩm
```bash
curl "http://localhost:3000/api/trpc/publicProductApi.listProducts?input=%7B%22json%22%3A%7B%22apiKey%22%3A%22your-api-key%22%7D%7D"
```

---

### 4. External Admin API — Quản trị từ hệ thống bên ngoài
Endpoints: `/api/external/*`

Dành cho MES, ERP, phần mềm quản lý nhà máy. Xác thực bằng Master Key hoặc JWT.

Chi tiết → xem [SYNC_API.md](SYNC_API.md#9-external-admin-api)

### 5. REST Proxy — API REST chuẩn ✨ MỚI
Endpoints: `/api/machine/*`, `/api/public/*`

Các endpoint REST proxy cho tRPC, phù hợp với client C#, Python, firmware không hỗ trợ tRPC.

Chi tiết → xem [SYNC_API.md](SYNC_API.md#8-rest-proxy-endpoints)

---

## Tài liệu chi tiết / Detailed Docs

| Tài liệu | Mô tả |
|-----------|-------|
| [AUTHENTICATION.md](AUTHENTICATION.md) | Hướng dẫn xác thực |
| [MACHINE_API.md](MACHINE_API.md) | API tích hợp máy AOI |
| [PRODUCT_API.md](PRODUCT_API.md) | API truy xuất sản phẩm |
| [AI_MODEL_API.md](AI_MODEL_API.md) | API quản lý AI model |
| [SYNC_API.md](SYNC_API.md) | ✨ API đồng bộ ảnh & điểm đo (tổng hợp cho bên thứ 3) |
| [ERROR_CODES.md](ERROR_CODES.md) | Mã lỗi & xử lý |
| [EXAMPLES.md](EXAMPLES.md) | Ví dụ tích hợp đa ngôn ngữ |

---

## Rate Limiting

| Endpoint | Giới hạn |
|----------|---------|
| `/api/trpc/*` | 1000 requests / 15 phút |
| `/api/auth/*` | 30 requests / 15 phút |

## Body Size Limit

Maximum request body: **50 MB** (hỗ trợ upload ảnh base64 lớn)
