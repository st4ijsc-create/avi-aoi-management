# 09 — Device Programming & Control (DPC) Strategy

> **Câu hỏi gốc:** *"Nên làm riêng một phần mềm sau đó kết hợp hệ thống, hay tích hợp hệ thống kiểu hybrid?"* — cho bài toán **lập trình & điều khiển trực tiếp** đa loại / đa hãng thiết bị (PLC, Robot, Zmotion, motion controller, CNC...), nhận **phản hồi realtime** để xử lý.

| | |
|---|---|
| **Mã doc** | 09_DEVICE_PROGRAMMING_CONTROL_STRATEGY |
| **Ngày** | 2026-06-29 |
| **Trạng thái** | 🟡 **DRAFT — CHỜ DUYỆT.** Chưa gọi agent, chưa viết code. |
| **Tiền đề** | Mở rộng [08_FACTORY_CONTROL_PLANE_STRATEGY](08_FACTORY_CONTROL_PLANE_STRATEGY_2026-06.md) (tầng E0–E5) xuống **tầng lập trình thiết bị (D-tier)**. |
| **Quyết định người dùng (2026-06-29)** | (1) Phạm vi = **Hybrid + native IEC 61131-3**. (2) Ưu tiên GĐ1 = **Zmotion + Mitsubishi PLC + Robot (Techman + mở rộng)**. (3) Phần cứng = **hỗn hợp / cuốn chiếu** (emulator trước, HW thật validate sau). |
| **Cách dùng file** | Sống cùng dự án. Mỗi phase xong → tick checklist + ghi commit vào §12 Changelog. |

---

## 1. Tóm tắt điều hành (Executive Summary)

Hệ thống hiện tại là một **Control Plane trưởng thành ở mức "ra lệnh" (command-centric)**: 5 driver OT thật (OPC-UA, Modbus, S7, Mitsubishi MC, EtherNet/IP) + 1 robot thật (Techman) + 1 Orchestration Studio block-based + FOE engine + digital twin + edge runtime. **Nhưng nó KHÔNG lập trình được thiết bị** — chỉ ghi tag/scalar và gọi job đã lập trình sẵn trong IDE của hãng. Không có ladder/ST, không G-code, không robot script, **không Zmotion**, không code editor, không online-monitor/teach-jog, telemetry mới ở mức polling 5s.

**Trả lời lại câu hỏi:** ✅ **HYBRID — nhưng phải làm SÂU thêm 1 tầng.** Không tách phần mềm rời (mất UNS/auth/AI/data chung + sinh 2 nguồn sự thật). Không nhồi monolith tự viết lại compiler từng hãng (bất khả thi + rủi ro an toàn). Câu trả lời đúng là mở rộng đúng triết lý hybrid-layered đã chốt ở doc 08 — **"author trong hệ sinh thái, build/deploy qua adapter, execute trên thiết bị"** — xuống tới tầng *lập trình*, bằng một abstraction mới: **Programming Adapter (Toolchain Adapter)**.

> **Một dòng:** *Một **Unified Engineering Workspace** (IDE trong platform) + một lớp **Programming Adapter** pluggable, phân 3 nhóm đích: (A) controller mở → build/nạp trực tiếp; (B) PLC hãng đóng → wrap toolchain/CLI hãng; (C) native IEC 61131-3 → tự xây editor, compile sang runtime mở. An toàn (E-stop/interlock/SIL) **luôn** nằm trên PLC chứng nhận; platform chỉ author–supervise–monitor.*

---

## 2. Audit hiện trạng (cơ sở của quyết định)

### 2.1 Đang CÓ (mạnh — không làm lại)

