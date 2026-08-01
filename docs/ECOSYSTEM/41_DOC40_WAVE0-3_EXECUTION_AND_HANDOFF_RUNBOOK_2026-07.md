# Doc 41 — Thực thi Doc 40 Wave 0–3 + Runbook bàn giao để TEST

- **Ngày:** 2026-07-10 · **Nhánh:** `automation-orchestration-r0` · **Trạng thái:** ✅ Thực thi xong Wave 0–3B + QA verify · **UNCOMMITTED** (chưa git theo quy ước)
- **Phạm vi:** User duyệt toàn bộ D1–D10 + Wave 0–3 (kèm 3.8 Full-Sim). Thực thi bằng các đợt agent chuyên môn, mỗi đợt green-gate `tsc + build + test`, cuối cùng QA adversarial 5 chiều.
- **Kết quả gate:** tsc **0 lỗi** · build **0 lỗi** · test **52 file/75 test fail = ĐÚNG BASELINE** (0 regression do đợt này; 75 lỗi còn lại là DB-integration cần `pg`/test-DB + IR golden stale, có sẵn từ trước). 65 file sửa + 15 file mới + 4 migration.

---

## §1. Đã làm gì (theo wave)

### Wave 0+1 — Quick-wins + sửa bug chặn nghiệp vụ + RBAC wiring
- **Đóng "permission ma" `machine_monitoring`** (D2): tạo `shared/permissions.ts` (registry moduleName hợp lệ + alias `machine_monitoring`→`machine_status`), áp alias TRUNG TÂM ở `accessControl.checkPermission` + `usePermissions.hasPermission` → mọi gate phantom (≥12 route + hàng chục procedure) hết chết cứng, không cần sửa từng router.
- **Module `production_session`** cho operator (mig 0237): mở vào-ca/tạm-dừng/kết-thúc/bàn-giao (trước bị chặn vì operator `production_orders.canCreate/canEdit=false`). Kèm **owner-scope** (QA fix): operator chỉ thao tác phiên của chính mình.
- **Bug "nút không hoạt động"**: 4 mutation OEE-target + downtime raw-SQL sai casing Postgres → **Drizzle** (hết lỗi runtime + fail-âm-thầm); downtime history đọc từ **DB** thay in-memory; PdM `orderBy` thiếu `desc` → đã thêm; negative-cache machineId có **TTL 60s**.
- **RBAC**: RobotControl bỏ hardgate `role==='admin'` → `hasPermission('machine_control')`; RoleBuilder cảnh báo role-floor; AppLauncher khóa tile theo RBAC; Simple-mode giữ item cốt lõi cho operator/maintenance; onboarding hạ adminProcedure→role-floor engineer; lưu **IP/port/protocol** vào bản ghi máy (mig 0238).
- **Surface engineering/control** (QA fix): `/robot-control /control-plane /fleet-orchestration /ir-editor /pou-studio /engineering-home` re-gate `machine_status`→`machine_control` (chặn viewer/operator xem read-only).
- **Frontend quick-wins**: i18n keys deviceHub/twinHub/ecn; loading states; toast deploy theo status thật; SMS switch nhãn "sắp có"; gỡ chip VDA5050 sai; xóa dead code MachineStatusMonitor; route AdminMonitoring vào Admin; MonitoringSettings redirect.

### Wave 2 — Đóng vòng điều khiển & deploy tin được
- **Deploy Approval Inbox thật** (mig 0239, cờ `DPC_DEPLOY_APPROVAL_ENABLED` OFF): sửa cùng lúc **four-eyes hình thức** (approver ký bằng session của chính họ, SoD 3 lớp) + **ngõ cụt actionId** (server sinh `ai_pending_actions` thật → dispatcher hết NOT_CONFIRMED). QA xác nhận không có đường tự-duyệt.
- **Gated Command Console** (`/command-console`): UI phát 1 lệnh robot qua HITL dispatcher — typed-confirm + interlock preview + pending→done live. Endpoint `robot.actuate` = **actuationProcedure** (role-floor + 2FA — đã sửa theo QA blocker).
- **Robot commissioning/FAT gate** (mig 0240, `ROBOT_COMMISSIONING_REQUIRED` default ON): robot chưa commissioned bị ép `simulated` — đối xứng OT.
- **Delta mock gate** (`ROBOT_MOCK_VENDORS_ENABLED` OFF): driver hư cấu không gửi được khung xuống thiết bị thật.
- **Sim-gate FOE** (`FOE_SIM_GATE_REQUIRED` OFF) + **step-up 2FA** (`ACTUATION_STEPUP_2FA` OFF) — code sẵn, bật khi cần.

