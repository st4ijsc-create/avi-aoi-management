# ST4I Standard Process Feed — Specification v1

**Doc 57 · 2026-07-17 · schemaVersion `1.0` · Status: DRAFT (chờ QĐ5 ratify tại pilot — doc 56 §6)**
**Audience:** đội cơ điện / nhà tích hợp / firmware của **máy automation** (bắt vít, điểm keo, hàn điểm, leak-test, ép, dán nhãn, vision-check) và **thiết bị IoT** (ESP32 nhiệt-ẩm, cảm biến LAN xưởng) muốn đẩy dữ liệu vào nền tảng ST4I AVI/AOI Management **mà không cần viết adapter riêng**.
**Origin:** doc 56 (Device Connectivity Standardization) — Trục 2, gap CONN-1 / AIR-2 / API-4 / API-6 / API-7 / API-10 / API-11 / TAX-12; Đợt 1 việc 4 (spec) + việc 10 (ApiDocs). Song hành doc 28 (Standard Inspection Feed cho máy AOI/AVI) — cùng khuôn kỷ luật.

> **Quan hệ với doc 28.** Doc 28 chuẩn hóa **1 kết quả kiểm tra 1 board (AOI/AVI/SPI)**. Doc 57 chuẩn hóa **dữ liệu chu trình của máy automation + telemetry IoT**. Hai spec độc lập, cùng nguyên tắc: `schemaVersion` bắt buộc, additive-only, reject-unsupported, `rawExtras` bảo toàn, timestamp có offset bắt buộc, conformance fixtures. Máy AOI vẫn dùng doc 28 (`submitInspection`); máy bắt vít/keo/hàn dùng doc 57 (`process-result`).

---

## 1. Overview

Nền tảng nhận **3 loại message** từ thiết bị. Mỗi loại có một đường ingest riêng, cùng một mô hình credential (`mk_` per-machine key, scope `ingest:write`):

| Loại | Ý nghĩa | Endpoint chính | Bảng đích |
|---|---|---|---|
| **RESULT** | 1 message = **1 kết quả chu trình cho 1 serial** (siết 1 con vít, bơm 1 điểm keo, 1 mối hàn, 1 lần leak-test…). Rời rạc, per-unit, có verdict. | `POST /api/v1/ingest/process-result` | `process_results` (+ genealogy hash-chain, SPC, mart) |
| **TELEMETRY** | Dòng đo **liên tục theo thời gian** (nhiệt độ, độ ẩm, dòng điện, mô-men trục…). Không verdict, nhiều mẫu/giây. | `POST /api/v1/ingest/telemetry` (alias versioned của `/api/ot/ingest` đang LIVE) | `ot_telemetry` qua `telemetryBus` → presence / dashboard |
| **EVENT** | **Alarm / đổi trạng thái** (ISA-18.2): torque out-of-spec, kẹt keo, quá nhiệt hàn… | MQTT `syn/…` theo `event.schema.json` (§10) | andon / alert / escalation |

Tài liệu này định nghĩa **normative** message **RESULT** (§3–§8) và **TELEMETRY** (§9), mô tả tham chiếu **EVENT** (§10). Tất cả field name là **camelCase**, encoding **JSON UTF-8**, một object top-level cho mỗi message.

**Hard rules khiến feed đáng tin (vi phạm → reject toàn bộ message, không partial-ingest):**

- `schemaVersion` **bắt buộc** = `"1.0"`; phiên bản không hỗ trợ bị **reject** rõ ràng (không đoán — §12).
- `serialNumber` **bắt buộc** non-empty (RESULT) — trục truy vết + genealogy; feed không serial phá vỡ genealogy per-unit.
- `ts` **bắt buộc** RFC 3339 **kèm offset tường minh** (`Z` hoặc `±hh:mm`). Giờ naive (không offset) **bị reject** — fleet mới không nợ fake-UTC (bài học doc 27 A2 / doc 56 API-10).
- `result` là **đúng một** trong `pass` | `fail` | `warn` | `skip` (chữ thường).
- `stepType` phải thuộc danh mục `process_step_types` (§3.4); `unit` phải thuộc unit registry hoặc kèm conversion (§6).
- Versioning **additive-only** (§12): trong cùng major, field không đổi tên/kiểu/đơn vị/nghĩa; consumer **bỏ qua** field lạ (bảo toàn thành `rawExtras`).

