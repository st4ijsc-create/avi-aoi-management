# Doc 61 — Machine Developer Integration Guide (ST4I AVI/AOI Management)

> **Tài liệu cho ĐỘI DEV viết phần mềm chạy BÊN TRONG máy nội bộ** (bắt vít, điểm keo,
> hàn, leak-test, cảm biến IoT…). Đây là **tài liệu tham chiếu quy chuẩn, ĐÃ KIỂM CHỨNG
> TRỰC TIẾP trên server đang chạy** — mọi request/response trong tài liệu này được bắn
> thật vào một API server live và chép nguyên response về (xem §14 *Nhật ký kiểm chứng*).
>
> Ngày: 2026-07-18 · Nối tiếp doc 56 (chuẩn hóa kết nối thiết bị), doc 57 (spec Feed v1),
> doc 58 (onboarding đội cơ điện). SDK tham chiếu: `examples/device-client/`.

---

## 0. Đọc gì, ở đâu (bản đồ tài liệu)

Hệ thiết bị nội bộ **đã được quy chuẩn** (doc 56 → 60). Ba tài liệu + một bộ SDK bổ trợ nhau:

| Bạn cần | Đọc |
|---|---|
| **Viết phần mềm trong máy (guide này)** — endpoint chính xác, envelope đã kiểm chứng, mẫu firmware, xử lý lỗi, độ-bền | **Doc 61 (tài liệu này)** |
| Spec chuẩn Feed v1 (bảng field gốc, đơn vị, versioning, canonical DB mapping) | `docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md` |
| Onboarding đội cơ điện (chọn deviceClass, đăng ký, ma trận 14 cờ, checklist) | `docs/ECOSYSTEM/58_DEVICE_ONBOARDING_GUIDE_2026-07-18.md` |
| SDK/firmware mẫu copy-chạy (Python/Node/ESP32) | `examples/device-client/` (README + code) |

> ⚠️ **Vì sao có guide này khi đã có doc 57/58?** Quá trình chuẩn hóa làm **schema runtime
> thật (code) lệch một số điểm so với spec doc 57/README cũ**. Guide này ghi lại **contract
> ĐÚNG như code đang chạy** (đã bắn thử), và §4.8 liệt kê rõ các điểm lệch để đội dev không
> copy nhầm payload sẽ bị 400. Doc 57 vẫn là spec định hướng; **khi lệch, code (guide này)
> thắng**.

---

## 1. Toàn cảnh — máy nào gửi gì, tới đâu

Có **4 loại tương tác** một máy nội bộ cần:

| # | Tương tác | Endpoint | Cho máy nào | Cần cờ server |
|---|---|---|---|---|
| 1 | **RESULT** (1 chu trình = 1 vít/1 điểm keo/1 mối hàn) | `POST /api/v1/ingest/process-result` | automation (SCREWDRIVE/DISPENSING/WELDER…) | `PROCESS_RESULT_INGEST_ENABLED=true` |
| 2 | **TELEMETRY** (dòng mẫu liên tục: nhiệt/ẩm/dòng…) | `POST /api/v1/ingest/telemetry` | IoT (ESP32, cảm biến LAN) + máy có OT tag | (không cần cờ) |
| 3 | **CONFIG-SYNC** (kéo recipe/cấu hình về máy) | `GET/POST /api/machine/config-sync/{check,get,ack}` | mọi máy có recipe | `CONFIG_SYNC_GENERIC_ENABLED=true` |
| 4 | **HEARTBEAT** (nhịp sống + tín hiệu xoay khóa) | `POST /api/machine/heartbeat` | mọi máy | (không cần cờ) |

**Chọn theo nhóm thiết bị** (`deviceClass`, doc 56):

| deviceClass | machineType (ví dụ) | Gửi chính | Định danh |
|---|---|---|---|
| `automation` | `SCREWDRIVE`, `DISPENSING`, `WELDER`, `ASSEMBLY`, `ROBOT`, `PRESS_FIT`, `ICT`, `FCT`… | **RESULT** (+ config-sync) | `serialNumber` = unit đang gia công |
| `iot` | `IOT_SENSOR`, `IOT_GATEWAY` | **TELEMETRY** | `deviceId` = mã máy/cảm biến |
| `aoi_avi` | `AOI`, `AVI`, `SPI`, `AXI` | **Inspection Feed** (doc 28 `submitInspection`) — *ngoài phạm vi guide này* | `serialNumber` = board |

> Máy AOI/AVI (kiểm board) dùng đường **doc 28** riêng. Guide này phục vụ **automation + IoT**.

---

## 2. Quick start — 15 phút có dữ liệu lên hệ thống

### 2.1 Dùng SDK có sẵn (khuyến nghị)

`examples/device-client/` có SDK **0-dependency** cho 3 nền tảng:

