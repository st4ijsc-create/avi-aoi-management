# ST4I Device Client — SDK/firmware mẫu (reference)

Bộ **client tham chiếu** để đội cơ điện / firmware nội bộ đưa **máy mới lên nền tảng
ST4I AVI/AOI Management mà KHÔNG cần sửa code server**. Copy thư mục này, điền vài
tham số (URL server + khóa `mk_`), là gửi được dữ liệu chuẩn.

Chuẩn dữ liệu: **doc 57 — ST4I Standard Process Feed v1**
(`docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md`), song hành doc 28
(Inspection Feed cho máy AOI/AVI) và doc 56 (Device Connectivity Standardization).

> 📘 **Đội DEV viết phần mềm trong máy: đọc `docs/ECOSYSTEM/61_MACHINE_DEVELOPER_INTEGRATION_GUIDE_2026-07-18.md`**
> — tài liệu tham chiếu quy chuẩn ĐÃ KIỂM CHỨNG LIVE (endpoint/envelope/mã lỗi/độ-bền + đính
> chính các điểm lệch so với spec cũ). README này là quick-start; doc 61 là contract đầy đủ.

> Máy **AOI/AVI** (kiểm tra board) dùng doc 28 (`submitInspection`).
> Máy **automation** (bắt vít / điểm keo / hàn / leak-test…) và **IoT** (ESP32
> nhiệt-ẩm, cảm biến LAN) dùng doc 57 — chính là bộ client này.

---

## Thư mục

| File | Ngôn ngữ | Dùng cho |
|---|---|---|
| `csharp/St4iDeviceClient.cs` | **C# / .NET (WPF)** | **Phần mềm máy WPF / dịch vụ Windows** — ngôn ngữ chính |
| `csharp/ExampleScrewdriver.cs` | C# (`dotnet run`) | Ví dụ vòng đời: RESULT + waveform + config-sync + telemetry |
| `python/st4i_device_client.py` | Python 3.8+ (chỉ stdlib `urllib`) | PC-based machine / gateway; bắt vít, keo, hàn |
| `python/example_screwdriver.py` | Python | Ví dụ máy bắt vít gửi torque + waveform |
| `arduino/st4i_device_client.ino` | ESP32 (Arduino) | Cảm biến IoT nhiệt-ẩm gửi telemetry |
| `nodejs/st4i_device_client.mjs` | Node.js ≥ 18 (không dependency) | Gateway/PC chạy Node; có demo tích hợp |

**C#/.NET (WPF)** — `St4iDeviceClient.cs` là 1 file thả vào project (namespace `St4i.DeviceClient`),
dùng `HttpClient` + `System.Text.Json`, biên dịch cho netstandard2.0 / .NET Framework 4.7.2+ / .NET 6/8/10
(0 NuGet trên .NET 6+; .NET Framework 4.x thêm gói `System.Text.Json`). API async giống Python/Node.
Chi tiết + quy tắc WPF: **doc 61 §2.4 + §11.4**.

Python client **chỉ dùng thư viện chuẩn** (`urllib`) nên copy-chạy ngay trên máy
công nghiệp không có Internet để `pip install`. Nếu thích `requests` cho gọn, thay
`_http()` bằng `requests.request(...)` — API còn lại giữ nguyên.

---

## Onboarding 4 bước