### Wave 3A — Dữ liệu giám sát nói thật
- **OT-F1 (P0) đóng**: 5 driver phát hiện **rớt kết nối giữa phiên** (listener transport + fallback đếm N-fail `OT_LINKLOSS_FAIL_THRESHOLD=3`) → HA reconnect/failover thực sự chạy. + integration test kill-server.
- **machinePresenceService** (`MACHINE_PRESENCE_ENABLED` OFF): Availability đúng cho MỌI transport (không chỉ socket). Downtime auto-detect seed lúc boot + threshold ra env.
- **PdM**: đọc `machine_sensor_readings` thật (vibration/current/temp) → 4/4 feature sống; tách health đo-được vs dự-báo; **tab Telemetry** trong MachineCockpit (chart sensor).
- **OEE perf**: `getAllMachinesOEELive` set-based (~300 query/phút → ~3); bỏ global telemetry firehose (per-machine room + opt-in); ideal-cycle chủ động.
- **Trang Control/Trust Readiness** (`/control-readiness`): ma trận đèn xanh/vàng/đỏ mọi gate/flag runtime + boot summary — công cụ QA/audit.

### Wave 4d — Factory Command View + đại tu 3D + content-first (yêu cầu #1/#2/#3)
- **Factory Command View** (`/factory-command`, mới): 1 màn hình toàn nhà máy, máy xếp theo Line đúng vị trí (`machine_positions`), màu trạng thái realtime (socket), **rail "vấn đề đang mở"** (Andon/alarm/PdM/WO-quá-hạn/offline, click → camera bay tới + drawer), **drawer 4 tab** (Hiện trạng/Telemetry/Vấn đề/Hành động) không rời trang, **2D⇄3D toggle** (2D mặc định theo D8), overlay heat (status/oee/ng/energy), nút TV/fullscreen. RBAC `machine_status` (xem), nút Điều khiển ẩn theo `machine_control`. Router `factoryCommand.overview/machineDetail` set-based, dữ liệu thật honest-null.
- **Đại tu 3D** (`components/factory-scene/`, mới — chưa động vào 3D cũ): `FactoryScene3D` với `frameloop="demand"` (0fps khi tĩnh) + **InstancedMesh** (1 draw call/loại máy) + geometry low-poly tự dựng theo machineType (D9, không GLB ngoài) + ContactShadows bake + camera fly-to + LOD nhãn + theme-aware. `FactoryScene2D` SVG top-down (mặc định, in/TV được). Beacon Andon/PdM throttle ~12fps (QA fix — giữ demand-mode cho TV 24/7).
- **Content-first** (mới): `StatChip` (KPI 1 dòng ~32px), `MetricCard` variant compact, `useFullscreen` hook, `DensityProvider` — áp vào UnifiedDeviceMonitor (bảng fleet ≥70%, KPI→StatChip, nút ⛶) + DeviceHub (tab strip gọn).
- **QA 4d fix:** 1 blocker (drawer crash render recipe object) + 1 high (machineDetail lệch shape → drawer hiện sai) + 1 medium (telemetry giả giá trị + beacon 60fps) — đã đóng bằng adapter chuẩn hoá shape + throttle. 3D **mượt/đẹp thực tế cần anh xác nhận trực quan** (không drive được R3F headless).