| Nền tảng | File | Dùng cho |
|---|---|---|
| Python 3.8+ (`urllib`) | `python/st4i_device_client.py` | PC/gateway công nghiệp; bắt vít, keo, hàn |
| Node.js ≥18 (`fetch`) | `nodejs/st4i_device_client.mjs` | Gateway/PC chạy Node |
| ESP32 (Arduino, ArduinoJson v7) | `arduino/st4i_device_client.ino` | Cảm biến IoT nhiệt-ẩm |

### 2.2 Hello-world máy bắt vít (Python) — ĐÃ CHẠY THẬT

```python
from st4i_device_client import St4iDeviceClient

c = St4iDeviceClient("https://factory.local:5000",
                     mk_key="mk_...",            # khóa máy (xem §3)
                     machine_code="SCRW-01",
                     queue_path="scrw01_queue.jsonl",  # store-and-forward bền qua restart
                     verify_tls=True)

data = c.submit_process_result(
    serial_number="SN-2026-000777",
    step_type="screw_tightening",
    result="pass",                                # pass | fail | warn | skip
    recipe={"code": "TQ-M3-08", "version": "2"},
    metrics=[{"name": "torque", "value": 12.2, "unit": "Nm",
              "lsl": 10.5, "usl": 13.5, "nominal": 12.0},
             {"name": "angle", "value": 358, "unit": "deg"}],
    idempotency_key="SCRW-01:TQ-M3-08:000123",    # exactly-once (retry an toàn)
)
print(data)   # -> {'success': True, 'processResultId': 27817}
```

Response thật (guide này bắn live): `{'success': True, 'processResultId': 27817}`. Gửi lại
**cùng `idempotency_key`** → `{'success': True, 'processResultId': 27817, 'duplicate': True}`
(cùng id, KHÔNG ghi trùng).

### 2.3 Hello-world cảm biến IoT (Python)

```python
esp = St4iDeviceClient("https://factory.local:5000", mk_key="mk_...", machine_code="ESP32-ENV-01")
esp.submit_telemetry([
    {"metric": "temperature", "value": 31.7, "unit": "C", "quality": "good"},
    {"metric": "humidity",    "value": 61.2, "unit": "%", "quality": "good"},
])   # -> {'accepted': 2, 'received': 2}   (HTTP 202)
```

> SDK tự thêm `deviceId = machine_code` cho mỗi sample (server dùng `deviceId` để quy máy — §5.2).

---

## 3. Credential & Registration (vòng đời khóa máy)

### 3.1 Ba loại token/khóa (định dạng chính xác — từ code)

| Loại | Định dạng | Sinh bởi | Lưu ở server |
|---|---|---|---|
| **Khóa máy `mk_`** | `mk_<48 hex>` | server (khi approve/claim/enroll/issueKey) | **hash SHA-256** (không lưu plaintext) |
| **Claim token `mct_`** | `mct_<64 hex>` | admin (approve / `issueClaimToken`) | hash SHA-256, TTL mặc định **15 phút**, dùng-1-lần |
| **Enroll token `met_`** | `met_<64 hex>` | admin (`issueEnrollmentToken`) | hash SHA-256, TTL mặc định **60 phút**, hỗ trợ batch (`maxUses`, `serialPattern`) |

> **Phần mềm trong máy KHÔNG tự sinh khóa** — chỉ NHẬN `mk_` qua claim/enroll/admin.
> `mk_` **hiển thị plaintext ĐÚNG MỘT LẦN** khi cấp — máy phải **lưu an toàn** (server không trả lại lần hai).

### 3.2 Luồng lấy khóa (REST, cho phần mềm máy dùng HTTP thuần)

```
1. POST /api/machine/register                    (PUBLIC — không cần khóa)
      body {serialNumber, name, machineType, model?, manufacturer?, firmwareVersion?, syncMode?}
      → {success:true, id, registrationStatus:"pending", message:"…awaiting admin approval"}

2. (admin duyệt máy trong hệ thống, cấp claim token mct_ — ngoài băng)

3. GET  /api/machine/config?serialNumber=SN-...  (PUBLIC — poll trạng thái duyệt)
      → {success:true, isApproved:true, requiresClaim:true, apiKey:null, …}
        (apiKey LUÔN null — không còn rò khóa qua serialNumber)

4. POST /api/machine/claim                        (PUBLIC — đổi token lấy khóa)
      body {serialNumber, claimToken:"mct_..."}
      → {success:true, apiKey:"mk_...", machineId, code, message:"…store it securely; token now spent"}
      # LƯU apiKey an toàn — đây là lần DUY NHẤT thấy plaintext.
```

**Zero-touch (fleet)**: nếu server bật `ENROLLMENT_ENABLED=true`, đổi `met_` lấy `mk_` qua
tRPC `machine.enroll {serialNumber, enrollmentToken, machineInfo?}` → `{apiKey, machineId, code, scopes, …}`.
*(Lưu ý: hiện enroll chỉ có cổng tRPC, chưa có REST proxy `/api/machine/enroll`. Máy HTTP thuần
dùng claim; hoặc gọi tRPC-HTTP `POST /api/trpc/machine.enroll`.)*

