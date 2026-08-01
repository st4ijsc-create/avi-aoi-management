# Doc 40 — Đánh giá độ hoàn thiện lần 2: Machine Monitoring & Engineering + Control — Kèm kế hoạch nâng cấp (CHỜ DUYỆT)

- **Ngày:** 2026-07-10 · **Nhánh:** `automation-orchestration-r0`
- **Phương pháp:** 12 AI agent song song (~1,75M token, 791 lượt đọc code, read-only) — 5 agent audit kỹ thuật + 1 agent ma trận thiết bị + 5 agent đóng vai người dùng + 1 agent benchmark thương mại. Mọi finding đều có evidence `file:line` do agent tự đọc; đánh giá theo **trạng thái code hiện tại**, không chép kết luận doc 25/26/37/38.
- **Phạm vi:** app **Máy móc & Thiết bị** (`devices` — Machine Monitoring) + app **Kỹ thuật & Điều khiển** (`engineering`), trọng tâm nền tảng kết nối/điều khiển backend (`server/services/ot|equipment|fleet|orchestration|robot|programming|safety|secsgem|mtconnect|focas|euromap`) và độ đầy đủ chức năng + tối ưu hiển thị frontend.
- **Trạng thái:** 📋 **BÁO CÁO CHỜ USER DUYỆT** — chưa thực thi bất kỳ thay đổi nào. Kế hoạch nâng cấp ở §11.

---

## §0. TL;DR

**Kết luận tổng:** 2 module đạt **~80% framework / ~35-60% production** tùy trục — khung kỹ thuật thuộc loại hiếm thấy (dispatcher đa-gate + ledger, sim-gate cứng, verify-after-download, twin live, AI copilot vượt cả 7 platform thương mại được so), nhưng giá trị đến tay người dùng bị chặn bởi 4 nhóm vấn đề: **(1) bug thật cấp "nút không hoạt động"**, **(2) RBAC split-brain lan rộng** (permission ma khóa ≥12 route về admin-only), **(3) tư thế cờ "control ON, verify OFF" + ~15-20% năng lực đã build đang ngủ vì flag**, **(4) 0% HW-validation**. Tổng cộng **91 finding kỹ thuật** (1 P0 + 17 P1 + 51 P2 + 22 P3) + 5 persona review + benchmark 16 năng lực.

### Scorecard

| Trục | Framework | Production | Chốt 1 câu |
|---|---|---|---|
| Backend kết nối thiết bị | 82% | **35%** | 5 driver thật nhưng gateway OFF, HA mù rớt-kết-nối-giữa-phiên (P0), 0 giờ HW |
| Backend điều khiển & lập trình | 82% | **42%** | Gate/ledger/sim/verify chuẩn mực; robot thiếu FAT gate, safety e-stop = Null, verify flags OFF |
| Backend dữ liệu giám sát | 78% | **40%** | Đường ống chạy "khô"; Availability chỉ đúng máy socket; downtime = nhập tay; bug PdM |
| Frontend Machine Monitoring | 82% | **60%** | Trưởng thành nhất, 100% dữ liệu thật; thiếu floor-map/telemetry-drill/so-sánh-ca |
| Frontend Engineering & Control | 82% | **55%** | Vòng điều khiển CỤT (không UI dispatch), four-eyes danh nghĩa, editor = textarea |
| Persona trung bình | — | **5.6/10** | Operator 4.5 · Quản đốc 5.5 · Bảo trì 6 · Kỹ sư 6 · OT Admin 6 |

### 10 phát hiện đắt nhất

1. **OT-F1 (P0):** HA supervisor không thể phát hiện rớt kết nối giữa phiên — cả 5 driver chỉ flip `connected=false` trong `disconnect()`; reconnect/failover thực tế không bao giờ chạy.
2. **Permission ma `machine_monitoring`** — category dùng làm module, không seed nào có → cockpit máy, feeder-verify, engineering-home… thực tế admin-only; 4/8 journey operator hỏng vì wiring quyền.
3. **Giao chỉ tiêu OEE chết runtime + ghi downtime fail âm thầm** — raw SQL sai casing Postgres (toast vẫn báo thành công); downtime history in-memory mất sạch sau restart.
4. **Ngõ cụt actionId:** real deploy Mitsubishi/robot bị NOT_CONFIRMED vĩnh viễn (UI sinh actionId random ≠ ai_pending_actions mà dispatcher verify) — đồng thời four-eyes chỉ là "chọn tên người duyệt hộ". 2 lỗi ngược chiều quanh 1 seam.
5. **Vòng điều khiển robot cụt ở frontend** — không tồn tại UI nào phát 1 lệnh qua HITL dispatcher dù flag ON; Propose → vòng tròn không có bước thực thi.
6. **Tư thế cờ "đã lên đạn"**: control/deploy ON trong khi readback/interlock-engine/four-eyes/FOE-durable/safety OFF và driver robot tự khai "chưa validate — hãy để OFF".
7. **Availability OEE chỉ đúng cho máy nối socket** — machine_status_logs không được ghi từ MQTT/OT/MTConnect/SECS → OEE null vĩnh viễn cho máy tích hợp chuẩn công nghiệp.
8. **Backend xong, UI 0%**: PKI cert, PM schedules, spare-parts ledger, sensor trend (dữ liệu đang ingest), reporting mart — nhiều hạng mục "đã thực thi" chưa ai dùng được.
9. **Máy AOI onboard xong bị vứt IP/port** — bảng machines không có cột địa chỉ; mất kết nối là phải ra tận máy.
10. **Lỗ đen SMT**: mounter/reflow/stencil-printer/wave + IPC-CFX/Hermes + IO-Link + SCPI + printer/marking = 0 dòng code — hệ chỉ phủ khâu inspection của line SMT.

### Kế hoạch đề xuất (§11, chờ duyệt)

**Wave 0** quick-wins → **Wave 1** sửa bug + RBAC wiring (cao nhất) → **Wave 2** đóng vòng điều khiển/deploy tin được (Approval Inbox + Command Console + robot FAT gate) → **Wave 3** dữ liệu nói thật + flip-to-verify (link-loss, presence, downtime, PdM, ~10 flag) **+ 3.8 Full-System Sim Mode (§13.4: bật MỌI flag + nhà máy ảo giả lập + kịch bản phá hoại)** → **Wave 4** frontend chuyên nghiệp + tính năng persona (4 gói: devices / engineering / war-room+CMMS+operator-kiosk / **4d = Factory Command View §13.1 + đại tu 3D §13.2 + content-first §13.3**) → **Wave 5** mở rộng độ phủ thiết bị (SLMP 3E ưu tiên 1, CFX, IO-Link, SCPI…) → **Wave 6** việc owner + đầu tư HW (FAT bench, Timescale, Safety PLC). **10 quyết định** chờ anh chốt ở §12 + cuối §13.

---

## §1. Phương pháp & phạm vi

| Nhóm | Agent | Phạm vi |
|---|---|---|
| Audit kỹ thuật | `backend-kết-nối` | drivers 5 protocol, connectionSupervisor HA, ingest/telemetryBus, store-forward, machineAuth/PKI, plugin bridge, MTConnect/SECS-GEM/FOCAS/Euromap, MQTT, edge |
| Audit kỹ thuật | `backend-điều-khiển` | commandDispatcher 4-gate, commissioning, interlock, robot 6 vendor, VDA5050, fleet, FOE/DAG, pipeline deploy (sim-gate/SoD/verify/rollback), IEC 61131-3/IR, safety e-stop, Zmotion FFI |
| Audit kỹ thuật | `backend-dữ-liệu-giám-sát` | ingest→lưu trữ→OEE/downtime/PdM/alert/energy→socket push, Timescale/CAgg, khả năng chịu tải 100+ máy |
| Audit kỹ thuật | `frontend-monitoring` | toàn bộ route app `devices` |
| Audit kỹ thuật | `frontend-engineering` | toàn bộ route app `engineering` |
| Ma trận | `ma-trận-thiết-bị` | ~17 loại thiết bị nhà máy × 5 năng lực (connect/monitor/control/program/twin) |
| Persona | 5 agent | Operator (chị Lan) · Bảo trì (anh Hùng) · Kỹ sư tự động hóa (anh Minh) · Quản đốc (chị Hương) · OT/IT Admin (anh Tuấn) |
| Benchmark | 1 agent | So với Ignition, ThingWorx, FactoryTalk, WinCC Unified, Kepware, AVEVA, Tulip |

Quy ước trạng thái năng lực: **real** = chạy thật · **partial** = một phần · **stub** = khung rỗng/mô phỏng · **flag_off** = code xong nhưng flag tắt · **missing** = chưa có.

---

## §2. Backend — Nền tảng KẾT NỐI thiết bị

**Chín muồi: framework ~82% · production ~35%.** Framework rất đầy đủ: 5 driver protocol dùng thư viện thật đã cài (node-opcua / modbus-serial / nodes7 / mcprotocol / st-ethernet-ip), supervisor HA backoff+failover, store-forward WAL restore lúc boot, telemetry bus hợp nhất, plugin sidecar có signature/lifecycle/quota, PKI/SPIFFE-lite, SECS/GEM HSMS codec thật. Nhưng production thấp vì: master flag `OT_GATEWAY_ENABLED` đang **comment trong .env** nên cả 5 driver không chạy; HA supervisor **mù với rớt kết nối giữa phiên**; OPC-UA không có security mode; PKI phát hành xong nhưng không transport nào verify; MTConnect/SECS-GEM bật flag nhưng 0 nguồn cấu hình; **0 giờ HW-validation** (không đổi so với doc 37 ở trục này).

### 2.1 Năng lực