### Wave 4c — Persona features: War-room (supervisor) + CMMS hub (maintenance)
- **War-room "Giao ban 7h"** (`/war-room`, mới): one-pager theo ca — KPI strip + **bảng OEE theo LINE** (A/P/Q/OEE/output/plan%/NG, màu ngưỡng) + top-5 máy downtime + so sánh ca (shift_configs thật, không hardcode) + plan-vs-actual. Router `warRoom.briefing` + `oeeService.getLineOEE` set-based, honest-null, xuất PDF + TV mode. RBAC `machine_status`.
- **CMMS mini hub** (`/cmms`, mới): 4 tab — **Lịch PM** (CRUD `maintenance_schedules`, tính năng maintenance chưa từng có) + **Vật tư** (partsBelowReorder + recordPartsUsed trong WO detail) + **Độ tin cậy** (MTBF/MTTR toàn đội + bad-actors) + Work orders. WorkOrdersPage: assignee → EntityPicker, spare-parts panel, machineCode → Link cockpit. RBAC PM write = `machine_downtime` (maintenance có).
- **QA 4c fix:** 2 high — (1) war-room OEE-theo-line hiện 0 khi chọn ca (daily_statistics grain-ngày lọc cửa-sổ-ca) → dùng cửa-sổ NGÀY cho lines, per-ca ở shiftCompare; (2) CMMS PM split-brain (client gate ≠ server write) → thống nhất `machine_downtime`. Low ghi nhận: MTTR/MTBF là trung bình-theo-máy + reliability giới hạn 500 WO.

### Wave 4F — hoàn tất W4 còn lại (devices 4a + engineering 4b + operator)
- **4a devices:** DeviceHub gộp **tab OEE & Downtime** (bóc OEEDashboard → content, redirect /oee-dashboard → tab, auto-refresh 60s); MachineCockpit thêm **tab "Bảo trì"** (lịch sử WO + timeline downtime + spare-parts theo máy + roll-up MTTR).
- **4b engineering:** RobotCockpit **trend sparkline** (joint/speed/battery) + **ack/shelve alarm** (deep-link governance) + **TeachJog persist** (localStorage + "Lưu vào project robot-tm"); trim RobotControl (gỡ command-panel chết, trỏ /command-console); TwinHub **badge LIVE/SIM**; EngineeringChanges (AlertDialog thay window.prompt + drawer chi tiết + FilterBar); FleetOrchestration **poll-by-tab** (5 query/5s → 1-2).
- **operator:** wizard **"Đổi sản phẩm" 4 bước** (/product-changeover: quét barcode → readiness → feeder-verify → xác nhận/gửi supervisor); **QR asset tag** (in QR /machine/:id dán máy); **kiosk mode** hoàn chỉnh + **"Line của tôi"** + nút Gọi-bảo-trì 1-chạm.
- **QA 4F fix:** 1 high (bug backend `getProductMachineMappings` gọi `.where()` 2 lần → GHI ĐÈ không AND → wizard báo "sẵn sàng" sai; fix `and(...conds)`) + 1 medium (nav /oee-dashboard gate analytics_oee → machine_status khớp OEE-là-monitoring) + 1 low (dead useAuth). **Lưu ý:** robot per-occurrence alarm ack chưa có endpoint (dùng deep-link governance, không fake); CodeMirror editor CHƯA làm (cần thêm dependency — để riêng).

### Wave 5 — Mở rộng độ phủ thiết bị (device coverage)
Mỗi driver/adapter kèm **unit test mock-server** (70 test mới, tất cả PASS) để sẵn sàng HW-FAT — **CHƯA HW-validated** (đúng nguyên tắc honest).
- **SLMP 3E/4E encoder** (ưu tiên 1, đóng OT-F8/CTL-04): driver `slmp` mới trên node:net — mở khóa Mitsubishi **FX5U/iQ-R** (mặc định SLMP 3E, trước chỉ 1E). Encoder/decoder nhị phân theo spec (subheader 5000/D000, cmd 0401H/1401H, device-code table), link-loss, read-only X/DX. 15 test. Migration 0241 (`otprotocolenum` +slmp).
- **SMT core machine types** (MTX-03): MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER + capability profile. Migration 0242 (`machinetypeenum` +4).
- **SCPI-over-TCP** (RF/FCT instrument, MTX-10) + **ZPL printer** TCP 9100 (traceability, MTX-13) + **energy-meter Modbus template** (Schneider/Selec, tự chảy vào energy_readings, MTX-09) + **UR robot** vào vendor registry (wrap URSim, MTX-12; migration 0243 `robotvendorenum` +ur).
- **Fleet program rollout canary** (deployToFleet): deploy 1 build → N máy tuần tự qua ĐÚNG deployBuild (giữ mọi gate), canary N máy đầu → verify fail thì dừng+rollback, ok thì promote; + ma trận máy×version. UI section trong EngineeringWorkspace. 13 test.
- **QA W5 fix:** 2 high — (1) auto-rollback lùi SAI máy (rollbackDeployment scope project+stage → thêm deviceId); (2) fleet production four-eyes hình thức → chặn khi ở chế độ Approval Inbox. 2 medium — SLMP timeout tear-down socket (chống nhận nhầm response); fleet idempotency nonce (retry được sau canary hỏng). Low: SCPI write ungated (chưa có caller, ghi nhận). **IO-Link + IPC-CFX chưa làm** (CFX cần dep AMQP mới — cần quyết định).

