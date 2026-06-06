# Kế hoạch tổng thể — Nâng cấp thành Hệ thống Quản lý Nhà máy Thông minh 4.0 (AI Local)

> Tạo 2026-06-06. Tài liệu kiến trúc & roadmap để **chủ dự án review và duyệt TRƯỚC KHI gọi AI Agent chuyên môn code**.
> Định hướng đã chốt: **(1) Trọng tâm = lớp kết nối & điều khiển máy 2 chiều** · **(2) AI chỉ ĐỀ XUẤT, con người duyệt (HITL) — không để AI tự điều khiển máy** · **(3) Phạm vi = kiến trúc đầy đủ + roadmap dài.**
> Nguyên tắc xuyên suốt kế thừa GĐ1/2/3 Copilot: local-first/offline, HITL propose→confirm→execute, RBAC 2 lần, audit append-only, i18n vi/en/zh, idempotency, **không viết lại nghiệp vụ — tái dùng endpoint/service sẵn**.

---

## PHẦN A — ĐÁNH GIÁ HỆ THỐNG HIỆN TẠI (so với bài toán "kiểm soát toàn bộ nhà máy tự động hóa")

### A.1. Bài toán mục tiêu
Một nhà máy thông minh tự động hóa hoàn toàn gồm nhiều dây chuyền, mỗi dây chuyền nối tiếp nhiều loại máy: **máy lên liệu (feeder/loader) → máy lắp ráp tự động (assembly) → máy bắt vít (screwdriving) → máy điểm keo (dispensing) → máy AVI/AOI (inspection) → robot testing / jig test tự động (FCT/ICT) → máy đóng gói (packaging) → robot & máy xếp palet (palletizing)**. Cần một bộ não AI local giám sát + điều phối + truy vết + dự báo cho **toàn bộ** chuỗi này, không chỉ công đoạn inspection.

### A.2. Bảng đánh giá độ đáp ứng (hiện trạng đã kiểm chứng qua khảo sát mã nguồn)