```
┌── 1. ADMIN cấp token (một lần, ngoài băng) ──────────────────────────────┐
│   • Claim  mct_ :  admin duyệt máy qua wizard → mint claim token show-once │
│   • Enroll met_ :  admin mint enrollment token (zero-touch fleet)          │
│        (tRPC: machine.issueClaimToken / machine.issueEnrollmentToken)      │
└───────────────────────────────────────────────────────────────────────────┘
                                   │  đưa token cho đội thiết bị
                                   ▼
┌── 2. THIẾT BỊ đổi token → khóa mk_ (một lần) ────────────────────────────┐
│   • claim :  POST /api/trpc/machine.claimKey  { serialNumber, claimToken } │
│   • enroll:  POST /api/trpc/machine.enroll    { serialNumber, enrollment…} │
│     → nhận  { apiKey: "mk_live_…", machineId, code, … }  (SHOW MỘT LẦN)     │
│     → LƯU mk_ vào file bảo mật trên thiết bị (client.save_key()).           │
└───────────────────────────────────────────────────────────────────────────┘
                                   │  giữ mk_ dùng mãi
                                   ▼
┌── 3. THIẾT BỊ gửi dữ liệu (liên tục) ────────────────────────────────────┐
│   • RESULT    :  POST /api/v1/ingest/process-result   (Feed v1 envelope)   │
│   • TELEMETRY :  POST /api/v1/ingest/telemetry        (CanonicalSample[])  │
│     Header:  Authorization: Bearer mk_…   (hoặc  X-API-Key: mk_…)          │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌── 4. THIẾT BỊ heartbeat (định kỳ) ───────────────────────────────────────┐
│   • POST /api/machine/heartbeat     Header:  X-API-Key: mk_…               │
│     → hệ thống thấy máy ONLINE (presence).                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Bước 1 + 2 làm MỘT LẦN cho mỗi máy.** Sau đó firmware chỉ lặp bước 3 + 4.
ESP32 thường không tự bootstrap — chạy `python/` hoặc `nodejs/` một lần để lấy `mk_`
rồi dán vào `.ino`.

---

## Bảng endpoint + header xác thực

| Mục đích | Method + Path | Header auth | Body |
|---|---|---|---|
| Enroll (met_→mk_) | `POST /api/trpc/machine.enroll` | *(không)* — token là credential | `{"json":{ serialNumber, enrollmentToken, machineInfo? }}` |
| Claim (mct_→mk_) | `POST /api/trpc/machine.claimKey` | *(không)* | `{"json":{ serialNumber, claimToken }}` |
| RESULT | `POST /api/v1/ingest/process-result` | `Authorization: Bearer mk_…` **hoặc** `X-API-Key: mk_…` | envelope Feed v1 (dưới) |
| TELEMETRY | `POST /api/v1/ingest/telemetry` | `Authorization: Bearer mk_…` **hoặc** `X-API-Key: mk_…` | `{ "samples": CanonicalSample[] }` |
| Heartbeat | `POST /api/machine/heartbeat` | `X-API-Key: mk_…` (**không** đọc Bearer) | `{ "apiKey": "mk_…" }` |

> ⚠️ **Header auth THẬT.** Server (`server/api/v1/auth.ts::extractKey` và
> `machineHeaderKey`) chỉ chấp nhận scheme **`Authorization: Bearer <mk_>`** hoặc header
> **`X-API-Key: <mk_>`**. Doc 57 §2 có viết ví dụ `Authorization: ApiKey …` nhưng
> **scheme `ApiKey` KHÔNG được server phân giải** — dùng `Bearer` hoặc `X-API-Key`.
> Các client trong thư mục này đã dùng đúng.

> ⚠️ **tRPC dùng superjson.** Body enroll/claim phải bọc `{"json": <input>}`, và
> response bọc `{"result":{"data":{"json": <data>}}}`. Client đã tự bọc/mở lớp này —
> nếu bạn tự gọi bằng `curl`, nhớ bọc tay.

---

## Envelope Process Feed v1 (RESULT)

```jsonc
{
  "schemaVersion": "1.0",                 // optional, log-only (server KHÔNG ép "1.0")
  "machineCode":   "SCRW-01",             // optional — auth vẫn resolve máy từ mk_
  "serialNumber":  "SN-2026-000777",      // BẮT BUỘC — trục genealogy (≤128 ký tự)
  "stepType":      "screw_tightening",    // BẮT BUỘC — nên thuộc process_step_types (≤64)
  "result":        "pass",                // BẮT BUỘC — pass|fail|warn|skip (chữ thường)
  "ts":            "2026-07-17T14:03:00.480+07:00",  // optional — nếu GỬI thì PHẢI kèm offset UTC
  "recipe":   { "code": "TQ-M3-08", "version": "2.1", "checksum": "a1b2c3d4" },
  "metrics":  [ { "name": "torque", "value": 0.82, "unit": "Nm",     // value CHỈ number
                  "lsl": 0.70, "usl": 0.95, "nominal": 0.82 } ],
  "waveforms":[ { "name": "torque_vs_angle", "unit": "Nm", "rateHz": 500,
                  "samples": [[0,0.02],[90,0.15],[412,0.82]] } ],   // ≤64 sóng, ≤100k cặp/sóng
  "idempotencyKey": "SCRW-01:TQ-M3-08:88123",   // exactly-once (8..200 ký tự)
  "lineCode": "LINE-01", "lotCode": "LOT-77",    // genealogy (string) — optional
  "productionOrderCode": "WO-20260717-01", "stationId": 12  // stationId PHẢI là SỐ
}
```

- **`stepType`** danh mục v1: `screw_tightening` · `glue_dispense` · `weld_spot` ·
  `leak_test` · `functional_test` · `press_fit` · `label_apply` · `vision_check`.
  (Schema chỉ kiểm độ dài ≤64; vocab-check tùy cờ `PROCESS_ATTR_VALIDATE_MODE` phía server.)
- **Đơn vị chuẩn** (§6 doc 57): `Nm` (torque) · `deg` · `mL` · `kPa`/`bar` · `°C` ·
  `A` · `Hz` · `%RH`. (Đường REST hiện KHÔNG kiểm registry đơn vị — dùng đơn vị chuẩn để
  SPC/analytics đọc đúng.)
- **`metrics[].value` CHỈ nhận number** — gửi chuỗi/boolean → **400**.
- **Field lạ ở top-level bị server STRIP âm thầm** (`rawExtras` CHƯA cài cho process-result).
  Đưa số đo vendor-custom vào `metrics[]` (dạng số), KHÔNG đặt ở top-level.

Phản hồi: `{ "ok": true, "data": { "processResultId": 123, "duplicate": false } }` (HTTP 201);
khi **replay** cùng `idempotencyKey` → `{ "data": { "processResultId": 123, "duplicate": true } }`
(cùng id, KHÔNG ghi trùng).

### TELEMETRY (CanonicalSample)

```jsonc
{ "samples": [
  { "deviceId": "esp32-ws3-01", "metric": "temperature", "value": 27.4,
    "unit": "°C", "ts": "2026-07-17T14:03:00+07:00", "quality": "good" },
  { "deviceId": "esp32-ws3-01", "metric": "humidity", "value": 61.2, "unit": "%RH" }
] }
```

`ts` telemetry là **khuyến nghị** (vắng → server đóng dấu giờ nhận). Phản hồi
`{ "ok": true, "data": { "accepted": n, "received": n, "machine": "…" } }` (HTTP 202).

### CONFIG-SYNC (kéo recipe về máy)

SDK Python/Node có sẵn vòng lặp `check → get → apply → ack` (server cần
`CONFIG_SYNC_GENERIC_ENABLED=true`, scope `equipment:read`):

```python
def apply_recipe(cfg):
    load_into_controller(cfg["payload"])   # mã firmware nạp recipe vào máy
    return True