### Wave 5b — CodeMirror editor + IPC-CFX + IO-Link (dep mới: @uiw/react-codemirror, rhea)
- **CodeMirror 6 editor** (ENG-F5, D4): thay textarea thô trong CodeEditor bằng @uiw/react-codemirror — số dòng, khớp ngoặc, highlight cú pháp ST/BASIC/G-code (StreamLanguage tự viết theo domain), theme sáng/tối, **inline diagnostics** (hook sẵn), giữ nguyên props 3 caller (EngineeringWorkspace/IrEditor/ProgrammingCopilot) — lazy-loaded, không phình entry bundle. QA fix: aria-label vào bề mặt soạn thảo.
- **IPC-CFX telemetry client** (MTX-03, D5, rhea/AMQP 1.0): giám sát INBOUND cho line SMT (mounter/reflow/printer) — parse CFX envelope (UnitsProcessed/StationStateChanged/FaultOccurred/ToolChanged) → CanonicalSample qua telemetryBus. Cờ `CFX_ENABLED` OFF, export-only (chưa mount boot). 26 test. **Owner:** broker AMQP + `CFX_ENDPOINTS` + `CFX_ENABLED=true` + khai máy.
- **IO-Link master profile** (MTX-06): data-template port→tag cho ifm/Balluff/Turck qua opcuaDriver có sẵn (KHÔNG driver mới). 11 test.
- **Dependency mới** (`npm install --legacy-peer-deps` — repo dùng flag này do storybook/vite): @uiw/react-codemirror, @codemirror/{view,state,legacy-modes}, rhea.

### Wave 3B — Full-System Simulation Mode (yêu cầu #4: "bật mọi thứ + giả lập")
- **6 simulator** (`scripts/sim/`): OPC-UA server, Modbus slave, HSMS equipment, MTConnect agent, VDA5050 AGV, sensor generator — nói protocol THẬT (2 cái đã smoke live: MTConnect XML + OPC-UA bind).
- **Nhà máy ảo** (`scripts/sim-factory/`): `npm run sim:factory` seed 3 line × 12 máy + `machine_positions` + shift + oee_targets + adapters (guard D10: chỉ ghi DB tên chứa `sim`).
- **`.env.sim`**: profile bật TOÀN BỘ ~30 flag để đánh giá (KHÔNG đụng `.env` production).
- **Scenario engine** (`npm run sim:scenario`): 4 kịch bản phá hoại YAML (machine-down / ng-spike / db-down-recovery / opcua-kill-midsession).
- **Backend quick-fixes**: S6F11 sink, store-forward drain timer, energy auto-ingest (cờ OFF), mqttSummary idempotent.

---

## §2. QA verify — kết quả

5 reviewer adversarial (RBAC · deploy-loop · control-safety · data-truth · flag-posture). **Đã sửa hết blocker/high/medium:**

| Mức | Finding | Xử lý |
|---|---|---|
| **BLOCKER** | `robot.actuate` dùng protectedProcedure → bỏ role-floor+2FA cho real-motion | ✅ Sửa → `actuationProcedure` |
| **HIGH** | Alias làm **viewer** xem được surface engineering/control read-only | ✅ Sửa → re-gate 6 surface sang `machine_control` |
| **MEDIUM** | Operator sửa được phiên sản xuất của người khác | ✅ Sửa → owner-scope check |
| LOW | Drain timer NaN nếu env phi-số | ✅ Sửa → guard `Number.isFinite` |
| LOW | Comment machine.create sai | ✅ Sửa |
| LOW (ghi nhận) | Enum `awaiting_approval` ordinal ở cuối (harmless); step-up 2FA chưa áp deployBuild; presence cache fast-path (flag OFF); machine.create create-được-nhưng-update admin-only | Ghi §4 |