| Năng lực | Trạng thái | Ghi chú chính |
|---|---|---|
| Driver OPC-UA (read/subscribe/write) | flag_off | Code thật ([opcuaDriver.ts:87-140](server/services/ot/drivers/opcuaDriver.ts#L87-L140)); chạy ngay khi flip `OT_GATEWAY_ENABLED`. KHÔNG có securityMode/cert (mặc định None/None) |
| Driver Modbus TCP | flag_off | Thật, decode endianness/wordOrder; chỉ TCP, không RTU/serial |
| Driver Siemens S7 | flag_off | Thật qua nodes7 (S7-300/400/1200/1500); chưa HW-validated |
| Driver Mitsubishi MC | flag_off | Chỉ **1E frame (A-compatible)** — iQ-R/iQ-F/FX5U mặc định SLMP 3E **chưa nói chuyện được**; encoder 3E còn TODO |
| Driver EtherNet/IP (AB CIP) | flag_off | Thật; đọc per-tag tuần tự → chậm với tag list lớn |
| ConnectionSupervisor HA | partial | Kiến trúc đúng (backoff+jitter, dual-endpoint promote) nhưng **cả 5 driver thật chỉ set `connected=false` trong `disconnect()`** → rớt cáp giữa phiên không bao giờ được phát hiện |
| Ingest telemetry hợp nhất | real | telemetryBus normalize→bulk insert→broadcast; nhưng 2 flag coalesce (doc 38 R-2a) chưa flip → 1 INSERT/tag/poll |
| Store-forward WAL | real | Flag ON, backfill idempotent; điểm yếu: rewrite toàn file mỗi append + drain chỉ chạy khi có write mới |
| Auth máy per-key (mk_) | partial | Cơ chế tốt nhưng shared plaintext key legacy vẫn được nhận (`MACHINE_SHARED_KEY_ALLOWED=true`) + đường machineCode-only không secret còn mở |
| Device PKI/SPIFFE-lite (doc 37 C2) | flag_off | Issue/rotate/revoke thật nhưng **0 transport nào verify cert** — giấy tờ phát ra không ai kiểm tra |
| Plugin driver bridge (3rd-party) | flag_off | Mạch end-to-end khép kín (sidecar RPC, fail-closed signature); chưa có plugin vendor thật |
| MTConnect poller | partial | Transport thật; `MTCONNECT_ENABLED=true` nhưng `MTCONNECT_SOURCES` trống → **no-op thực tế** |
| SECS/GEM (HSMS) | partial | Framing E37 thật, S5F1→Andon có đường; nhưng thiếu `SECS_GEM_LIVE_ENABLED`+`SECS_GEM_EQUIPMENT` → tắt; **S6F11 event chỉ console.log rồi mất** |
| FOCAS (Fanuc CNC) | stub | Tự khai read-only framework, cần sidecar native Fwlib32 |
| Euromap 77 (ép nhựa) | partial | Read path thật tái dùng OPC-UA; chưa từng chạy với server thật |
| MQTT broker (aedes) | real | **Đang chạy thật — nhưng mặc định plaintext, không bắt buộc password** (xem OT-F5) |
| Edge runtime + coordinator | real | ON; edge "node" là library chạy chung tiến trình, chưa có artifact deploy riêng |
| Mở rộng số lượng thiết bị | partial | 1 tiến trình Node, connect tuần tự, N+1 query, không hot-reload adapter |

### 2.2 Findings (14)

| ID | Mức | Vấn đề | Evidence & Khuyến nghị |
|---|---|---|---|
| OT-F1 | **P0** | **HA supervisor không phát hiện rớt kết nối giữa phiên với driver thật** — reconnect/failover thực tế không bao giờ kích hoạt; telemetry ngừng câm lặng khi đứt cáp/PLC reboot | healthTick chỉ dựa `driver.isConnected()`; cả 5 driver chỉ flip trong `disconnect()` ([connectionSupervisor.ts:324-346](server/services/ot/connectionSupervisor.ts#L324-L346)); test pass nhờ fake driver có `dropLink()`. **Fix:** lắng socket close/error mỗi driver + fallback đếm N lần read-fail liên tiếp → coi là mất kết nối; integration test kill-server giữa phiên |
| OT-F2 | P1 | Flag mâu thuẫn: `OT_GATEWAY_ENABLED` comment nên 5 driver + HA + coalesce không chạy dù nhiều flag con =true; MTConnect/SECS cũng dormant vì thiếu dữ liệu cấu hình | .env:439 comment vs OT_CONN_HA/STORE_FORWARD=true. **Fix:** flag-matrix 1 trang + boot log "connectivity summary" armed/dormant + flip chủ đích |
| OT-F3 | P1 | OPC-UA không hỗ trợ Sign/SignAndEncrypt + client cert → không nối được server sản xuất bắt buộc security (S7-1500, Kepware default) | [opcuaDriver.ts:106-109](server/services/ot/drivers/opcuaDriver.ts#L106-L109). **Fix:** thêm securityMode/Policy/cert vào connectionOptions, tiêu thụ cert từ device PKI |
| OT-F4 | P1 | Device PKI chỉ dừng ở phát hành — không transport nào verify; `DEVICE_PKI_ENABLED` không tồn tại trong .env | grep verify = 0 kết quả. **Fix:** chọn điểm cưỡng chế đầu tiên = MQTTS mutual-TLS hoặc header cert trên machine-ingest |
| OT-F5 | P1 | **MQTT broker — đường kết nối duy nhất đang thực chạy — mặc định không password, không TLS, bind 0.0.0.0**; client chỉ cần deviceId tồn tại là vào được | [mqttService.ts:512-556](server/services/mqttService.ts#L512-L556). **Fix:** cấp password per-device → `MQTT_REQUIRE_PASSWORD=true` → `MQTT_TLS_ENABLED` |
| OT-F13 | P1 | **Zero HW-validation toàn bộ 5 driver + SECS/GEM** (không đổi từ doc 37); lib cộng đồng ít bảo trì (mcprotocol 0.1.2, nodes7 0.3.18) chưa từng chạm PLC thật | **Fix:** đợt HW-FAT bench với kịch bản rút cáp/reboot/DB-down (§11 Wave E) |
| OT-F6 | P2 | Write-amplification mặc định: 2 flag coalesce (doc 38 R-2a) chưa flip → 1 INSERT/tag/poll | **Fix:** flip `OT_POLL_BATCH_ENABLED` khi bật gateway |
| OT-F7 | P2 | Không hot-reload adapter — thêm PLC qua UI phải restart server mới thấy dữ liệu | **Fix:** otAdmin router `reloadAdapters()` diff DB vs supervisors |
| OT-F8 | P2 | Mitsubishi MC chỉ 1E frame; SLMP 3E encoder còn TODO (spec đã chép sẵn trong header) | **Fix:** viết encoder 3E trên node:net ([mitsubishiMcDriver.ts:26-47](server/services/ot/drivers/mitsubishiMcDriver.ts#L26-L47)) |
| OT-F9 | P2 | SECS/GEM S6F11 collection event không có DB writer — dữ liệu giá trị nhất của GEM bị vứt | **Fix:** sink → telemetryBus/process_results |
| OT-F10 | P2 | Store-forward WAL rewrite toàn file mỗi append + backfill chỉ chạy khi có write mới → DB hồi phục lúc vắng traffic thì hàng chờ nằm im | **Fix:** append-only + timer drain 30-60s |
| OT-F11 | P2 | Shared plaintext machine apiKey vẫn được nhận + machineCode-only không secret còn mở → mạo danh máy bơm dữ liệu giả khả thi từ trong mạng | **Fix:** chiến dịch rotate mk_ rồi flip `MACHINE_SHARED_KEY_ALLOWED=false` |
| OT-F12 | P3 | opcuaGateway legacy là đường chết (boot không truyền onSample — dữ liệu đọc về bị vứt nếu bật nhầm flag) | **Fix:** gỡ hoặc redirect vào telemetryBus |
| OT-F14 | P3 | loadEnabledAdapters N+1 query + connect tuần tự (10 adapter offline = +50s boot) | **Fix:** query gộp inArray + Promise.allSettled có cap |

---

## §3. Backend — Nền tảng ĐIỀU KHIỂN & LẬP TRÌNH thiết bị

**Chín muồi: framework ~82% · production ~42%.** Điểm mạnh nhất hệ thống: `commandDispatcher` một-đường-ghi-duy-nhất với chuỗi gate đầy đủ (auth HITL → idempotency → tag.writable → driver → mode gate → **commissioning gate default-ON** → policy-as-code → inline interlock fail-closed → write → readback) + ledger append-only; pipeline deploy hoàn chỉnh (four-eyes → SoD → **sim-gate cứng** → verify-after-download → rollback); fleet orchestration race-safe FOR UPDATE; IEC 61131-3 + PLCopen + IR node-graph persist + transpiler URScript/ROS2; role-floor+2FA áp 34 mutation. Vấn đề lớn nhất là **tư thế cờ lệch: control ON nhưng verify OFF** — và robot dispatcher thiếu commissioning gate trong khi driver robot tự khai UNVERIFIED.

### 3.1 Năng lực

| Năng lực | Trạng thái | Ghi chú chính |
|---|---|---|
| OT command dispatch đa-gate + ledger | real | 9 lớp gate, dispatch() là caller duy nhất của `driver.writeTags`, 26 test ([commandDispatcher.ts:231-589](server/services/ot/commandDispatcher.ts#L231-L589)) |
| Commissioning/FAT gate OT | real | Default ON — chốt chặn thực tế duy nhất còn lại trước real-write (vì `OT_CONTROL_ENABLED=true` đã bật) |
| Verify-after-write (read-back) | flag_off | Code+test sẵn, `OT_READBACK_ENABLED` absent → lệnh acked không được xác minh giá trị đã tới thiết bị |
| Interlock inline gate (fail-closed) | real | Luôn chạy trong dispatcher trước real-write |
| Interlock engine (poll, Andon + auto-block) | flag_off | `INTERLOCK_ENGINE_ENABLED` absent → **chiều chủ động của interlock bất động**, rule chỉ chặn lệnh chứ không tự phát Andon |
| Robot dispatch (HITL+mode+interlock) | partial | **KHÔNG có commissioning/FAT gate** (bất đối xứng với OT) trong khi `ROBOT_CONTROL_ENABLED=true` |
| Robot drivers 6 vendor | partial | Fanuc = spec-verified (manual B-84184EN/03); Techman/MELFA = "assumptions, MUST be verified"; **Delta = MOCK protocol hư cấu nhưng vẫn register như thật**; URSim harness có sẵn (flag OFF) |
| VDA 5050 AGV | partial | MQTT transport thật; mapping chưa validate với AGV thật |
| Fleet orchestration (task/traffic/charging/resource) | real | Race-safe FOR UPDATE, deadlock wait-graph; `planPath` là honest stub (chưa có map/occupancy grid) |
| FOE workflow engine + durable | partial | Engine chạy; `FOE_DURABLE` OFF → crash giữa run = treo "held" chờ resume tay, mất luôn run-event forensic |
| Pipeline deploy chương trình | real | Sim-gate cứng + SoD + verify-after-download + rollback; **four-eyes version (`DPC_VERSION_REVIEW_ENABLED`) OFF** |
| Zmotion deploy (ZAux FFI) | flag_off | Code-complete; cần owner: `npm i koffi` + zauxdll.dll + `ZAUXDLL_PATH` trên host nối controller |
| Mitsubishi PLC engineering | partial | Param/recipe push qua dispatcher; full program transfer vẫn cần GX Works (ranh giới chủ đích) |
| IEC 61131-3 / PLCopen / IR node-graph | real | Persist saveFlow đã đóng gap doc 38 T; codegen ST/XML/URScript/ROS2 có test |
| Safety e-stop rated + Safety-PLC | **stub** | **Không tồn tại đường dừng khẩn safety-rated** — Null scaffold `actuated:false`, Pilz/Sick skeleton; không thể đóng bằng phần mềm |
| SECS/GEM control (S2F41 HCACK gated) | partial | Host command → PROPOSAL HITL, không tự actuate; live-loop tắt vì thiếu flag |
| Role-floor + 2FA actuation (doc 38 Q) | real | 34 call-site; nhưng require2FA chỉ check "đã bật 2FA", **không step-up re-verify OTP theo lệnh** |
| Sparkplug-B NCMD/DCMD inbound | flag_off | Decode → dispatch HITL, thừa hưởng toàn bộ gate — an toàn để thử |

### 3.2 Findings (16)

| ID | Mức | Vấn đề | Khuyến nghị |
|---|---|---|---|
| CTL-01 | P1 | **Tư thế cờ "control armed, verification disarmed"**: `OT_CONTROL/ROBOT_CONTROL/DPC_DEPLOY=true` nhưng READBACK / INTERLOCK_ENGINE / SAFETY / FOUR-EYES đều OFF — chỉ cần 1 admin ký commissioning là ghi thật xuống PLC không read-back | Bật gói verify trước lệnh thật đầu tiên; cân nhắc hạ `ROBOT_CONTROL_ENABLED=false` tới khi có FAT robot; ghi tư thế chuẩn vào .env.example |
| CTL-02 | P1 | **robotCommandDispatcher không có commissioning/FAT gate** trong khi Techman/MELFA tự khai protocol UNVERIFIED — robot connected có thể nhận real motion sau HITL | Thêm `isCommissioned(robotId)` default-ON, tái dùng commissioning_records (mig 0237) |
| CTL-03 | P1 | Không có đường dừng khẩn safety-rated (Null scaffold, Pilz/Sick không actuate, cả 2 flag absent) — lỗ P0 doc 37 chưa đổi, cần phần cứng | Mua Safety PLC + FAT (backlog đầu tư); trước mắt bật SAFETY_PLC_ADAPTER read-only observe khi có endpoint |
| CTL-04 | P2 | Mitsubishi MC 1E-only — FX5U (RF test cell) mặc định SLMP 3E chưa kết nối được | Viết SLMP 3E encoder (spec sẵn trong TODO M7) |
| CTL-05 | P2 | **Delta robot driver = MOCK protocol hư cấu nhưng chọn được như vendor thật** — có thể gửi khung TCP bịa xuống controller thật sau HITL | Gate sau flag opt-in + metadata `validationStatus` badge trên UI |
| CTL-06 | P2 | Four-eyes version OFF — artifact chưa ai review vẫn build+deploy được | Flip `DPC_VERSION_REVIEW_ENABLED=true` khi dùng deploy thật |
| CTL-07 | P2 | "2FA actuation" chỉ check tài khoản đã bật 2FA, không re-verify OTP theo lệnh — session hijack vẫn phát lệnh máy được (IEC 62443 CL2+ đòi re-auth) | Step-up: mutation nhận totpCode, verify tươi qua otplib, cache 5-10' |
| CTL-08 | P2 | Interlock engine OFF → rule đã approve không tự phát Andon/auto-block; user tưởng "đang bảo vệ" trong khi bất động | Flip `INTERLOCK_ENGINE_ENABLED=true` + hiển thị trạng thái engine trên UI |
| CTL-09 | P2 | FOE_DURABLE OFF — crash giữa workflow đa máy treo "held" chờ resume tay | Flip `FOE_DURABLE=true` (code-complete, auto-resume an toàn) |
| CTL-10 | P2 | SECS/GEM live-loop (đóng P0-6 doc 37) thực tế chưa hoạt động runtime — thiếu 2/3 flag | Bật chuỗi flag khi có equipment; test trước bằng HSMS simulator |
| CTL-11 | P2 | Zmotion deploy dry-run trên host hiện tại (koffi chưa cài, ZAUXDLL_PATH chưa set) | 3 bước owner-install vào runbook + health-check "ZAux binding: yes/no" |
| CTL-12 | P3 | Header zmotionBasicAdapter stale ("shim NOT yet present" trong khi zauxFfi.ts đã có) | Cập nhật honesty-contract header |
| CTL-13 | P3 | Command-authz X1-e (capability-class per lệnh) skip vì FIELD_V2 OFF | Bật sau khi kiểm tra ma trận role→capability |
| CTL-14 | P3 | `planPath` fleet là stub — định tuyến AGV phải cấp zone thủ công | Giữ tới khi có map từ twin/layout |
| CTL-15 | P3 | Sim-gate PLC/Zmotion là preview tuyến tính (không logic execution) — chương trình sai logic vẫn pass | Robot: route qua kinematicSimGate/URSim; PLC: thêm one-scan boolEval |
| CTL-16 | P3 | commandLog insert từng row trong vòng lặp không transaction — audit 1 lệnh multi-write có thể thiếu row khi crash | Batch values[] trong 1 transaction |

---

## §4. Backend — Đường DỮ LIỆU GIÁM SÁT máy

**Chín muồi: framework ~78% · production ~40%.** Khung rất đầy (bus hợp nhất + store-forward, OEE SEMI-E10 honest-null, scheduler đầy đủ vòng đời, socket push có auth, code Timescale/CAgg/coalesce viết sẵn) nhưng **đường ống đang chạy "khô"**: gần như toàn bộ producer telemetry OFF; các mắt xích quyết định chất lượng số liệu đang OFF hoặc đứt (downtime auto-detect OFF, OEE snapshot OFF, observability OFF, availability chỉ có cho máy socket, machine_heartbeats không có writer); hạ tầng chịu tải 100+ máy chưa kích hoạt (plain PG + matview full-refresh 5' + global-room firehose + N+1 OEE broadcaster); và vài **bug thật** (PdM orderBy thiếu DESC, negative-cache machineId vĩnh viễn, 2 rule alert stub trả 0).

### 4.1 Năng lực

| Năng lực | Trạng thái | Ghi chú chính |
|---|---|---|
| Telemetry ingest bus hợp nhất | real | 1 đường cho mọi protocol; nhưng producer thực đều tắt → bus nhàn rỗi |
| Store-forward khi DB down | real | Wire đúng đường persist chung, flag ON |
| TimescaleDB hypertable + CAgg | flag_off | `TSDB_URL` comment; 0235 CAgg tự no-op; ot_telemetry vẫn plain PG + retention DELETE |
| Chống write-amplification (coalesce) | flag_off | 2 flag OFF; chỉ mức per-tick trong ingest luôn bật |
| Realtime push Socket.io | real | telemetry:sample/oee:update/downtime/andon có thật 2 đầu; **nhưng đa số trang vẫn poll 10-60s** |
| OEE 3 thành phần SEMI-E10 | partial | Honest-null tốt; Availability chỉ có với máy socket (F1); Performance chicken-and-egg ideal-cycle (F8) |
| OEE snapshot hourly/daily | flag_off | Code idempotent sẵn, `OEE_SNAPSHOT_ENABLED` absent → oee_metrics chỉ ghi khi bấm tay |
| Downtime tự phát hiện | flag_off | Flag absent + in-memory map có lỗ hổng seed/restart/đa-instance (F4) |
| Predictive maintenance | partial | Heuristic (không ML) đang chạy nhưng **2/4 feature chết** vì machine_heartbeats không có writer (F2) + bug orderBy (F5) |
| Alert pipeline (eval→notify→escalation) | partial | Chạy thật nhưng phân mảnh 3-4 pipeline; 2 rule-type stub trả 0 vĩnh viễn (F10) |
| NG-rate alert theo điểm đo | real | Event-driven, cooldown, min-sample — tốt |
| Fleet status hợp nhất 3 mặt phẳng | real | Read-only, honest-degrade (doc 38 T) |
| SLO burn-rate (doc 38 P) | flag_off | `OBSERVABILITY` absent → SLO vẫn mù trên thực địa |
| Matview refresh dashboard | real | Đang chạy nhưng vẫn FULL refresh 5' quét toàn bộ product_inspections |
| Twin live stream (≤10Hz) | real | Flag ON; nguồn cấp = bus đang khô nên ít dữ liệu |
| MQTT summary ngày/tuần | real | Cron 6:00/7:00 VN; db-handle race nhỏ + không idempotent (F14) |
| Energy analytics | partial | Tính toán thật nhưng **writer duy nhất là POST tay** — không auto-ingest từ telemetry (F13) |

### 4.2 Findings (15)

| ID | Mức | Vấn đề | Khuyến nghị |
|---|---|---|---|
| MON-F1 | P1 | **Availability OEE chỉ đo được cho máy nối Socket.io** — machine_status_logs không được ghi từ MQTT/OT-adapter/MTConnect/SECS → OEE=null vĩnh viễn cho các máy đó | `machinePresenceService` hợp nhất: mọi transport ghi machine_status_logs qua 1 hàm chống trùng; fallback suy từ ot_telemetry theo TTL |
| MON-F2 | P1 | **PdM đứt đôi 2 đầu dữ liệu**: machine_heartbeats KHÔNG có writer (riskAnomaly/riskTemp luôn bất hoạt), machine_sensor_readings (vibration/current/temp thật đang ingest) KHÔNG có reader | computeFailureRisk đọc machine_sensor_readings; persist heartbeat socket event (throttle 1/phút) |
| MON-F3 | P1 | Chuỗi producer telemetry đều OFF trong .env → bus/twin/UnifiedDeviceMonitor chạy khô — "code xong, chưa cắm" | Runbook bật staged: OT gateway 1 adapter → MTCONNECT_SOURCES 1 agent → SECS live |
| MON-F4 | P1 | Downtime auto-detect OFF + in-memory: restart mất dấu, máy im lặng từ boot vô hình, không seed từ DB; hiện downtime = nhập tay → availability mặc định 100% | Vá seed từ MAX(inspection/telemetry) lúc boot + threshold ra env, rồi bật flag |
| MON-F5 | P2 | **Bug PdM: query "latest health" thiếu `desc()` → lấy bản ghi CŨ NHẤT** → healthScore đóng băng ở giá trị đầu tiên | Thêm `desc()` ([predictiveMaintenanceService.ts:509-520](server/services/predictiveMaintenanceService.ts#L509-L520)) + rà các query "latest" khác |
| MON-F6 | P2 | telemetry:sample phát firehose vào room `global` mà mọi client subscribe đều join — không chịu nổi 100+ máy | `TELEMETRY_EMIT_COALESCE_MS=250` ngay; bỏ emit global, chỉ per-machine room + room opt-in |
| MON-F7 | P2 | OEE broadcaster 60s chạy N+1 (100 máy ≈ 300 query/phút); computeStateDurations không chặn dưới thời gian → quét toàn lịch sử mỗi lần | Set-based GROUP BY + LAG window; thêm `endTime >= from` |
| MON-F8 | P2 | OEE_SNAPSHOT OFF + ideal-cycle chicken-and-egg (ideal đọc từ chính oee_metrics) → OEE liên tục gần như không có dữ liệu | Bật flag + thêm nguồn ideal cycle chủ động (field machines/oee_targets) |
| MON-F9 | P2 | Chưa cutover Timescale: matview FULL refresh 5' + retention DELETE — điểm nghẽn ghi số 1 ở tải 100+ máy (việc owner từ doc 38 S) | Cài extension → 0172 + 0235 → backfill → swap read-path → tắt matview refresh |
| MON-F10 | P2 | 2 rule-type alert là stub trả 0 vĩnh viễn (BROKER_DISCONNECT, CLIENT_OFFLINE) — user tạo rule tin rằng được giám sát nhưng im lặng tuyệt đối; cooldown in-memory mất khi restart | Implement 2 metric hoặc chặn tạo trên UI kèm nhãn "chưa hỗ trợ"; persist cooldown vào history |
| MON-F12 | P2 | OBSERVABILITY chưa bật → thành quả doc 38 P (SLO feed) chưa phát huy | Bật `OBSERVABILITY=true` (advisory-only) + smoke /metrics |
| MON-F13 | P2 | energy_readings chỉ có đường ghi thủ công — energy analytics/forecast trả rỗng trong vận hành thật | Mirror metric whitelist (power_kw…) từ telemetryBus, flag mới |
| MON-F11 | P3 | Negative-cache deviceId→machineId vĩnh viễn: map máy sau khi telemetry đã chảy → machineId NULL tới khi restart | TTL 60s hoặc clearMachineIdCache() trong mutation machines/device_adapters |
| MON-F14 | P3 | mqttSummaryScheduler: db handle race + insert không idempotent (trigger tay + cron = 2 summary/ngày) | await getDb() mỗi run + unique ON CONFLICT |
| MON-F15 | P3 | PdM healthScore tự tham chiếu (risk-trend ăn chính đầu ra của mình) | Tách health "đo được" vs "dự báo" |

---

## §5. Frontend — Module MÁY MÓC & THIẾT BỊ (Machine Monitoring)

**Chín muồi: framework ~82% · production ~60%** — module frontend trưởng thành nhất trong 2 trục. Consolidation doc 39 đã phát huy (3 surface giám sát → 1 DeviceHub, 9 trang MQTT → 1 ConnectivityHub), **100% dữ liệu từ tRPC thật** (không tìm thấy mock/Math.random nào trong 18 page), realtime socket thật ở UnifiedDeviceMonitor + MachineCockpit, empty/error state trung thực, RBAC per-button, CRUD đầy đủ. Trừ điểm: 2 file page chết (847+317 dòng), 1 legacy hub có tab không thể truy cập, **primitive doc 39 chưa được áp ở BẤT KỲ trang devices nào**, không virtualization, OEE trùng 3 nơi, và thiếu các năng lực giám sát chuyên nghiệp (floor-map trong app, drill-down máy→cảm biến, so sánh ca, export server-side).

Route thực tế: `/device-monitor` (hub 3 tab) · `/oee-dashboard` · `/connectivity` (hub 9 tab) · `/system-health` · `/machine-onboarding` · `/aoi-onboarding` · `/machine-registration` · `/device-adapters` · `/hot-folders` · `/edge-nodes` · `/technician-copilot` · `/work-orders` · `/alerts` · `/monitoring-setting` · `/machine/:id` (cockpit 9 tab).

### 5.1 Findings (16)

| ID | Mức | Vấn đề | Khuyến nghị |
|---|---|---|---|
| DEV-01 | P1 | **MonitoringSettings thành hub cụt**: menu-trong bị ẩn (doc 36) nhưng không có TabsList thay thế → 5 tab MQTT không thể truy cập từ UI, đồng thời trùng 100% ConnectivityHub; tab device-management dùng raw `<a href>` gây full reload | Redirect `?tab=mqtt-*` → `/connectivity`, giữ duy nhất tab device-management thành trang gọn |
| DEV-02 | P1 | **RBAC mismatch**: nav row đòi `machine_status` nhưng RouteGuard đòi `admin_system` → operator thấy menu, bấm bị chặn (đúng mẫu split-brain doc 39) | Đồng bộ một chiều nav ↔ guard |
| DEV-03 | P2 | AdminMonitoring.tsx (317 dòng, giám sát slow-query hoàn chỉnh, backend thật) **không có route** — orphan | Route vào app Admin hoặc tab của /system-health |
| DEV-04 | P2 | MachineStatusMonitor.tsx 847 dòng dead code (route đã redirect) | Xóa file + orphan sweep |
| DEV-05 | P2 | DeviceHub không react với `?tab=` sau mount (ConnectivityHub đã có fix, DeviceHub chưa) → deep-link đổi URL nhưng không đổi tab | Copy pattern useEffect [search] (5 dòng) |
| DEV-06 | P2 | i18n hụt: `deviceHub.tabs.*` không có trong en/vi/zh → tab strip hub luôn English; title MachineHealthMonitoring hardcode | Bổ sung key + quét script t(key,fallback) mồ côi |
| DEV-07 | P2 | UnifiedDeviceMonitor: force re-render **toàn bảng** mỗi 5s + mỗi batch telemetry, không virtualization → không scale fleet lớn | DataTable virtualized + store telemetry per-row (useSyncExternalStore) |
| DEV-08 | P2 | **Primitive doc 39 chưa áp ở trang devices nào** — filter tự chế không URL-sync, form không zod thống nhất, loading mỗi trang một kiểu | Pilot 3 trang lưu lượng cao: UnifiedDeviceMonitor, MachineRegistration, EdgeNodesPage |
| DEV-09 | P2 | Framework strip: chip VDA5050 hardcode `enabled={undefined}` → hiện "chưa rõ" dù flag =true — vi phạm cam kết honesty của chính trang | Wire query status hoặc gỡ chip |
| DEV-10 | P2 | OEE trùng 3 nơi (OEEDashboard / DeviceHub tab Health&OEE / MachineCockpit) cùng nguồn; OEEDashboard không auto-refresh; 2 bản copy gauge component | Gộp OEEDashboard thành tab thứ 4 của DeviceHub, 1 gauge chung |
| DEV-11 | P2 | Thiếu loading state: MachineHealthMonitoring Overview + EdgeNodesPage hiện "trống" khi đang tải (nhìn như nhà máy không có máy) | Nhánh isLoading trước empty; dài hạn AsyncBoundary |
| DEV-13 | P2 | **Khoảng trống chuyên nghiệp**: không floor-map trong app devices (phải nhảy app Production), cockpit không có tab telemetry time-series per-tag, không so sánh ca, export chỉ CSV client-side | Xem upgrade ideas U5.1-U5.4 |
| DEV-12 | P3 | EdgeNodesPage: staleness không tự cập nhật — node chết vẫn hiện "Trực tuyến" tới khi bấm refresh | refetchInterval 30-60s hoặc tick 15s |
| DEV-14 | P3 | ProductMachineMapping: không loading state, card-per-machine không phân trang, toggle không khóa khi pending | Search + skeleton + disabled isPending |
| DEV-15 | P3 | Nav row feeder-verify/routing-master khai trong group devices nhưng ownership MOD_PRODUCTION → biến mất khỏi app Devices; label chưa i18n | i18n key + xác nhận chủ đích SKU |
| DEV-16 | P3 | MachineOnboardingWizard không có persistence/resume — F5 ở bước 4 mất toàn bộ (ProductOnboardingWizard đã có pattern resumable) | Persist draft localStorage/server |

### 5.2 Ý tưởng nâng cấp chính

1. **Hoàn tất consolidation** (M): OEE & Downtime thành tab 4 của DeviceHub; rút MonitoringSettings về 1 trang device-mapping; giảm ~1.4k dòng UI trùng.
2. **Áp primitive doc 39 + virtualization** (M) vào 3 trang lưu lượng cao.
3. **MachineCockpit tab "Telemetry"** (L): drill-down máy → trục/cảm biến với chart lịch sử per-tag + overlay live socket — đóng mắt xích cuối của chuỗi giám sát chuyên nghiệp.
4. **Tab "Sơ đồ xưởng" 2D trong DeviceHub** (L): trạng thái máy trên layout, click → cockpit (năng lực chuẩn SCADA; twin 3D vẫn ở Production).
5. **So sánh ca/máy + xuất báo cáo server-side** (L): shift dimension filter + nút gọi reporting engine (PDF/Excel VN-font) thay CSV client.
6. **Quick-wins 1 buổi** (S): xóa dead code, i18n keys, sync ?tab= DeviceHub, wire VDA5050 chip, isLoading states, refetch edge nodes.

---

## §6. Frontend — Module KỸ THUẬT & ĐIỀU KHIỂN (Engineering & Control)

**Chín muồi: framework ~82% · production ~55%.** Tiến bộ rõ so với doc 26 (~6.5/10): mọi page gọi tRPC thật, editor có save/version/diff/rollback thật, twin 3D socket live + replay thật, mọi surface điều khiển honest về flag/gate. Nhưng còn 4 lỗ nặng: **(1) vòng điều khiển robot CỤT** — không UI nào dispatch lệnh qua robotCommandDispatcher dù flag ON, chuỗi Propose→Confirm→Execute là vòng tròn không có bước thực thi; **(2) four-eyes deploy "trên danh nghĩa"** — requester tự chọn tên approver từ dropdown, approver không thao tác gì; **(3) deploy workflow không ép qua simulate-pass** (P0 tồn từ doc 22); **(4) editor code là textarea thô, POU authoring bằng JSON** — thua xa chuẩn công cụ kỹ thuật.

### 6.1 Findings (16)

| ID | Mức | Vấn đề | Khuyến nghị |
|---|---|---|---|
| ENG-F1 | **P1** | **Vòng điều khiển robot cụt**: Cockpit Actions → Propose → RobotControl banner → "Back to cockpit" — không có bước thực thi; grep toàn client = 0 mutation dispatch trong khi server dispatcher + flag đã sẵn | Xây **Gated Command Console**: tRPC bọc robotCommandDispatcher + typed-confirm 2 bước + interlock-check hiển thị trước + pending/done live |
| ENG-F2 | **P1** | **Four-eyes deploy danh nghĩa**: requester chọn tên approver rồi tự bấm Deploy — không session/chữ ký/OTP của người được nêu tên; audit trail ghi người chưa từng thao tác | Chuyển sang request→approve 2 phiên qua ApprovalsInbox (đã có aggregator) |
| ENG-F3 | P1 | RBAC split-brain: RobotControl hardgate `role==='admin'` cho enable/test-connection → engineer có machine_control vẫn bị khóa, RoleBuilder vô hiệu | Thay bằng hasPermission('machine_control') 2 đầu |
| ENG-F4 | P1 | **Deploy workflow không ép sim-pass** (cả UI lẫn server foeEngine.deployWorkflow) — trái lời hứa "author → simulate → deploy", P0 doc 22 vẫn mở | Server lưu sim-result + hash(definition), deploy đòi sim-pass, override có lý do + audit |
| ENG-F5 | P2 | CodeEditor = textarea thô (không highlight/autocomplete/inline diagnostics) cho ST/BASIC/G-code | Drop-in CodeMirror 6 (không CDN), map diagnostics → markers |
| ENG-F6 | P2 | POU Studio: soạn LAD/FBD/SFC bằng JSON textarea — canvas chỉ để xem; kỹ sư PLC không soạn ladder bằng JSON | Nâng PouCanvas thành editor click-to-add/kéo-thả tối thiểu |
| ENG-F7 | P2 | ControlPlane + RobotControl hiện "Chưa có thiết bị/robot" ngay khi đang tải (empty-state giả) | AsyncBoundary/isLoading trước empty |
| ENG-F8 | P2 | FleetOrchestration poll 5 query × 5s bất kể tab nào đang mở (limit 200/500); không virtualization toàn module | Gate polling theo tab active + DataTable |
| ENG-F9 | P2 | EngineeringChanges: `window.prompt` cho reject, label hardcode English, namespace `ecn` = 0 key cả 3 locale, không detail view/filter | AlertDialog + drawer chi tiết + i18n + FilterBar |
| ENG-F10 | P2 | TwinHub trộn tab LIVE và SIM ngang hàng không nhãn (RF Test Cell dùng máy hardcode 901/902/903) — user mới dễ tưởng SIM là cell thật; `twinHub` 0 key locale | Badge LIVE/SIM trên TabsTrigger + i18n |
| ENG-F11 | P2 | EngineeringHub liên kết mù: tile Command Audit trỏ trang gated admin_system (kỹ sư bấm → màn chặn); 3 tile twin trỏ route redirect mất metadata quyền/beta + nhảy chéo app | Trỏ thẳng /digital-twin?tab= + mở command audit cho machine_monitoring |
| ENG-F12 | P2 | RobotCockpit Teach/Jog là buffer chết: đổi tab mất trắng nội dung teach, không lưu thành artifact; "Open IR" không mang programId | Nút "Lưu vào project robot-tm" + withParams cho Open IR |
| ENG-F14 | P2 | Thiếu năng lực HMI/SCADA chuẩn: không trend/history trong cockpit (dữ liệu đã có), alarm không ack/shelve được tại cockpit (mutation shelve đã tồn tại ở trang khác), không watch-board pin biến | Sparkline + Ack/Shelve theo quyền + pin watch-board |
| ENG-F13 | P3 | 2FA-floor actuation không cảnh báo trước — user soạn → build → sim → deploy rồi mới nhận FORBIDDEN | Hook useActuationReadiness + banner pre-flight |
| ENG-F15 | P3 | Trùng surface robot: RobotControl chồng ~70% RobotCockpit, 2 trang deep-link vòng nhau | Gộp RobotControl thành tab Registry của cockpit |
| ENG-F16 | P3 | i18n: `twinHub`/`ecn` thiếu hoàn toàn; quy ước fallback không nhất quán (trang VN-default vs EN-default) | Bổ sung + chốt quy ước 1 chiều |

### 6.2 Ý tưởng nâng cấp chính

1. **Gated Command Console** (L) — đóng vòng Propose→Confirm→Execute: gap lớn nhất so với kỳ vọng người mua module OT_CONTROL.
2. **Approver inbox thật cho deploy production** (M) — four-eyes 2 phiên đăng nhập, chuẩn IEC 62443/GxP.
3. **Sim-gate bắt buộc trước deploy** (M) — đóng P0 doc 22.
4. **CodeMirror 6 cho CodeEditor** (M) — IDE thật với highlight + inline diagnostics + autocomplete từ symbol table.
5. **Trend & alarm layer cho cockpit** (M) — sparkline telemetry, ack/shelve tại chỗ theo quyền, watch-board.
6. **Gộp surface robot + nhãn LIVE/SIM TwinHub** (S).
7. **Data-primitive cho module engineering** (M) — DataTable/AsyncBoundary/FilterBar.
8. **Pre-flight banner 2FA/quyền/flag cho mọi nút actuation** (S) — "báo trước khi bấm" (doc 26 U7).

---

## §7. Ma trận độ phủ thiết bị nhà máy thông minh

Đánh giá 23 loại thiết bị × 5 năng lực. **Bức tranh:** hệ có xương sống kết nối đa giao thức THẬT ở mức driver (5 OT driver PLC + 4 robot driver thật/spec-cited + VDA5050 + MTConnect + HSMS + Euromap-77 read), khung capability 17 lớp, program/twin sâu cho Zmotion/robot/IEC61131. Nhưng **lỗ đen lớn nhất cho nhà máy SMT/điện tử: toàn bộ core SMT line (mounter, reflow, stencil printer, wave solder) + chuẩn line IPC-CFX/Hermes + IO-Link + printer/laser marking + RF instrument (SCPI/VISA) chưa từng được code** — hệ hiện chỉ phủ khâu inspection và hạ tầng OT chung.

| Loại thiết bị | Connect | Monitor | Control | Program | Twin | Gap chính |
|---|---|---|---|---|---|---|
| Máy AOI/AVI/SPI/AXI | real | real | stub | partial | real | Kết nối = hot-folder parse, không live command; GenICam stub; không download recipe xuống máy (SECS S7 chưa có) |
| PLC Mitsubishi (FX5U/iQ-R) | flag_off | flag_off | flag_off | partial | partial | Chỉ 1E frame — SLMP 3E TODO; param push OK, full program cần GX Works |
| PLC Siemens S7 | flag_off | flag_off | flag_off | missing | missing | Driver thật; không programming adapter (TIA) |
| PLC Allen-Bradley (EtherNet/IP) | flag_off | flag_off | flag_off | missing | missing | Driver thật; không programming adapter |
| OPC-UA / Modbus generic | flag_off | flag_off | flag_off | n/a | n/a | Tất cả sau `OT_GATEWAY_ENABLED` (chưa set); hãng mới = plugin sidecar (flag OFF) |
| Robot Mitsubishi MELFA | real | real | partial | partial | real | ASCII R3 spec-cited; 0% HW-validated |
| Robot Techman (TM) | partial | partial | partial | partial | real | Register map + TMSCT là GIẢ ĐỊNH; driver tự dặn "để ROBOT_CONTROL=false" nhưng .env đang =true |
| Robot Fanuc (RMI) | real | real | partial | partial | real | Driver chất lượng cao nhất (manual-verified); cần option R912; chưa HW-test |
| Robot Delta | stub | stub | stub | missing | partial | Vendor KHÔNG có host protocol công khai — mock trung thực; muốn thật phải viết DRL server-side |
| Robot UR | partial | partial | partial | partial | missing | Client URScript/Dashboard thật nhưng **đứng ngoài vendor registry** — không thêm được UR như robot chuẩn; RTDE chưa có |
| AGV/AMR (VDA 5050) | real | real | partial | n/a | partial | MQTT thật + fleet orchestration bật; mapping chưa validate AGV thật |
| Motion Zmotion (ZMC) | partial | **missing** | missing | **real** | partial | Program-tier mạnh nhất; deploy chờ koffi+DLL; **không có đường monitor Zmotion — điểm mù** |
| CNC (MTConnect/FOCAS) | partial | partial | missing | missing | missing | MTConnect thật nhưng 0 source; FOCAS stub cần Fwlib32 |
| Máy ép nhựa (Euromap 63/77) | partial | partial | missing | missing | missing | E77 read path thật, chưa máy nào cấu hình; E63 file-session chưa có |
| Conveyor / Feeder | partial | partial | partial | n/a | partial | FEEDER = generic Modbus profile; **không có machine type CONVEYOR; SMEMA/board-flow không có** |
| Camera GenICam/GigE | stub | stub | missing | n/a | n/a | Documented stub — cần GenTL producer native; ảnh vào qua hot-folder |
| Cảm biến rời (vib/current/temp) | real | real | missing | n/a | n/a | MQTT ingest thật nuôi PdM; **IO-Link = 0 dòng code, chưa từng nghĩ tới** |
| Test cell RF (VNA/spectrum) | **missing** | partial | missing | n/a | real | Twin/sim đẹp nhưng 0 driver instrument — **SCPI/VISA/LXI hoàn toàn vắng** |
| Năng lượng (power meter) | partial | real | missing | n/a | n/a | Analytics dày; không có Modbus profile cho meter — dữ liệu phải tự đẩy |
| Môi trường (nhiệt/ẩm) | real | partial | missing | n/a | n/a | Qua sensor convention; không có khái niệm environment zone/dashboard riêng |
| SECS/GEM semiconductor | partial | flag_off | stub | missing | n/a | HSMS thật; live-loop chết vì thiếu 1 flag; S2F41/S7 recipe chưa có |
| Printer / laser marking | missing | missing | missing | missing | missing | **Chưa từng được nghĩ tới** — chỉ có ENGRAVING_MARK là điểm đo inspection; mắt xích traceability thiếu |
| Safety PLC (Pilz/Sick) | flag_off | flag_off | stub | n/a | n/a | Read-only seam đúng thiết kế nhưng OFF toàn bộ; e-stop registry = Null |
| **SMT core: mounter/reflow/stencil printer/wave + IPC-CFX/Hermes** | **missing** | **missing** | **missing** | **missing** | **missing** | **Hoàn toàn vắng** — grep CFX/Hermes/reflow/mounter = 0; hệ chỉ phủ khâu inspection của line SMT |

### 7.1 Findings ma trận (chọn lọc)

| ID | Mức | Vấn đề | Khuyến nghị |
|---|---|---|---|
| MTX-01 | P1 | **Cờ actuation BẬT trong khi driver tự khai "chưa validate HW — hãy để OFF"** — hệ ở trạng thái "đã lên đạn" chờ HW xuất hiện | Tắt 3 cờ control tới khi FAT per-driver; commissioning gate per-device là điều kiện cứng |
| MTX-02 | P1 | Split-brain: control ON nhưng gateway kết nối PLC OFF — user cấu hình adapter trên `/device-adapters` sẽ không thấy gì chạy | 1 công tắc prod thống nhất + banner trạng thái gateway trên UI |
| MTX-03 | P1 | **SMT core line không có độ phủ** (mounter/reflow/stencil-printer/wave + IPC-CFX/Hermes) — không làm được closed-loop SPI→printer hay truy vết board xuyên line | Roadmap: IPC-CFX client (AMQP 1.0) như protocol mới của telemetryBus + Hermes board-flow + 3 machine type mới |
| MTX-06 | P2 | IO-Link hoàn toàn vắng — chuẩn cảm biến thông minh phổ biến nhất | Không cần driver mới: IO-Link master profile trên opcuaDriver + tag template |
| MTX-09 | P2 | Không driver power-meter dù modbusDriver có sẵn | Energy-meter tag template (Schneider/ABB/Selec) + cron map ot_telemetry → energy_readings |
| MTX-10 | P2 | RF test cell: 0 instrument driver (SCPI-over-TCP là text protocol đơn giản — 1 adapter nhỏ là đủ) | SCPI adapter theo pattern tcpLineClient |
| MTX-11 | P2 | Interlock phần mềm là đường dừng chủ động duy nhất khi robot control bật — khoảng trống an toàn có điều kiện | Check trong robotCommandDispatcher: không real-run khi e-stop registry còn Null ở site thật |
| MTX-12 | P3 | UR client thật nhưng ngoài vendor registry | Bọc ursimClient thành RobotDriver 'ur' |
| MTX-13 | P3 | Printer/label ZPL (TCP 9100, 1 chiều) là quick-win traceability | Adapter ZPL tối thiểu |

---

## §8. Đánh giá theo vai trò người dùng (5 persona)

| Persona | Điểm /10 | Một câu |
|---|---|---|
| Chị Lan — Operator | **4.5** | Phần "nhìn" (Andon, briefing, fleet) rất tốt; phần "làm" (vào ca, bàn giao, đổi sản phẩm, quét feeder, xem chi tiết máy) **gần như tê liệt với quyền seed mặc định** |
| Anh Hùng — Bảo trì | **6** | Xương sống khá (cockpit, RCA copilot, WO close-loop, PdM chạy); chuỗi hằng ngày đứt 4 khớp: báo động không tới điện thoại, PM không lên lịch được, spare-parts 0 UI, hồ sơ máy thiếu ký ức bảo trì |
| Anh Minh — Kỹ sư tự động hóa | **6** | Pipeline quản trị chương trình đạt 8/10 (sim-gate cứng, verify-hash, ledger); nhưng ngày làm việc thật **vẫn phải mở GX Works3 + RT ToolBox và gọi admin** |
| Chị Hương — Quản đốc | **5.5** | Khung ~8/10 nhưng nghiệp vụ lõi đứt: **giao chỉ tiêu OEE chết runtime (bug SQL)**, downtime in-memory + ghi fail âm thầm, không có OEE theo line/ca |
| Anh Tuấn — OT/IT Admin | **6** | Backend nền tốt (role-floor+2FA, command ledger, PKI); nhưng cert 0 UI, onboarding 3 wizard phân mảnh + **vứt IP máy**, SLO mù, license bypass không ai biết |

### 8.1 Chị Lan — Operator (4.5/10)

**Journeys:** Báo sự cố 1-chạm + voice vi-VN → Andon = **works** (flow tốt nhất hệ thống). Xem fleet = partial (sidebar TRỐNG ở Simple mode). **Blocked:** Vào ca/kết thúc ca (seed operator `production_orders.canCreate/canEdit=false` — vô hiệu hóa chính component xây cho operator ở doc 35 W4-E); xem chi tiết máy `/machine/:id` và quét feeder `/feeder-verify` (**permission ma `machine_monitoring`** — là category chứ không phải module, KHÔNG role nào được seed → chỉ admin qua được, trong khi server feederVerify thực ra mở cho mọi user đăng nhập); bàn giao ca (canEdit); `/alerts` (khóa sau nhóm mqtt); tile Engineering hiện trong Launcher nhưng bấm = denied (launcher chỉ khóa theo license, không theo RBAC).

**Phát hiện quan trọng nhất:** permission ma `machine_monitoring` gate **≥12 route + hàng chục procedure server** (assetCockpit, commandCenter, edgeRuntime…) nhưng không tồn tại trong bất kỳ seed nào → hàng loạt trang thực tế admin-only. Phần lớn lỗi là **wiring quyền chứ không phải thiếu tính năng** — sửa seed + 3 gate là điểm nhảy lên ~7.

**Đề xuất:** kiosk mode trạm vận hành hoàn chỉnh (nền ?kiosk=1 + offlineQueue đã có); wizard "Đổi sản phẩm" 4 bước (quét barcode → chương trình + readiness → feeder-verify → yêu cầu HITL supervisor — toàn bộ backend đã tồn tại, chỉ thiếu màn nối); nút "Gọi bảo trì" riêng + bật ANDON_SLA_ESCALATION; badge/PIN login cho tablet dùng chung (bảng OperatorBadges đã có); "Line của tôi" scope mọi surface theo userAssignments.

### 8.2 Anh Hùng — Bảo trì (6/10)

**Journeys:** Chẩn đoán (RCA Copilot bật thật, health/PdM) = **works**. Nhận cảnh báo trên điện thoại = partial (**FCM có code nhưng FIREBASE_* env chưa set → push OFF**; app FactoryAlertSystem chỉ nghe topic station NG; **công tắc SMS trong form alert là no-op** — dispatchAlert không có nhánh SMS; WO PREDICTIVE tự sinh không notify ai). Hồ sơ máy 360° = partial (cockpit 9 tab tốt nhưng **không có tab bảo trì**: lịch sử WO, timeline downtime, spare BOM, manual). Lịch PM = **kẹt từ gốc**: bảng maintenance_schedules + cron sinh WO đã có nhưng **không có router CRUD lẫn UI** (P0). Trừ kho linh kiện = **backend ledger atomic hoàn chỉnh, 0 UI client** (P0). Trend sensor = dữ liệu vibration/current đang ingest thật nhưng **không có API đọc lẫn chart** — dead-end dữ liệu. QR dán máy = missing (BarcodeScanner có sẵn, chỉ dùng cho serial sản phẩm). Bẫy Simple-mode ẩn sạch menu devices/engineering với chính role maintenance.

**Đề xuất:** CMMS mini hub 4 tab (WO · PM schedules · Spare parts · Reliability MTBF/MTTR toàn đội) — ~80% backend đã tồn tại; QR asset tag "đứng trước máy là có tất cả"; kênh maintenance trong FactoryAlertSystem + config FCM; trend sensor PdM + ngưỡng theo sensorType; timeline can thiệp hợp nhất per máy; checklist PM có ảnh.

### 8.3 Anh Minh — Kỹ sư tự động hóa (6/10)

**Journeys:** Sim trước deploy = **works** (sim-gate là điều kiện CỨNG của deployBuild, FK/IK/collision thật — điểm sáng nhất). Theo dõi lệnh/ledger = **works** (append-only trung thực). Onboarding máy mới = **blocked** (machine.create + edgeDeployment.* đều adminProcedure cứng — kỹ sư lắp máy phải gọi admin, phá mục tiêu "máy online <10 phút"). Deploy thật = **blocked kép**: (a) four-eyes hình thức (chọn tên approver từ dropdown); (b) **ngõ cụt actionId — UI sinh `rid("act")` ngẫu nhiên không tồn tại trong ai_pending_actions mà dispatcher tái xác minh → real deploy Mitsubishi/robot bị NOT_CONFIRMED vĩnh viễn** dù mọi cờ bật (xác nhận bằng đọc code 2 đầu). Jog robot = missing (TeachJogPanel chỉ preview cục bộ; teach thật vẫn cần pendant). Quản lý 40 máy = partial (**1 project = 1 deviceId → deploy tay 40 lần, không có ma trận máy×version**). Toast UI báo "Đã deploy" cả khi deployment failed/rejected.

**Đề xuất:** "Deploy Approval Inbox" hợp nhất (sửa cùng lúc four-eyes hình thức + ngõ cụt actionId — luồng proposeAction→confirmAction đã có mẫu ở aiCopilotActions); chiến lược "bao vây GX Works" (artifact kind vendor-binary: platform quản version/hash/phân phối/audit, GX Works chỉ còn là compiler); fleet rollout canary deployToFleet; Monaco + program_symbols + RAG manual + FIM local (hạ tầng doc 34 đã đầu tư); Online Test Mode force-write có gate trên watch table; HIL gate cho Mitsubishi/Zmotion simulator.

### 8.4 Chị Hương — Quản đốc (5.5/10)

**Journeys:** Bird-eye sáng = works (Command Center + TodayBriefing + exec report AI đang BẬT). TV mode = **works** (Andon board đạt chuẩn production). Drill-down OEE = partial: **KHÔNG tồn tại OEE theo LINE** (chỉ per-machine); máy thiếu ideal-cycle bị lọc bỏ im lặng; tab Downtime đọc mảng **in-memory mất sạch sau restart**; **ghi downtime thủ công FAIL ÂM THẦM (raw SQL camelCase không quote trên Postgres — lỗi 42703 bị nuốt, toast vẫn báo thành công)**. So sánh ca = partial (ca HARDCODE 6-14/14-22/22-6 trong khi bảng shift_configs cấu hình được đã tồn tại — 2 nơi không nói chuyện; reporting mart dim_shift doc 35 W5 có router nhưng **0 consumer client**). Giao chỉ tiêu OEE = **blocked — chết runtime**: create/update/delete target đều raw SQL sai casing → lỗi "column machineid does not exist" ngay khi bấm Lưu. Nút "Xuất Excel" OEE là CSV đội lốt .xls.

**Đề xuất:** war-room "Giao ban 7h" one-pager theo ca (OEE/line + top downtime + plan-vs-actual + Pareto NG + diff ca trước, tự đẩy 6h45 qua exec-report scheduler đang ON); so sánh kỳ đa chiều OEE/downtime/UPH; cảnh báo lệch kế hoạch realtime (pacing 15'); TV mode OEE mở rộng Andon board; timeline can thiệp trong cockpit.

### 8.5 Anh Tuấn — OT/IT Admin (6/10)

**Journeys:** Audit lệnh điều khiển = **works** (command ledger + UI lọc, auto-refresh — đúng thứ cần khi bị hỏi "ai đã bấm gì"). License = works về UI nhưng **LICENSE_BYPASS=true → moduleGate pass-through toàn bộ, không UI nào cho thấy "gate đang bypass"**. Onboard máy AOI = partial: **IP/port/protocol nhập & test ở bước 1-2 bị VỨT khi tạo máy** (bảng machines không có cột ipAddress → máy mất kết nối là mất luôn địa chỉ chẩn đoán); 3 wizard onboarding phân mảnh. Onboard PLC = blocked (OT_GATEWAY off mà wizard bước "chờ telemetry" không nói nguyên nhân — mất 1 giờ debug; form manifest không có trường credential, secret lưu **plaintext + không redact khi list**). Cert PKI = **missing hoàn toàn về UI** (backend đủ issue/rotate/revoke, grep client = 0). Phân quyền = partial (RoleBuilder cho gán machine_control cho operator → lưu OK nhưng server chặn — split-brain). SLO = mù (OBSERVABILITY chưa bật + không UI live). Edge nodes = partial (version GÕ TAY, không push update). Chẩn đoán mất kết nối = chỉ badge "Ngoại tuyến", không wizard phân tầng.

**Đề xuất:** trang **"Trust & Enforcement Center"** (gate nào thật/bypass, cert sắp hết hạn, user privileged chưa 2FA — toàn read-only, giá trị audit IEC 62443 cao); onboarding hợp nhất theo device-class + bảng machine_connections (connection passport QR); edge fleet management (heartbeat giàu + update ký số); diagnostics engine chạy nền gắn nguyên nhân vào alert machine_offline; lộ trình flip flag production-hardening có smoke-test từng bước.

---

## §9. Benchmark với platform thương mại

So với Ignition · ThingWorx · FactoryTalk · WinCC Unified · Kepware · AVEVA · Tulip trên 16 năng lực:

### 9.1 Nơi hệ thống VƯỢT chuẩn thương mại (differentiators)

1. **AI copilot cục bộ** sâu hơn mọi platform được so (RCA/Threshold/Setup/Programming Copilot + RAG 91k chunk manual, chạy local RTX 5090) — Ignition/FactoryTalk/Kepware không có gì tương đương.
2. **Vision AI AOI/AVI first-party** tích hợp thẳng MES/quality — các platform kia phải mua Cognex/Halcon rời.
3. **Deploy governance vượt FactoryTalk AssetCentre**: sim-gate BẮT BUỘC + verify-after-download đọc ngược + four-eyes version + SoD + ledger append-only.
4. **Kiểm soát actuation trên chuẩn**: role-floor + 2FA (IEC 62443-2-1 CL2) + HITL + interlock fail-closed trước mọi real-write + hash-chain audit.
5. **Alarm rationalization ISA-18.2/EEMUA-191 built-in** (priority derive từ ma trận consequence×time, KPI flood/chattering/bad-actors) — với Ignition/WinCC phải mua PAS/exida.
6. **Digital twin 3D thật** (USD/DTDL, Rapier physics, replay, drift detector) — không platform nào trong 7 có sẵn.
7. **Fleet/AGV orchestration cùng codebase MES** + độ rộng protocol điện tử/bán dẫn trong 1 codebase (SECS/GEM + MTConnect + Sparkplug + VDA5050 + Euromap + ROS2).
8. **Audit trail tamper-evident hơn Ignition** (per-row HMAC + hash-chain + WORM + e-sig 21 CFR §11.200).
9. Văn hóa **"honest engineering"** (provenance sim/real, không fabricate, isRated ép false tới FAT) — hiếm có, giảm rủi ro uy tín khi demo.

### 9.2 Gap so với chuẩn thương mại

| Năng lực | Chuẩn thương mại | Gap của ta | Ưu tiên |
|---|---|---|---|
| Device connectivity breadth | Kepware 150+ driver **đã FAT với HW thật** | Driver ít hơn 1 bậc, và **~0% HW-validated — với khách công nghiệp, driver chưa chạy HW thật = chưa tồn tại** | **P0** |
| Tag historian & trend | Power Chart ad-hoc, compression, partition | Chưa cutover Timescale; **không có tag-browser/trend ad-hoc** — muốn xem 1 tag phải có trang dựng sẵn | P1 |
| HMI designer | Kéo-thả + tag binding + faceplate (năng lực LÕI của họ) | Không có screen designer tổng quát — 188 trang là code sẵn. Chấp nhận được nếu bán product đóng gói; là gap chiến lược nếu bán platform | P1 |
| Scripting/extension end-user | Ignition Jython mọi nơi; Tulip no-code | **Không có user scripting/expression sandbox** — kỹ sư process không tự viết được logic nhỏ | P1 |
| Redundancy/HA | Redundant gateway pair, client auto-failover | HA chỉ mức kết nối + data durability; **app server 1 tiến trình Node — chết là mù toàn bộ** | P1 |
| Edge management | Ignition Edge agent đóng gói + EAM remote upgrade | Edge runtime là module Node chung codebase, không OTA/provisioning | P1 |
| Deployment pipeline | AssetCentre backup/compare định kỳ | Governance vượt chuẩn nhưng **chưa từng deploy thành công xuống thiết bị thật**; thiếu backup-schedule + compare | P1 |
| Licensing/marketplace | Module license vận hành trơn nhiều năm | Cơ chế đủ nhưng **LICENSE_BYPASS=true, route-guard OFF, marketplace internal-only** — chưa ai "mua" được | P1 |
| Mobile | Perspective app chạy mọi màn hình | App RN chỉ là alert client (còn untracked git) | P2 |
| Alarm notification | Đa kênh + roster + lịch trực | Thiếu roster/lịch trực, shelving UI nhanh cho operator, alarm journal hợp nhất | P2 |
| PdM | ThingWorx Analytics ML + RUL | Heuristic tốt hơn Ignition; thiếu ML học từ hỏng thật + dữ liệu sensor chứng minh | P2 |

---

## §10. Chủ đề hệ thống (tổng hợp xuyên 12 agent)

1. **"Đã lên đạn nhưng chưa kiểm chứng"** — tư thế cờ ngược đời: `OT_CONTROL/ROBOT_CONTROL/DPC_DEPLOY=true` trong khi mọi lớp xác minh (readback, interlock engine, four-eyes version, FOE durable, safety) OFF, và driver tự khai UNVERIFIED. Ngày HW xuất hiện, lệnh đầu tiên qua HITL sẽ đi thẳng xuống driver chưa validate. *(CTL-01, MTX-01)*
2. **Split-brain cấu hình flag** — control ON nhưng gateway OFF; SECS bật 1/3 flag; MTConnect bật nhưng 0 source; coalesce/observability/snapshot code xong chưa flip. Ước ~15-20% năng lực đã build đang "ngủ" chỉ vì flag. *(OT-F2, MON-F3, CTL-08/09/10)*
3. **RBAC split-brain lan rộng** — permission ma `machine_monitoring` (category dùng làm module, không seed nào có) khóa ≥12 route về admin-only; RoleBuilder cấp quyền mà server chặn im lặng; adminProcedure cứng chặn kỹ sư onboarding máy; launcher không RBAC; nav ≠ guard. **Gốc rễ của 4/8 journey operator hỏng.** *(persona Lan/Minh/Tuấn, DEV-02, ENG-F3)*
4. **Bug thật cấp "nút không hoạt động"** — giao chỉ tiêu OEE chết runtime + ghi downtime fail âm thầm (raw SQL sai casing Postgres), downtime history in-memory mất sau restart, PdM lấy bản ghi CŨ NHẤT làm health hiện tại, SMS switch no-op, 2 rule alert stub trả 0 vĩnh viễn. *(persona Hương/Hùng, MON-F5/F10)*
5. **Vòng điều khiển cụt ở 2 đầu** — frontend không có UI dispatch lệnh nào (Propose→vòng tròn), còn đường deploy thật thì ngõ cụt actionId (UI sinh random ≠ ai_pending_actions mà dispatcher verify) + four-eyes hình thức. **Cùng 1 seam, 2 lỗi ngược chiều — sửa bằng 1 giải pháp: Approval Inbox thật.** *(ENG-F1/F2, persona Minh)*
6. **HA/reliability "đúng trên giấy"** — supervisor không thể phát hiện rớt kết nối giữa phiên (5 driver không flip connected); availability OEE chỉ đúng cho máy socket; store-forward không drain khi vắng traffic. *(OT-F1 P0, MON-F1)*
7. **Backend xong — UI 0%** — PKI cert, PM schedules, spare parts ledger, sensor trend, reporting mart dim_shift, AdminMonitoring orphan, machine IP bị vứt khi onboard. Nhiều tính năng "đã thực thi" ở doc trước thực tế chưa ai dùng được qua UI. *(persona Hùng/Tuấn/Hương)*
8. **Primitive doc 39 chưa sinh lãi** — 0 trang devices/engineering dùng DataTable/AsyncBoundary/FilterBar; over-fetch poll 5s đa query; không virtualization; empty-state giả khi loading.
9. **Độ phủ thiết bị lệch về inspection** — SMT core line (mounter/reflow/printer + CFX/Hermes), IO-Link, SCPI/RF, power meter, label printer đều missing; Mitsubishi SLMP 3E (dòng PLC chủ lực) chưa nói chuyện được. *(MTX-03..)*
10. **0% HW-validation là bức tường chung** — mọi capability kết nối/điều khiển dừng ở cùng một chỗ: chưa có đợt FAT/commissioning với thiết bị thật (đợt E doc 37 chưa thực hiện).

---

## §11. KẾ HOẠCH NÂNG CẤP (chờ duyệt — chưa thực thi)

> Nguyên tắc: **sửa cái đang nói dối user trước** (bug + RBAC + no-op), rồi **đóng vòng điều khiển tin được**, rồi **kích hoạt những gì đã build**, rồi mới **xây thêm**. Mỗi wave có green-gate `tsc + build + test` và smoke tiêu chí rõ; flag mới mặc định OFF trừ khi ghi rõ.

### Wave 0 — Quick-wins 1 buổi (effort S)
Xóa 2 file dead code (MachineStatusMonitor 847 dòng, AdminMonitoring → route vào Admin); i18n keys `deviceHub/twinHub/ecn/field` cho 3 locale + title cứng; DeviceHub sync `?tab=`; wire chip VDA5050; isLoading states (MachineHealthMonitoring, EdgeNodesPage, ControlPlane, RobotControl); refetch edge nodes; toast deploy branch theo status thật; ẩn/label switch SMS no-op + 2 rule alert stub; header stale zmotionBasicAdapter; hint quyền operator đổi sang ngôn ngữ hành động.

### Wave 1 — Sửa bug chặn nghiệp vụ + RBAC wiring (effort M, ưu tiên CAO NHẤT)
| # | Hạng mục | Nguồn |
|---|---|---|
| 1.1 | Fix 4 mutation raw-SQL sai casing (oee create/update/deleteTarget + socket start/endDowntime) → Drizzle; downtime history đọc từ DB thay in-memory | Hương P0 |
| 1.2 | Fix bug PdM `orderBy` thiếu desc; negative-cache machineId TTL/invalidation | MON-F5/F11 |
| 1.3 | **Đóng permission ma `machine_monitoring`**: registry permission thống nhất (shared/) + đổi gate ≥12 route/procedure sang module thật (`machine_status`…) hoặc seed module mới cho các role + migration backfill + test CI "mọi requiredPermission phải tồn tại & được seed cho ≥1 role không-admin" | Lan P0 |
| 1.4 | Quyền phiên sản xuất operator: module `production_session` (canCreate/canEdit own-session) — mở khóa Vào ca/Kết thúc/Bàn giao | Lan P0 |
| 1.5 | /feeder-verify + /alerts đổi gate đúng; nav ↔ RouteGuard sync (/monitoring-setting); App Launcher khóa tile theo RBAC; Simple-mode: hạ tier item cốt lõi cho operator/maintenance | Lan/Hùng |
| 1.6 | RoleBuilder cảnh báo role-floor actuation; usePermissions bỏ hardgate admin; RobotControl hasPermission thay `role==='admin'` | ENG-F3, Tuấn |
| 1.7 | Onboarding: hạ adminProcedure → role-floor engineer+2FA (machine.create, edgeDeployment.testConnection/deployModel); **lưu IP/port/protocol vào bản ghi máy** (bảng machine_connections hoặc cột mới) | Minh, Tuấn P0 |
| 1.8 | MonitoringSettings rút gọn: redirect tab MQTT → /connectivity, giữ device-management | DEV-01 |

**Green-gate:** đóng vai operator seed mặc định đi lại 8 journey của chị Lan — kỳ vọng ≥6 works.

### Wave 2 — Đóng vòng điều khiển & deploy tin được (effort L)
| # | Hạng mục | Nguồn |
|---|---|---|
| 2.1 | **Deploy Approval Inbox thật**: deployBuild tạo `awaiting_approval` + ai_pending_actions row đúng chuẩn → approver ký bằng session của họ (2FA step-up) → dispatch với actionId THẬT. Sửa cùng lúc four-eyes hình thức + ngõ cụt NOT_CONFIRMED | ENG-F2, Minh P0 |
| 2.2 | **Gated Command Console**: tRPC bọc robotCommandDispatcher/commandDispatcher cho lệnh đơn lẻ + typed-confirm + interlock-check hiển thị trước + pending/done live; nối nút Propose | ENG-F1 |
| 2.3 | Commissioning/FAT gate cho robot dispatcher (đối xứng OT, default-ON, mig 0237) + check "không real-run khi e-stop registry Null ở site thật" | CTL-02, MTX-11 |
| 2.4 | Sim-gate bắt buộc cho deploy workflow FOE (lưu sim-result + hash, override có lý do) | ENG-F4 (P0 doc 22) |
| 2.5 | Step-up 2FA (OTP tươi) cho actuation/deploy, flag `ACTUATION_STEPUP_2FA` | CTL-07 |
| 2.6 | Gate Delta mock + metadata validationStatus badge; batch commandLog transaction | CTL-05/16 |
| 2.7 | Pre-flight banner useActuationReadiness (2FA/quyền/flag) trên mọi nút actuation | ENG-F13 |

**Green-gate:** 1 lệnh robot sim + 1 deploy staging đi trọn vòng Propose→Approve→Execute→Verify trong UI, ledger đủ row.

### Wave 3 — Dữ liệu giám sát nói thật + kích hoạt năng lực đã build (effort L)
| # | Hạng mục | Nguồn |
|---|---|---|
| 3.1 | **Link-loss detection cho 5 driver** (socket close/error + N-fail fallback) + integration test kill-server — biến HA từ giấy thành thật | OT-F1 **P0** |
| 3.2 | **machinePresenceService hợp nhất** — mọi transport ghi machine_status_logs → Availability đúng cho mọi máy; seed downtime detector lúc boot + threshold ra env → bật DOWNTIME_DETECTION | MON-F1/F4 |
| 3.3 | Đấu lại PdM: đọc machine_sensor_readings (4/4 feature sống) + persist heartbeat + tách health đo-được/dự-báo; API đọc + chart trend sensor trong cockpit | MON-F2, Hùng |
| 3.4 | OEE: nguồn ideal-cycle chủ động + bật OEE_SNAPSHOT; set-based fleet query (bỏ N+1); bỏ global telemetry firehose (per-machine room) + TELEMETRY_EMIT_COALESCE_MS=250 | MON-F6/F7/F8 |
| 3.5 | **Gói flip-to-verify**: OT_READBACK + INTERLOCK_ENGINE + FOE_DURABLE + DPC_VERSION_REVIEW + OBSERVABILITY=true, mỗi flag 1 smoke | CTL-01/06/08/09, MON-F12 |
| 3.6 | Flag-matrix 1 trang + boot "connectivity summary" + trang **Control/Trust Readiness** (gate thật/bypass, cert hạn, user chưa 2FA, ZAux binding, engine ON/OFF, LICENSE_BYPASS banner) | OT-F2, Tuấn |
| 3.7 | Quick-fixes backend: S6F11 sink, store-forward append-only + drain timer, otAdmin hot-reload, energy auto-ingest whitelist, mqttSummary idempotent, siết MACHINE_SHARED_KEY sau rotate, MQTT password/TLS staged, OPC-UA security mode + tiêu thụ PKI cert, **Cert Lifecycle UI** | OT-F3..F11, Tuấn P0 |

**Green-gate:** 1 adapter OPC-UA sim: rút "cáp" (kill sim server) → supervisor reconnect + downtime event tự ghi + availability đổi; OEE 3 thành phần có số thật.

### Wave 4 — Frontend chuyên nghiệp hóa & tính năng persona (effort L-XL, chia 3 gói song song)

**4a — Module devices:** OEE & Downtime thành tab 4 DeviceHub (redirect /oee-dashboard) + 1 gauge chung; primitive doc 39 + virtualization vào UnifiedDeviceMonitor/MachineRegistration/EdgeNodesPage (tách telemetry store per-row); MachineCockpit tab **Telemetry** (chart lịch sử per-tag + live overlay) + tab **Bảo trì** (timeline WO/downtime/recipe/threshold + spare BOM + manual); tab **Sơ đồ xưởng 2D** trong DeviceHub; hiển thị máy thiếu OEE kèm lý do thay vì lọc bỏ; wizard onboarding hợp nhất theo device-class + connection passport; diagnostics wizard phân tầng cho máy offline.

**4b — Module engineering:** CodeMirror 6 drop-in + inline diagnostics + autocomplete program_symbols (bước sau: FIM ghost-text từ hạ tầng doc 34); trend + ack/shelve alarm + watch-board trong cockpit; gộp RobotControl → tab Registry cockpit; TwinHub badge LIVE/SIM; EngineeringChanges drawer + FilterBar + bỏ window.prompt; FleetOrchestration gate poll theo tab + DataTable; Teach/Jog buffer persist + "Lưu vào project"; PouCanvas editor tương tác tối thiểu; EngineeringHub sửa tile mù.

**4c — Persona features:** War-room "Giao ban 7h" one-pager + **OEE theo LINE rollup** + so sánh ca dùng shift_configs + consumer reporting mart + plan-vs-actual pacing alert + TV mode OEE trên Andon; **CMMS mini hub** (PM schedules router+UI, spare parts UI, reliability MTBF/MTTR toàn đội, checklist PM ảnh) + QR asset tag + kênh maintenance FactoryAlertSystem + config FCM; wizard "Đổi sản phẩm" 4 bước cho operator + kiosk mode hoàn chỉnh + badge/PIN login + "Line của tôi"; edge fleet (version tự báo + update ký số).

### Wave 5 — Mở rộng độ phủ thiết bị (effort L-XL, theo nhu cầu kinh doanh)
SLMP 3E/4E encoder (spec sẵn — mở khóa FX5U/iQ-R, **ưu tiên 1**); fleet program rollout canary deployToFleet + ma trận máy×version; chiến lược "bao vây GX Works" (artifact vendor-binary + verify hash online); IPC-CFX client (AMQP) + Hermes board-flow + machine types MOUNTER/REFLOW/STENCIL_PRINTER; IO-Link master profile; SCPI-over-TCP adapter (RF instrument); energy-meter Modbus template; ZPL printer TCP 9100; UR vào vendor registry; HIL gate Mitsubishi/Zmotion simulator; user expression sandbox (gap Ignition); trend/tag-browser ad-hoc.

### Wave 6 — Việc OWNER + đầu tư phần cứng (không phải code thuần)
- **HW-FAT bench (đợt E doc 37)**: 1 PLC mỗi họ + kịch bản rút cáp/reboot/DB-down/failover → ký commissioning records. Điều kiện tiên quyết để tuyên bố production và bán driver.
- Timescale cutover (0172+0235, backfill, swap read-path, tắt matview) — điểm nghẽn ghi số 1.
- Zmotion: npm i koffi + zauxdll.dll + ZAUXDLL_PATH trên host nối controller.
- FIREBASE_* env cho FCM push; cấu hình SKU thật rồi tắt LICENSE_BYPASS; Safety PLC (Pilz/Sick) mua + đấu + FAT; app-server HA (standby pair) cho hồ sơ thầu 24/7; commit FactoryAlertSystem vào git.

### Thứ tự khuyến nghị & ước lượng

| Wave | Nội dung | Effort ước | Phụ thuộc |
|---|---|---|---|
| 0 | Quick-wins | 0.5 ngày agent | — |
| 1 | Bug + RBAC | ~1 ngày agent (8-10 exec agent) | — |
| 2 | Control loop | ~1-1.5 ngày | Wave 1 (RBAC) |
| 3 | Data truth + activation | ~1-1.5 ngày | song song Wave 2 được |
| 4 | Frontend + persona | ~2-3 ngày (3 gói song song) | Wave 1 |
| 5 | Device coverage | theo nhu cầu KD | Wave 3 |
| 6 | Owner/HW | lịch mua sắm | — |

---

## §12. Quyết định cần anh duyệt

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| D1 | **Tư thế cờ control**: giữ `ROBOT_CONTROL/OT_CONTROL=true` + bật gói verify, hay hạ về OFF tới khi FAT? | Hạ `ROBOT_CONTROL_ENABLED=false` (driver tự khai UNVERIFIED); giữ OT_CONTROL=true vì đã có commissioning gate; bật gói verify Wave 3.5 |
| D2 | **Permission ma `machine_monitoring`**: đổi gate sang module thật (`machine_status`) hay seed module mới cho các role? | Đổi gate sang module thật + registry thống nhất — ít migration, chặn tái phát bằng test CI |
| D3 | Gộp OEEDashboard vào DeviceHub? Gộp RobotControl vào RobotCockpit? | Có cả hai (redirect giữ deep-link) — tiếp nối chiến dịch chống surface-sprawl doc 39 |
| D4 | Editor: CodeMirror 6 (nhẹ, không CDN) hay Monaco (nặng, gần VSCode)? | CodeMirror 6 trước (Wave 4b), Monaco chỉ khi cần LSP đầy đủ |
| D5 | Đầu tư SMT core (IPC-CFX/Hermes) ngay ở Wave 5 hay chờ khách hàng cụ thể? | Làm CFX client trước (1 protocol phủ nhiều vendor, giá trị bán hàng SMT cao); Hermes chờ line thật |
| D6 | Duyệt danh mục đầu tư Wave 6 (HW-FAT bench, Safety PLC, Timescale trên server, HA app-server)? | HW-FAT + Timescale trước; Safety PLC khi có lịch robot thật; HA app-server khi có hồ sơ thầu |
| D7 | Phạm vi thực thi: duyệt toàn bộ Wave 0-4 một lần (như doc 27/31/35) hay duyệt từng wave? | Duyệt Wave 0-3 thực thi ngay (bug/RBAC/control/data — rủi ro thấp, giá trị cao); Wave 4 duyệt theo 3 gói; Wave 5 theo D5 |

**Sau khi anh duyệt (toàn bộ hoặc từng phần), tôi sẽ gọi các agent chuyên môn thực thi theo wave với green-gate tsc+build+test từng đợt.**

---

## §13. BỔ SUNG THEO YÊU CẦU (2026-07-10) — 4 thiết kế cho quản lý nhà máy trực quan

> Bổ sung sau phản hồi của user vào bản audit: (1) màn hình chỉ huy toàn nhà máy 2D/3D, (2) chất lượng 3D chuyên nghiệp + mượt, (3) layout frontend content-first, (4) bật mọi thứ + giả lập để đánh giá toàn cục.

### §13.1 — "Factory Command View" · Toàn nhà máy trong MỘT màn hình

**Persona đích:** sếp phòng tự động hóa / giám đốc nhà máy — không đi từng module; mở 1 màn hình thấy toàn cảnh, click máy là có mọi thứ.

**Nền tảng đã có sẵn (không phải xây từ 0):** schema `factory_layouts` + `machine_positions` (2D/3D, x/y/z, rotation, size — [layout.ts:9-56](drizzle/schema/layout.ts#L9-L56)) + `workshop_positions`/`factory_positions` cho cấp tập đoàn; FactoryFloorEditor để đặt vị trí; socket machine:status_update + twinStream; Andon/alarm/PdM/WO đều có API. **Vấn đề hiện tại:** FactoryLiveMap3D không tiêu thụ machine_positions (chỉ tọa độ 0–1 hoặc auto-grid), drill-down rời trang, không có rail "vấn đề đang mở".

**Thiết kế — route mới `/factory-command` (landing mặc định của app devices cho role quản lý):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ KPI strip (1 hàng, ≤64px): OEE nhà máy · máy chạy/dừng/lỗi · NG ca … │
├───────────────────────────────────────────────┬──────────────────────┤
│                                               │  RAIL VẤN ĐỀ ĐANG MỞ │
│         CANVAS LAYOUT 2D ⇄ 3D (≥70% màn)      │  🔴 Andon AOI-12 5'  │
│   máy đặt theo Line đúng vị trí thật          │  🟠 PdM risk R-03    │
│   màu = trạng thái realtime                   │  🟡 WO quá hạn M-07  │
│   viền nháy = Andon · icon ⚡ = PdM risk      │  (click → camera bay │
│                                               │   tới máy + mở panel)│
├───────────────────────────────────────────────┴──────────────────────┤
│ Drawer chi tiết máy (mở khi click, KHÔNG rời màn hình):               │
│ [Hiện trạng] [Telemetry] [Vấn đề] [Hành động]                         │
└──────────────────────────────────────────────────────────────────────┘
```

1. **3 lớp kiến trúc:** *Layout layer* (đọc machine_positions; máy chưa có tọa độ → auto-layout theo line + snap, lưu lại 1 nút bấm; FactoryFloorEditor thành chế độ Edit của chính màn này) · *Live-state layer* (1 socket room `factory:{id}:presence` đẩy delta status/OEE/andon/PdM — tái dùng machinePresenceService Wave 3.2 + twinStream, KHÔNG poll) · *Interaction layer* (click máy → drawer 4 tab mini: **Hiện trạng** (status, OEE ca, alarm active, recipe đang chạy, WO mở) · **Telemetry** (sparkline 3-5 tag chính) · **Vấn đề** (andon + alarm + PdM risk + lịch sử 8h) · **Hành động** (gọi bảo trì 1-chạm, mở cockpit đầy đủ, propose lệnh qua Command Console Wave 2.2 — theo RBAC)).
2. **2D ⇄ 3D cùng một nguồn dữ liệu + cùng camera state:** 2D là mặc định (SVG/Canvas2D — đọc nhanh, in được, chạy TV yếu); 3D bật khi cần trình diễn/không gian. Toggle không mất ngữ cảnh.
3. **LOD phân cấp tập đoàn → nhà máy → xưởng/line → máy** — dùng đúng 3 bảng position đã có; zoom-out thấy tòa nhà tô màu tổng trạng thái, zoom-in mới hiện từng máy.
4. **Visual encoding chuẩn ISA-101:** màu nền máy = run/idle/down/offline/maintenance; **viền nhấp nháy đỏ = Andon active**; badge ⚡ = PdM risk cao; **overlay heat tùy chọn** (OEE / NG-rate / năng lượng / downtime phút) đổi bằng 1 dropdown; ribbon dòng chảy WIP theo line (mũi tên mờ).
5. **Tính năng "sếp":** rail phải liệt kê MỌI vấn đề đang mở toàn nhà máy (Andon + alarm + PdM + WO quá hạn + máy offline) sắp theo mức độ — click item → camera fly tới máy + mở drawer; filter "chỉ hiện máy có vấn đề"; **time-scrub 8h** kéo lại quá khứ (twinReplay đã có backend); chế độ **TV auto-cycle** (kế thừa Andon board contract `?cycle=`); nút xuất ảnh PNG cho báo cáo.
6. **Quyền:** xem = `machine_status`; tab Hành động theo RBAC hiện hữu. Đây cũng chính là "tab Sơ đồ xưởng" Wave 4a nhưng nâng cấp thành màn hình độc lập cấp-1 — thay thế đề xuất cũ.

### §13.2 — Đại tu chất lượng & độ mượt 3D (chuẩn RTX 5090)

**Chẩn đoán từ code hiện tại** ([FactoryFloor3D.tsx](client/src/components/FactoryFloor3D.tsx), [Factory3DScene.tsx](client/src/components/Factory3DScene.tsx)): `<Canvas shadows>` không cap `dpr`, **không `frameloop="demand"`** → render 60fps liên tục kể cả khi đứng yên; `useFrame` per-mesh animate emissive (mỗi máy 1 callback mỗi frame); **mỗi máy = nhiều mesh riêng + 1 drei `<Text>`** = hàng trăm draw call; shadow map realtime; poll 5s tạo object mới gây GC churn; vật liệu phẳng không môi trường → nhìn "đồ chơi". 2 component 3D trùng nhau (Factory3DScene vs FactoryFloor3D) chưa hợp nhất.

**Kế hoạch đại tu (giữ stack three 0.182 + R3F 9.5 — đủ sức, chỉ đang dùng sai cách):**

| Hạng mục | Nội dung |
|---|---|
| Render loop | `frameloop="demand"` + `invalidate()` chỉ khi có delta trạng thái/camera move; `dpr={[1, 2]}`; pulse trạng thái chuyển vào **shader uniform thời gian** (1 material clock) thay vì N callback useFrame |
| Draw calls | **InstancedMesh** cho thân máy cùng loại (N máy = 1 draw call, màu per-instance qua `instanceColor`); nhãn máy: chỉ render khi zoom đủ gần (LOD), gộp bằng troika-text hoặc HTML overlay layer |
| Ánh sáng/bóng | Bỏ shadow map realtime → **ContactShadows/AO baked** + environment HDR nhẹ (drei `Environment` preset nội bộ) — đẹp hơn, rẻ hơn |
| Model | Thay box bằng **thư viện GLB low-poly theo machineType** (AOI, reflow, robot arm, conveyor, AGV — modelRegistry + sampleUrdfs đã có khung), nén Draco/KTX2; fallback box khi thiếu model |
| Tương tác | OrbitControls damping; **camera fly-to easing** (maath) khi click máy/rail; raycast qua **three-mesh-bvh** cho scene lớn; hover = OutlinePass selective thay đổi emissive |
| Hậu kỳ | Bloom + SAO selective (pmndrs postprocessing) bật theo auto-detect GPU — RTX 5090 ăn trọn, máy yếu tự hạ |
| Kiến trúc | **Hợp nhất Factory3DScene + FactoryFloor3D → 1 `FactoryScene`** dùng chung cho TwinHub + Command View + cockpit tab 3D; tách data-layer (zustand store nhận socket delta) khỏi render-layer |
| Ngân sách hiệu năng | Mục tiêu đo được: **60fps @ 500 máy @ 4K**, first-frame < 1.5s; gắn r3f-perf trong dev + Playwright screenshot CI |

### §13.3 — Layout frontend "content-first": ưu tiên không gian cho dữ liệu & canvas

**Nguyên tắc thiết kế mới (áp toàn 2 module, sau đó lan toàn app):**

1. **Khu vực nội dung chính (bảng dữ liệu / canvas / chart) ≥ 70% viewport.** PageHeader gọn 1 hàng (breadcrumb + action inline, bỏ mô tả dài); bỏ padding lồng nhau của Card-trong-Card.
2. **KPI/thẻ trạng thái thu nhỏ thành `StatChip` 1 dòng** (label + số + delta, cao ~32-40px, xếp 1 hàng ngang có overflow scroll) — thay cho lưới MetricCard 4 ô cao 110px hiện tại. MetricCard thêm variant `compact`; giữ bản lớn chỉ cho trang tổng quan thuần KPI.
3. **Side panel/filter → collapsible drawer**, mặc định đóng ở màn <1600px; trạng thái mở/đóng lưu localStorage.
4. **`DensityProvider` toàn app** (comfortable / compact) — user pref; compact giảm row-height bảng, font 13px, padding 8px.
5. **Fullscreen-in-app cho canvas & bảng** (nút ⛶): editor IR/POU, twin, Command View, watch table, DataTable — chiếm toàn viewport, ESC thoát.
6. Bảng full-height với **sticky header + virtualization** (đồng bộ với việc áp DataTable doc 39 ở Wave 4a/4b).
7. **Thứ tự áp dụng:** UnifiedDeviceMonitor + DeviceHub → EngineeringWorkspace (editor + watch chiếm chính) → FleetOrchestration (map to) → OEE tab (gauge → sparkline row) → CommandCenter → RobotCockpit. Mỗi trang có ảnh trước/sau trong PR để anh duyệt trực quan.

### §13.4 — "Bật mọi thứ + giả lập": Full-System Simulation Mode

**Mục tiêu:** đánh giá tổng quát VÀ chi tiết toàn hệ sinh thái ở mức hoàn thiện cao nhất **trước khi có phần cứng** — mọi flag ON, mọi tầng chạy, dữ liệu chảy end-to-end bằng thiết bị giả lập.

**Đã có sẵn:** robot vendor `sim` (registry), foeSimulator, desEngine, stubDriver OT, safetyPlcAdapter backend `sim`, URSim docker, PackML sim, kinematicSimGate. **Cần bổ sung 6 simulator mỏng:**

| Simulator | Cách làm |
|---|---|
| OPC-UA server sim | node-opcua (đã cài) chạy server demo với tag map chuẩn — driver opcua kết nối THẬT vào nó; kill/restart server = test link-loss OT-F1 |
| Modbus slave sim | modbus-serial server mode (cùng lib) hoặc diagslave — test driver + endianness |
| HSMS equipment sim | passive entity trên codec secsgem đã có — bắn S5F1/S6F11 theo kịch bản → test live-loop + Andon |
| MTConnect agent sim | HTTP server trả XML /probe /current mẫu — điền MTCONNECT_SOURCES |
| VDA5050 AGV sim | publisher MQTT state/connection + nhận Order — test fleet orchestration + traffic |
| Telemetry/sensor generator | MQTT publisher theo convention sensor (vibration/current/temp có drift + sự cố tiêm được) — nuôi PdM 4/4 feature |

**Gói triển khai:**
1. **`npm run sim:factory`** — 1 lệnh dựng "nhà máy ảo": seed 3 line × 12 máy đủ chủng loại (AOI, PLC×3 hãng, robot×3, conveyor, AGV, power meter, sensor) + `machine_positions` layout + shift_configs + oee_targets + adapter/tag; khởi động 6 simulator; Command View §13.1 sáng đèn ngay.
2. **Profile `.env.sim`** — bật TOÀN BỘ: OT_GATEWAY + 5 protocol + coalesce + READBACK + INTERLOCK_ENGINE + FOE_DURABLE + DPC_VERSION_REVIEW + SECS_GEM_LIVE + MTCONNECT_SOURCES + VDA5050 + OBSERVABILITY + DOWNTIME_DETECTION + OEE_SNAPSHOT + TWIN_DRIFT + LICENSE gate (bỏ bypass) + FIELD_V2… Trang **Control/Trust Readiness** (Wave 3.6) làm checklist: mục tiêu **100% đèn xanh trong môi trường sim**.
3. **Scenario engine kịch bản phá hoại:** máy down 10' → xem chuỗi presence→downtime→OEE→alert→Andon→escalation; NG spike → interlock rule nổ; DB down 5' → store-forward drain; kill OPC-UA sim giữa phiên → supervisor reconnect; feeder sai → gate chặn; deploy sai hash → verify-after-download bắt. Mỗi kịch bản là 1 file YAML chạy lại được + tiêu chí pass/fail.
4. **E2E Playwright drive** qua các kịch bản trên UI (như doc 36 đã làm 20/21 PASS) + báo cáo "System Readiness Report" tự sinh — đây là bằng chứng "đánh giá tổng quát + chi tiết" và là bản nháp quy trình cho HW-FAT thật (Wave 6): kịch bản sim nào pass thì mang y nguyên sang bench phần cứng.

### Cập nhật kế hoạch & quyết định

- **Wave 3 bổ sung 3.8 = §13.4 Full-System Sim Mode** (simulator + seed + .env.sim + scenario engine) — đây trở thành green-gate tự nhiên của cả Wave 2 và 3.
- **Wave 4 bổ sung gói 4d = §13.1 Factory Command View + §13.2 đại tu 3D + §13.3 content-first pass** (gói lớn nhất của Wave 4, có thể chạy song song 4a-4c).
- **Quyết định bổ sung:**

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| D8 | Command View đặt làm landing mặc định app devices cho role quản lý? 2D hay 3D là mặc định? | Có — landing cho supervisor/manager/admin; **2D mặc định**, 3D là toggle (nhanh, TV được, in được) |
| D9 | Model 3D theo machineType: dùng GLB low-poly tự dựng (agent sinh procedural + tinh chỉnh) hay mua/ngoại nhập asset? | Tự dựng low-poly trước (miễn phí, đủ nhận diện hình khối); slot upload GLB per-machine đã có sẵn ở cockpit cho máy cần đẹp |
| D10 | Full-Sim Mode chạy trên DB dev hiện tại hay 1 DB `_sim` riêng? | DB `_sim` riêng (clone schema — script setup-test-db đã có pattern) để dữ liệu giả không lẫn dữ liệu thật |

---

*Báo cáo sinh bởi 12 AI agent (1,75M token đọc code, 791 tool call) — mọi finding có evidence file:line. File dữ liệu thô từng agent lưu tại scratchpad phiên làm việc.*