### 3.3 Header xác thực khi gọi API

Mọi endpoint ingest/config-sync nhận khóa qua **một trong hai** (tương đương):

```
Authorization: Bearer mk_xxxxxxxx        ← khuyến nghị (ingest)
X-API-Key: mk_xxxxxxxx                    ← thay thế
```

- Header **thắng** field `apiKey` trong body. Scheme `Authorization: ApiKey …` **KHÔNG** được
  phân giải (chỉ `Bearer`).
- **Ngoại lệ heartbeat**: proxy `/api/machine/heartbeat` chỉ đọc `X-API-Key` **hoặc** `body.apiKey`
  — **KHÔNG đọc `Bearer`**. SDK đã xử lý đúng.

### 3.4 Scope & TTL

| Scope | Cho gì |
|---|---|
| `ingest:write` | đẩy RESULT + TELEMETRY |
| `equipment:read` | heartbeat, config-sync, checkPointsVersion |

- Khóa fleet automation/iot (approve/claim/enroll) mặc định có `["ingest:write","equipment:read"]`.
- **TTL khóa `mk_`**: mặc định **0 = không hết hạn**; khóa fleet mk_-only mặc định **180 ngày**
  (theo dõi `keyExpiresInDays` trong response heartbeat để xoay khóa trước hạn).
- Thiếu scope → **403 `forbidden`** (kèm `details.required/granted`).

### 3.5 mk_-only (fleet hardening)

Khi server bật `MACHINE_CRED_MK_ONLY_ENABLED=true`, thiết bị class `automation`/`iot`
**BẮT BUỘC** dùng `mk_` per-device — đường machineCode-only / shared-key bị từ chối. AOI/AVI không đổi.
Mặc định cờ **OFF**.

---

## 4. RESULT feed — `POST /api/v1/ingest/process-result`

Máy automation gửi **1 kết quả chu trình** (1 con vít / 1 điểm keo / 1 mối hàn / 1 lần ép…).

### 4.1 Endpoint & auth

```
POST /api/v1/ingest/process-result
Content-Type: application/json
Authorization: Bearer mk_...        # scope ingest:write
```

Server phải bật **`PROCESS_RESULT_INGEST_ENABLED=true`** (mặc định OFF → ships-dark).

### 4.2 Envelope — bảng field ĐẦY ĐỦ (schema runtime thật)

| Field | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `serialNumber` | string | ✅ | 1..128 — serial/barcode unit (genealogy) |
| `stepType` | string | ✅ | 1..64 — nên thuộc `process_step_types` |
| `result` | enum | ✅ | `pass` \| `fail` \| `warn` \| `skip` (chữ thường) |
| `schemaVersion` | string | — | ≤20, **log-only** (server KHÔNG ép `"1.0"`) |
| `machineCode` | string | — | định danh máy — hoặc để trống, auth resolve từ `mk_` |
| `ts` | string | — | ISO-8601; **nếu gửi PHẢI có offset UTC** (`Z`/`±HH:MM`); vắng → server đóng dấu |
| `recipe` | object | — | `{ code(1..128) ✅, version?(≤64), checksum?(≤128) }` |
| `metrics` | array | — | ≤512 phần tử (bảng §4.3) |
| `waveforms` | array | — | ≤64 sóng (bảng §4.4) |
| `idempotencyKey` | string | — | **8..200** — exactly-once (§8) |
| `stationId` | number | — | **SỐ nguyên dương** (platform station id) — ⚠ gửi chuỗi = 400 |
| `lineCode` | string | — | ≤50 — genealogy |
| `productionOrderCode` | string | — | ≤80 — genealogy |
| `lotCode` | string | — | ≤80 — genealogy |

> `serverReceivedAt`, `timeSource` là **server đóng dấu** — máy **KHÔNG gửi**.
> **Field lạ top-level bị STRIP âm thầm** (không có `rawExtras` cho process-result). Đưa số
> đo vendor-custom vào `metrics[]`.

### 4.3 `metrics[]` — mỗi số đo

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | string | ✅ | 1..64 |
| `value` | **number** | ✅ | **CHỈ number** — chuỗi/boolean → 400 |
| `unit` | string | — | ≤32 (dùng đơn vị chuẩn §6 doc 57 để SPC đọc đúng) |
| `lsl` / `usl` / `nominal` | number | — | ngưỡng dưới / trên / danh định |

### 4.4 `waveforms[]` — dạng sóng (torque-vs-angle, dòng hàn…)

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | string | ✅ | 1..64 |
| `unit` | string | — | ≤32 |
| `rateHz` | number | — | dương |
| `samples` | array | ✅ | mảng cặp `[t, value]` (2 số), ≤100 000 cặp; tổng byte bị cap phía server |

### 4.5 Response (HTTP 201)