**Vùng SẠCH (QA xác nhận):** SoD deploy không có đường tự-duyệt · actionId fix đúng · link-loss fail-safe · commissioning gate default-ON · Delta mock chặn · OEE set-based không lệch số · downtime DB-backed không rơi Promise · `.env` production KHÔNG đổi · mọi cờ mới OFF-by-default · guard D10 chặn seed vào DB thật · không circular import.

---

## §3. VIỆC OWNER PHẢI LÀM trước/khi test

### 3.1 Áp migration (4 cái mới — CHƯA áp)
```
# DB hiện tại (production/dev): áp 0237-0240
node scripts/migrate-standalone.mjs      # npm run db:push
```
- `0237_production_session_permission` — backfill quyền phiên cho operator/supervisor hiện có.
- `0238_machine_connection_fields` — cột ipAddress/port/connectionProtocol trên machines.
- `0239_deploy_approval` — thêm giá trị enum `awaiting_approval` (ADD VALUE, tự-commit).
- `0240_robot_commissioning` — bảng `robot_commissioning_records`.
- `0241_slmp_protocol` — `otprotocolenum` +`slmp` (driver Mitsubishi FX5U/iQ-R).
- `0242_smt_machine_types` — `machinetypeenum` +MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER.
- `0243_robot_vendor_ur` — `robotvendorenum` +`ur` (Universal Robots).
- ⚠️ **2FA**: bật 2FA cho tài khoản admin/supervisor/engineer (privileged) — nếu không sẽ không ký được deploy/actuation (readiness hook cảnh báo trước).

### 3.2 Test bình thường trên DB hiện tại
Không cần bật cờ gì — mọi thay đổi bug/RBAC/UI đã sống ngay sau khi áp migration + restart app. Test theo §5.

### 3.3 Test Full-Sim Mode (đánh giá "bật mọi thứ") — tùy chọn
```
# 1. Tạo DB _sim riêng (D10) + trỏ .env.sim vào nó
createdb aoi_sim   # hoặc theo README scripts/sim-factory/
DOTENV_CONFIG_PATH=.env.sim node scripts/migrate-standalone.mjs   # migrate schema vào _sim
npm run sim:factory                     # seed nhà máy ảo (guard: DB tên chứa 'sim')
# 2. Chạy server với profile sim (bật mọi flag)
DOTENV_CONFIG_PATH=.env.sim npm run dev
# 3. Chạy simulator thiết bị ảo (cửa sổ khác)
node scripts/sim/sim-devices.mjs
# 4. Chạy kịch bản phá hoại
npm run sim:scenario -- scripts/sim-factory/scenarios/opcua-kill-midsession.yaml
```
Xem trạng thái mọi gate/flag ở **`/control-readiness`** (mục tiêu: đèn xanh tối đa trong sim).

---

## §4. Còn TỒN (ghi nhận, không chặn test)

- **RBAC intent cần anh xác nhận**: viewer giờ CHỈ thấy surface *giám sát* (cockpit/command-center/device-monitor/oee/system-health) read-only, KHÔNG thấy engineering/control (đã chặn). Nếu anh muốn viewer thấy khác đi, báo tôi.
- machine.create mở cho engineer/supervisor nhưng update/delete/regenerateApiKey vẫn admin-only — cân nhắc mở cùng role-floor nếu gây nghẽn onboarding.
- Step-up 2FA (`ACTUATION_STEPUP_2FA`) hiện chỉ áp `orchestration.deployWorkflow`; muốn phủ `programming.deployBuild` thì thêm UI nhập OTP (đã có middleware).
- machinePresenceService cache fast-path (chỉ khi `MACHINE_PRESENCE_ENABLED=true`): nên bỏ để dựa DB-latest — LOW.
- mqttSummary upsert còn TOCTOU nếu trigger tay + cron chạy ĐÚNG đồng thời — cần unique index (mig sau) để dùng ON CONFLICT.
- CTL-16 (batch commandLog transaction) đã **revert** — P3 không đáng churn file dispatcher an-toàn-nhất.
- s7/ethernet-ip trong sim là KHUNG (chưa serve) — thêm khi cần.
- **Chưa commit** (theo quy ước — chờ anh test xong).

---

## §4b. ĐÃ ÁP MIGRATION + SEED DỮ LIỆU TEST (2026-07-11)

