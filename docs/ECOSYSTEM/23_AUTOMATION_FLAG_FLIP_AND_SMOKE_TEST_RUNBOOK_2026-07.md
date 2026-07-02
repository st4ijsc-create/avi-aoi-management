# 23 — Runbook: Bật cờ (flag-flip) & Smoke-test cho các tính năng Automation

> **Đối tượng:** vận hành (ops) / kỹ sư triển khai. **Bối cảnh:** sau khi thực thi doc 22 P0–P5 (nhánh `automation-orchestration-r0`), toàn bộ năng lực automation mới **mặc định TẮT CỜ** — code đã build + test nhưng chưa "chạy thật". Runbook này hướng dẫn **bật từng cờ có kiểm soát + smoke-test + rollback**.
> **Ngày:** 2026-07-02. Liên quan: doc 22 (đánh giá + kế hoạch), doc 19 (activation runbook cũ), doc 20 (Group C pre-hardware).

---

## 0. Nguyên tắc an toàn (đọc trước)

1. **Bật trên STAGING trước**, không bật thẳng production. Mỗi cờ bật xong → smoke-test → quan sát ≥1 ca → mới cân nhắc production.
2. **Bật TỪNG cờ một** (hoặc từng nhóm nhỏ cùng phụ thuộc), không bật hàng loạt. Sau mỗi lần bật, chạy smoke-test tương ứng.
3. **Không bao giờ** bật cờ **Tier C/D** (ghi thiết bị / an toàn phần cứng) khi chưa có phần cứng + 2-eyes sign-off. Phần mềm **không thay thế** safety-rated stop.
4. Mọi cờ đọc **lúc runtime** → **phải khởi động lại server** (`npm run dev` / `npm start`) sau khi sửa `.env`.
5. **Rollback = đặt lại `=false` + restart.** Mọi service tự no-op khi cờ off (đã test). Không cần rollback DB (tính năng advisory chỉ ghi log/bảng riêng).

---

## 1. Pre-flight checklist (bắt buộc trước khi bật bất kỳ cờ nào)

```bash
# 1. Migration đã áp đủ (phải thấy "✓ All on-disk migrations in range recorded success=true")
node scripts/check-applied-migrations.mjs            # cần DATABASE_URL trong .env

# 2. Biên dịch + test xanh
npm run check                                        # tsc --noEmit → exit 0
npx vitest run                                       # full suite (2620+ pass)

# 3. Hạ tầng
#    - PostgreSQL reachable (DATABASE_URL); TimescaleDB cho twin replay
#    - STORAGE_MODE=local  (để phục vụ /uploads — cần cho upload model 3D)
#    - Local LLM (node-llama-cpp + llama-server) nếu bật nhóm AI vision/RCA
#    - MQTT broker (Aedes nội bộ hoặc external) nếu bật MTConnect / Sparkplug / VDA5050
```

**Cách bật 1 cờ:** sửa dòng tương ứng trong `.env` thành `=true` (nếu chưa có, thêm mới — tên chuẩn ở `.env.example`), rồi **restart server**.

---

## 2. Các tầng kích hoạt (theo rủi ro & phụ thuộc)

> Thứ tự khuyến nghị: **Tier A → B → (C chỉ khi có HW) → D (phần cứng)**.

### TIER A — An toàn / advisory / read-only *(bật trước, rủi ro thấp nhất)*