| Mảng | Hiện trạng | File chính |
|---|---|---|
| OT drivers (thật) | OPC-UA, Modbus, Siemens S7, Mitsubishi MC, EtherNet/IP — **read/subscribe + write tag** | `server/services/ot/drivers/*` |
| Robot driver (thật) | Techman TMflow (Modbus telemetry + TMSCT motion) | `server/services/robot/drivers/techmanDriver.ts` |
| Robot scaffold | Fanuc / Mitsubishi MELFA / Delta — **chưa wire** | `…/robot/drivers/*` |
| Adapter facade | `EquipmentAdapter` + `capabilityModel` + `equipmentRegistry` (11 kind) | `server/services/equipment/*` |
| Lệnh có kiểm soát | `commandDispatcher` / `robotCommandDispatcher` — **1 cổng**, HITL + dry-run + idempotent + audit | `server/services/ot/commandDispatcher.ts` |
| Orchestration | Studio block-based (8 step types) + FOE engine + digital twin sim + AI advisor | `server/services/orchestration/foe/*`, `client/.../OrchestrationStudio.tsx` |
| Edge | edgeRuntime + edgeCoordinator (buffer/sync/heartbeat — **soft-RT, coordination**) | `server/services/edge/*` |
| Realtime ra UI | Socket.IO room-based (`machine:` / `line:` / `factory:`) + eventBus | `server/_core/socket.ts`, `eventBus.ts` |
| Standards framework | SECS/GEM, VDA5050, MTConnect, Sparkplug B/UNS (flag-gated) | `server/services/{secsgem,vda5050,mtconnect,uns}/*` |

### 2.2 Đang THIẾU (đây là phạm vi doc 09)

| # | Khoảng trống | Bằng chứng audit |
|---|---|---|
| G1 | **Không lập trình thiết bị**: 0 ladder/ST/FBD (IEC 61131-3), 0 G-code, 0 robot motion script, 0 BASIC. Chỉ ghi scalar. | grep `zmotion/ladder/gcode/structured text` = 0 |
| G2 | **Không có Zmotion** (controller bạn nêu đích danh). | 0 match toàn repo |
| G3 | **Adapter interface không có path "deploy program / download/upload logic"** — chỉ `sendCommand/readTelemetry/getState`. | `equipmentAdapter.ts` |
| G4 | **Không có code editor** (Monaco/CodeMirror/Blockly) ở frontend; không teach/jog robot; không tag-watch / online-monitor console. | package.json + import scan |
| G5 | Robot đa hãng mới là **scaffold** (chỉ Techman thật). | `…/robot/drivers/*` |
| G6 | **Telemetry polling 5s** — không đủ cho live-tuning/scope/online-debug. Không OPC-UA monitoredItem streaming. | `opcuaDriver.ts`, poller 5s |
| G7 | **Không có Project/Workspace + version control cho chương trình thiết bị** (chỉ recipe = JSON param). | `RecipeManagement.tsx` |
| G8 | Không có **compile → simulate → staged deploy → rollback** cho *chương trình* (chỉ có cho *workflow* ở FOE). | doc 08 |

---

## 3. Trả lời lại câu hỏi kiến trúc (phân tích 3 lựa chọn)

| Tiêu chí | A. Phần mềm IDE **rời** rồi tích hợp | B. **Monolith** nhồi vào platform | ✅ C. **Hybrid sâu** (đề xuất) |
|---|---|---|---|
| 1 nguồn sự thật (auth/RBAC/data/UNS) | ❌ tách đôi | ✅ | ✅ |
| Realtime feedback chung với hệ sinh thái | ❌ phải cầu nối lại | ✅ | ✅ |
| Tận dụng AI/RCA/digital-twin sẵn có | ❌ khó | ✅ | ✅ |
| Không tự viết lại compiler từng hãng | ✅ (mua IDE rời) | ❌ bất khả thi | ✅ (wrap toolchain) |
| An toàn (safety trên PLC, không giả lập) | ⚠️ tuỳ | ❌ rủi ro nếu nhồi RT vào Node | ✅ tách rõ author vs execute |
| Tốc độ ra mắt từng hãng | ⚠️ chậm (làm app riêng) | ❌ | ✅ pluggable từng adapter |
| Bảo trì / mở rộng hãng mới | ❌ 2 codebase | ⚠️ phình to | ✅ thêm 1 adapter |

**Kết luận:** giữ **Hybrid** (bạn đã chốt) nhưng **làm sâu** — chính thức hoá thành tầng **DPC (Device Programming & Control)** với abstraction **Programming Adapter**, song song với `EquipmentAdapter` (đã lo telemetry/command). Đây là cùng một mô thức "author-here / execute-on-device" mà doc 08 đã dùng cho orchestration, nay kéo xuống tầng lập trình.

---

## 4. Thiết kế kiến trúc (Architecture Design)

### 4.1 Bản đồ tầng (đặt DPC vào hệ thống hiện có)

