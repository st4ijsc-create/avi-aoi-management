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

## CÒN LẠI (chưa chạy trong phiên này)

- Kill-test store-forward (tắt DB giữa chừng → buffer WAL → replay): cơ chế `processStoreForward` đã test unit; chưa diễn tập với DB down thật.
- Config-sync qua HTTP proxy thật + retained MQTT notify `synapse/v1/machine/{code}/config/{kind}`: logic đã chứng qua caller + unit test; chưa diễn tập trên server HTTP đang chạy (cờ Đ4 mới nên instance :3000 cũ chưa bật — cần restart server với cờ Đ4 để E2E HTTP).
- Thiết bị THẬT (đội cơ điện flash firmware theo `examples/device-client/` + conformance fixtures doc 57) — cổng nghiệm thu nhà máy (QĐ8, tách khỏi green-gate).
- ✅ ProcessAnalytics UI (trang + tab MachineCockpit), wizard V2, DeviceHub deviceClass filter: **ĐÃ tích hợp + commit `897218d2`** (green: tsc + esbuild + i18n parity); LIVE-render trong browser để phiên sau.