---

## 2. Authentication

Mọi request ingest xác thực bằng **machine key `mk_`** (per-machine, hash-at-rest), scope `ingest:write`. Không dùng session/JWT trình duyệt.

Ba cách gửi credential (chọn 1):

| Cách | Vị trí | Ví dụ |
|---|---|---|
| **Header (khuyến nghị)** | `Authorization: ApiKey <mk_...>` hoặc `X-API-Key: <mk_...>` | `X-API-Key: mk_live_9f3a…` |
| Body field | `"apiKey": "<mk_...>"` trong JSON body | `{ "apiKey": "mk_live_9f3a…", … }` |
| `machineCode` | `"machineCode"` trong body / header `X-Machine-Code` | chỉ chấp nhận cho deviceClass `aoi_avi`; **fleet automation/iot BẮT BUỘC `mk_`** (doc 56 QĐ3, cờ `MACHINE_CRED_MK_ONLY_ENABLED`) |

**Cấp credential (chi tiết ở doc 56 Trục 1 / Đợt 2 — không lặp lại ở đây):**

- **Claim `mct_`** — admin/kỹ thuật viên duyệt máy qua wizard → mint claim token show-once → thiết bị `redeem` → nhận `mk_`.
- **Enrollment `met_`** — zero-touch cho fleet: admin mint enrollment token (machineType + serialPattern + scope + TTL + maxUses) → thiết bị gọi `machine.enroll {token, serial}` → tự-approve theo policy → nhận `mk_`.
- **PKI cert (X.509 mTLS)** — opt-in về sau cho thiết bị nhạy cảm; giai đoạn 1 dùng `mk_` + ACL topic.

`mk_` có **TTL + cảnh báo hết hạn**; rotate qua runbook doc 52. Scope tối thiểu để ingest: `ingest:write`.

---

## 3. RESULT message — `POST /api/v1/ingest/process-result`

Content-Type: `application/json`. Response theo envelope thống nhất `{ ok, data?, error? }` (server `api/v1/envelope.ts`); lỗi mang `ApiHttpError` với `code` + `message` + HTTP status (§11.3).

### 3.1 Envelope — bảng field top-level

| Field | Kiểu | Bắt buộc | Mô tả | Ví dụ |
|---|---|:---:|---|---|
| `schemaVersion` | string | **yes** | Phiên bản spec. v1 = `"1.0"`. Version lạ → reject (§12). | `"1.0"` |
| `serialNumber` | string ≤100 | **yes** | Serial/barcode của unit đang gia công. Non-empty sau trim. Trục genealogy. | `"SN-2026-000777"` |
| `machineCode` | string ≤50 | cond. | Định danh máy đã đăng ký. Có thể thay bằng `mk_` (ingest context override). Bắt buộc nếu credential là `machineCode`. | `"SCRW-01"` |
| `stepType` | string token | **yes** | Loại bước công nghệ — thuộc `process_step_types` (§3.4). `^[a-z][a-z0-9_]*$`. | `"screw_tightening"` |
| `result` | enum | **yes** | Verdict chu trình: `pass` \| `fail` \| `warn` \| `skip` (chữ thường). | `"pass"` |
| `ts` | timestamp | **yes** | Thời điểm hoàn tất chu trình. RFC 3339 **kèm offset** (§4). Naive → reject. | `"2026-07-17T14:03:00+07:00"` |
| `recipe` | object | no | Recipe/chương trình đang chạy: `{ code, version?, checksum? }` (§3.5). | `{ "code": "TQ-M3-08", "version": "2.1" }` |
| `metrics` | array | no | Mảng số đo của chu trình (§3.2). | xem §8.1 |
| `waveforms` | array | no | Mảng dạng sóng (torque-vs-angle, pressure-vs-time…) — cap ~64KB/message (§3.3). | xem §8.1 |
| `idempotencyKey` | string ≤128 | no | Khóa exactly-once; dedup theo `(machineId, idempotencyKey)` (§5). | `"SCRW-01:cycle:88123"` |
| `stationId` | string ≤50 | no | Trạm/vị trí trong dây chuyền. | `"ST-SCRW-A"` |
| `lineCode` | string ≤50 | no | Mã dây chuyền. | `"LINE-01"` |
| `productionOrderCode` | string ≤50 | no | Mã đơn sản xuất / work order. | `"WO-20260717-01"` |
| `lotCode` | string ≤50 | no | Lô/batch. | `"LOT-77"` |