```
┌─────────────────────────────────────────────────────────────────────┐
│  L5  ECOSYSTEM (platform)                                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Unified Engineering Workspace  (MỚI — D-tier UI)             │  │
│  │  • Project Explorer (per device/cell, có version control)     │  │
│  │  • Editors: Monaco (text: ST/BASIC/G-code/robot script)       │  │
│  │             Blockly/graph (ladder/FBD, motion sequence)       │  │
│  │  • Online Monitor (tag/register watch, scope, force)          │  │
│  │  • Robot Teach/Jog panel · Variable table · Cross-reference   │  │
│  │  • Build · Simulate(twin) · Deploy(staged) · Diff · Rollback  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│            │ (1 Unified API /v1 · 1 auth/RBAC · 1 audit)             │
│  ┌─────────▼─────────────────────────────────────────────────────┐  │
│  │  Programming Service  (MỚI)                                   │  │
│  │  ProgramProject → ProgramArtifact → BuildResult → Deployment  │  │
│  │  validate · compile · simulate · sign-off(HITL) · deploy      │  │
│  └─────────┬─────────────────────────────────────────────────────┘  │
│            │   ProgrammingAdapter interface (MỚI)                   │
│   ┌────────┼───────────────┬───────────────────────┐                │
│   ▼ (A)    ▼ (B)           ▼ (C)                    ▼                │
│  Open     Vendor-closed   Native IEC 61131-3      Robot            │
│  ctrl     toolchain wrap  (own editor→open RT)    program          │
└───┼────────┼───────────────┼───────────────────────┼───────────────┘
    │        │               │                       │
┌───▼────────▼───────────────▼───────────────────────▼───────────────┐
│  Existing EquipmentAdapter / commandDispatcher (telemetry+command) │
│  Edge Runtime (coordination, offline buffer) — soft-RT             │
└───┬─────────────────────────────────────────────────────────────────┘
    │  realtime feedback (streaming tier MỚI: subscribe, not 5s poll) │
┌───▼─────────────────────────────────────────────────────────────────┐
│  L2/L1  THIẾT BỊ — execute chương trình; SAFETY ở PLC chứng nhận    │
│  Zmotion ZMC · Mitsubishi FX5U/Q · Techman/Fanuc · CNC · OpenPLC    │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Abstraction cốt lõi — `ProgrammingAdapter` (interface MỚI)

Song song với `EquipmentAdapter` (đã lo `sendCommand/readTelemetry/getState`). Mỗi target hãng/loại cài 1 `ProgrammingAdapter`:

```ts
interface ProgrammingAdapter {
  kind: ProgrammingKind            // 'zmotion-basic' | 'iec61131' | 'robot-tm' | 'gcode' | ...
  capabilities: ProgCapability     // { canCompile, canSimulate, canDownload, canUpload,
                                   //   canOnlineMonitor, canForce, canTeach, languages[] }

  validate(src: ProgramArtifact): Promise<Diagnostics>        // lint/parse, KHÔNG chạm HW
  compile(src: ProgramArtifact): Promise<BuildResult>         // → bytecode/binary/transferable
  simulate?(build: BuildResult, scenario): Promise<SimResult> // twin/emulator, KHÔNG chạm HW
  deploy(build: BuildResult, opts: DeployOpts): Promise<DeployResult> // ← gated: HITL + flag + staged
  upload?(target): Promise<ProgramArtifact>                   // đọc ngược chương trình từ thiết bị
  diff?(a, b): Promise<ProgramDiff>

