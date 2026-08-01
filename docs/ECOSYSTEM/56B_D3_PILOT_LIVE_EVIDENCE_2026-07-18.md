# Doc 56B — Đ3 PILOT: Bằng chứng LIVE E2E (2026-07-18)

Chạy THẬT trên server dev (`tsx server/_core/index.ts` :3000) + DB thật `aoi@127.0.0.1:5434`, cờ pilot bật: `PROCESS_RESULT_INGEST_ENABLED=true`, `PROCESS_ANALYTICS_ENABLED=true`, `IOT_DEVICE_CLASS_ENABLED=true`. Thiết bị + credential cấp qua `scripts/pilot-provision-devices.mjs` (mk_ key thật, sha256 hash-at-rest `api_keys`).

## Kịch bản A — Máy bắt vít `SCRW-SIM-01` (SCREWDRIVE, machineId 243)

Sim `scripts/sim/screwdriver-emitter.mjs` → **HTTP POST `/api/v1/ingest/process-result`** (Bearer mk_, đường ingest thật, KHÔNG ghi tắt DB), 12 chu trình + retry mỗi chu trình.

**Kết quả emitter:** `cycles=12 posted=12 accepted=12 httpError=0 networkError=0 · pass=8 fail=4 · duplicates(dedup ✓)=12` — mọi POST trả **HTTP 201**.

**Xác minh DB (`process_results` machineId=243):**
- 12 rows, 12 serial phân biệt.
- `stats by result: pass=8, fail=4` — **khớp chính xác** output sim.
- `process_idempotency_keys` machineId=243 = **12 rows** → 12 lần retry cùng `idempotencyKey` KHÔNG sinh row mới ⇒ **exactly-once dedup PROVEN qua HTTP + auth + ledger + DB thật**.
- Sample row đầy đủ envelope Feed v1: `torque=12.01`, `torque__usl=13.5` (limit lưu), `time_source=device` (ts kèm offset), `waveforms IS NOT NULL` (đường cong siết lưu jsonb), `server_received_at` stamped.

## Kịch bản B — Cảm biến ESP32 `ESP32-ENV-01` (IOT_SENSOR, machineId 244)

**HTTP POST `/api/v1/ingest/telemetry`** (Bearer mk_) — nhiệt-ẩm.
- Response: `{"ok":true,"data":{"accepted":2,"received":2}}` **HTTP 202**.
- Xác minh `ot_telemetry` machineId=244: `temperature=31.4 unit=C`, `humidity=62.1 unit=%` landed.

## Tầng phân tích + AI

- ProcessAnalytics helper `aggregateProcessResultStats({machineId:243})` = query SQL đã trả pass=8/fail=4; router `processResult.stats/metricSeries/stepTypes` (cờ `PROCESS_ANALYTICS_ENABLED`) test gating OFF→rỗng / ON→wire helper (2 test pass).
- AI tool F6 `get_machine_process_result` (handlersF6.ts) resolve theo machineCode → gọi CHÍNH `aggregateProcessResultStats` ⇒ đọc đúng dữ liệu pilot đã chứng minh (kỹ thuật viên hỏi "SCRW-SIM-01 pass/fail bao nhiêu" → tool trả summary thật).

## Chuỗi 5 chặng nghiệm thu §9 blueprint

| Chặng | A (máy vít) | B (ESP32) |
|---|---|---|
| 1. Đăng ký + credential | ✅ provision + mk_ | ✅ provision + mk_ |
| 2. Gửi dữ liệu (ingest thật) | ✅ 12× HTTP 201 | ✅ HTTP 202 |
| 3. Vào DB đúng schema | ✅ process_results 12 + envelope đủ | ✅ ot_telemetry |
| 4. Phân tích/dashboard đọc được | ✅ stats pass=8/fail=4 | ✅ (telemetry series) |
| 5. AI đọc được | ✅ F6 tool cùng query | ✅ machine-anchored tool |
| Kill-test dedup exactly-once | ✅ 12 retry = 0 row thừa | — |

## Đ4 — CONFIG-SYNC LOOP: Bằng chứng LIVE (2026-07-18, bổ sung phiên sau)

Đóng vòng **cài đặt & đồng bộ cấu hình tổng quát** trên chính máy pilot `SCRW-SIM-01` (id 243) qua `scripts/pilot-config-sync.mjs` — chạy CHÍNH các publicProcedure mà Express proxy gọi (real `authenticateMachine` bằng mk_ key tươi, real `resolveActiveRecipe`, real `recordReportedConfig`, real `computeDriftState`, real bảng `machine_config_state`), DB owner `aoi@5434`, cờ `CONFIG_SYNC_GENERIC_ENABLED=CONFIG_DRIFT_REPORT_ENABLED=true` + `RECIPE_TYPED_SCHEMA_MODE=enforce`. Chỉ bỏ lớp HTTP proxy mỏng (Bearer mk_ trên dây đã chứng ở Đ3).