Field lạ ở top-level **không fail** validation — được bảo toàn nguyên văn thành `rawExtras` (§7). Vendor nên đặt dữ liệu riêng trong `rawExtras`/`meta` thay vì đặt field top-level mới.

### 3.2 `metrics[]` — số đo chu trình

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `name` | string ≤50 | **yes** | Tên số đo (canonical, vd `torque`, `angle`, `volume`, `pressure`). |
| `value` | number | **yes** | Giá trị đo (hữu hạn; không NaN/Inf). |
| `unit` | string ≤20 | no | Đơn vị chuẩn (§6). Đơn vị lạ không kèm conversion → reject (fleet mới). |
| `lsl` | number | no | Lower spec limit. |
| `usl` | number | no | Upper spec limit. |
| `nominal` | number | no | Giá trị danh định / target. |

`lsl`/`usl`/`nominal` là spec limit **firmware gửi kèm** (self-describing) — server nối vào `process_spec_limits` cho SPC/CPK (doc 56 Đợt 4). Nếu vắng, server dùng spec limit đã cấu hình phía server.

### 3.3 `waveforms[]` — dạng sóng (optional)

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `name` | string ≤50 | **yes** | Tên sóng (vd `torque_vs_angle`, `pressure_vs_time`). |
| `unit` | string ≤20 | no | Đơn vị của trục giá trị (`v`). |
| `rateHz` | number | no | Tần số lấy mẫu (Hz) nếu đều nhau. |
| `samples` | array | **yes** | Mảng cặp `[t, v]` — `t` = trục hoành (thời gian giây / góc °…), `v` = giá trị. `[[0,0.1],[0.02,0.4],…]`. |

**Giới hạn kích thước:** tổng `waveforms` **≤ ~64KB/message** (lưu cột `jsonb` riêng trên `process_results`). Sóng lớn hơn → hạ tần số lấy mẫu hoặc chỉ gửi cửa sổ quanh sự kiện. Vượt cap → reject với `code: "waveform_too_large"`.

### 3.4 `stepType` vocabulary (`process_step_types`)

Danh mục data-driven (bảng `process_step_types`: `code` unique, `nameVi`, `machineType?`, `active`). Seed v1:

`screw_tightening` · `glue_dispense` · `weld_spot` · `leak_test` · `functional_test` · `press_fit` · `label_apply` · `vision_check`

`stepType` ngoài danh mục: giai đoạn đầu **mode log** (chấp nhận + cảnh báo — cờ `PROCESS_ATTR_VALIDATE_MODE`), sau chuyển **enforce** (reject). Thêm code mới → phối hợp platform owner seed vào `process_step_types`.

### 3.5 `recipe` sub-object

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `code` | string ≤50 | **yes** | Mã recipe/chương trình đang chạy trên máy. |
| `version` | string ≤50 | no | Phiên bản recipe (drift check với recipe active server-side — doc 56 Trục 3). |
| `checksum` | string ≤64 | no | Hash nội dung recipe (phát hiện drift). |

---

## 4. Chính sách thời gian (offset bắt buộc)