  // realtime engineering (chỉ khi online)
  watch?(symbols: string[]): AsyncIterable<SymbolSample>      // tag/register watch streaming
  force?(symbol, value, opts): Promise<ForceResult>           // ← gated nặng, audit, auto-expire
}
```

**Nguyên tắc bất biến (kế thừa doc 08, KHÔNG nới):**
- `deploy()` / `force()` **luôn** đi qua HITL sign-off + flag (`DPC_DEPLOY_ENABLED`, mặc định OFF) + dry-run; mọi thao tác ghi `program_deployments` (append-only audit).
- Adapter **không tự** mở socket điều khiển ngoài cổng chung — telemetry/command vẫn mượn `EquipmentAdapter`/`commandDispatcher` đã có.
- **Safety không bao giờ** chạy trên Node/platform. Chương trình native (C-tier) chỉ deploy sang **runtime/PLC riêng**; logic E-stop/interlock/SIL ở PLC chứng nhận, ngoài phạm vi tự-sinh.

### 4.3 Ba nhóm đích (3 chiến lược build/deploy)

| Nhóm | Đích GĐ1 | Editor | Build/Deploy | Mức tự làm |
|---|---|---|---|---|
| **(A) Controller mở** | **Zmotion ZMC/VPLC** (BASIC + motion), G-code/CNC | Monaco (BASIC/Gcode) + motion-sequence block | **Trực tiếp**: gửi qua Ethernet/USB SDK (ZMC PCI/Ethernet cmd), download/upload chương trình | Cao — ta build path thật |
| **(B) Vendor đóng** | **Mitsubishi FX5U/Q** (GX Works) | Engineering UI: tag/device table, recipe/param, *(ladder native ở C nếu chọn OpenPLC route)* | **Wrap toolchain hãng**: gọi CLI/SDK/headless của GX Works để compile+transfer; ta KHÔNG viết lại compiler | Trung bình — wrapper + orchestrate |
| **(C) Native IEC 61131-3** | Ladder/ST/FBD → **OpenPLC / CODESYS-compatible runtime** | Blockly/graph (LD/FBD) + Monaco (ST) | **Tự editor → compile sang runtime mở** (OpenPLC ST → Matiec; hoặc xuất PLCopen XML) | Cao + dài — đây là phần tham vọng bạn chọn |
| **(Robot)** | **Techman** (mở rộng), Fanuc/MELFA/Delta | Teach/job list + script (TMSCT) + jog | TM: TMSCT/Listen-Node thật; hãng khác: từ scaffold → SDK | Trung bình |

> **Vì sao phân nhóm:** không có "một cách build" cho mọi hãng. Hãng đóng (Mitsubishi/Siemens) bắt buộc dùng toolchain của họ → **wrap, đừng tái tạo**. Controller mở (Zmotion) + runtime mở (OpenPLC) cho phép ta làm path thật, đầu-cuối. Native IEC 61131-3 chỉ thực tế khi đích là runtime mở — **không** cố nạp ladder tự-sinh vào PLC hãng đóng (rủi ro an toàn + không được chứng nhận).

### 4.4 Nâng cấp realtime feedback (đóng khoảng trống G6)

Tầng **Streaming Telemetry** mới, đặt cạnh polling 5s hiện có (không phá vỡ):
- OPC-UA **monitoredItem subscription** (thay vì poll), Modbus/MC **fast-scan** cho symbol đang watch (vd 50–200 ms khi Online Monitor mở), Zmotion realtime channel.
- Đẩy ra UI qua Socket.IO namespace mới `engineering:{machineId}` (watch table, scope). Tách khỏi luồng telemetry lưu DB để **không bơm 100ms vào TimescaleDB**.
- **Honest:** vẫn soft-RT. Mục tiêu là *engineering feedback* (xem giá trị/tune/debug), **không** phải vòng điều khiển hard-RT. Hard-RT ở thiết bị.

### 4.5 Mô hình an toàn (Safety) — không đổi, siết thêm cho "program"

1. **Tách author/execute:** platform author + simulate; thiết bị execute. Logic safety ở PLC chứng nhận.
2. **Staged deploy bắt buộc:** `validate → compile → simulate(twin/emulator) → HITL sign-off → deploy(STAGING) → verify → PROMOTE`. Có **rollback** về artifact trước (giữ N bản).
3. **Flag mặc định OFF:** `DPC_DEPLOY_ENABLED`, `DPC_ONLINE_FORCE_ENABLED`, `DPC_STREAMING_ENABLED`. Build/simulate luôn chạy; deploy/force cần bật + sign-off.
4. **`force()`** (ghi đè biến khi online): RBAC admin, auto-expire, banner cảnh báo, audit từng lần — như interlock approve hiện tại.
5. **Không tự-sinh logic safety:** AI/Copilot có thể gợi ý chương trình *quy trình*, **không bao giờ** sinh/deploy logic an toàn; con người ký.

---

## 5. Mô hình dữ liệu (schema MỚI)

| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `program_projects` | Workspace per device/cell (owner, deviceId, kind, defaultBranch) | RBAC module `device_programming` |
| `program_artifacts` | Phiên bản source (kind, language, content/blob, hash, branch, version, status: draft/validated/released/archived) | append-version, không sửa tại chỗ |
| `program_builds` | Kết quả compile (artifactId, adapterKind, ok, diagnostics[], outputBlobRef, durationMs) | |
| `program_deployments` | Audit deploy (buildId, deviceId, stage: staging/production, status, signedOffBy, rolledBackFrom) | **append-only** giống `commandLog` |
| `program_symbols` | Symbol/tag/variable table per project (name, address, dataType, comment, watchable, forceable) | nguồn cho Online Monitor |
| `program_sim_runs` | Kết quả simulate (buildId, scenario, ok, timeline, warnings) | tái dùng pattern `program_sim` của FOE |

Tái dùng: `device_adapters`/`device_tags` (đã có), `machines.capabilities`, migration runner `scripts/migrate-standalone.mjs`. Migration mới = **0130** (D0; 0129 đã dùng cho machine_layout).

---

## 6. Frontend MỚI (Unified Engineering Workspace)

| Thành phần | Lib | Mô tả |
|---|---|---|
| Code editor | **`monaco-editor`** (+`@monaco-editor/react`) | ST / Zmotion BASIC / G-code / robot script; syntax highlight + diagnostics từ `validate()` |
| Visual logic | **`blockly`** hoặc react-flow | Ladder/FBD + motion-sequence (nhóm C/A) |
| Project Explorer | có sẵn (tree) | branch/version/diff, gắn `program_projects` |
| Online Monitor | Socket.IO `engineering:` | watch table giá trị realtime, scope chart, nút Force (gated) |
| Robot Teach/Jog | mới | jog joint/cartesian, lưu point, build job list (Techman thật trước) |
| Deploy panel | tái dùng pattern Studio | build→simulate→sign-off→deploy→rollback, diff viewer |

Route mới đề xuất: `/engineering` (workspace), `/engineering/:projectId`. Thêm vào nav nhóm OT/Machine Control. RBAC module mới `device_programming` (canView/Create/Edit/Deploy/Force).

---

## 7. KẾ HOẠCH CHI TIẾT (phased — theo dõi & cập nhật)

> Mô thức giống E0–E5: mỗi phase 1 commit, flag OFF mặc định, tsc xanh, có test, vi/en/zh. Phần cứng **cuốn chiếu**: mỗi phase chạy được trên **emulator** trước (OpenPLC, ZMC sim, robot sim), validate HW thật khi có.

### Phase D0 — Nền tảng Programming (abstraction + data) ✅ ĐÃ XONG
- [x] `ProgrammingAdapter` interface + `programmingRegistry` (facade, song song equipmentRegistry) + `StubProgrammingAdapter` an toàn (0 phần cứng). `server/services/programming/programmingAdapter.ts`.
- [x] Schema `program_projects/artifacts/builds/sim_runs/deployments/symbols` (`drizzle/schema/programming.ts` + enums) + **migration 0130** (idempotent; 0129 đã dùng cho machine_layout).
- [x] `programmingService` (validate/compile/simulate + **DEPLOY GATE** HITL sign-off + staged + rollback + idempotent). `server/services/programming/programmingService.ts`.
- [x] Flags: `DPC_DEPLOY_ENABLED`, `DPC_STREAMING_ENABLED`, `DPC_ONLINE_FORCE_ENABLED` (đọc runtime, mặc định OFF).
- [x] tRPC `programmingRouter` (projects/artifacts CRUD + build/simulate + deploy gated + rollback + symbols) wired `routers.ts` key `programming`. RBAC tái dùng `machine_monitoring`(read)/`machine_control`(write).
- **Chấp nhận:** ✅ tsc EXIT=0; ✅ 14/14 test (gate flag-off→simulated, non-ok→rejected, idempotency, flag-on+sign-off→adapter.deploy gọi, flag-on+no-signoff→simulated/không gọi); ✅ 0 path ghi thiết bị (stub không có device path).

### Phase D1 — Unified Engineering Workspace (UI khung) ✅ ĐÃ XONG
- [x] Trang `/engineering` (`client/src/pages/EngineeringWorkspace.tsx`): Project Explorer + tạo project, Artifacts (versions) + lưu phiên bản, **CodeEditor** (`client/src/components/engineering/CodeEditor.tsx` — textarea + gutter + Tab, **monaco-swappable** qua component boundary), validate→diagnostics inline, build, simulate→timeline, Deploy panel (stage + sign-off + banner khi flag OFF), Deployments audit, Symbols table.
- [x] RouteGuard `/engineering` + nav `nav.engineeringWorkspace` (nhóm OT, perm `machine_control`) + i18n vi/en/zh.
- **Ghi chú thiết kế:** monaco **hoãn có chủ đích** (tránh rủi ro bundler/offline) — `CodeEditor` là ranh giới component để thay monaco sau mà không đụng page. RBAC tái dùng `machine_control`/`machine_monitoring` (không tạo module mới để khỏi khoá quyền — admin chạy ngay).
- **Chấp nhận:** ✅ tsc EXIT=0; ✅ locale vi/en/zh parse OK; flow tạo project→soạn→validate→build→simulate→(deploy SIMULATED) chạy trên router D0, chưa cần HW.

### Phase D2 — Zmotion adapter (nhóm A, controller mở) ✅ ĐÃ XONG (emulator)  ⟵ *ưu tiên 1*
- [x] `server/services/programming/zmotion/zmotionBasicAdapter.ts` — `ProgrammingAdapter` kind `zmotion-basic`, đăng ký vào `programmingRegistry`.
- [x] **THẬT (chạy không cần HW):** validate (lexer Zmotion-BASIC + block-balance + kiểm tra motion-op), compile (output `zmc://build/<checksum>` + meta moves/ops), simulate (timeline motion từ MOVE/MOVEABS…).
- [x] **FRAMEWORK trung thực (cần validate HW):** `ZmcLink` (TCP probe ZMC Ethernet) cho deploy/upload — gated; **không** giả "deployed": không endpoint→failed, unreachable→failed, reachable nhưng frame chưa validate→failed có lý do rõ. Caps `canDownload/canUpload/canOnlineMonitor/canForce`.
- **Còn lại (kéo sang sau khi có HW/SDK):** frame file-transfer ZMC thật, `watch()` realtime (gắn D6), editor motion-sequence block, telemetry Zmotion vào `EquipmentAdapter`, jog.
- **Chấp nhận:** ✅ tsc xanh; ✅ 8 test (validate/compile/simulate/deploy-guard/registry). Workspace dùng kind `zmotion-basic`: soạn→validate→build→simulate chạy; deploy gated (flag OFF). Field-map ZMC cần HW thật (đã ghi).

