# Doc 58 — Hướng dẫn kết nối thiết bị nội bộ (đội cơ điện) — 2026-07-18

> **Đối tượng:** kỹ sư cơ điện / tự động hoá lắp firmware cho máy nội bộ (bắt vít, điểm keo, hàn, cảm biến IoT) kết nối lên nền tảng.
> **Tiền đề:** doc 56 Đ0–Đ7 đã thực thi (branch `automation-orchestration-r0`) — chuẩn hoá **đăng ký · dữ liệu API · cài đặt/đồng bộ · quản lý cấu hình · dashboard · AI**. Đặc tả gói tin: **doc 57 — ST4I Standard Process Feed v1**.

Một thiết bị nội bộ đi qua **5 chặng** (đã chứng LIVE trên pilot, xem doc 56B). Làm đúng 5 chặng ⇒ dữ liệu tự lên dashboard + SPC + AI mà **không cần sửa code nền**.

```
1. ĐĂNG KÝ  →  2. CREDENTIAL (mk_)  →  3. GỬI DỮ LIỆU (Feed v1)  →  4. CẤU HÌNH (recipe/spec)  →  5. NGHIỆM THU (dashboard/SPC/AI)
```

---

## 0. Chọn nhóm thiết bị (deviceClass) & loại máy (machineType)

`machineType` quyết định `deviceClass` (bảng `DEVICE_CLASS_BY_TYPE`, `server/constants/machineTypes.ts`):

| deviceClass | machineType tiêu biểu | Kênh dữ liệu chính |
|---|---|---|
| `aoi_avi` | AVI, AOI, SPI, AXI, ICT, FCT, CMM | inspection (đường cũ) + process-result |
| `automation` | **SCREWDRIVE, DISPENSING, WELDER**, ASSEMBLY, PALLETIZER… | **process-result** (RESULT) |
| `iot` | **IOT_SENSOR, IOT_GATEWAY** | **telemetry** (TELEMETRY) |

Máy tự động hoá (bắt vít/keo/hàn) → gửi **RESULT** (`process-result`). Cảm biến IoT → gửi **TELEMETRY**. Sự kiện (alarm/state) → **EVENT** (tuỳ chọn).

---

## 1. ĐĂNG KÝ thiết bị

**Cách A — UI (khuyến nghị):** *Menu › Thiết bị › Thêm thiết bị* (`/device-onboarding`, wizard V2 3 nhánh — bật cờ client `VITE_DEVICE_ONBOARD_WIZARD_V2_ENABLED=true`). Chọn nhóm → điền code/tên/machineType/trạm → tạo. IoT: hệ tự gắn trạm ảo `IOT-<workshop>` (cờ `IOT_DEVICE_CLASS_ENABLED`).

**Cách B — self-enroll (máy tự đăng ký):** `POST /api/machine/register` với enrollment token `met_…` (tab *Enrollment Tokens*), hoặc claim token `mct_…` qua `POST /api/machine/claim`.

**Cách C — script (pilot/CI):** `node scripts/pilot-provision-devices.mjs` — tạo máy `approved+active` + mint mk_ (xem chặng 2). Tham khảo `scripts/pilot-dispensing.mjs` cho DISPENSING.

Máy phải ở trạng thái `registrationStatus='approved'`, `isActive=true`, `lifecycleStatus='active'` mới nhận dữ liệu. Duyệt: admin, hoặc non-admin có quyền `machine_registration` (cờ `MACHINE_APPROVE_RBAC_OPEN_ENABLED`).

---

## 2. CREDENTIAL — khoá máy `mk_`

Nền dùng **khoá per-máy `mk_…`** (sha256 hash-at-rest trong `api_keys`, KHÔNG lưu plaintext). Fleet mới **chỉ dùng mk_** (cờ `MACHINE_CRED_MK_ONLY_ENABLED`) — cấm `machineCode`-only và shared-key.