```jsonc
// ghi mới:
{ "ok": true, "data": { "success": true, "processResultId": 27817 } }
// replay cùng idempotencyKey (KHÔNG ghi row thứ 2):
{ "ok": true, "data": { "success": true, "processResultId": 27817, "duplicate": true } }
// queued (DB lỗi thoáng qua + PROCESS_STORE_FORWARD_ENABLED=true → ghi WAL đĩa):
{ "ok": true, "data": { "success": true, "queued": true, "submissionId": "<key>", "processResultId": null } }
```

### 4.6 Ví dụ curl ĐÃ KIỂM CHỨNG

```bash
curl -X POST https://factory.local:5000/api/v1/ingest/process-result \
  -H "Authorization: Bearer mk_..." -H "Content-Type: application/json" \
  -d '{
    "schemaVersion":"1.0","serialNumber":"SN-0001","stepType":"screw_tightening",
    "result":"pass","ts":"2026-07-18T10:00:00+07:00","idempotencyKey":"SCRW-01:RC1:000001",
    "recipe":{"code":"SCRW-RC-001","version":"1"},
    "metrics":[{"name":"torque","value":12.1,"unit":"Nm","lsl":10.5,"usl":13.5,"nominal":12}]
  }'
# → HTTP 201  {"ok":true,"data":{"success":true,"processResultId":27815}}
```

### 4.7 Batch (chỉ qua tRPC — KHÔNG có route REST)

```
POST /api/trpc/machineApi.submitProcessResultBatch
body { machineCode?, apiKey?, results: [ <envelope §4.2>, … ] }   # 1..200 (MACHINE_INGEST_BATCH_MAX)
```
Đặc tính: **1 auth + 1 heartbeat** cho cả batch; mỗi item cô lập (1 item lỗi không hỏng batch);
rate-limit tính theo từng item; mỗi item giữ idempotency riêng. Response:
`{success, machineId, submitted, succeeded, duplicates, queued, failed, results:[{index, success, processResultId, duplicate?, error?}]}`.

### 4.8 ⚠️ ĐÍNH CHÍNH quan trọng (điểm lệch spec cũ ↔ code thật — ĐÃ bắn thử)

| Điểm | Spec doc 57 / README cũ | **THỰC TẾ (code, đã kiểm chứng)** |
|---|---|---|
| `stationId` | string `"ST-SCRW-A"` | **number** — gửi chuỗi → **400** `invalid_type` |
| Replay field | `data.idempotent = true` | **`data.duplicate = true`** (cùng `processResultId`) |
| `metrics[].value` | number\|string\|bool | **chỉ number** — khác → 400 |
| `ts` | bắt buộc | **optional** (nếu gửi thì cần offset) |
| `schemaVersion` | bắt buộc = `"1.0"`, version lạ reject | **optional, log-only**, không reject |
| `serialNumber` max | 100 | **128** |
| `idempotencyKey` | ≤128 | **8..200** (key < 8 ký tự → 400) |
| Mã lỗi chi tiết | `missing_required`, `naive_timestamp`, `unknown_unit`, `waveform_too_large`… | **KHÔNG phát ra** — mọi lỗi payload gộp thành **`400 ingest_failed`**, chi tiết ở `error.message` |
| `rawExtras` | field lạ → lưu vào `rawExtras` | **CHƯA cài** cho process-result — field lạ bị **STRIP** |

> Những điểm này đã được sửa trong `examples/device-client/README.md` + `example_screwdriver.py`.

---

## 5. TELEMETRY feed — `POST /api/v1/ingest/telemetry`

Cảm biến IoT / máy có OT tag gửi **dòng mẫu liên tục** (nhiệt/ẩm/dòng/mô-men…).

### 5.1 Hai endpoint — dùng cái nào?

| Endpoint | Auth đọc | Response | HTTP OK | Dùng khi |
|---|---|---|---|---|
| **`/api/v1/ingest/telemetry`** ⭐ | `Bearer` **hoặc** `X-API-Key` | `{ok, data:{accepted, received, machine}}` | **202** | mặc định (ESP32 dùng Bearer) |
| `/api/ot/ingest` (gốc, high-throughput) | **chỉ** `X-API-Key`/`body.apiKey`/`machineCode` | `{ok, accepted, received, machine}` (không bọc `data`) | 200 | firehose OT có tier rate-limit riêng (300k/phút) |

> ⚠️ ESP32 gửi `Authorization: Bearer` **phải** dùng `/api/v1/ingest/telemetry` — bắn Bearer vào
> `/api/ot/ingest` sẽ **401** (route đó không đọc Bearer).

### 5.2 `CanonicalSample` — mỗi mẫu

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `metric` | string | ✅ | tên tag chuẩn hóa, vd `"temperature"` (≤256, cắt nếu dài) |
| `value` | number\|string\|bool\|null | — | bus tách vào numValue/textValue/boolValue |
| `unit` | string | — | vd `"C"`, `"%"` |
| `ts` | string (ISO) | — | vắng → server đóng dấu giờ nhận |
| `deviceId` | string | — | **mã máy/cảm biến — server resolve `machineId` qua `machines.code`** |
| `machineId` | int | — | nếu đã biết id cứng (bỏ qua bước resolve) |
| `protocol` | enum | — | `mqtt/opcua/modbus/s7/ethernet_ip/mtconnect/sparkplug/inspection/other`; giá trị lạ → `other` |
| `quality` | enum | — | `good/bad/uncertain`; vắng/lạ → `good` |
| `meta` | object | — | tùy ý |