### Phase D3 — Mitsubishi engineering + toolchain wrap (nhóm B) ✅ ĐÃ XONG (emulator)  ⟵ *ưu tiên 2*
- [x] `server/services/programming/mitsubishi/mitsubishiEngineeringAdapter.ts` — kind `mitsubishi-engineering`, đăng ký registry.
- [x] **THẬT:** validate bảng device/recipe `<DEVICE> = <value>` (parse + kiểm tra cú pháp MELSEC X/Y/M/L/F/B/D/W/R/Z/T/C/S/V, hex cho X/Y/B/W); compile → param map `melsec://recipe/<checksum>`; simulate → preview ghi param từng bước.
- [x] **FRAMEWORK trung thực:** deploy chưa wire → `failed` có lý do rõ (đường thật: param-push qua `commandDispatcher` HITL/OT_CONTROL **hoặc** GX Works headless). caps `canDownload/canOnlineMonitor/canForce`.
- **Còn lại (cần HW/toolchain):** wire param-push qua commandDispatcher, GX Works CLI wrap, Online Monitor MC fast-scan (D6), upload. Ladder native → D5 (OpenPLC).
- **Chấp nhận:** ✅ tsc xanh; ✅ 8 test. Workspace kind `mitsubishi-engineering`: soạn recipe→validate→build→simulate. Tài liệu ghi rõ phần cần GX Works/HW.