- `ts` (RESULT) và mọi timestamp phải khớp:
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`
- **Offset tường minh là BẮT BUỘC.** `"2026-07-17T14:03:00"` (naive) → **reject** `code: "naive_timestamp"`. Đúng: `"2026-07-17T14:03:00+07:00"` hoặc `"2026-07-17T07:03:00Z"`.
- Server ghi thêm provenance: `server_received_at timestamptz` (giờ nhận) + `time_source` (`device` | `server`) — không ghi đè `ts` của thiết bị.
- Lý do (doc 27 A2): export không offset từng gây lệch +7h toàn báo cáo. Fleet mới **không được nợ** khoản này.

---

## 5. Idempotency & exactly-once

- `idempotencyKey` (optional nhưng **khuyến nghị mạnh** cho firmware có retry): server dedup theo cặp `(machineId, idempotencyKey)`.
- Gửi lại cùng key → server trả **thành công idempotent** (không tạo bản ghi trùng); response `data.idempotent = true`.
- Ledger: bảng riêng `process_idempotency_keys` (mirror `inspection_idempotency_keys`) — tách khỏi hypertable `process_results` để không đụng ràng buộc unique trên hypertable.
- Khuyến nghị đặt key ổn định theo chu trình, vd `"<machineCode>:<recipeCode>:<cycleCounter>"` — cùng chu trình vật lý luôn cùng key qua các lần retry.
- **Store-and-forward:** khi mất mạng, firmware nên queue local và gửi lại với **cùng** `idempotencyKey` khi phục hồi — server phía mình cũng có WAL store-forward (`PROCESS_STORE_FORWARD_ENABLED`).

---

## 6. Đơn vị chuẩn + bảng conversion (tham chiếu)

Unit registry đa-dimension (`units_of_measure` + `unit_conversions`, doc 56 API-6). Ingest **reject `unit` lạ không kèm conversion** (fleet mới). Đơn vị chuẩn v1:

| Dimension | Đơn vị chuẩn (canonical) | Đơn vị chấp nhận (có conversion) |
|---|---|---|
| torque (mô-men) | **Nm** | `kgf·cm` (1 kgf·cm = 0.0980665 Nm), `mNm` (1 mNm = 0.001 Nm) |
| angle (góc) | **deg** (°) | `rad` (1 rad = 57.29578°) |
| glue volume (thể tích keo) | **mL** | `µL` (1 µL = 0.001 mL), `mg` (theo tỉ trọng keo — cần khai density) |
| pressure (áp suất) | **kPa** | `bar` (1 bar = 100 kPa), `MPa` (1 MPa = 1000 kPa), `psi` (1 psi = 6.89476 kPa) |
| temperature (nhiệt độ) | **°C** | `K` (K = °C + 273.15), `°F` ((°F−32)/1.8) |
| current (dòng điện) | **A** | `mA` (1 mA = 0.001 A) |
| frequency (tần số) | **Hz** | `kHz` (1 kHz = 1000 Hz) |
| humidity (độ ẩm) | **%RH** | — |

Đơn vị chuẩn được lưu như-gửi (server không auto-convert giá trị); conversion table dùng để so sánh/quy đổi ở tầng phân tích. Thêm đơn vị mới → seed `unit_conversions` (CRUD sẵn từ mig 0123).

---

## 7. Additive-only · reject-unsupported · rawExtras

- **Additive-only:** trong major version `1.x`, chỉ **thêm** field OPTIONAL; field cũ không đổi tên/kiểu/đơn vị/nghĩa; không biến field optional thành required.
- **Reject-unsupported:** `schemaVersion` server không hỗ trợ → reject rõ ràng (`code: "unsupported_schema_version"`), **không đoán**.
- **rawExtras:** field top-level lạ + `metrics[].` lạ + `recipe.` lạ được bảo toàn **nguyên văn** vào cột `rawExtras` (jsonb) — nothing lost, nothing breaks. Consumer v1 bỏ qua chúng.
- Dữ liệu vendor-custom → đặt trong `rawExtras` (hoặc `meta` cho TELEMETRY) để không bao giờ va chạm field spec tương lai.

---

## 8. Ví dụ payload cụ thể

### 8.1 Máy bắt vít — `screw_tightening` (RESULT, có waveform torque-vs-angle)

```json
{
  "schemaVersion": "1.0",
  "machineCode": "SCRW-01",
  "serialNumber": "SN-2026-000777",
  "stepType": "screw_tightening",
  "result": "pass",
  "ts": "2026-07-17T14:03:00.480+07:00",
  "stationId": "ST-SCRW-A",
  "lineCode": "LINE-01",
  "productionOrderCode": "WO-20260717-01",
  "lotCode": "LOT-77",
  "recipe": { "code": "TQ-M3-08", "version": "2.1", "checksum": "a1b2c3d4" },
  "metrics": [
    { "name": "torque", "value": 0.82, "unit": "Nm", "lsl": 0.70, "usl": 0.95, "nominal": 0.82 },
    { "name": "angle",  "value": 412,  "unit": "deg", "lsl": 360, "usl": 450, "nominal": 410 }
  ],
  "waveforms": [
    {
      "name": "torque_vs_angle",
      "unit": "Nm",
      "rateHz": 500,
      "samples": [[0, 0.02], [90, 0.15], [180, 0.38], [270, 0.61], [360, 0.79], [412, 0.82]]
    }
  ],
  "idempotencyKey": "SCRW-01:TQ-M3-08:88123"
}
```

### 8.2 Máy điểm keo — `glue_dispense` (RESULT, metrics volume/pressure)

```json
{
  "schemaVersion": "1.0",
  "machineCode": "GLUE-02",
  "serialNumber": "SN-2026-000777",
  "stepType": "glue_dispense",
  "result": "warn",
  "ts": "2026-07-17T14:05:12+07:00",
  "stationId": "ST-GLUE-B",
  "lineCode": "LINE-01",
  "recipe": { "code": "GLU-DOT-05", "version": "1.0" },
  "metrics": [
    { "name": "volume",   "value": 0.118, "unit": "mL",  "lsl": 0.100, "usl": 0.140, "nominal": 0.120 },
    { "name": "pressure", "value": 305,   "unit": "kPa", "lsl": 280,   "usl": 360,   "nominal": 320 }
  ],
  "idempotencyKey": "GLUE-02:GLU-DOT-05:44219",
  "rawExtras": { "nozzleTempC": 41.2, "cartridgeId": "CART-9981" }
}
```

> `result: "warn"` = trong spec nhưng gần biên (vd volume lệch nominal) — firmware tự phân loại. `rawExtras.nozzleTempC` là field vendor-custom, bảo toàn nguyên văn (§7).

### 8.3 ESP32 nhiệt-ẩm — `temperature` / `humidity` (TELEMETRY — xem §9)

```json
{
  "samples": [
    { "deviceId": "esp32-ws3-01", "metric": "temperature", "value": 27.4, "unit": "°C", "ts": "2026-07-17T14:03:00+07:00", "quality": "good" },
    { "deviceId": "esp32-ws3-01", "metric": "humidity",    "value": 61.2, "unit": "%RH", "ts": "2026-07-17T14:03:00+07:00", "quality": "good" }
  ]
}
```

---

## 9. TELEMETRY message — `POST /api/v1/ingest/telemetry`

Đường **liên tục** cho cảm biến/telemetry. **Alias versioned của `/api/ot/ingest`** (đang LIVE, cùng handler, cùng rate-tier machine-ingest cao) — dùng `/api/v1/ingest/telemetry` cho fleet mới, giữ `/api/ot/ingest` backward.

Body: `{ "samples": CanonicalSample[] }` (hoặc bare array). Response: `{ "ok": true, "accepted": <n>, "received": <n>, "machine": "<code>" }`.

### 9.1 `CanonicalSample` — bảng field

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `metric` | string | **yes** | Tên metric (canonical dot-path, vd `temperature`, `humidity`, `spindle.temp`). |
| `value` | number\|string\|bool | **yes** | Giá trị mẫu. |
| `ts` | timestamp | no* | ISO 8601 kèm offset. Vắng → server đóng dấu giờ nhận. *Khuyến nghị gửi để chính xác. |
| `deviceId` | string | no | Định danh thiết bị (1 gateway credential forward nhiều device — bus tự resolve `machineId`). |
| `machineId` | number | no | ID máy (nếu biết trực tiếp). |
| `unit` | string | no | Đơn vị (§6, UCUM-ish). |
| `quality` | enum | no | `good` \| `uncertain` \| `bad` (kiểu OPC-UA). Mặc định `good`. |
| `protocol` | string | no | Nguồn giao thức (mqtt/modbus/http…). |
| `meta` | object | no | Namespace mở rộng vendor (bảo toàn). |

### 9.2 Ví dụ — ESP32 nhiệt-ẩm

Xem §8.3 (payload) — firmware gửi batch `[temperature, humidity]` mỗi ~30s bằng `mk_` của device đã enroll (deviceClass `iot`, station ảo `IOT-<ws>` tự gán). Máy vít cũng có thể stream telemetry mô-men trục song song với RESULT.

```bash
curl -X POST "https://<host>/api/v1/ingest/telemetry" \
  -H "Authorization: ApiKey mk_live_9f3a…" \
  -H "Content-Type: application/json" \
  -d '{"samples":[
    {"deviceId":"esp32-ws3-01","metric":"temperature","value":27.4,"unit":"°C","ts":"2026-07-17T14:03:00+07:00"},
    {"deviceId":"esp32-ws3-01","metric":"humidity","value":61.2,"unit":"%RH","ts":"2026-07-17T14:03:00+07:00"}
  ]}'