Body: `{ "samples": [ … ] }` **hoặc** mảng trần `[ … ]`; phải có **≥1 sample** (rỗng → 400 `bad_request`).

> **Quan trọng để lên dashboard đúng máy**: đặt `deviceId` = mã máy trên MỖI sample. Nếu thiếu
> `deviceId`/`machineId`, sample vẫn nhận (202) nhưng **không quy được về máy nào** (machineId null).

### 5.3 Ví dụ ĐÃ KIỂM CHỨNG

```bash
curl -X POST https://factory.local:5000/api/v1/ingest/telemetry \
  -H "Authorization: Bearer mk_..." -H "Content-Type: application/json" \
  -d '{"samples":[
        {"deviceId":"ESP32-ENV-01","metric":"temperature","value":31.4,"unit":"C","ts":"2026-07-18T10:00:00+07:00","quality":"good"},
        {"deviceId":"ESP32-ENV-01","metric":"humidity","value":62.1,"unit":"%"}
      ]}'
# → HTTP 202  {"ok":true,"data":{"accepted":2,"received":2}}
```

### 5.4 Đọc lại để kiểm chứng đã ingest

`GET /api/v1/equipment/:id/telemetry?from=&to=&limit=` (scope `equipment:read`).

---

## 6. Config-sync — kéo recipe/cấu hình về máy

Server phải bật **`CONFIG_SYNC_GENERIC_ENABLED=true`** (mặc định OFF). `configKind` ∈
`recipe | device_settings | points | model`. Auth: cùng `mk_` (scope `equipment:read`).

### 6.1 Vòng lặp chuẩn (check → get → apply → ack)

```
1. CHECK  GET /api/machine/config-sync/check?configKind=recipe
          → {success, configKind, code, version, checksum, resolvedBy}
2. So (code,version,checksum) với bản máy đang cache.  Giống → dừng.  Khác → tiếp.
3. GET    GET /api/machine/config-sync/get?configKind=recipe
          → {…, payload:{…}}      # bộ tham số đầy đủ
4. APPLY  máy nạp payload vào chương trình chạy (nội bộ máy)
5. ACK    POST /api/machine/config-sync/ack  body {configKind, code, version, checksum}
          → {success, machineId, configKind, driftState}   # kỳ vọng "in_sync"
```

`resolvedBy` ∈ `machine` (recipe bound riêng máy) \| `machineType` (default theo loại) \| `none`.
`driftState` ∈ `in_sync` \| `drift` \| `unknown` (so `checksum` byte-exact nếu cả hai phía có; else so `code+version`).

### 6.2 Ví dụ ĐÃ KIỂM CHỨNG (curl + SDK)

```bash
curl "https://factory.local:5000/api/machine/config-sync/check?configKind=recipe" -H "Authorization: Bearer mk_..."
# → 200 {"success":true,"configKind":"recipe","code":"SCRW-RECIPE-01","version":"2","checksum":"3c9e8caf…","resolvedBy":"machine"}

curl "https://factory.local:5000/api/machine/config-sync/get?configKind=recipe" -H "Authorization: Bearer mk_..."
# → 200 {…,"payload":{"speedRpm":300,"angleTarget":720,"torqueTarget":12.5,"torqueTolerance":0.5}}

curl -X POST https://factory.local:5000/api/machine/config-sync/ack -H "Authorization: Bearer mk_..." \
  -H "Content-Type: application/json" -d '{"configKind":"recipe","code":"SCRW-RECIPE-01","version":"2","checksum":"3c9e8caf…"}'
# → 200 {"success":true,"machineId":243,"configKind":"recipe","driftState":"in_sync"}
```

**Qua SDK** (vòng lặp trọn gói — đã chạy thật):

```python
def apply_recipe(cfg):
    load_into_controller(cfg["payload"])   # mã firmware nạp recipe
    return True

res = c.sync_config(apply_recipe, config_kind="recipe", cached_version=current_version)
# lần đầu:  {'changed': True, 'version': '2', 'driftState': 'in_sync'}
# đã khớp:  {'changed': False, 'version': '2'}
```

### 6.3 Mã lỗi config-sync (REST proxy)

Body lỗi: `{success:false, retryable:<bool>, message}` + header `Retry-After` cho 429.
Ánh xạ: `UNAUTHORIZED→401`, `FORBIDDEN→403`, `TOO_MANY_REQUESTS→429(retryable)`, `NOT_FOUND→404`,
`BAD_REQUEST→400`, `TIMEOUT/INTERNAL→503(retryable)`.