- Cấp qua UI (hiện 1 lần, dialog show-once) hoặc script provision.
- Scope tối thiểu: `ingest:write` (gửi dữ liệu) + `equipment:read` (kéo cấu hình).
- Gửi kèm mỗi request ở **HEADER**: `Authorization: Bearer mk_…` (hoặc `X-API-Key: mk_…`).
  ⚠ Server chỉ đọc scheme **Bearer** / header **X-API-Key** — KHÔNG đọc `Authorization: ApiKey`.
- TTL/xoay vòng: cảnh báo sắp hết hạn qua cờ `MACHINE_KEY_EXPIRY_ALERT_ENABLED` (cron tuần → action inbox). Đặt `MACHINE_KEY_DEFAULT_TTL_DAYS` (PROD gợi ý 90).

---

## 3. GỬI DỮ LIỆU — ST4I Standard Process Feed v1 (doc 57)

### 3a. RESULT (máy automation) — `POST /api/v1/ingest/process-result`

Envelope tối thiểu (khớp `submitProcessResultInputSchema`):

```json
{
  "schemaVersion": "1.0",
  "serialNumber": "SN000123",
  "stepType": "glue_dispense",
  "result": "pass",
  "ts": "2026-07-18T08:00:00+07:00",
  "recipe": { "code": "GLUE-RC-001", "version": "1" },
  "metrics": [
    { "name": "volume", "value": 0.25, "unit": "ml", "lsl": 0.15, "usl": 0.35, "nominal": 0.25 },
    { "name": "pressure", "value": 250, "unit": "kPa", "lsl": 180, "usl": 320, "nominal": 250 }
  ],
  "waveforms": [{ "name": "pressure_time", "unit": "kPa", "rateHz": 100, "samples": [[0,0],[10,240]] }],
  "idempotencyKey": "GLUE-SIM-01-SN000123"
}
```

Quy tắc bắt buộc:
- `ts` PHẢI có **offset UTC tường minh** (`+07:00` hoặc `Z`) — thiếu offset ⇒ 400. Bỏ `ts` ⇒ server tự đóng dấu (`timeSource='server'`).
- `stepType` NÊN tồn tại trong `process_step_types` (đã seed: `screw_tightening`, `glue_dispense`, `weld_spot`, …). Chế độ `PROCESS_ATTR_VALIDATE_MODE` = off|log|enforce.
- `idempotencyKey` ≥ 8 ký tự — **gửi lại y hệt = dedup exactly-once** (ledger `process_idempotency_keys`). Firmware CỨ retry khi mất mạng; không sinh bản ghi trùng (đã chứng: 12 retry = 0 dòng thừa).
- `metrics[].lsl/usl/nominal` tuỳ chọn; nếu bật `PROCESS_SPEC_GATE_ENABLED`, server chấm pass/fail theo `process_spec_limits` của mình (đính metadata, **không override** `result` máy gửi).

Cờ server cần bật để nhận **201**: `PROCESS_RESULT_INGEST_ENABLED=true`. OFF ⇒ 400 (ship-dark).
Ví dụ khung firmware: `scripts/sim/screwdriver-emitter.mjs` (đổi `metrics`/`stepType`/waveform cho máy khác — DISPENSING xem `scripts/pilot-dispensing.mjs`).

### 3b. TELEMETRY (cảm biến IoT) — `POST /api/v1/ingest/telemetry`

Alias của `/api/ot/ingest` → `ot_telemetry` + `telemetryBus`. Gửi mẫu `{ machineCode, metric, value, unit, ts }`. Trả **202**. Ví dụ pilot: ESP32 nhiệt-ẩm (doc 56B kịch bản B).

### 3c. EVENT (tuỳ chọn) — alarm/state-change → central-alert (map theo họ máy, mig 0291).

---

## 4. CẤU HÌNH — recipe & đồng bộ (config-sync generic)

Bật `CONFIG_SYNC_GENERIC_ENABLED=true`. Máy KÉO cấu hình (không nhận PUSH body):