| # | Năng lực cần cho nhà máy 4.0 | Hiện trạng | Điểm | Bằng chứng |
|---|---|---|---|---|
| 1 | Phân cấp ISA-95 (Corp→Factory→Workshop→Line→Station→Machine) | ✅ Đầy đủ 6 tầng | 95 | `drizzle/schema/hierarchy.ts:1-190` |
| 2 | Định nghĩa công đoạn / routing / process | ✅ Có (lineStages, processes, lineProcessAssignments) | 85 | `drizzle/schema/production.ts:98-193` |
| 3 | Truy vết WIP & genealogy theo serial | ✅ Tiên tiến (hash-chain SHA-256, 2 chiều, escape detection) | 95 | `drizzle/schema/mes.ts:21-104`, `product.ts:969-1022` |
| 4 | OEE per-máy (SEMI E10) + downtime | ✅ Đầy đủ | 92 | `drizzle/schema/oee.ts:1-115` |
| 5 | Quality: defect IPC-A-610, SPC, quality gate | ✅ Đầy đủ (7 chart, Western Electric/Nelson) | 92 | `drizzle/schema/spc.ts:33-212` |
| 6 | Bảo trì dự đoán (PdM) closed-loop | ✅ Có (health score, MTBF/MTTR, spare parts) | 85 | `drizzle/schema/mes.ts:195-304`, `machine.ts:77-111` |
| 7 | AI local offline (LLM/VLM/embedding/ONNX) | ✅ Mạnh (Qwen2.5 + LLaVA + mxbai, node-llama-cpp) | 90 | `server/services/aiGgufEngine.ts`, `aiInferenceEngine.ts` |
| 8 | AI Copilot agentic + HITL write | ✅ Có (GĐ1/2/3 propose→confirm, multi-step planner) | 85 | `aiCopilotActions.ts`, `aiAgentOrchestrator` (GĐ3 plan) |
| 9 | MQTT ingest telemetry + alert | ✅ Đầy đủ (Aedes local + HiveMQ, NG/summary/heartbeat) | 88 | `server/services/mqttService.ts` |
| 10 | Năng lượng / ISO 50001 | ✅ Cơ bản (kWh/unit, carbon, TimescaleDB) | 75 | `drizzle/schema/g3.ts`, timescale hypertable |
| **11** | **Industrial protocol thật (OPC-UA/Modbus/PLC/Profinet/EtherCAT)** | ⚠️ **CHỈ scaffold OPC-UA+Modbus (chưa cài package, NO-OP)** | **30** | `server/services/opcuaGateway.ts` (feature-flag tắt) |
| **12** | **Điều khiển máy 2 chiều (start/stop/recipe/job download)** | ❌ **CHỈ có CONFIGURE + SOFTWARE_UPDATE qua MQTT** | **20** | `mqttService.ts:530-650` (chỉ 2 lệnh) |
| **13** | **Machine types cho máy phi-inspection** (feeder/assembly/screw/glue/packaging/palletizer/robot) | ❌ **Gộp hết vào "AUTOMATION"** | **25** | `drizzle/schema/enums.ts:14-23` (8 type, đều inspection-centric) |
| **14** | **Mô hình thiết bị/recipe/program cho máy phi-inspection** | ❌ **Chưa có (data model nghiêng về điểm đo/ảnh)** | **20** | không có schema recipe/program/job |
| **15** | **Andon / line interlock / e-stop / permissive** | ❌ **Chưa có** | **15** | không có schema andon/interlock |
| **16** | **Unified Namespace (UNS) / chuẩn hóa topic toàn nhà máy** | ⚠️ **MQTT có nhưng topic cục bộ AOI, chưa chuẩn ISA-95 UNS** | **40** | `mqttService.ts:4-9`, `mqtt.ts:363-368` |
| 17 | BOM / vật liệu cấp component / feeder material | ❌ Chỉ cấp LOT, không BOM | 35 | `drizzle/schema/mes.ts:113-186` |
| 18 | APS (lập lịch hữu hạn năng lực, ràng buộc changeover) | ⚠️ Chỉ FIFO/Priority/EDF + realtime dispatch | 50 | `scheduling.ts`, `dispatchingService.ts` |

**Điểm tổng hợp độ đáp ứng "kiểm soát toàn bộ nhà máy": ~62/100.**
Hệ thống là một **MES + AI inspection xuất sắc (≈90)** nhưng **lớp kết nối/điều khiển thiết bị công nghiệp (OT) cho mọi loại máy mới ở mức ~25** — đây chính là khoảng trống lớn nhất, và trùng đúng trọng tâm bạn đã chọn.

### A.3. Kết luận đánh giá
- **Đã có (tận dụng tối đa, không làm lại):** toàn bộ tầng MES/quality/traceability/OEE/PdM/AI-local/Copilot-HITL.
- **Thiếu nghiêm trọng (trọng tâm nâng cấp):**
  1. **OT Connectivity Layer thật** — OPC-UA/Modbus/PLC + driver per vendor, chứ không chỉ MQTT của riêng AOI.
  2. **Bidirectional Device Control (qua HITL)** — gửi lệnh start/stop/recipe/job xuống mọi loại máy, có RBAC + audit + xác nhận.
  3. **Mô hình thiết bị tổng quát** — machine types + capability + recipe/program/job cho feeder/assembly/screw/glue/packaging/palletizer/robot.
  4. **Unified Namespace (UNS)** — chuẩn hóa topic ISA-95 cho toàn nhà máy (không chỉ AOI).
  5. **Andon / Line Interlock / Safety permissive** — phối hợp thời gian thực giữa các máy.
  6. **AI giám sát toàn line** — vẫn chỉ ĐỀ XUẤT (HITL), nhưng mở rộng read-tool/insight cho mọi loại máy.

---

## PHẦN B — SƠ ĐỒ LƯU TRÌNH HỆ THỐNG THÔNG MINH 4.0 (AI LOCAL)