| Cờ | Tính năng | Prereq | Smoke-test → Kỳ vọng |
|---|---|---|---|
| `PDM_SENSOR_INGEST_ENABLED` | Ingest sensor MQTT → `machineSensorReadings` (PdM theo rung/dòng thật) | MQTT broker + sensor publish | Publish 1 topic sensor → thấy row mới trong `machine_sensor_readings`; PdM risk cập nhật |
| `PDM_AUTO_WORKORDER_ENABLED` | PdM risk cao → tự tạo maintenance work-order (idempotent) | PdM đang chạy | Ép 1 máy risk cao → 1 work-order tạo ra (không nhân đôi khi chạy lại) |
| `AI_MODEL_PERF_SNAPSHOTS_ENABLED` | Sweep ghi `model_performance_snapshots` từ `ai_feedback` | Có feedback dữ liệu | Sau 1 chu kỳ sweep → có row snapshot cho model đang active |
| `AI_MODEL_AUTOROLLBACK_ENABLED` | Drift → đề xuất/rollback về version ổn định | **Bật SAU** khi snapshots đã có dữ liệu | Không còn "no signal → no-op"; log đánh giá rollback xuất hiện |
| `AI_ROBOT_ANOMALY_ENABLED` | Phát hiện bất thường quỹ đạo/lực/cycle robot (advisory) | robot telemetry | Bơm cycle-time tăng dần → cảnh báo advisory (không chặn) |
| `EQ_GOVERN_ENABLED` | Equipment Standards Board (device-type versioned, SemVer, conformance) | — | Trang `Admin → Equipment Standards` sống; tạo change-request → review → publish |
| `WORKFORCE_ENABLED` | Workforce Board + operator_assignments + collaboration FSM | — | Gán operator vào trạm → hiện realtime; double-book bị chặn |
| `SAFETY_AUDIT_ENABLED` | `safety_events` SIL-tagged (log advisory) + PDCA near-miss | — | Ghi 1 safety-event qua router → xuất hiện trong Safety Cockpit + `responseTimeMs` điền |
| `SAFETY_SIM_TRACKS_ENABLED` | **DEMO** — publisher track mô phỏng người↔robot để chạy vòng an toàn end-to-end | `SAFETY_ZONE_SW_ENABLED` (đánh giá) | Bật → thấy `safety:event` socket + Safety Cockpit đổi cấp (speed→stop), nhãn "SIMULATED". **KHÔNG** actuate thiết bị |
| `SAFETY_ZONE_SW_ENABLED` | Zone evaluator 3-cấp (advisory: speed_reduce/stop/rated_stop-LOG-ONLY) | — | Nạp proximity gần → cấp phản ứng đúng; `rated_stop` chỉ **log**, không dừng thật |
| `MTCONNECT_ENABLED` | Poller MTConnect (máy CNC/agent MTConnect) → telemetry bus + alarm→Andon | MTConnect agent URL | Trỏ 1 agent → SAMPLE vào `ot_telemetry`, CONDITION → Andon |
| `TWIN_LIVE_ENABLED` | Digital Twin live (WS stream <500ms thay poll 5s) + đăng ký model | — | Twin Center đổi từ poll sang stream; upload model 3D `/machine/:id` tab 3D hoạt động |
| `MODEL_PIPELINE_ENABLED` | Pipeline URDF→glTF (convert từ UI) | TWIN_LIVE | `twin.pipeline.convertUrdf` tạo glTF + row `equipment_3d_models` 'ready' |
| `SIM_KINEMATIC_ENABLED` | Simulation Gate động học THẬT (FK/collision/joint-limit/IK cho move_linear) | — | Chạy sim 1 program → trả collision/joint-limit thật; flow lỗi **không** deploy được |
| `SIM_PHYSICS_ENABLED` | Lớp dynamics (vận tốc/gia tốc/mô-men) — mặc định backend nội bộ | SIM_KINEMATIC | Move quá nhanh → cờ `dynamicsPass:false` + lý do; **KHÔNG** đổi `pass` kinematic |

> **Ghi chú:** `SAFETY_SIM_TRACKS_ENABLED` chỉ để **demo/nghiệm thu vòng phần mềm** — tắt trước khi có cảm biến thật. Nó bơm dữ liệu **mô phỏng có nhãn**, không phải sensor thật.

### TIER B — Orchestration *(cần dữ liệu thật + theo dõi; bật sau Tier A)*

| Cờ | Tính năng | Prereq | Smoke-test → Kỳ vọng |
|---|---|---|---|
| `FLEET_ORCH_ENABLED` | Task Allocator + Traffic/Zone reservation + rebalance drain sweep | Có `tasks`/`zones`/robot registry | Tạo task → gán robot theo capability/distance/battery; đặt zone quá tải → queue (không vượt cap — race đã fix P0) |
| `FLEET_RESOURCE_ENABLED` | Shared resource claim + predictive charging | FLEET_ORCH | Claim jig bởi 2 robot → 1 active, 1 queued; release → promote FIFO |
| `FOE_ENABLED` | FOE workflow runtime (ISA-88) | — | Deploy 1 workflow → run/step audit; HITL gate resume |
| `ANDON_ROBOT_DISPATCH_ENABLED` | Andon "cần hỗ trợ" → tạo task assist → allocator | **FLEET_ORCH** | Bấm Andon assist → 1 task `andon:*:assist` tạo ra; lệnh robot vẫn qua gate dry-run |
| `OT_OPCUA_MONITORED_ITEMS` | OPC-UA push (ClientMonitoredItem) thay poll | OT_GATEWAY+OT_OPCUA + PLC/soft-PLC | Đổi 1 node trên server OPC-UA → sample push tới ngay (không chờ poll) |
| `ERP_INBOUND_ENABLED` | Nhận order/BOM từ ERP (`POST /api/v1/orders`, `/bom`) | API key + scope | POST order idem-key → upsert `production_orders`; POST lại → idempotent |
| `ERP_OUTBOX_ENABLED` | Outbox bền đẩy quality/OEE/genealogy lên ERP + circuit-breaker | endpoint ERP | Inspection hoàn tất → row `integration_outbox` → worker đẩy (retry nếu fail) |

### TIER C — Nhạy cảm / hướng-thiết-bị *(chỉ staging + 2-eyes; KHÔNG production khi chưa có HW sign-off)*

