# Authentication — Xác thực API

> **Cập nhật doc 51 (P0/P1):** hệ khóa per-máy `mk_` băm SHA-256 + claim token một lần thay cho
> việc `config` phát khóa plaintext. Mọi mô tả dưới đây khớp `server/services/machineAuthService.ts`,
> `server/routers/hierarchyRouters.ts` và `server/routers/machineApiRouters.ts` trên đĩa.

## 1. Phương thức xác thực máy

`authenticateMachine` thử các phương thức theo **đúng thứ tự ưu tiên** sau:

| # | Phương thức | Cách gửi | Trạng thái |
|---|-------------|----------|------------|
| 1 | **Machine key `mk_`** (khuyến nghị) | `Authorization: Bearer <mk_...>` hoặc `X-API-Key: <mk_...>` (ưu tiên hơn body); hoặc `apiKey` trong body | ✅ Chuẩn |
| 2 | Shared apiKey cũ (`machines.apiKey`) | `apiKey` trong body | ⚠️ DEPRECATED |
| 3 | Machine Code (không bí mật) | `machineCode` trong body | ⚠️ DEPRECATED |

Khóa lấy từ header (`Bearer`/`X-API-Key`) **được ưu tiên** hơn `apiKey` trong body. Lưu ý: các
procedure có ràng buộc `apiKey || machineCode` (vd `submitInspection`, `deltaSyncPoints`) vẫn cần một
trong hai trường đó trong body để **qua kiểm tra input** — khi đó gửi khóa ở header sẽ được dùng để
xác thực, còn body chỉ cần chứa `apiKey` (chính khóa đó) hoặc `machineCode` cho hợp lệ.

### 1.1 Machine key `mk_` (KHUYẾN NGHỊ)

- Định dạng: `mk_<48 hex>`. Chỉ **hash SHA-256** được lưu trong bảng `api_keys` (cột `keyHash`); bản
  rõ chỉ hiện **đúng một lần** khi cấp/rotate.
- Kiểm tra khi xác thực: khóa còn `isActive`, chưa `revokedAt`, chưa `expiresAt`, và **scope thỏa** thao tác.
- Bump `lastUsedAt` throttled (tối đa 1 lần/60s/khóa).

```bash
# Header Bearer (khuyến nghị)
curl "http://localhost:3000/api/trpc/machineApi.heartbeat" \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_xxxxxxxx..." \
  -d '{"json":{"apiKey":"mk_xxxxxxxx..."}}'

# Hoặc X-API-Key
curl "http://localhost:3000/api/trpc/machineApi.heartbeat" \
  -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: mk_xxxxxxxx..." \
  -d '{"json":{"apiKey":"mk_xxxxxxxx..."}}'
```

### 1.2 Shared apiKey cũ — DEPRECATED

Khóa dùng chung `machines.apiKey` (plaintext) là **đường yếu**: ai đọc được label/scrape được khóa
đều giả mạo máy được. Gated bởi `MACHINE_SHARED_KEY_ALLOWED` (tri-state):

| Giá trị | Hành vi |
|---------|---------|
| `allow` (mặc định) | Chấp nhận mọi nơi; ghi telemetry mỗi lần dùng |
| `read-only` | Chỉ chấp nhận scope đọc (`equipment:read`); mọi WRITE (`ingest:write`/`edge:sync`) → 401 |
| `deny` | Từ chối mọi nơi (giữ nguyên nghĩa `false` cũ) |

### 1.3 Machine Code — DEPRECATED

`machineCode` không mang bí mật nào — chỉ là mã in trên máy. Gated bởi `MACHINE_CODE_ONLY_ALLOWED`
(cùng tri-state `allow`/`read-only`/`deny`, mặc định `allow`).

> Mọi lần dùng đường yếu (kể cả bị từ chối) được đếm chính xác (`getWeakAuthUsage()`) + phát sự kiện
> Prometheus, phục vụ WARN-THEN-DENY: biết máy nào còn dùng đường yếu **trước khi** siết cờ về `deny`.
> Quy trình rotate: `docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md`.

## 2. Scope vocabulary

Khóa `mk_` mang danh sách scope. Scope mặc định khi cấp mới:
`["ingest:write", "equipment:read", "edge:sync"]`.

| Scope | Cho phép |
|-------|----------|
| `ingest:write` | Gửi inspection/ảnh: `submitInspection`, `uploadImage`, `syncMeasurementPoints`, `sync*Image` |
| `equipment:read` | Đọc cấu hình: `getPoints`, `deltaSyncPoints`, `checkPointsVersion`, `getSyncHistory`, `heartbeat` |
| `edge:sync` | Edge model deploy/OTA: `checkModelVersion`, `getModelPackage`, `confirmDeployment`, `edgeHeartbeat`, `syncEdgeResults` |

Grant hợp lệ: một scope trong bộ từ vựng, `namespace:*` (vd `equipment:*`), hoặc `*`. Cấp scope
ngoài từ vựng → `BAD_REQUEST`.