### B.1. Kiến trúc phân tầng (ISA-95 Level 0→4) — bản đích

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L4  ENTERPRISE / BI                                                                     │
│     Corporate dashboards · Reports (PDF/PPT/Excel) · Multi-plant rollup · License       │
│     [ĐÃ CÓ]                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L3.5  AI LOCAL "BỘ NÃO" (on-prem, offline)                                              │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│   │ AI Copilot/Orchestrator (HITL)  ── chỉ ĐỀ XUẤT, người duyệt ──                    │ │
│   │   Planner (GGUF generateJSON) · Read-tools (mọi loại máy) · Write-tools(propose)  │ │
│   │   Playbook/SOP · Specialist agents · KB/RAG (pgvector, local embed)               │ │
│   ├─────────────────────────────────────────────────────────────────────────────────┤ │
│   │ Analytics: SPC · Anomaly(PatchCore) · Time-series forecast(EWMA/Holt-Winters)     │ │
│   │ Vision/VLM(LLaVA) · PdM health score · OEE engine · Dispatch ranking              │ │
│   └─────────────────────────────────────────────────────────────────────────────────┘ │
│   [ĐÃ CÓ ~85% — mở rộng read-tool/insight cho máy phi-inspection]                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L3  MES / OPERATIONS                                                                    │
│     Orders · Scheduling/Dispatch · WIP routing · Genealogy(hash-chain) · OEE ·          │
│     Quality gate · PdM work-order · Material/lot · Energy/EnPI · Shift/sign-off          │
│     [ĐÃ CÓ — bổ sung: recipe/program/job management · andon · BOM(tùy chọn)]            │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲ ▼  (2 chiều: telemetry lên / lệnh xuống qua HITL)
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L2.5  UNIFIED NAMESPACE (UNS) — MQTT Sparkplug-B / topic ISA-95 chuẩn hóa  ★MỚI★        │
│     enterprise/site/area/line/cell/device/{telemetry|state|event|command|response}      │
│     Broker: Aedes local (+ HiveMQ bridge tùy chọn) · QoS/retain · birth/death cert      │
│     [MỞ RỘNG từ MQTT hiện có]                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲ ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L2  OT CONNECTIVITY / DEVICE GATEWAY  ★TRỌNG TÂM MỚI★                                   │
│   Driver framework (plugin per protocol/vendor):                                        │
│     OPC-UA · Modbus TCP/RTU · Siemens S7 · Mitsubishi MC/FINS · EtherNet-IP · REST/MQTT │
│   Mỗi máy = Device Adapter (capability descriptor: đọc tag nào, lệnh nào hỗ trợ)        │
│   2 chiều: poll/subscribe telemetry  +  command dispatcher (start/stop/recipe/job)      │
│   An toàn: command đi qua HITL của L3.5 → người duyệt → mới ghi xuống PLC                │
│   [SCAFFOLD opcuaGateway.ts → nâng thành framework đầy đủ]                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲ ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ L1/L0  THIẾT BỊ / PLC / SENSOR / ACTUATOR                                               │
│  Feeder│Assembly│Screw│Dispensing│AVI/AOI│Robot-test/Jig│Packaging│Palletizer-robot     │
│  + Andon tower · E-stop · Safety relay · Energy meter                                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
★ = phần mới/trọng tâm nâng cấp. Phần `[ĐÃ CÓ]` tái dùng nguyên trạng.

### B.2. Lưu trình 2 chiều (telemetry ↑ và lệnh điều khiển ↓ — với rào HITL)