```

---

## 10. EVENT / Alarm (tham chiếu)

Máy mới publish EVENT qua MQTT `syn/…` theo `event.schema.json` (ISA-18.2). **Quy ước firmware nội bộ:** dùng `nativeCode = standardCode` để **bỏ tầng map** (doc 56 API-7) — firmware phát thẳng mã chuẩn.

Bảng alarm chuẩn seed cho 3 họ máy nội bộ (`master_alarms` / `alarm_taxonomy`):

| standardCode | Họ máy | Ý nghĩa |
|---|---|---|
| `TORQUE_OUT_OF_SPEC` | screw | Mô-men ngoài [lsl, usl] |
| `SCREW_FLOAT` | screw | Vít nổi / không ăn ren (float) |
| `GLUE_CLOG` | glue | Tắc/nghẹt vòi keo |
| `GLUE_PRESSURE_LOW` | glue | Áp suất keo dưới ngưỡng |
| `WELD_TEMP_HIGH` | weld | Nhiệt độ mối hàn vượt ngưỡng |

`mapAlarm → andon` đã LIVE (EQ_INTEG=true). Mã ngoài bảng: chấp nhận (soft) nhưng chưa phân loại vào Pareto alarm cho tới khi seed. Thêm mã mới → phối hợp platform owner.

---

## 11. Conformance fixtures + tự kiểm chứng

### 11.1 Bộ case firmware PHẢI pass

| # | Case | Kỳ vọng |
|---|---|---|
| C1 | **Valid** — payload §8.1 đầy đủ | Chấp nhận, ghi `process_results`, trả `{ ok: true, data: { processResultId } }` |
| C2 | **Valid tối thiểu** — chỉ field bắt buộc (`schemaVersion`, `serialNumber`, `stepType`, `result`, `ts`) | Chấp nhận |
| C3 | **Thiếu field bắt buộc** — bỏ `serialNumber` | Reject `code: "missing_required"`, path `serialNumber` |
| C4 | **`ts` naive** — `"2026-07-17T14:03:00"` (không offset) | Reject `code: "naive_timestamp"` |
| C5 | **`result` lạ** — `"NG"` (không thuộc pass/fail/warn/skip) | Reject `code: "invalid_enum"`, path `result` |
| C6 | **`unit` lạ** — `metrics[0].unit = "footpound"` không có conversion | Reject `code: "unknown_unit"` (mode enforce) / warn (mode log) |
| C7 | **`stepType` lạ** — `"paint_spray"` ngoài danh mục | Reject/warn theo `PROCESS_ATTR_VALIDATE_MODE` |
| C8 | **`waveforms` quá cap** — tổng > ~64KB | Reject `code: "waveform_too_large"` |
| C9 | **`schemaVersion` lạ** — `"2.0"` | Reject `code: "unsupported_schema_version"` |
| C10 | **Idempotent replay** — gửi lại cùng `idempotencyKey` | `{ ok: true, data: { idempotent: true } }`, không tạo bản ghi trùng |
| C11 | **Field lạ** — thêm `foo: "bar"` top-level | Chấp nhận; `foo` vào `rawExtras` (§7) |

### 11.2 Tự test qua `machineContractRouter.validate`

Firmware/đội tích hợp **tự kiểm chứng offline** trước khi bắn thật, không cần ghi DB:

```ts
// tRPC (authenticated) — validate opt-in, KHÔNG ghi dữ liệu
const r = await trpc.machineContract.validate.mutate({
  version: "process-result@1.0",
  payload: { /* payload §8.1 */ }
});
// Thành công:  { ok: true,  version: "process-result@1.0" }
// Lỗi:         { ok: false, version, errors: [{ path: "serialNumber", message: "..." }] }
```

Contract `process-result@1.0` đăng ký trong `machineDataContract` registry (`server/contracts/machineDataContract.ts`) + phơi JSON-Schema qua `machineContract.jsonSchema({ version })` cho đối tác sinh client. Bộ fixtures normative đặt tại `server/services/**/__fixtures__/process-result/` (11 case §11.1).

### 11.3 Mã lỗi HTTP (envelope `{ ok:false, error }`)

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `missing_required` / `invalid_enum` / `naive_timestamp` / `unknown_unit` / `waveform_too_large` | Payload sai (§11.1) |
| 401 | `unauthorized` | Thiếu/sai `mk_` |
| 403 | `forbidden` | `mk_` thiếu scope `ingest:write`, hoặc deviceClass automation dùng machineCode-only |
| 409 | `unsupported_schema_version` | `schemaVersion` không hỗ trợ |
| 429 | `rate_limited` | Vượt rate-tier machine-ingest |
| 503 | `db_unavailable` | DB down — firmware retry với cùng `idempotencyKey` |

---

## 12. Versioning (schemaVersion / spec_version 1.0)

- Wire field `schemaVersion` (string) hiện thực hóa cơ chế **spec_version**. Doc này định nghĩa `"1.0"`.
- Trong major `1.x`: **additive-only** (§7). Consumer bỏ qua field lạ (bảo toàn `rawExtras`).
- Breaking change → tăng major (`"2.0"`); server validate version + reject version không hỗ trợ với lỗi rõ ràng — **không đoán**.
- **Roadmap (chỉ định hướng, không cam kết):** `1.1` có thể thêm `metrics[].sampleWindow`, `recipe.toolId`, EVENT inline trong RESULT; `2.0` (nếu cần) đổi mô hình waveform sang binary reference. Mọi thay đổi phải qua khuôn additive hoặc bump major.

---

## 13. Canonical mapping (tham chiếu — hệ thống lưu gì)

| Spec field (RESULT) | Platform canonical |
|---|---|
| `serialNumber` | `process_results.serialNumber` |
| `machineCode` | `machineId` (resolve; ingest context override) |
| `stepType` | `process_results.stepType` (FK `process_step_types.code`) |
| `result` | `process_results.result` |
| `ts` | `process_results.ts` (giờ thiết bị) |
| — | `process_results.server_received_at` + `time_source` (server ghi) |
| `recipe.{code,version,checksum}` | `recipeCode` / `recipeVersion` / `recipeChecksum` |
| `metrics[]` | `process_results.metrics` (jsonb) → SPC/CPK qua `process_spec_limits` |
| `waveforms[]` | `process_results.waveforms` (jsonb, cap ~64KB) |
| `idempotencyKey` | ledger `process_idempotency_keys (machineId, idempotencyKey)` |
| `stationId`/`lineCode`/`productionOrderCode`/`lotCode` | cột tương ứng / resolve FK |
| field lạ, `metrics[].` lạ, `recipe.` lạ | `rawExtras` (jsonb, lossless) |

| Spec field (TELEMETRY) | Platform canonical |
|---|---|
| `metric` / `value` / `unit` / `quality` / `ts` | `ot_telemetry` qua `telemetryBus` |
| `deviceId` | resolve soft `machineId` (1 gateway → nhiều device) |
| `meta` | preserved |

---

## 14. Tóm tắt tiếng Việt

**Mục đích:** Chuẩn dữ liệu công bố cho **máy automation** (bắt vít / điểm keo / hàn / leak-test…) và **thiết bị IoT** (ESP32…) đẩy dữ liệu vào ST4I mà không cần adapter riêng (doc 56 Trục 2). Song hành doc 28 (dành cho AOI/AVI).

**Nội dung chính:**
- **3 loại message:** **RESULT** (`POST /api/v1/ingest/process-result` — 1 kết quả chu trình/serial) · **TELEMETRY** (`POST /api/v1/ingest/telemetry` — dòng đo liên tục, alias của `/api/ot/ingest`) · **EVENT** (MQTT alarm ISA-18.2, firmware dùng `nativeCode = standardCode`).
- **Xác thực:** machine key `mk_` (scope `ingest:write`) qua `Authorization: ApiKey mk_…` / `X-API-Key` / body; cấp qua claim `mct_` hoặc enrollment `met_` (doc 56 Trục 1). Fleet automation/iot **bắt buộc `mk_`**, cấm machineCode-only.
- **Envelope RESULT:** `schemaVersion:"1.0"`, `serialNumber`, `stepType` (danh mục `process_step_types`), `result` (`pass`/`fail`/`warn`/`skip`), `ts` (**offset bắt buộc**), `recipe?`, `metrics?[{name,value,unit,lsl,usl,nominal}]`, `waveforms?` (cap ~64KB), `idempotencyKey?`, + `stationId/lineCode/productionOrderCode/lotCode`.
- **Bắt buộc:** `schemaVersion`, `serialNumber`, `stepType`, `result`, `ts` (RFC 3339 **có offset** — giờ naive bị reject, bài học lệch +7h).
- **Đơn vị chuẩn:** Nm (torque), deg (góc), mL (keo), kPa/bar (áp), °C (nhiệt), A (dòng), Hz (tần số), %RH (ẩm) — đơn vị lạ không kèm conversion bị reject.
- **Idempotency:** `idempotencyKey` dedup theo `(machineId, idempotencyKey)` — retry an toàn, exactly-once; ledger riêng `process_idempotency_keys`.
- **Phiên bản:** additive-only trong `1.x`; field lạ bỏ qua (bảo toàn `rawExtras`); version lạ reject rõ ràng.
- **Tự kiểm chứng:** `machineContract.validate({ version:"process-result@1.0", payload })` — 11 conformance case (§11.1) firmware phải pass, không cần ghi DB.

**Liên hệ:** đội ST4I cấp `mk_` (claim/enrollment), seed `stepType`/`unit`/alarm mới vào danh mục nếu cần.

---

*Doc 57 · ST4I Standard Process Feed v1 · endpoint `POST /api/v1/ingest/process-result` + `POST /api/v1/ingest/telemetry` · contract registry `process-result@1.0` · self-test `machineContractRouter.validate` · song hành doc 28 (Inspection Feed) · nối tiếp doc 56 (Device Connectivity Standardization). Trạng thái: DRAFT chờ QĐ5 ratify tại pilot.*