### Phase D4 — Robot programming (Techman job-list + teach) ✅ ĐÃ XONG (emulator)  ⟵ *ưu tiên 3*
- [x] `server/services/programming/robot/robotTmAdapter.ts` — kind `robot-tm`, đăng ký registry.
- [x] **THẬT:** validate job-list (POINT defs + verbs MOVE/MOVEL/HOME/PICK/PLACE/GRIP/RELEASE/WAIT; kiểm tra point tham chiếu đã định nghĩa); compile → job descriptor `tm://job/<checksum>` + steps/points; simulate → timeline motion + dwell (WAIT theo `t=`).
- [x] **FRAMEWORK trung thực:** deploy chưa wire → `failed` rõ (đường thật: TMSCT push qua `robotCommandDispatcher` HITL/ROBOT_CONTROL). caps `canTeach/canDownload/canOnlineMonitor`. Fanuc/MELFA/Delta tái dùng shape khi driver rời scaffold.
- **Còn lại (cần HW):** Teach/Jog panel UI, point-table builder, wire TMSCT download, mở rộng hãng khác.
- **Chấp nhận:** ✅ tsc xanh; ✅ 8 test. Workspace kind `robot-tm`: soạn job→validate→build→simulate.

### Phase D5 — Native IEC 61131-3 (nhóm C) ✅ ĐÃ XONG (emulator)  ⟵ *phần tham vọng*
- [x] `server/services/programming/iec61131/` — 2 adapter: `iec61131-st` (Structured Text) + `iec61131-ld` (Ladder DSL: mỗi rung `OUT := <bool expr>`), đăng ký registry.
- [x] **THẬT:** ST validate (cân bằng VAR/END_VAR, IF/END_IF, FOR, WHILE; `:=`); LD validate (parse từng rung + parse biểu thức). compile cả hai → **transpile LD→ST** → output `openplc://{st,ld}/<checksum>` (matiec-compatible).
- [x] **Ladder simulate = THẬT:** `boolEval.ts` — parser đệ-quy an toàn (AND/OR/NOT/XOR/ngoặc, **không eval**) → **chạy 1 scan thực** với `assumedInputs`, scan-forward (output rung trước nuôi rung sau), tính output đúng. (ST simulate = preview trung thực, không giả chạy.)
- [x] **AN TOÀN (quy tắc cứng §4.5):** deploy chỉ tới **runtime MỞ** (OpenPLC); chưa cấu hình host → `failed` rõ; **KHÔNG bao giờ** nạp logic tự-sinh vào PLC hãng đóng, **không** sinh logic safety.
- **Còn lại:** editor Blockly/graph cho ladder (UI), compile thật qua matiec/PLCopen-XML, chạy trên OpenPLC host thật.
- **Chấp nhận:** ✅ tsc xanh; ✅ 10 test (boolEval AND/NOT/OR/XOR/unknown/malformed; ST balance; LD transpile; **LD one-scan tính Y0=X0·!X1, Y1=Y0+X2 đúng cả 2 ca**).