```
(A) LUỒNG TELEMETRY LÊN (read, tự động):
 PLC/Máy ──tag/event──► Device Adapter (L2) ──chuẩn hóa──► UNS topic (L2.5)
   └► Ingest service ──► PostgreSQL (inspection/oee/wip/machineHeartbeats…) + TimescaleDB
        └► AI Analytics (SPC/anomaly/forecast/health) ──► Insight + Alert
             └► Dashboard / Android app / Copilot context

(B) LUỒNG LỆNH XUỐNG (write/control, BẮT BUỘC qua HITL — KHÔNG tự động):
 Người dùng/AI-đề-xuất
   │  AI chỉ ĐỀ XUẤT: "nên đổi recipe R12 cho máy điểm keo #3 vì CPK giảm"
   ▼
 propose_command (L3.5)  ── dry-run preview + RBAC#1 + zod strict ──► PendingAction (TTL)
   ▼  [Người vận hành xem confirm card, đối chiếu]
 confirm (RBAC#2) ──► Command Dispatcher (L2) ──► Device Adapter ──► ghi tag/recipe xuống PLC
   ▼
 Máy phản hồi (response/ack) ──► UNS ──► cập nhật trạng thái + AUDIT append-only (ai_pending_actions + auditLogs)
   │  Nếu lỗi/timeout/denied → dừng, không retry mù, ghi audit, báo người dùng.
```

**Điểm mấu chốt (đúng định hướng đã chốt):** mọi hành động *ghi xuống máy* đều đi qua đúng khung HITL của GĐ2/GĐ3 (`aiCopilotActions.ts` propose→confirm→execute, RBAC 2 lần, audit, idempotency). AI **không bao giờ** tự ghi lệnh xuống thiết bị — chỉ tạo đề xuất để người duyệt.

### B.3. Vòng đời một sản phẩm qua line (genealogy xuyên công đoạn)

```
Feeder ─► Assembly ─► Screw ─► Dispensing ─► AOI/AVI ─► Jig/FCT/ICT ─► Packaging ─► Palletizer
  │         │          │          │             │           │              │            │
  └─ mỗi máy phát event "station" gắn serial/lot ─► genealogyChain (hash-chain SHA-256)
        + kết quả (pass/fail/giá trị đo/torque/lượng keo/test result) gắn vào stationTraces
        ► AI phát hiện escape/first-defect-station, dự báo, đề xuất hành động (HITL)
```
Hiện genealogy đã hỗ trợ chuỗi này; chỉ cần **các máy phi-inspection cũng phát event station + kết quả công đoạn** (torque máy bắt vít, thể tích keo, kết quả jig…) → cần mở rộng data model & adapter (Phần C).

---

## PHẦN C — KẾ HOẠCH NÂNG CẤP TOÀN DIỆN (ROADMAP DÀI, THEO GIAI ĐOẠN)

> Mỗi giai đoạn liệt kê: mục tiêu · việc chính · file/schema tác động · tiêu chí nghiệm thu. Tất cả write/command đi qua HITL. Không viết lại nghiệp vụ sẵn có.

### Giai đoạn F1 — Nền OT Connectivity (Device Gateway Framework) ★ưu tiên 1★
**Mục tiêu:** biến `opcuaGateway.ts` (scaffold) thành **framework driver đa giao thức, plugin-based**, đọc telemetry thật từ PLC/máy.
- Driver interface chung: `connect/disconnect/readTags/subscribe/writeTags/health`.
- Driver cụ thể (ưu tiên): **OPC-UA** (`node-opcua`), **Modbus TCP** (`modbus-serial`); kế tiếp S7/MC/EtherNet-IP.
- **Device Adapter + Capability Descriptor**: mỗi máy khai báo (YAML/JSON) tag đọc được, lệnh hỗ trợ, đơn vị, scale, vùng an toàn.
- Ingest chuẩn hóa → bảng telemetry hiện có + TimescaleDB.
- **Files:** nâng `server/services/opcuaGateway.ts` → `server/services/ot/` (driverRegistry, opcuaDriver, modbusDriver, deviceAdapter, ingest); `drizzle/schema` thêm `deviceAdapters`, `deviceTags`. ENV cho endpoint/poll.
- **Nghiệm thu:** đọc telemetry thật từ ≥1 OPC-UA + ≥1 Modbus device vào DB; offline/disconnect xử lý sạch; feature-flag bật/tắt từng driver.