res = c.sync_config(apply_recipe, config_kind="recipe", cached_version=current_version)
# lần đầu: {'changed': True, 'version': '2', 'driftState': 'in_sync'} ; đã khớp: {'changed': False, …}
```

Hoặc gọi rời: `check_config()` / `get_config()` / `ack_config()` (Node: `checkConfig`/`getConfig`/
`ackConfig`/`syncConfig`). Chi tiết contract + mã lỗi: **doc 61 §6**.

---

## Độ tin cậy: idempotency · retry · hàng đợi local

Ba cơ chế bắt buộc để feed không mất dữ liệu và không ghi trùng (client đã cài sẵn):

1. **`idempotencyKey`** — server dedup theo `(machineId, idempotencyKey)`. Gửi lại
   cùng key → server trả `duplicate: true` (cùng `processResultId`), **không** tạo bản ghi trùng. **Đặt key
   ổn định theo chu trình vật lý**, ví dụ `"<machineCode>:<recipeCode>:<cycleCounter>"`,
   để cùng một lần siết vít luôn cùng key qua mọi lần retry. (Nếu không truyền,
   client tự sinh key ngẫu nhiên — an toàn cho 1 lần, nhưng không dedup được sau
   restart.)

2. **Retry + backoff** — client tự thử lại khi **mất mạng**, **HTTP 429** (rate limit)
   hoặc **5xx** (`503 db_unavailable`), với exponential backoff. Lỗi **4xx còn lại**
   (400 payload sai / 401 / 403 / 409 version) là **lỗi vĩnh viễn** → KHÔNG retry
   (gửi lại vẫn sai), ném lỗi để firmware sửa.

3. **Hàng đợi local (store-and-forward)** — khi mất mạng và hết lượt retry, payload
   được xếp vào hàng đợi (**file JSONL** nếu truyền `queue_path`/`queuePath` → bền qua
   restart; hoặc RAM). Lần gửi sau client tự **replay** với **cùng `idempotencyKey`**,
   nên server dedup an toàn. Gọi `flush_queue()` / `flushQueue()` để xả thủ công.

**Thời gian (`ts`)**: optional, nhưng **nếu gửi thì luôn kèm offset** (`Z` hoặc `±hh:mm`).
Giờ naive (không offset) bị server **reject** — HTTP 400 `ingest_failed`, `error.message`
ghi rõ *"ts must carry an explicit UTC offset…"* (bài học lệch +7h của doc 27). Vắng `ts` ⇒
server đóng dấu giờ nhận (`timeSource='server'`). Client Python/Node tự sinh `ts` có offset;
ESP32 lấy giờ NTP rồi nối offset khớp `configTime`.

---

## Bắt đầu nhanh

### C# / WPF
Thả `csharp/St4iDeviceClient.cs` vào project WPF của bạn. Chạy demo:
```bash
cd csharp
ST4I_SERVER="https://factory.local:5000" ST4I_MK_KEY="mk_..." dotnet run
# dev self-signed: thêm ST4I_VERIFY_TLS=0 ; telemetry IoT: thêm ST4I_ESP_KEY=mk_...
```
Giữ 1 `St4iDeviceClient` singleton; `await` mọi hàm (không `.Result` trên UI thread); vòng
telemetry/heartbeat trên Task nền. Quy tắc WPF đầy đủ: doc 61 §11.4.

### Python
```bash
cd python
# đã có mk_:
export ST4I_SERVER="https://factory.local:5000"
export ST4I_MK_KEY="mk_live_xxxx"
python example_screwdriver.py
# hoặc bootstrap lần đầu bằng claim token admin cấp:
export ST4I_CLAIM_TOKEN="mct_xxxx"; export ST4I_SERIAL="SCRW-01-DEVICE"
python example_screwdriver.py
```
Dev server TLS self-signed → thêm `export ST4I_VERIFY_TLS=0`.

### Node.js
```bash
cd nodejs
ST4I_SERVER="https://factory.local:5000" ST4I_MK_KEY="mk_live_xxxx" \
  node st4i_device_client.mjs