| Chặng | Lệnh | Kết quả LIVE |
|---|---|---|
| DEPLOY (ý định KT) | `createRecipe(status=active)` + `upsertDesiredConfig` | recipe `SCRW-RECIPE-01` v2 (v1→archived, `uq_machine_recipes_active_code` giữ 1-active/code), desired shadow ghi `checksum=3c9e8caf…`. driftState="drift" **ngay** vì máy còn báo checksum tay-sửa lần trước ⇒ trung thực |
| CHECK (máy hỏi) | `machineApi.checkConfigVersion` | `{code:SCRW-RECIPE-01, version:2, checksum:3c9e8caf…, resolvedBy:"machine"}` — bind per-máy |
| GET (máy kéo) | `machineApi.getActiveConfig` | payload đủ `{torqueTarget:12.5, torqueTolerance:0.5, angleTarget:720, speedRpm:300}` round-trip đúng giá trị (jsonb đổi thứ tự key — checksum canonical là chữ ký bất biến) |
| ACK #1 (áp đúng) | `machineApi.ackConfigApplied(checksum=đúng)` | **driftState="in_sync"**, shadow `reportedChecksum==desiredChecksum` |
| ACK #2 (thợ đổi tay) | `machineApi.ackConfigApplied(checksum=lệch)` | **driftState="drift"**, shadow lưu checksum phân kỳ ⇒ sẵn sàng cho `routeConfigDriftAlert` |

**Verdict script: ✅ exit 0** — deploy→check→get→ack(in_sync)→drift, shadow bền, drift phát hiện. Cột `machine_config_state` (mig 0293) mang desired* (đặt lúc deploy) vs reported* (đặt lúc ack) + driftState; checksum = tín hiệu drift chuẩn (fallback code+version). Đây là hiện thực hóa LIVE của "tiêu chuẩn hóa cài đặt & đồng bộ cấu hình" — KHÔNG còn hard-wire measurement-points AOI: cùng đường ống phục vụ recipe (screw/dispense/weld), device_settings (IoT), points (AOI, alias đọc y hệt legacy), model (reserved).

## Đ5 — DASHBOARD/SPC/MART/FLEET: Bằng chứng LIVE (2026-07-18)

Tầng **phân tích dữ liệu theo deviceType** — NỐI process_results (dữ liệu automation/IoT vừa chảy) vào SPC/mart sẵn có, KHÔNG viết lại: `server/utils/spc.ts` (generateControlChart I-MR + calculateCapabilityIndices) dùng chung với đường inspection. mig 0294 `process_result_daily` (rollup/ngày, FPY lưu sẵn). Chạy `scripts/pilot-analytics.mjs` trên DB thật + dữ liệu pilot (12 chu trình torque máy 243 từ Đ3):

| Thành phần | Kết quả LIVE |
|---|---|
| MART `refreshProcessResultDaily` (raw INSERT…SELECT…ON CONFLICT) | **91 rollup rows** upsert; máy 243 → `total=12 pass=8 fail=4 FPY=66.7%` (khớp Đ3) |
| SPC `buildProcessControlChart` I-MR trên 12 torque thật | `UCL=16.856 CL=11.730 LCL=6.605 σ̂=1.71`, out-of-control **0/12**, **Cpk=0.24** (USL 13.5/LSL 10.5 — thấp thật do phương sai pilot lớn, honest) |
| FLEET `aggregateProcessResultStatsByType` | 3 nhóm machineType (FCT/ICT/—), pass/fail/total |
| **Verdict script** | **✅ exit 0** |