### Giai đoạn F2 — Mô hình thiết bị tổng quát cho MỌI loại máy ★ưu tiên 1★
**Mục tiêu:** mở rộng data model để đại diện feeder/assembly/screw/glue/jig/packaging/palletizer, không gộp hết vào "AUTOMATION".
- Mở rộng `machineTypeEnum`: thêm `FEEDER, ASSEMBLY, SCREWDRIVE, DISPENSING, FCT, ICT_FUNC, ROBOT_TEST, PACKAGING, PALLETIZER, ROBOT` (giữ tương thích ngược).
- **Machine capability model**: máy có gì (đo torque? lượng keo? cycle? recipe?), kết quả công đoạn dạng tổng quát (`processResults`: serial, machineId, stepType, metricsJson, result).
- Genealogy: mọi máy phát event `station` + `processResult` gắn serial.
- **Files:** `drizzle/schema/enums.ts` (+enum), `drizzle/schema/machine.ts` (capability), schema mới `processResults`; migration mới. Adapter map tag→processResult.
- **Nghiệm thu:** tạo được 1 line mẫu đủ 8 loại máy; mỗi máy ghi processResult gắn serial vào genealogy; backward-compat AVI/AOI không hồi quy.

### Giai đoạn F3 — Unified Namespace (UNS) chuẩn hóa ★ưu tiên 2★
**Mục tiêu:** chuẩn hóa topic toàn nhà máy theo ISA-95 (không chỉ AOI), nền cho mở rộng vô hạn thiết bị.
- Topic chuẩn: `ent/{corp}/site/{factory}/area/{workshop}/line/{line}/cell/{station}/device/{machine}/{telemetry|state|event|command|response}`.
- Cân nhắc **Sparkplug-B** (birth/death certificate, sequence, payload nén) cho thiết bị OT; giữ topic AOI cũ qua lớp bridge tương thích.
- **Files:** mở rộng `server/services/mqttService.ts` + `drizzle/schema/mqtt.ts` (topic template chuẩn), bridge layer. Không phá topic cũ.
- **Nghiệm thu:** thiết bị mới đăng ký theo UNS; topic cũ vẫn chạy; tài liệu topic chuẩn cho team tích hợp máy.

### Giai đoạn F4 — Bidirectional Device Control qua HITL ★ưu tiên 1 (trọng tâm)★
**Mục tiêu:** gửi lệnh xuống máy (start/stop/pause/reset/recipe-select/job-download/jog) qua đúng khung HITL.
- **Command Dispatcher (L2)**: nhận lệnh đã confirm → ghi tag/recipe xuống PLC qua driver; chờ response/ack; timeout & idempotency.
- **Write-tool catalog điều khiển máy** (mỗi tool theo KHUÔN GĐ3: zod strict + summarize + preview dry-run + execute + requiredPermission):
  - `machine_start`/`machine_stop`/`machine_pause`/`machine_reset` (rủi ro Cao → permission đặc thù + có thể yêu cầu 2FA).
  - `select_recipe`/`download_job`/`set_machine_param` (rủi ro Cao).
  - `acknowledge_machine_alarm` (rủi ro Thấp).
- **Recipe/Program/Job management** (L3): bảng `machineRecipes`, `recipeDeployments` (version, who, when, checksum) — recipe là tài sản có kiểm soát phiên bản như spec điểm đo.
- **An toàn:** mọi lệnh control = write-action GĐ2 (propose→confirm→execute, RBAC 2 lần, audit). AI chỉ đề xuất. Lệnh rủi ro cao có cờ `requiresAdmin`/2FA. Không auto-chain nhiều lệnh.
- **Files:** `server/services/ot/commandDispatcher.ts`; write-handlers mới trong khung `aiLocalTools/writeHandlers/`; `toolRegistry.ts` (+tool); schema `machineRecipes`/`recipeDeployments`/`commandLog`; migration. Tái dùng `aiCopilotActions.ts` propose/confirm.
- **Nghiệm thu:** start/stop 1 máy thật qua propose→confirm→execute→ack→audit; thiếu quyền → denied + audit; recipe deploy có version & rollback thủ công; preview không ghi PLC.