1. **check** — `GET /api/machine/config-sync/check?configKind=recipe` → `{code, version, checksum, resolvedBy}`. So `checksum` với cái đang chạy; khác ⇒ cần cập nhật.
2. **get** — `GET /api/machine/config-sync/get?configKind=recipe` → payload đầy đủ + checksum. Áp vào máy.
3. **ack** — `POST /api/machine/config-sync/ack` `{configKind, code, version, checksum}` → server ghi *reported* + tính `driftState` (in_sync|drift). Bật `CONFIG_DRIFT_REPORT_ENABLED` để heartbeat `running[]` cũng báo drift → Andon.

Kỹ sư deploy recipe qua UI (Kỹ thuật › Recipe) → server ghi *desired* shadow + notify retained MQTT `synapse/v1/machine/{code}/config/{kind}` (chỉ `{code,version,checksum}` — body luôn kéo HTTP). `configKind` ∈ `recipe | device_settings | points | model`.

Spec-limits (cho spec-gate + Cpk): seed `process_spec_limits` theo `(stepType, metricKey)` — đã có screw/dispense/weld (mig 0289+0295); KT chỉnh qua Threshold Advisor. Recipe typed-schema: `RECIPE_TYPED_SCHEMA_MODE=off|log|enforce` (screw/dispense/weld/iot).

---

## 5. NGHIỆM THU — dashboard · SPC · AI

Bật `PROCESS_ANALYTICS_ENABLED=true`, rồi kiểm 5 chặng §9 blueprint:

| Chặng | Kiểm ở đâu |
|---|---|
| Đăng ký + credential | máy `approved`, `api_keys` có mk_ |
| Gửi dữ liệu | emitter thấy **201/202**; `process_results`/`ot_telemetry` có dòng |
| Vào DB đúng schema | envelope đủ (metrics, waveforms, `time_source`, `server_received_at`) |
| Dashboard đọc được | `/process-analytics` + tab "Kết quả process" (MachineCockpit): donut pass/fail, **SPC I-MR** (UCL/CL/LCL + Cpk + #ngoài-kiểm-soát), card "Tổng hợp theo loại máy" (FPY theo deviceClass) |
| AI đọc được | hỏi AI: *"sức khoẻ thiết bị `<CODE>`"* → `get_device_health` (process+drift+SPC); *"tổng hợp automation hôm nay"* → `get_fleet_process_summary` |

---

## 6. Ma trận cờ (tất cả default-OFF ⇒ đường cũ byte-identical)

| Cờ | Đợt | Tác dụng khi ON |
|---|---|---|
| `PROCESS_RESULT_INGEST_ENABLED` | Đ1 | nhận RESULT `/api/v1/ingest/process-result` |
| `PROCESS_STORE_FORWARD_ENABLED` | Đ1 | WAL đĩa khi DB chập chờn |
| `PROCESS_ATTR_VALIDATE_MODE` | Đ1 | validate stepType (off\|log\|enforce) |
| `MACHINE_CRED_MK_ONLY_ENABLED` | Đ2a | fleet mới chỉ mk_ (cấm shared-key/code-only) |
| `IOT_DEVICE_CLASS_ENABLED` | Đ2a | IoT first-class + trạm/line ảo `IOT-<ws>` |
| `MACHINE_APPROVE_RBAC_OPEN_ENABLED` | Đ2a | non-admin có `machine_registration` được duyệt |
| `MQTT_TELEMETRY_BRIDGE_ENABLED` | Đ2a | bridge MQTT synapse/ → telemetryBus |
| `VITE_DEVICE_ONBOARD_WIZARD_V2_ENABLED` | Đ2b | wizard `/device-onboarding` (CLIENT/Vite) |
| `CONFIG_SYNC_GENERIC_ENABLED` | Đ4 | check/get/ackConfigApplied + shadow |
| `CONFIG_DRIFT_REPORT_ENABLED` | Đ4 | heartbeat drift + Andon |
| `RECIPE_TYPED_SCHEMA_MODE` | Đ4 | validate recipe typed (off\|log\|enforce) |
| `PROCESS_SPEC_GATE_ENABLED` | Đ4 | spec-gate server-authoritative |
| `PROCESS_ANALYTICS_ENABLED` | Đ3/Đ5 | ProcessAnalytics + SPC + fleet + mart |
| `SOCKET_MACHINE_AUTH_MODE` | Đ0 | auth socket máy (off\|log\|enforce) |

Chi tiết trong `.env.example` (khối "Doc 56"). Thứ tự bật gợi ý: Đ0 socket-auth (log) → Đ1 ingest → Đ2a credential → Đ4 config-sync → Đ3/Đ5 analytics → Đ2b wizard (client).

---

## 7. Checklist vận hành (operator hardening)

- [ ] **Backfill machineType** cho máy cũ (nhiều `process_results.machineType=null` ⇒ fleet rollup gom vào "—"). Đặt máy đúng `machineType` để SPC/fleet phân nhóm.
- [ ] **Bật spec-gate sau khi có spec-limits** — bật `PROCESS_SPEC_GATE_ENABLED` chỉ khi `process_spec_limits` đã seed cho stepType đó (nếu không, gate fail-open 'none' vô hại nhưng không có tác dụng).
- [ ] **Refresh mart định kỳ** — gọi `processResult.refreshDaily` (hoặc lịch) để `process_result_daily` nóng; dashboard fallback live khi mart nguội.
- [ ] **Xoay khoá mk_** — bật `MACHINE_KEY_EXPIRY_ALERT_ENABLED`; xử lý action-inbox trước hạn (kẻo ingest 401).
- [ ] **Runbook 52 §3.f** — nếu NULL `machines.apiKey` plaintext, PHẢI bật `SOCKET_MACHINE_AUTH_MODE` (log→enforce) trước, kẻo vỡ presence socket.
- [ ] **Config-sync HTTP E2E** — sau khi bật cờ Đ4, restart server để instance nhận cờ; diễn tập check→get→ack qua HTTP thật + kiểm retained MQTT.
- [ ] **Kill-test store-forward** — diễn tập tắt DB giữa ca → buffer WAL → replay (cơ chế đã unit-test, cần diễn tập thật).
- [ ] **Nghiệm thu HW thật** — đội cơ điện flash firmware theo `examples/device-client/` + conformance fixtures doc 57 (cổng nhà máy QĐ8, tách khỏi green-gate CI).

---

## 8. Nhân rộng loại máy mới (đã chứng: bắt vít → điểm keo)

Thêm 1 họ máy tự động hoá mới KHÔNG cần sửa code nền — chỉ **dữ liệu + cấu hình**:

1. `machineType` đã có trong enum (mig 0287: +WELDER/IOT_*). Thiếu ⇒ thêm ADD VALUE (gotcha 0242: tách ADD-VALUE/seed).
2. Seed `process_step_types` cho stepType mới (mig 0289 mẫu).
3. Seed `process_spec_limits` (stepType, metricKey) — mig 0295 mẫu (glue_dispense/weld_spot).
4. (Tuỳ chọn) thêm recipe typed-schema `server/services/recipes/recipeSchemas.ts` nếu muốn validate setpoint.
5. Firmware: đổi `metrics`/`stepType` trong khung `screwdriver-emitter.mjs`.

Kết quả: dữ liệu tự chảy qua ingest → spec-gate → SPC → fleet → AI (đã chứng LIVE cho DISPENSING, exit 0 — doc 56B mục Đ7).

---

*Tham chiếu: doc 56 (audit+blueprint+kế hoạch), doc 56B (bằng chứng LIVE Đ3–Đ7), doc 57 (đặc tả Feed v1). Scripts: `pilot-provision-devices` · `pilot-config-sync` · `pilot-analytics` · `pilot-ai-persona` · `pilot-dispensing` · `sim/screwdriver-emitter`.*