> ⚠️ Khi `CONFIG_SYNC_GENERIC_ENABLED` **OFF**, server trả **HTTP 500** (không có nhánh riêng)
> với message *"Generic config-sync is disabled…"*. Đây **không** phải lỗi tạm — **đừng retry**.

---

## 7. Heartbeat & presence — `POST /api/machine/heartbeat`

```
POST /api/machine/heartbeat
X-API-Key: mk_...            # heartbeat KHÔNG đọc Bearer — dùng X-API-Key hoặc body.apiKey
body { "apiKey": "mk_...", "running": [ {configKind, code?, version?, checksum?} ]? }
→ { success:true, machineId, keyStatus, keyRotationPending, keyExpiresInDays, configDrift? }
```

- Gửi định kỳ (vd 30–60s) để hệ thống hiển thị máy **ONLINE**.
- Đính kèm `running[]` (tùy chọn) để server đối soát drift 2 chiều (cần `CONFIG_DRIFT_REPORT_ENABLED`;
  hiện chỉ qua tRPC — REST proxy chưa forward `running[]`).
- Theo dõi `keyExpiresInDays` / `keyRotationPending` để **xoay khóa trước hạn**.

---

## 8. Độ tin cậy cho firmware (bắt buộc để không mất/không trùng dữ liệu)

Ba cơ chế — SDK đã cài sẵn, mọi ngôn ngữ khác nên nhân bản:

### 8.1 `idempotencyKey` — exactly-once
Server dedup theo `(machineId, idempotencyKey)`. **Đặt key ổn định theo chu trình vật lý**:
`"<machineCode>:<recipeCode>:<cycleCounter>"`. Cùng một lần siết vít luôn cùng key qua mọi lần
retry → replay trả `duplicate:true`, không tạo bản ghi trùng. **ĐÃ CHỨNG**: gửi 2 lần cùng key →
cùng `processResultId`, lần 2 có `duplicate:true`.

### 8.2 Thời gian — offset bắt buộc (nếu gửi `ts`)
Luôn kèm offset UTC (`Z` hoặc `±HH:MM`). Giờ naive (`2026-07-18T10:00:00`) → **400**,
`error.message`: *"ts must carry an explicit UTC offset…"* (bài học lệch +7h doc 27).
An toàn nhất: **bỏ `ts`** để server đóng dấu, hoặc dùng `datetime.now().astimezone().isoformat()`.

### 8.3 Retry + backoff (chỉ khi retryable)
Retry với exponential backoff **chỉ** cho: mất mạng, **429**, **5xx** (`503 db_unavailable`).
**4xx còn lại (400/401/403/409) là lỗi VĨNH VIỄN** → không retry (gửi lại vẫn sai), ném để sửa.
Config-sync/heartbeat proxy trả cờ `retryable` — dùng cờ đó làm chuẩn.

### 8.4 Store-and-forward (hàng đợi local)
Mất mạng + hết retry → xếp payload vào hàng đợi **file JSONL** (bền qua restart). Lần sau replay
**cùng `idempotencyKey`** → server dedup an toàn. SDK: truyền `queue_path=...`, gọi `flush_queue()`.
*(Server cũng có WAL riêng: `PROCESS_STORE_FORWARD_ENABLED` cho RESULT, `OT_STORE_FORWARD_ENABLED` cho telemetry — buffer khi DB down thay vì drop.)*

---

## 9. Bảng lỗi hợp nhất (tra nhanh)

| HTTP | Ở đâu | code / dạng | Nghĩa | Retry? |
|---|---|---|---|---|
| 201 | RESULT | — | ghi OK (hoặc `duplicate:true`) | — |
| 202 | TELEMETRY | — | nhận OK (`accepted/received`) | — |
| 400 | RESULT | `ingest_failed` | payload sai / cờ OFF / `ts` naive / value-type / stationId-type / rate-limit tRPC. Đọc `error.message` | **KHÔNG** |
| 400 | TELEMETRY | `bad_request` | body rỗng/không `{samples:[…]}` | **KHÔNG** |
| 401 | mọi nơi | `unauthorized` | thiếu/sai `mk_` | KHÔNG (rotate khóa) |
| 403 | mọi nơi | `forbidden` | thiếu scope | KHÔNG |
| 404 | config-sync | `not_found` | code/model không tồn tại | KHÔNG |
| 429 | mọi nơi | `rate_limited` | vượt 600/phút/khóa (RESULT) | CÓ (backoff, `Retry-After`) |
| 500 | config-sync | — | cờ config-sync OFF (PRECONDITION) | **KHÔNG** |
| 503 | mọi nơi | — | DB tạm không sẵn | CÓ (backoff) |

---

## 10. Tự kiểm chứng & smoke-test