### Giai đoạn F5 — Andon / Line Interlock / Safety permissive ★ưu tiên 2★
**Mục tiêu:** phối hợp thời gian thực giữa các máy (NG ở công đoạn trước → chặn công đoạn sau; andon tower; e-stop trạng thái).
- **Andon model**: trạng thái đèn (green/yellow/red/call), lý do, ai gọi, thời gian phản hồi (MTTA), escalation.
- **Interlock rules** (khai báo): điều kiện (vd CPK<x, NG-rate>y, upstream stop) → hành động đề xuất (chặn/giảm tốc/cảnh báo). **Quan trọng:** theo định hướng HITL, interlock mặc định **đề xuất + cảnh báo**, hành động dừng line thực tế vẫn cần người xác nhận (hoặc do PLC safety lo phần an toàn cứng, hệ thống chỉ giám sát/đề xuất).
- **Files:** schema `andonEvents`, `interlockRules`; service `andonService.ts`; reuse alert/socket realtime; FE andon board.
- **Nghiệm thu:** andon call hiển thị realtime + đo MTTA; interlock rule trigger ra đề xuất; ghi audit.

### Giai đoạn F6 — AI giám sát toàn line (mở rộng read-tool & insight, vẫn chỉ ĐỀ XUẤT) ★ưu tiên 2★
**Mục tiêu:** "bộ não" AI nhìn được mọi loại máy, đưa insight/đề xuất xuyên công đoạn (không tự điều khiển).
- Mở rộng read-tools cho máy phi-inspection: `get_machine_process_result`, `get_line_balance`, `get_torque_trend`, `get_dispense_volume_trend`, `get_packaging_throughput`, `get_palletizer_status`…
- Insight xuyên công đoạn: tương quan torque↔NG downstream; dự báo nghẽn line; đề xuất đổi recipe/bảo trì.
- Playbook SOP cho toàn line (kế thừa GĐ3c): "Xử lý NG tăng đột biến", "Đổi recipe đầu line", "Cài máy mới vào line".
- **Files:** thêm read-handlers `aiLocalTools/handlers.ts`; playbook YAML; reuse planner GGUF. Không sửa lõi HITL.
- **Nghiệm thu:** AI trả lời/đề xuất chính xác cho ≥1 tình huống xuyên công đoạn; mọi hành động vẫn qua HITL.