### Phase D6 — Streaming realtime feedback (đóng G6) 🔲
- [ ] OPC-UA monitoredItem subscription + fast-scan symbol đang watch; namespace Socket.IO `engineering:`.
- [ ] Scope chart + watch table realtime; tách khỏi đường lưu TimescaleDB.
- [ ] Flag `DPC_STREAMING_ENABLED`.
- **Chấp nhận:** Online Monitor cập nhật <200ms với symbol đã chọn; polling DB không đổi.

### Phase D7 — AI Engineering Copilot + hardening 🔲
- [ ] Copilot: giải thích/đề xuất chương trình quy trình, sinh skeleton ST/BASIC, **chỉ gợi ý** (HITL ký, không deploy, không sinh logic safety) — tái dùng `aiOrchestrationAdvisor` purity pattern.
- [ ] Marketplace/library mẫu chương trình per device-class; export/import project.
- [ ] Soak test, rollback drills, tài liệu vận hành + cập nhật `ADAPTER_SDK.md` (Programming SDK).

### Sơ đồ phụ thuộc
```
D0 ──► D1 ──► D2 (Zmotion)        ─┐
        │                          ├─► D6 (streaming) ─► D7 (AI + hardening)
        ├──► D3 (Mitsubishi)       │
        ├──► D4 (Robot)            │
        └──► D5 (IEC 61131-3) ─────┘
```

---

## 8. Phân công AI Agent (chỉ chạy SAU khi duyệt)

| Phase | Agent chuyên môn | Nhiệm vụ |
|---|---|---|
| D0 | backend/architecture | interface + schema + service + router, test |
| D1 | frontend | Monaco workspace, diff/version, RBAC/nav/i18n |
| D2 | backend (protocol) + frontend | Zmotion adapter + BASIC/motion editor + monitor |
| D3 | backend (protocol) | Mitsubishi engineering + toolchain wrap |
| D4 | robotics | teach/jog + TMSCT job builder |
| D5 | backend (compiler) + frontend | IEC 61131-3 editor + OpenPLC compile |
| D6 | backend (realtime) | streaming subscription + socket namespace |
| D7 | AI + QA | Copilot purity + hardening/docs |