Router `processResult` (cờ `PROCESS_ANALYTICS_ENABLED`, gate ship-dark): `spcChart` (I-MR + Cpk server-authoritative), `fleetRollup` (gắn deviceClass qua DEVICE_CLASS_BY_TYPE + FPY), `envSeries` (telemetry IoT reuse getTelemetrySeries), `dailyRollup`/`refreshDaily` (mart). Client `ProcessAnalytics.tsx`: chart ưu tiên giới hạn kiểm soát UCL/CL/LCL từ server (fallback ±2σ), caption SPC (σ̂/Cpk/#OOC), card "Tổng hợp theo loại máy" (FPY theo deviceClass). i18n +10 leaf/locale parity. tsc 0 lỗi · vitest processSpc 4 + analytics-router 4 (gồm OFF-inert 5 endpoint). **mig 0294 áp DB live.**

## Đ6 — AI LOCAL 3 PERSONA: Bằng chứng LIVE (2026-07-18)

Tầng **AI local hỗ trợ kỹ thuật + công nhân + quản lý** — NỐI dữ liệu chuẩn hóa (process + config-drift Đ4 + SPC/fleet Đ5) vào AI-tool sẵn (`aiLocalTools`, KHUÔN F6). 2 tool read `handlersF7.ts`, self-register, intent qua triggers + arg-extract:

- **`get_device_health`** (công nhân "máy này ổn không" + kỹ thuật "lệch cấu hình/Cpk"): 1 thiết bị — pass/fail+FPY, config drift (desired vs reported shadow), SPC I-MR (Cpk/#OOC) của metric chính (tự suy nếu không nêu).
- **`get_fleet_process_summary`** (quản lý "phân xưởng automation thế nào"): pass-rate & FPY theo machineType/deviceClass, lọc theo nhóm.

`scripts/pilot-ai-persona.mjs` chạy CHÍNH handler đã đăng ký trên DB thật + máy pilot 243:

```
get_device_health(SCRW-SIM-01):
Thiết bị SCRW-SIM-01 (SCREWDRIVE/automation) — process 12 bản ghi, đạt 8/lỗi 4 (33.33%), FPY 66.7%.
• Cấu hình: ⚠ LỆCH (recipe)          ← đọc thẳng shadow drift do Đ4 tạo
• SPC angle: CL 358.933 [331.467–386.399], ngoài kiểm soát 0/12.
get_fleet_process_summary: toàn bộ 5904 bản ghi, FPY chung 98.2% · FCT/ICT/— theo deviceClass.
```

**Verdict script: ✅ exit 0.** Green-gate: tsc 0 lỗi · vitest 7 (F7) + 190 (toàn aiLocalTools, KHÔNG vỡ đếm tool) · intent routing xác minh (device-health + fleet-summary định tuyến đúng qua triggers). Lưu ý honest: `MACHINE_CODE_REGEX` chung cắt "SCRW-SIM-01"→"SIM-01" khi hỏi tự do (dùng context selectedMachineCode khi mở từ trang máy) — hành vi có sẵn, không sửa regex chung trong Đ6.

## Đ7 — NHÂN RỘNG DISPENSING (họ máy tự động hoá thứ 2): Bằng chứng LIVE (2026-07-18)

Chứng **chuẩn hoá TỔNG QUÁT**: một máy ĐIỂM KEO (DISPENSING / `glue_dispense`) chảy qua ĐÚNG pipeline mà máy vít đã chứng ở Đ3 — **zero endpoint mới**. mig 0295 bù spec-limits còn thiếu cho `glue_dispense` (volume 0.15–0.35 ml, pressure 180–320 kPa) + `weld_spot` (current 1800–2600 A, time 80–220 ms). `scripts/pilot-dispensing.mjs` provision `GLUE-SIM-01` (id245, DISPENSING) + mk_, gửi 10 chu trình qua **CHÍNH `machineApi.submitProcessResult`** (auth mk_ + stepType-validate + spec-gate vs 0295 + idempotency), 2 giọt thiếu keo ép dưới LSL:

```
EMIT glue_dispense: posted=10 accepted=10 pass=8 fail=2
DB process_results(GLUE-SIM-01, glue_dispense) = 10 rows · analytics pass=8 fail=2
SPC volume: CL=0.2158 [-0.0010–0.4326] OOC=0/10 Cpk=0.30
AI get_device_health: DISPENSING/automation — 10 bản ghi, đạt 8/lỗi 2 FPY 80%, SPC volume computed.
```

**Verdict script: ✅ exit 0** — cùng ingest+spec-gate+SPC+AI như máy vít, chỉ khác metric (torque→volume/pressure) + stepType (screw_tightening→glue_dispense). WELDER đã có step-type + spec (0289+0295) sẵn nhân rộng tương tự. Đội cơ điện: dùng `scripts/sim/screwdriver-emitter.mjs` làm khung, đổi metrics/stepType (xem doc 58).

## CÒN LẠI (chưa chạy trong phiên này)

- Kill-test store-forward (tắt DB giữa chừng → buffer WAL → replay): cơ chế `processStoreForward` đã test unit; chưa diễn tập với DB down thật.
- ✅ **Config-sync HTTP proxy E2E ĐÃ CHỨNG LIVE** (2026-07-18): server riêng cờ Đ4 (`:3008`, MQTT off) + `scripts/pilot-config-sync-http.mjs` → check/get/ack(in_sync)/ack(drift) đều **HTTP 200** qua Express proxy + **Bearer mk_ trên dây**. Phát hiện+vá gap thật: 3 proxy config-sync trước chỉ đọc `x-api-key`/`?apiKey` ⇒ thiết bị dùng `Authorization: Bearer` (như doc 58 khuyến nghị cho ingest) bị BAD_REQUEST ở refine `apiKey|machineCode`; nay proxy đọc thêm Bearer (`machineBearer`), nhất quán với ingest. **Retained MQTT notify** `synapse/v1/machine/{code}/config/{kind}` vẫn CHƯA diễn tập (MQTT_ENABLED=false trong lần chạy này; code best-effort no-op khi broker off) — cần server có `MQTT_ENABLED=true` để E2E notify.
- Thiết bị THẬT (đội cơ điện flash firmware theo `examples/device-client/` + conformance fixtures doc 57) — cổng nghiệm thu nhà máy (QĐ8, tách khỏi green-gate).
- ✅ ProcessAnalytics UI (trang + tab MachineCockpit), wizard V2, DeviceHub deviceClass filter: **ĐÃ tích hợp + commit `897218d2`** (green: tsc + esbuild + i18n parity); LIVE-render trong browser để phiên sau.