**Migration:** 7 migration mới (0237–0243) đã áp vào `aoi_management` (`npm run db:push`) — verify enum slmp/SMT/ur/awaiting_approval, bảng robot_commissioning, cột IP máy đều có. (5 fail còn lại = Timescale/db_feature_status TIỀN-TỒN, không ảnh hưởng.)

**Seed dữ liệu test** (`node scripts/seed-test-data.mjs` — sau `SIM_SEED_CONFIRM=1 DATABASE_URL=<real> SIM_ENV_FILE=.env.__none__ node scripts/sim-factory/seed.mjs` dựng topology):
- **4 tài khoản test** (mật khẩu `Test@1234`, quyền từ template thật):
  - `operator1` (operator) · `maint1` (maintenance) — **2FA TẮT**, login chỉ cần mật khẩu (role không-privileged, không cần 2FA cho tính năng của họ).
  - `engineer1` (engineer) · `supervisor1` (supervisor) — **2FA BẬT** (bắt buộc để test actuation deploy/command). Login đòi OTP → lấy mã: `node scripts/print-otp.mjs engineer1` (đổi mỗi 30s).
- **Topology:** 3 line × 36 máy (đủ loại kể cả MOUNTER/REFLOW mới) + 36 vị trí layout + 3 ca + 3 oee_targets + 15 adapter + 9 OT commissioning + 3 **robot** (sim/ur/fanuc, đã commission).
- **Dữ liệu vận hành:** 252 oee_metrics + 252 daily_stats (OEE/war-room), 108 health + 576 sensor readings (cockpit health/trend), 14 downtime (2 đang mở) + 4 andon (Command View rail), 9 work-order + 9 PM schedule + 4 spare-parts (CMMS), 6 product-machine mapping (changeover), 1 production session.
- Seed idempotent (chạy lại an toàn). Guard D10: cần `SIM_SEED_CONFIRM=1` vì DB không tên `*_sim`.

## §5. Cách TEST từng phần (kịch bản đề xuất)

| Vùng | Đăng nhập vai | Kỳ vọng |
|---|---|---|
| Operator unblock | role `operator` | Vào ca / bàn giao được; vào `/machine/:id`, `/feeder-verify` được; KHÔNG thấy tile Engineering |
| Deploy Approval | engineer (đã 2FA) + supervisor | Engineer "Gửi yêu cầu deploy" → supervisor thấy ở ApprovalsInbox → ký → deploy chạy; engineer KHÔNG tự duyệt được |
| Command Console | engineer | `/command-console` chọn robot + lệnh → typed-confirm → job log pending→done |
| OEE/downtime | supervisor | Giao chỉ tiêu OEE lưu được (không lỗi cột); ghi downtime → toast phản ánh đúng |
| Readiness | admin | `/control-readiness` hiện ma trận gate/flag |
| RBAC viewer | role `viewer` | Thấy giám sát read-only; `/control-plane` `/engineering` bị chặn |
| **Factory Command View** | supervisor/admin | `/factory-command`: thấy máy theo Line + màu realtime; click máy → drawer chi tiết; rail vấn đề → bay tới máy; **toggle 2D⇄3D — xác nhận 3D mượt/đẹp**; overlay OEE/NG |
| Content-first | bất kỳ | `/device-monitor`: KPI thu thành chip 1 dòng, bảng fleet chiếm ≥70%, nút ⛶ fullscreen |
| **War-room** | supervisor | `/war-room`: chọn ca+ngày → bảng OEE theo LINE có số, top downtime, so ca, plan-vs-actual; xuất PDF; TV mode |
| **CMMS hub** | maintenance | `/cmms`: tab Lịch PM tạo/sửa lịch được (maintenance có quyền); Vật tư + Độ tin cậy MTBF/MTTR |
| Full-Sim | admin + .env.sim | Simulator chạy → telemetry chảy → presence/downtime/OEE cập nhật; kill OPC-UA sim → supervisor reconnect; Command View sáng đèn |

---

*Chi tiết audit gốc: [Doc 40](40_MACHINE_MONITORING_ENGINEERING_CONTROL_COMPLETION_AUDIT_2_2026-07.md). Còn Wave 4 (Factory Command View + đại tu 3D + content-first + persona features) và Wave 5-6 (device coverage + HW) CHƯA làm — chờ anh duyệt tiếp sau khi test Wave 0-3.*