Quy ước thực thi: mỗi phase tự chứa, flag OFF, tsc xanh, test kèm, vi/en/zh, **không** lift dry-run trừ khi có HW + bạn xác nhận. Mỗi phase xong → cập nhật §12.

---

## 9. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Tự-sinh logic safety gây nguy hiểm | 🔴 cao | Cấm tuyệt đối: safety ở PLC chứng nhận; native chỉ deploy runtime mở; con người ký |
| Toolchain hãng đóng (GX Works) không có API headless | 🟠 | Wrap CLI nếu có; nếu không → đường recipe/param + OpenPLC cho ladder; ghi rõ giới hạn |
| Field-map/SDK sai khi chưa có HW | 🟠 | Cuốn chiếu: emulator trước, đánh dấu "cần validate HW"; không bật control |
| IEC 61131-3 phình to (D5) | 🟠 | Giới hạn subset (LD/ST cơ bản) + đích OpenPLC; mở rộng sau |
| Streaming 100ms ngợp DB/UI | 🟡 | Tách kênh engineering khỏi đường lưu DB; chỉ watch symbol đã chọn |
| Node soft-RT bị hiểu nhầm là hard-RT | 🟡 | Tài liệu trung thực ở mọi nơi (như edgeRuntime hiện tại) |

## 10. Câu hỏi mở (cần chốt khi chạy)
- [ ] Có sẵn ZMC sim/emulator và SDK Ethernet của Zmotion để build D2 không? (nếu không → bắt đầu bằng giao thức được tài liệu hoá, validate HW sau)
- [ ] Môi trường có GX Works CLI/headless cho D3 không? Nếu không → ưu tiên đường OpenPLC cho ladder.
- [ ] Robot sim nào dùng cho D4 (Techman simulator?).
- [ ] Host edge cho OpenPLC runtime ở D5 (máy nào).

---

## 11. Lệnh đối chiếu trạng thái (definition of done toàn cục)
- [ ] D0–D7 commit lên `main`, tsc xanh, test kèm.
- [ ] Mọi flag mặc định OFF; migration 0129+ **chưa** chạy tới khi vận hành áp.
- [ ] Mỗi adapter có tài liệu field-map + "cần validate HW thật".
- [ ] Không có path nào ghi thiết bị ngoài `commandDispatcher`/`programmingService` (HITL+audit).
- [ ] `ADAPTER_SDK.md` cập nhật phần Programming Adapter.

## 12. Changelog (cập nhật khi thực thi)
| Ngày | Phase | Commit | Ghi chú |
|---|---|---|---|
| 2026-06-29 | — | — | Tạo doc 09 (DRAFT, chờ duyệt) |
| 2026-06-29 | — | — | Người dùng DUYỆT toàn bộ D0–D7; phần cứng/SDK cài sau (cuốn chiếu, emulator trước) |
| 2026-06-29 | **D0** | `7aef0a3` | Programming foundation: ProgrammingAdapter+registry+stub, schema+migration 0130, programmingService (deploy gate), programmingRouter wired. tsc xanh, 14/14 test. Flags OFF, migration chưa chạy. |
| 2026-06-29 | **D1** | `85b64f5` | Unified Engineering Workspace /engineering + CodeEditor (monaco-swappable) + route/nav/i18n. tsc xanh, locale OK. monaco hoãn (component boundary sẵn). |
| 2026-06-29 | **D2** | `bc08bd0` | Zmotion BASIC adapter: validate/compile/motion-simulate THẬT + ZmcLink deploy/upload framework trung thực (gated, không giả deployed). 8 test, tsc xanh. Cần HW cho frame ZMC + watch. |
| 2026-06-29 | **D3** | `d6b8607` | Mitsubishi engineering adapter: MELSEC device/recipe validate+compile+simulate THẬT; deploy framework trung thực (param-push/GX Works chưa wire→failed rõ). 8 test, tsc xanh. |
| 2026-06-29 | **D4** | `33e95bc` | Robot Techman job-list adapter: teach-point/job validate+compile+simulate THẬT; TMSCT deploy framework trung thực. 8 test, tsc xanh. |
| 2026-06-29 | **D5** | _(đang commit)_ | Native IEC 61131-3: ST + Ladder adapters; boolEval an toàn; **LD one-scan eval THẬT**; LD→ST transpile→OpenPLC; deploy chỉ runtime mở (gated). 10 test, tsc xanh. |
| | … | | |