### 10.1 Validate payload offline (không ghi DB)
tRPC `machineContract.validate({ contract: "process-result", version: "1.0", payload })`
→ `{ ok:true }` hoặc `{ ok:false, errors:[{path,message}] }`.
⚠️ Đây là **`protectedProcedure`** (cần session USER, KHÔNG dùng `mk_`); `contract` và `version`
là **hai field riêng** (chuỗi gộp `"process-result@1.0"` sẽ báo *Unknown process contract version*).

### 10.2 Smoke-test live (đội tích hợp chạy trước khi giao máy)
```
1. POST process-result (payload tối thiểu hợp lệ)        → kỳ vọng 201 {processResultId}
2. POST lại cùng idempotencyKey                          → 201 {duplicate:true}, CÙNG id
3. POST với ts naive (không offset)                      → 400 ingest_failed (message ts)
4. POST không header auth                                → 401 unauthorized
5. GET  config-sync/check?configKind=recipe              → 200 {code,version,checksum}
6. POST telemetry {samples:[{deviceId,metric,value}]}    → 202 {accepted}
```
*(Bộ này chính là §14 — guide này đã chạy đủ 6 bước và chép response thật.)*

> Ghi chú: doc 57 §11.2 nhắc thư mục fixtures `__fixtures__/process-result/` — **hiện chưa tồn tại**
> trong repo; 11 conformance case C1–C11 mới là bảng đặc tả. Dùng smoke-test §10.2 để nghiệm thu.

---

## 11. Mẫu firmware theo từng lớp máy

### 11.1 Máy bắt vít (SCREWDRIVE) — RESULT + waveform + config-sync
- SDK Python đầy đủ: `examples/device-client/python/example_screwdriver.py` (vòng đời trọn vẹn:
  đọc torque/angle → phân loại pass/warn/fail → gửi RESULT + waveform → heartbeat → flush hàng đợi).
- Điểm cắm mã thật: `read_torque_cycle()` (đọc PLC/Modbus của súng vít). `classify()` so LSL/USL.
- Vòng recipe: gọi `c.sync_config(apply_recipe, config_kind="recipe")` đầu ca / khi đổi model.

### 11.2 Máy điểm keo (DISPENSING) — RESULT (metrics volume/pressure)
```python
c.submit_process_result(
    serial_number=unit, step_type="glue_dispense", result=verdict,
    recipe={"code": "GLUE-A12", "version": "3"},
    metrics=[{"name":"volume","value":vol,"unit":"mL","lsl":0.18,"usl":0.24,"nominal":0.21},
             {"name":"pressure","value":p,"unit":"kPa"}],
    idempotency_key=f"GLUE-01:GLUE-A12:{cycle}")
```
Tham chiếu simulator thật (khung firmware để nhân bản): `scripts/sim/screwdriver-emitter.mjs`,
`scripts/pilot-dispensing.mjs`.

### 11.3 Cảm biến IoT (ESP32) — TELEMETRY
- Firmware mẫu: `examples/device-client/arduino/st4i_device_client.ino` (NTP → `ts` có offset,
  batch 30s, retry, dừng sớm khi 4xx).
- Thay `readSensor()` bằng mã đọc DHT22/SHT31 thật; điền `SERVER_URL`, `MK_KEY`, `DEVICE_ID`,
  `GMT_OFFSET_SEC` + `TS_OFFSET_SUFFIX` (phải khớp nhau).

---

## 12. Cờ server đội ST4I/ops phải bật (checklist bàn giao)

| Cờ | Bật cái gì | Mặc định |
|---|---|---|
| `PROCESS_RESULT_INGEST_ENABLED` | RESULT feed | OFF (ships-dark) |
| `CONFIG_SYNC_GENERIC_ENABLED` | config-sync check/get/ack | OFF |
| `CONFIG_DRIFT_REPORT_ENABLED` | drift 2 chiều qua heartbeat `running[]` | OFF |
| `PROCESS_STORE_FORWARD_ENABLED` | WAL buffer RESULT khi DB down | OFF |
| `OT_STORE_FORWARD_ENABLED` | WAL buffer telemetry | OFF |
| `MACHINE_CRED_MK_ONLY_ENABLED` | bắt buộc `mk_` cho automation/iot | OFF |
| `ENROLLMENT_ENABLED` | luồng enroll `met_` | OFF |
| `PROCESS_ATTR_VALIDATE_MODE` | kiểm vocab `stepType` (`off/log/enforce`) | off |

*(TELEMETRY + heartbeat KHÔNG cần cờ.)* Ma trận đầy đủ 14 cờ: doc 58 §6.

---

## 13. Phụ lục — tra nhanh

**Endpoint quick-ref**

