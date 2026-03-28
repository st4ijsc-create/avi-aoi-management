# Error Codes — Mã lỗi API

Tất cả API sử dụng tRPC error codes, được map sang HTTP status code chuẩn.

---

## Bảng mã lỗi

| tRPC Code | HTTP Status | Mô tả | Khi nào xảy ra |
|-----------|-------------|-------|-----------------|
| `BAD_REQUEST` | 400 | Dữ liệu đầu vào không hợp lệ | Thiếu trường bắt buộc, sai kiểu dữ liệu, validation fail |
| `UNAUTHORIZED` | 401 | Chưa xác thực / sai thông tin | API key sai, machine code không tồn tại, chưa đăng nhập |
| `FORBIDDEN` | 403 | Không có quyền | Cần quyền Admin nhưng user thường |
| `NOT_FOUND` | 404 | Không tìm thấy | Product/Model/Point không tồn tại |
| `TOO_MANY_REQUESTS` | 429 | Quá giới hạn rate | Vượt 1000 req / 15 phút |
| `INTERNAL_SERVER_ERROR` | 500 | Lỗi server | Lỗi database, file system, hoặc lỗi ngoại lệ |

---

## Cấu trúc response lỗi

```json
{
  "error": {
    "message": "Invalid API key",
    "code": -32001,
    "data": {
      "code": "UNAUTHORIZED",
      "httpStatus": 401,
      "path": "machineApi.submitInspection"
    }
  }
}
```

---

## Validation Errors (BAD_REQUEST)

Khi input không hợp lệ (Zod validation), response bao gồm chi tiết từng lỗi:

```json
{
  "error": {
    "message": "[{\"code\":\"too_small\",\"minimum\":1,\"type\":\"string\",\"inclusive\":true,\"exact\":false,\"message\":\"String must contain at least 1 character(s)\",\"path\":[\"code\"]}]",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "path": "aiModel.create"
    }
  }
}
```

### Parse Zod Errors

```python
import json

error_msg = response.json()["error"]["message"]
try:
    zod_errors = json.loads(error_msg)
    for err in zod_errors:
        print(f"  Field: {'.'.join(err['path'])}")
        print(f"  Error: {err['message']}")
except json.JSONDecodeError:
    print(f"  Error: {error_msg}")
```

---

## Lỗi phổ biến theo API

### Machine API

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `submitInspection` | `UNAUTHORIZED` | API key hoặc machine code sai |
| `submitInspection` | `NOT_FOUND` | `productCode` không tồn tại hoặc không active |
| `submitInspection` | `BAD_REQUEST` | `measurements` trống hoặc sai định dạng |
| `syncMeasurementPoints` | `NOT_FOUND` | `productCode` không tồn tại |
| `uploadImage` | `NOT_FOUND` | `inspectionId` hoặc `measurementResultId` không tồn tại |
| `checkPointsVersion` | `NOT_FOUND` | `productCode` không tồn tại |

### Product API

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `listProducts` | `UNAUTHORIZED` | Thiếu cả `apiKey` và `machineCode` |
| `getProductByCode` | `NOT_FOUND` | `code` không tồn tại hoặc sản phẩm không active |
| `getProductImage` | `NOT_FOUND` | Sản phẩm không có ảnh tham chiếu |
| `getPointImage` | `NOT_FOUND` | Point không có ảnh tham chiếu |
| `getPointImage` | `BAD_REQUEST` | Thiếu `pointId` và (`pointCode` + `productCode`) |

### AI Model API

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `create` | `FORBIDDEN` | User không phải Admin |
| `getById` | `NOT_FOUND` | Model ID không tồn tại |
| `runInference` | `NOT_FOUND` | Model không tồn tại hoặc chưa có file |
| `runInference` | `INTERNAL_SERVER_ERROR` | Lỗi ONNX runtime (file mô hình lỗi, shape mismatch) |
| `delete` | `NOT_FOUND` | Model ID không tồn tại |
| `activateVersion` | `NOT_FOUND` | Version ID không tồn tại |

---

## Rate Limiting

| Endpoint Group | Giới hạn | Window |
|---------------|----------|--------|
| `/api/trpc/*` | 1000 requests | 15 phút |
| `/api/auth/*` | 30 requests | 15 phút |

Khi vượt giới hạn:

```json
{
  "error": "Too many requests, please try again later."
}
```

**HTTP Status**: `429 Too Many Requests`  
**Header**: `Retry-After: <seconds>`

### Xử lý rate limit (Python)

```python
import time

def api_call_with_retry(func, max_retries=3, *args, **kwargs):
    for attempt in range(max_retries):
        response = func(*args, **kwargs)
        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", 60))
            time.sleep(retry_after)
            continue
        return response
    raise Exception("Rate limit exceeded after max retries")
```

---

## Best Practices

1. **Luôn kiểm tra HTTP status code** trước khi parse JSON
2. **Parse Zod errors** để hiển thị lỗi validation chi tiết cho user
3. **Implement retry logic** cho lỗi `429` và `500`
4. **Không retry** cho `400`, `401`, `403`, `404` — đây là lỗi cần fix
5. **Log `path`** trong error response để debug nhanh hơn