# dev self-signed: thêm NODE_TLS_REJECT_UNAUTHORIZED=0
```

### ESP32 (Arduino)
1. Arduino IDE → cài board **ESP32** + thư viện **ArduinoJson** (v7).
2. Mở `arduino/st4i_device_client.ino`, điền `WIFI_SSID`, `WIFI_PASS`, `SERVER_URL`,
   `MK_KEY`, `DEVICE_ID`, `GMT_OFFSET_SEC` + `TS_OFFSET_SUFFIX` (phải khớp nhau).
3. Thay `readSensor()` bằng mã đọc DHT22/SHT31 thật.
4. Nạp firmware; xem Serial Monitor 115200 để thấy log `[ingest] OK HTTP 202`.

> ArduinoJson **v6**: đổi `JsonDocument doc;` → `DynamicJsonDocument doc(512);` và
> `samples.add<JsonObject>()` → `samples.createNestedObject()` (ghi chú sẵn trong file).

---

## Điều kiện phía server (cần đội ST4I bật)

- **`PROCESS_RESULT_INGEST_ENABLED=true`** — cổng `process-result` mặc định **OFF**
  (ships dark, doc 56/55). Khi OFF, server trả `PRECONDITION_FAILED` (HTTP 400
  `ingest_failed`). TELEMETRY (`/api/v1/ingest/telemetry`) không cần cờ này.
- **`ENROLLMENT_ENABLED=true`** — nếu dùng luồng enroll `met_`. Claim `mct_` không cần.
- **Fleet automation/iot bắt buộc `mk_`** (cấm machineCode-only) khi
  `MACHINE_CRED_MK_ONLY_ENABLED` bật (doc 56 QĐ3).
- Seed `stepType` / đơn vị / mã alarm mới vào danh mục nếu máy dùng mã ngoài seed v1.

## Tự kiểm chứng (không ghi DB)

Đội tích hợp có thể validate payload **offline** trước khi bắn thật qua tRPC
`machineContract.validate({ contract: "process-result", version: "1.0", payload })` — trả
`{ ok:true }` hoặc `{ ok:false, errors:[{path,message}] }`. LƯU Ý: đây là **`protectedProcedure`**
(cần session USER đăng nhập, KHÔNG dùng khóa `mk_`); và `contract`/`version` là **hai field
riêng** (chuỗi gộp `"process-result@1.0"` sẽ báo *Unknown process contract version*).

## Mã lỗi thật (đường REST `/api/v1/ingest/process-result`) — envelope `{ ok:false, error:{ code, message } }`

> Đường REST **gộp MỌI lỗi validate thành `400 ingest_failed`** — chi tiết field sai nằm ở
> `error.message` (text zod). Firmware đọc `error.message`, **không** dựa vào mã con.

| HTTP | `error.code` | Nghĩa · Xử lý firmware |
|---|---|---|
| 400 | `ingest_failed` | Payload sai (enum, `ts` naive, `value` không phải số, `stationId` không phải số, vượt waveform-cap), cờ ingest OFF, unknown stepType (enforce), auth máy tRPC fail, rate-limit. Đọc `error.message` → sửa, **không** retry |
| 400 | `bad_request` | Chỉ telemetry: body rỗng/không `{samples:[…]}` |
| 401 | `unauthorized` | Thiếu/sai `mk_` → rotate khóa, **không** retry |
| 403 | `forbidden` | Khóa thiếu scope `ingest:write` (kèm `details.required/granted`) |
| 500 | `internal_error` | Lỗi ngoài dự kiến (không lộ stack) |

> tRPC trực tiếp (`/api/trpc/machineApi.submitProcessResult`) giữ mã gốc: `PRECONDITION_FAILED`
> (412, cờ ingest OFF), `BAD_REQUEST` (400, zod), `UNAUTHORIZED`/`FORBIDDEN` (401/403),
> `TOO_MANY_REQUESTS` (429, mặc định 600/phút/khóa). Config-sync/heartbeat proxy trả thêm cờ
> `retryable` — chỉ retry khi `retryable=true` (429/503).
| 503 | `db_unavailable` | Client retry + xếp hàng với cùng `idempotencyKey` |

---

*Bộ client tham chiếu doc 56 Đợt 2 việc 8 · chuẩn doc 57 (Process Feed v1) ·
endpoint `POST /api/v1/ingest/process-result` + `/api/v1/ingest/telemetry` ·
bootstrap `machine.enroll` / `machine.claimKey`.*