| Việc | Method + Path | Auth | OK |
|---|---|---|---|
| Đăng ký máy | `POST /api/machine/register` | public | 200 |
| Poll duyệt | `GET /api/machine/config?serialNumber=` | public | 200 |
| Đổi khóa | `POST /api/machine/claim` | public (token) | 200 |
| RESULT | `POST /api/v1/ingest/process-result` | `ingest:write` | 201 |
| RESULT batch | `POST /api/trpc/machineApi.submitProcessResultBatch` | `ingest:write` | 200 |
| TELEMETRY | `POST /api/v1/ingest/telemetry` | `ingest:write` | 202 |
| Config check | `GET /api/machine/config-sync/check?configKind=` | `equipment:read` | 200 |
| Config get | `GET /api/machine/config-sync/get?configKind=` | `equipment:read` | 200 |
| Config ack | `POST /api/machine/config-sync/ack` | `equipment:read` | 200 |
| Heartbeat | `POST /api/machine/heartbeat` | `equipment:read` (X-API-Key) | 200 |
| Đọc telemetry | `GET /api/v1/equipment/:id/telemetry` | `equipment:read` | 200 |

**Giới hạn độ dài** (từ schema): `serialNumber` ≤128 · `stepType` ≤64 · `metric.name` ≤64 ·
`unit` ≤32 · `recipe.code` ≤128 · `recipe.version` ≤64 · `idempotencyKey` 8..200 ·
`lineCode` ≤50 · `lotCode`/`productionOrderCode` ≤80 · `metrics` ≤512 · `waveforms` ≤64 · `samples` ≤100k.

**`stepType` vocab v1**: `screw_tightening` · `glue_dispense` · `weld_spot` · `leak_test` ·
`functional_test` · `press_fit` · `label_apply` · `vision_check`.

**Đơn vị chuẩn** (§6 doc 57): `Nm` · `deg` · `mL` · `kPa`/`bar` · `°C` · `A` · `Hz` · `%RH`.

---

## 14. Nhật ký kiểm chứng (LIVE) — 2026-07-18

Mọi contract trong guide này bắn thật vào một API server đang chạy (device flags ON, owner DB),
2 thiết bị pilot (`SCRW-SIM-01` id 243, `ESP32-ENV-01` id 244). Response chép nguyên văn:

| # | Gọi | Kết quả thật |
|---|---|---|
| 1 | RESULT (curl) | `201 {"ok":true,"data":{"success":true,"processResultId":27815}}` |
| 2 | RESULT replay cùng key | `201 {…,"processResultId":27815,"duplicate":true}` (exactly-once) |
| 3 | RESULT qua SDK Python | `{'success':True,'processResultId':27817}` |
| 4 | RESULT replay qua SDK | `{'success':True,'processResultId':27817,'duplicate':True}` |
| 5 | RESULT `ts` naive (không offset) | `400 ingest_failed` — *"ts must carry an explicit UTC offset…"* |
| 6 | RESULT `stationId` = chuỗi | `400 ingest_failed` — `invalid_type, expected number, path [stationId]` |
| 7 | RESULT `stationId` = số | `201` OK |
| 8 | RESULT field lạ (`rawExtras`/`vendorX`) | `201` OK (field bị strip) |
| 9 | Không header auth | `401 {"ok":false,"error":{"code":"unauthorized",…}}` |
| 10 | TELEMETRY (curl + SDK) | `202 {"ok":true,"data":{"accepted":2,"received":2}}` |
| 11 | config-sync check | `200 {…,"code":"SCRW-RECIPE-01","version":"2","checksum":"3c9e8caf…","resolvedBy":"machine"}` |
| 12 | config-sync get | `200 {…,"payload":{"speedRpm":300,"angleTarget":720,"torqueTarget":12.5,"torqueTolerance":0.5}}` |
| 13 | config-sync ack | `200 {"success":true,"machineId":243,"configKind":"recipe","driftState":"in_sync"}` |
| 14 | SDK `sync_config` (check→get→apply→ack) | `{'changed':True,'version':'2','driftState':'in_sync'}`; lần 2 `{'changed':False}` |

---

## 15. Tóm tắt

- **Guide này = tài liệu quy chuẩn ĐÃ KIỂM CHỨNG cho đội dev viết phần mềm trong máy nội bộ.**
  Nối tiếp doc 57 (spec) + doc 58 (onboarding) + `examples/device-client/` (SDK).
- **Bốn tương tác**: RESULT (`/api/v1/ingest/process-result`), TELEMETRY
  (`/api/v1/ingest/telemetry`), CONFIG-SYNC (`/api/machine/config-sync/*`), HEARTBEAT.
- **Auth**: khóa `mk_` qua `Authorization: Bearer` (hoặc `X-API-Key`); lấy khóa qua
  register → approve → claim (`mct_`) / enroll (`met_`). `mk_` chỉ hiện 1 lần.
- **Ba trụ độ-bền**: `idempotencyKey` ổn định (exactly-once), `ts` kèm offset, retry-chỉ-khi-retryable
  + store-and-forward. SDK đã cài sẵn.
- **Đính chính then chốt** (§4.8): `stationId` là **số**, replay dùng `duplicate` (không phải
  `idempotent`), `metrics[].value` **chỉ number**, mọi lỗi payload = `400 ingest_failed` (đọc
  `error.message`), field lạ bị strip. Các file mẫu đã được sửa theo đúng contract này.