## 3. Cấp / xoay / thu hồi khóa (admin)

Quản trị viên (quyền `admin_system`) quản lý khóa qua `machineApi.*` — xem [MACHINE_API.md §Key Management](MACHINE_API.md#key-management-khóa-per-máy). Bản rõ trả **đúng một lần**:

- `machineApi.issueKey` — cấp khóa mới (`canCreate`).
- `machineApi.rotateKey` — thu hồi khóa cũ + cấp khóa mới cùng scope/expiry (`canEdit`).
- `machineApi.revokeKey` — thu hồi (`canEdit`).
- `machineApi.listKeys` — liệt kê (không lộ hash/plaintext) (`canView`).

## 4. Cấp phát khóa lần đầu — Claim token (MỚI, doc 51 P0)

`machine.config` **KHÔNG còn trả `apiKey`** (trước đây rò credential plaintext cho bất kỳ ai biết
`serialNumber`). Giờ máy nhận khóa qua **token một lần**:

```
                    (admin)                          (máy, không cần khóa)
 machine.approve / machine.issueClaimToken   →   machine.claimKey  →  apiKey (1 lần)
        │                                              │
   trả claimToken (mct_...) HIỆN 1 LẦN            POST /api/machine/claim (REST)
   TTL mặc định 15 phút, single-use
```

**Đặc điểm token** (`mct_<64 hex>`, hash SHA-256 lưu bảng `machine_claim_tokens`):

- **TTL** mặc định **15 phút** (`MACHINE_CLAIM_TOKEN_TTL_MINUTES`, kẹp trong khoảng (0, 1440]).
- **Dùng một lần** (burn `usedAt` trong transaction — hai claim đồng thời chỉ một thắng).
- Cấp token mới sẽ **vô hiệu** token cũ còn mở của máy đó (tối đa 1 token sống mỗi máy).
- **Throttle** `MACHINE_CLAIM_RATE_LIMIT_PER_HOUR` (mặc định 30/IP/giờ) → `429`.
- Mọi lần claim (thành công **và** thất bại) đều được audit.

### 4.1 Máy đổi token lấy apiKey

**tRPC:**
```bash
curl "http://localhost:3000/api/trpc/machine.claimKey" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"serialNumber":"SN-2024-001","claimToken":"mct_..."}}'
# → { "result": { "data": { "json": {
#       "apiKey": "mach_...", "machineId": 12, "code": "AOI-01",
#       "message": "API key claimed — store it securely; this token is now spent" } } } }
```

**REST:**
```bash
curl -X POST "http://localhost:3000/api/machine/claim" \
  -H "Content-Type: application/json" \
  -d '{"serialNumber":"SN-2024-001","claimToken":"mct_..."}'
# → { "success": true, "apiKey": "mach_...", "machineId": 12, "code": "AOI-01", "message": "..." }
```

Lỗi claim: token sai/đã dùng/hết hạn → `UNAUTHORIZED` (REST: HTTP 400, thông điệp đồng nhất, không
lộ nguyên nhân); máy chưa duyệt/chưa có khóa (`no_key`) → `PRECONDITION_FAILED`; vượt throttle → `429`.

### 4.2 Escape hatch tương thích (mặc định TẮT)

`MACHINE_CONFIG_EXPOSE_APIKEY=true` khiến `machine.config` phát lại apiKey plaintext (chỉ cho máy đã
`approved`) — **KHÔNG an toàn**, chỉ dùng khi firmware cũ chưa hỗ trợ claim; mỗi lần dùng log cảnh báo
throttled nêu tên máy. `config` giờ trả `apiKey: null` và `requiresClaim: true` khi escape hatch tắt.

## 5. AI Model API — Xác thực Session

API quản lý AI model (`aiModel.*`) yêu cầu **đăng nhập session** (cookie), không dùng API Key.
Thao tác admin (create/update/delete/upload) cần quyền **admin**.

```bash
curl -c cookies.txt "http://localhost:3000/api/trpc/auth.login" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"your-password"}}'
curl -b cookies.txt "http://localhost:3000/api/trpc/aiModel.list?input=%7B%22json%22%3A%7B%7D%7D"
```

## 6. Lỗi xác thực

| HTTP | tRPC Code | Mô tả |
|------|-----------|-------|
| 401 | `UNAUTHORIZED` | apiKey/machineCode/claim token sai, khóa thu hồi/hết hạn, đường yếu bị `deny` |
| 403 | `FORBIDDEN` | Machine key thiếu scope yêu cầu; hoặc cần admin |
| 412 | `PRECONDITION_FAILED` | Máy chưa duyệt khi cấp claim token; claim `no_key` |
| 429 | `TOO_MANY_REQUESTS` | Vượt throttle claim / rate ingest |
| 503 | — | DB tạm sập (ingest REST) — retry được |
</content>