### Giai đoạn F7 — Hoàn thiện bổ trợ ★ưu tiên 3★
- **BOM / material cấp component + feeder material** (lấp gap #17) — nếu nghiệp vụ cần truy vết linh kiện.
- **APS nâng cao** (capacity hữu hạn, changeover) — nâng từ dispatch hiện có.
- **Energy analytics nâng cao** (peak demand, power factor, per-recipe energy).
- **Digital twin / mô phỏng line** (xa hơn) — dùng telemetry + UNS để mô phỏng.

### Bảng phụ thuộc & thứ tự triển khai
```
F1 (OT framework) ─┬─► F2 (device model) ─► F4 (control HITL) ─► F5 (andon/interlock)
                   └─► F3 (UNS) ───────────┘                  ─► F6 (AI toàn line) ─► F7 (bổ trợ)
```
Khuyến nghị làm tuần tự **F1 → F2 → F4** (xương sống 2 chiều) trước; F3 song song F2; F5/F6 sau khi control ổn; F7 cuối.

---

## PHẦN D — RỦI RO & NGUYÊN TẮC AN TOÀN

| Rủi ro | Biện pháp |
|---|---|
| Lệnh điều khiển sai gây hỏng máy/nguy hiểm | Mọi command qua HITL (propose→confirm), RBAC 2 lần, preview dry-run, lệnh rủi ro cao + 2FA; KHÔNG auto-chain; an toàn cứng (e-stop/safety relay) thuộc PLC, hệ thống chỉ giám sát/đề xuất |
| AI tự ý điều khiển | Theo định hướng đã chốt: **AI chỉ ĐỀ XUẤT**, không có đường tự execute lệnh điều khiển máy |
| Đa giao thức/đa vendor phức tạp | Driver plugin từng cái, feature-flag, capability descriptor khai báo; bật dần |
| Phá vỡ hệ thống AOI đang chạy tốt | Tái dùng endpoint/schema sẵn, backward-compat, bridge topic cũ, migration cộng thêm (không sửa phá) |
| Bảo mật OT (ghi xuống PLC) | Audit append-only mọi lệnh, RBAC, network segmentation OT/IT, allowlist tag/lệnh ghi được |
| Offline/mất kết nối máy | Queue + birth/death cert (Sparkplug), xử lý timeout sạch, không retry mù |

---

## PHẦN E — 8 QUYẾT ĐỊNH ĐÃ CHỐT (2026-06-06) ✅

1. ✅ **Giao thức OT F1:** OPC-UA + Modbus **trước**; **S7 / Mitsubishi-MC / EtherNet-IP làm NGAY** (cùng F1, không hoãn). → Driver framework phải bao 5 giao thức.
2. ✅ **machineTypeEnum:** ĐỒNG Ý thêm `FEEDER, ASSEMBLY, SCREWDRIVE, DISPENSING, FCT, ICT_FUNC, ROBOT_TEST, PACKAGING, PALLETIZER, ROBOT` (giữ tương thích ngược 8 type cũ).
3. ✅ **UNS:** đi theo **Sparkplug-B chuẩn công nghiệp** + **giữ bridge topic AOI cũ** (không phá hệ AOI đang chạy).
4. ✅ **HITL lệnh điều khiển:** **KHÔNG bắt buộc 2FA mỗi lần** (vẫn HITL propose→confirm + RBAC 2 lần + audit); tạo **permission module mới `machine_control`** (canView/canCreate/canEdit/canExecute), không dùng admin-equiv.
5. ✅ **Recipe/program:** **CÓ** versioning + rollback (như spec điểm đo).
6. ✅ **Andon/Interlock:** **Rule tất định (người soạn & duyệt) ĐƯỢC tự chặn line**; **AI chỉ ĐỀ XUẤT, không tự sinh lệnh chặn.** Ranh giới: chặn line do interlock rule người-duyệt là logic tất định kiểm soát được; AI không có đường tự execute lệnh điều khiển/chặn.
7. ✅ **Pilot:** làm **thí điểm 1 line đủ loại máy trước**, sau đó hoàn thiện đầy đủ toàn nhà máy.
8. ✅ **F7 (BOM/APS/energy nâng cao):** tách thành **"Giai đoạn 2"** riêng, không thuộc roadmap đợt này.

### Tác động của quyết định lên roadmap
- F1 mở rộng: 5 driver (OPC-UA, Modbus, S7, Mitsubishi-MC, EtherNet-IP) thay vì 2.
- F3 cố định: Sparkplug-B + bridge AOI.
- F4: thêm permission module `machine_control`; bỏ ràng buộc 2FA-mỗi-lần (giữ HITL+RBAC2+audit).
- F5: interlock rule tất định tự chặn line được phép; AI chỉ đề xuất.
- F7 → chuyển sang "Giai đoạn 2" (ngoài phạm vi đợt này).
- Toàn bộ roadmap chạy theo mô hình **pilot 1 line đủ loại máy → nhân rộng**.

---

## PHẦN F — QUY TRÌNH SAU KHI DUYỆT
1. Chủ dự án review tài liệu này, trả lời 8 quyết định ở Phần E (có thể chỉnh sửa trực tiếp).
2. Với mỗi giai đoạn đã duyệt → tạo tài liệu chi tiết kỹ thuật riêng (như `AI-COPILOT-GD3-PLAN.md`) trước khi code.
3. Gọi **AI Agent chuyên môn** thực thi theo từng giai đoạn (F1 trước), mỗi PR nhỏ, có test + nghiệm thu, không hồi quy AOI hiện có.
4. Bật feature-flag dần, pilot 1 line, rồi nhân rộng toàn nhà máy.
```
