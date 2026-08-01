# Error Codes — Mã lỗi API

Hệ thống có **3 lớp API** với **3 dạng phong bì lỗi (error envelope) KHÁC NHAU**. Đọc kỹ mục
[Ba dạng phong bì lỗi](#ba-dạng-phong-bì-lỗi) — client phải parse đúng dạng theo lớp API đang gọi.

---

## Bảng mã lỗi (tRPC)

Lớp tRPC (`/api/trpc/*`) map mã lỗi tRPC sang HTTP status chuẩn:

| tRPC Code | HTTP Status | Mô tả | Khi nào xảy ra |
|-----------|-------------|-------|-----------------|
| `BAD_REQUEST` | 400 | Dữ liệu đầu vào không hợp lệ | Thiếu trường bắt buộc, sai kiểu, Zod validation fail, `inspectionTime` không parse được |
| `UNAUTHORIZED` | 401 | Chưa xác thực / sai thông tin | API key sai/hết hạn/bị thu hồi, machine code không tồn tại, claim token sai, đường yếu bị `deny` |
| `FORBIDDEN` | 403 | Không đủ quyền / thiếu scope | Machine key thiếu scope yêu cầu (`ingest:write`/`edge:sync`/`equipment:read`), cần admin |
| `NOT_FOUND` | 404 | Không tìm thấy | Product/Model/Point/Deployment không tồn tại |
| `PRECONDITION_FAILED` | 412 | Điều kiện chưa thỏa | Máy chưa được duyệt khi cấp claim token, hàng đợi đăng ký đầy, claim `no_key` |
| `CONFLICT` | 409 | Xung đột trạng thái | Mã máy trùng, gói model chưa sẵn sàng (`Package not ready`) |
| `TOO_MANY_REQUESTS` | 429 | Vượt giới hạn rate | Xem mục [Rate Limiting](#rate-limiting) — kèm header `Retry-After` |
| `INTERNAL_SERVER_ERROR` | 500 | Lỗi server | Lỗi database, file system, ngoại lệ |

> **DB tạm sập → 503, RETRY được.** Khi database mất kết nối, các endpoint ingest REST (`/api/v1/*`,
> health) trả **HTTP 503** với thân `{ "ok": false, "error": "Database unavailable — retry" }`.
> Với `submitInspection` (tRPC), khi bật `INSPECTION_STORE_FORWARD_ENABLED` server KHÔNG lỗi mà
> **đệm vào WAL** và trả `{ success:true, queued:true, inspectionId:null }` (xem MACHINE_API.md §1).

---

## Ba dạng phong bì lỗi

### 1. tRPC (`/api/trpc/*`)

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

- `code: -32001` cho lỗi ứng dụng (UNAUTHORIZED/FORBIDDEN/NOT_FOUND/…); `code: -32600` cho lỗi
  parse/validation (BAD_REQUEST).
- `data.code` là mã tRPC dạng chuỗi; `data.httpStatus` là HTTP status; `data.path` là procedure.
- Response tRPC được wrap superjson: với batch/superjson một số client thấy thêm lớp `"json"`
  (`error.json.message`). Luôn đọc HTTP status trước, rồi lần theo `code`/`data.code`.

### 2. REST `/api/v1/*` (OT ingest, data-plane)

```json
{ "ok": false, "error": "Body must be { samples: [ ... ] } with at least one sample" }
```

Thành công: `{ "ok": true, "accepted": 100, "received": 100, "machine": "AOI-01" }`.
HTTP status mang ý nghĩa: `401` Unauthorized, `403` Forbidden (thiếu scope), `503` DB tạm sập (retry), `500` lỗi khác.

### 3. REST proxy / External (`/api/machine/*`, `/api/external/*`)

```json
{ "success": false, "message": "Claim failed" }
```

Thành công: `{ "success": true, ... }` (các field dữ liệu nằm phẳng cùng cấp `success`).
`POST /api/machine/claim` map mã tRPC → HTTP: `404` NOT_FOUND, `429` TOO_MANY_REQUESTS,
`400` cho UNAUTHORIZED/BAD_REQUEST (token sai/hết hạn/đã dùng), `500` còn lại.

---

## Validation Errors (BAD_REQUEST)

Khi input không hợp lệ (Zod validation), `error.message` là chuỗi JSON của mảng issue:

```json
{
  "error": {
    "message": "[{\"code\":\"too_small\",\"minimum\":1,\"type\":\"string\",\"inclusive\":true,\"message\":\"String must contain at least 1 character(s)\",\"path\":[\"serialNumber\"]}]",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "path": "machineApi.submitInspection"
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
        print(f"  Field: {'.'.join(str(p) for p in err['path'])}")
        print(f"  Error: {err['message']}")
except json.JSONDecodeError:
    print(f"  Error: {error_msg}")
```

---

## Lỗi phổ biến theo API

### Machine API

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `submitInspection` | `UNAUTHORIZED` | apiKey/machineCode sai, hoặc đường yếu bị `deny` cho scope `ingest:write` |
| `submitInspection` | `FORBIDDEN` | Machine key thiếu scope `ingest:write` |
| `submitInspection` | `BAD_REQUEST` | Thiếu `serialNumber`/`overallResult`, `measurements[].result` sai, `inspectionTime` không parse được, ảnh vượt `MACHINE_INGEST_MAX_IMAGE_B64` |
| `submitInspection` | `TOO_MANY_REQUESTS` | Vượt rate ingest per-máy (mặc định 600/phút) |
| `syncMeasurementPoints` | `NOT_FOUND` | `productModelCode` không tồn tại |
| `uploadImage` | `NOT_FOUND` | `inspectionId` không tồn tại |
| `deltaSyncPoints` / `checkPointsVersion` | `NOT_FOUND` | `productModelCode` không tồn tại |
| `getModelPackage` | `CONFLICT` | Gói model chưa sẵn sàng (`Package not ready`) |
| `getModelPackage`/`confirmDeployment`/`edgeHeartbeat`/`syncEdgeResults` | `FORBIDDEN` | Deployment không thuộc máy này |
| `issueKey`/`rotateKey`/`revokeKey`/`listKeys` | `FORBIDDEN` | Thiếu quyền `admin_system` |

### Claim token (đăng ký máy)

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `machine.claimKey` / `POST /api/machine/claim` | `UNAUTHORIZED` | Token sai / đã dùng / hết hạn (thông điệp đồng nhất, không lộ nguyên nhân) |
| `machine.claimKey` | `PRECONDITION_FAILED` | Máy chưa được duyệt / chưa có apiKey (`no_key`) |
| `machine.claimKey` | `TOO_MANY_REQUESTS` | Vượt `MACHINE_CLAIM_RATE_LIMIT_PER_HOUR` (mặc định 30/IP/giờ) |
| `machine.issueClaimToken` | `PRECONDITION_FAILED` | Máy chưa `approved`, đã xóa, hoặc `retired`/`decommissioned` |

### AI Model API

| Endpoint | Lỗi | Nguyên nhân |
|----------|------|-------------|
| `create` | `FORBIDDEN` | User không phải Admin |
| `runInference` | `NOT_FOUND` | Model không tồn tại hoặc chưa có file |
| `runInference` | `INTERNAL_SERVER_ERROR` | Lỗi ONNX runtime (file mô hình lỗi, shape mismatch) |

---

## Rate Limiting

> ⚠️ Con số cũ "1000 req / 15 phút" là **SAI** và đã được sửa. Số dưới đây đọc trực tiếp từ
> `server/_core/rateLimitConfig.ts` và `server/services/machineAuthService.ts`.

| Tầng | Đường | Giới hạn mặc định | Cửa sổ | Khóa theo | Biến môi trường |
|------|-------|-------------------|--------|-----------|-----------------|
| API chung | `/api/*` (browser + generic, gồm tRPC không thuộc data-plane máy) | **300 request** | 60 giây | credential (x-api-key › Bearer › cookie › apiKey body/query › machineCode) › IP | `RATE_LIMIT_PER_MINUTE` |
| Đăng nhập | `/api/auth/*` | **30 request** | 15 phút | IP | `AUTH_RATE_LIMIT_PER_15MIN` |
| Data-plane máy (tầng HTTP) | `/api/machine/*` + các procedure `machineApi.*` cho phép (submitInspection, uploadImage, syncMeasurementPoints, heartbeat, get/delta/sync điểm & ảnh, checkModelVersion…) | **60 000 request/máy** (client có credential); **300** nếu không credential | 60 giây | credential máy (hash) › IP | `MACHINE_INGEST_RATE_MAX` |
| OT ingest | `POST /api/ot/ingest` | **300 000 request/khóa** (~5000 req/s) | 60 giây | khóa máy (hash x-api-key) › IP | `OT_INGEST_RATE_MAX` |
| Ingest per-máy (tầng ứng dụng) | `submitInspection`, `uploadImage`, `syncEdgeResults` | **600 request/máy** (0 = tắt) | 60 giây | keyId (khóa mk_) hoặc machineId | `MACHINE_INGEST_RATE_LIMIT_PER_MIN` |
| Bootstrap không xác thực | `/api/machine/claim`, `/api/machine/register`, `/api/machine/config` | giữ **300/60s** (KHÔNG lên tầng cao) | 60 giây | — | (dùng tầng API chung) |
| Claim token | `machine.claimKey` / `POST /api/machine/claim` | **30/IP** | 1 giờ | IP | `MACHINE_CLAIM_RATE_LIMIT_PER_HOUR` |

**Lưu ý quan trọng về ingest inspection:** có HAI limiter chồng lên nhau. Tầng HTTP (60 000/phút/máy)
lọc lũ ở middleware; tầng ứng dụng (`enforceMachineIngestRateLimit`, mặc định **600/phút/máy** = 10/s)
là giới hạn chặt hơn và thực tế chi phối `submitInspection`. Benchmark chuẩn (QĐ#7: 100 máy × 1 board/s =
60/phút/máy) nằm thoải mái dưới ngưỡng này. Nếu cần bơm nhanh hơn 10 board/s/máy, nâng
`MACHINE_INGEST_RATE_LIMIT_PER_MIN`.

Khi vượt giới hạn — HTTP `429`, kèm header `Retry-After` (mọi limiter đặt `standardHeaders: true`):

```json
{ "error": "Machine ingest rate limit exceeded" }
```

### Xử lý rate limit (Python)

```python
import time

def api_call_with_retry(func, max_retries=5, *args, **kwargs):
    for attempt in range(max_retries):
        response = func(*args, **kwargs)
        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", 60))
            time.sleep(retry_after)
            continue
        # 503 = DB tạm sập → cũng nên retry với backoff
        if response.status_code == 503:
            time.sleep(min(2 ** attempt, 30))
            continue
        return response
    raise Exception("Rate limit / DB unavailable after max retries")
```

---

## Best Practices

1. **Luôn kiểm tra HTTP status code** trước khi parse JSON, và parse đúng 1 trong 3 dạng phong bì.
2. **Parse Zod errors** để hiển thị lỗi validation chi tiết.
3. **Retry** cho `429` (theo `Retry-After`), `503` (DB tạm sập), `500` (backoff).
4. **Không retry** cho `400`, `401`, `403`, `404`, `412` — đây là lỗi cần fix ở client.
5. **Gửi `idempotencyKey`** ổn định qua các lần retry của cùng một board (chống ghi trùng — xem MACHINE_API.md §1).
6. **Log `path`** trong error response để debug nhanh hơn.
</content>
</invoke>