| Cờ | Cảnh báo |
|---|---|
| `OT_GATEWAY_ENABLED` + `OT_OPCUA/MODBUS/S7/MITSUBISHI_MC/ETHERNET_IP_ENABLED` | Kết nối PLC thật. Bật read-only trước; **cần soft-PLC/simulator** để test trước thiết bị thật |
| `OT_READBACK_ENABLED` | Verify read-back sau ghi — chỉ bật khi đã test read |
| `OT_CONTROL_ENABLED` | **GHI LỆNH THIẾT BỊ.** Chỉ bật với HITL + interlock + dry-run đã kiểm; 2-eyes; audit append-only |
| `DPC_DEPLOY_ENABLED` | Deploy chương trình xuống máy thật. **Chỉ deploy được khi Simulation Gate pass** (P0) + HITL confirmedBy |
| `EQ_INTEG_ENABLED` / `SECS_GEM_ENABLED` | SECS/GEM (E30 state model + S1 messages). `SECS_GEM_ENABLED` mở `establishCommunications()`/`requestOnline()` — read/monitor; cần thiết bị SECS thật để nghiệm thu |
| `VDA5050_ENABLED` / `ROBOT_CONTROL_ENABLED` | Điều khiển AGV/robot. Chỉ với robot thật + safety layer |

### TIER D — Cần PHẦN CỨNG (P6 — không thể validate chỉ bằng bật cờ)

| Cờ / Hạng mục | Phần cứng bắt buộc |
|---|---|
| `SAFETY_ZONE_SW_ENABLED` (thật) + rated-stop | **Safety PLC SIL 2/3** (Pilz/Sick) + reset thủ công — phần mềm chỉ giám sát |
| `SAFETY_VISION_ENABLED` | Camera edge + **export YOLO `.onnx`** (model hiện là PyTorch) + hiệu chuẩn |
| `SAFETY_PLC_ADAPTER_ENABLED` (live) | Modbus/OPC-UA tới safety-PLC thật (read-only) |
| OT drivers (thật) | PLC/CNC thật; FOCAS cần **Fwlib32**; EtherCAT cần master real-time |
| Human tracking | **UWB / LiDAR** |

---

## 3. Bộ cờ khuyến nghị cho STAGING (copy-paste, Tier A)

```dotenv
# --- Tier A: advisory / read-only (an toàn để bật trên staging) ---
PDM_SENSOR_INGEST_ENABLED=true
PDM_AUTO_WORKORDER_ENABLED=true
AI_MODEL_PERF_SNAPSHOTS_ENABLED=true
AI_ROBOT_ANOMALY_ENABLED=true
EQ_GOVERN_ENABLED=true
WORKFORCE_ENABLED=true
SAFETY_AUDIT_ENABLED=true
SAFETY_ZONE_SW_ENABLED=true
MTCONNECT_ENABLED=true
TWIN_LIVE_ENABLED=true
MODEL_PIPELINE_ENABLED=true
SIM_KINEMATIC_ENABLED=true
SIM_PHYSICS_ENABLED=true
# Demo vòng an toàn end-to-end (TẮT khi có cảm biến thật):
SAFETY_SIM_TRACKS_ENABLED=true
# Bật SAU khi model-perf snapshots đã có dữ liệu vài ca:
# AI_MODEL_AUTOROLLBACK_ENABLED=true
STORAGE_MODE=local
```

Sau khi thêm → **restart server** → chạy §4.

---

## 4. Lệnh verify nhanh sau khi bật

```bash
# Server khởi động không lỗi + log cho thấy các background worker đã start theo cờ
npm run dev            # quan sát log: [TwinStream] gateway started / [Fleet] sweep / sim publisher…

# Kiểm thử lại vùng liên quan (không cần DB thật cho phần lớn)
npx vitest run server/services/safety server/services/fleet server/services/twin \
                server/services/programming server/services/secsgem server/services/ai

# Twin: mở /machine/<id> → tab 3D → "Upload & register 3D model" (.glb/.gltf) → model hiện
# Fleet: /fleet-orchestration → tạo task → quan sát gán + zone occupancy
# Safety: /safety-workforce (Safety Cockpit) → thấy banner "NOT a SIL controller" + ticker sự kiện
```

---

## 5. Rollback & sự cố

- **Rollback tức thì:** đặt cờ về `=false` + restart. Service no-op ngay (đã test flag-off cho mọi tính năng).
- **Không có down-migration** — nhưng các bảng advisory (safety_events, model_performance_snapshots, tasks, zone_reservations…) chỉ chứa dữ liệu quan sát, tắt cờ là ngừng ghi. Không ảnh hưởng golden-thread hiện có.
- **Nếu smoke-test fail:** tắt cờ đó, ghi lại log, KHÔNG bật tiếp tầng sau. Các cờ độc lập nên 1 cờ lỗi không kéo theo cờ khác.
- **Ranh giới an toàn tuyệt đối:** không có cờ nào ở Tier A/B khiến phần mềm tự thực hiện safety-rated stop hay ghi lệnh thiết bị. Chỉ Tier C/D chạm thiết bị — và chỉ với phần cứng + sign-off.

---

## 6. Trạng thái hiện tại (2026-07-02)

- Code P0–P5 (+ deeper) **đã commit + test xanh** (full suite 2620+ pass, typecheck sạch). Migration dev DB ở **0156**.
- **Tất cả cờ automation mới đang OFF** trong `.env` runtime (một số cờ AI cũ — PdM/Anomaly/RCA/Orchestration — đã ON từ trước).
- Runbook này là bước **"bật + smoke-test"** còn lại của doc 22 §7 P2/hoạt-động — thuộc quyết định vận hành, **không tự động chạy**.
