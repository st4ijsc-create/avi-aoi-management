# 21 — Audit Tầng-Trên Hệ Sinh Thái: Đánh giá & Kế hoạch Nâng cấp

> Audit các tầng TRÊN tầng phần cứng — trả lời 3 câu hỏi: (1) tầng-trên đủ mạnh/linh hoạt/đủ chức năng để đạt mức "ecosystem" chưa? (2) quản lý hệ sinh thái có nhìn được TOÀN CẢNH không? (3) frontend cho máy & robot đã hoàn chỉnh chưa?
> Ngày: 2026-07-01 · Nhánh: `automation-orchestration-r0` · Đầu vào: 3 agent audit song song (A quản lý toàn cảnh · B frontend máy/robot · C kiến trúc tầng-trên).
> **Tài liệu chờ DUYỆT** trước khi gọi agent chuyên môn thực thi.

---

## 1. Kết luận điều hành (một câu)

**Hệ thống có "bộ xương" đạt chuẩn ecosystem, nhưng "trải nghiệm" và "sự gắn kết" ở tầng-trên thì chưa.** Spine mạnh (capability/PackML model, unified telemetry bus, event bus, `/api/v1`, tenant-RLS, governance có conformance) — nhưng **các module mới (fleet/safety/twin/IR/PdM/anomaly) đang bị "gắn rời", không dệt vào spine**; **không có một màn hình toàn cảnh (single pane of glass)**; và **không có cockpit hợp nhất cho từng máy/robot**. Nói ngắn: *xương đủ, cơ bắp mới rời, chưa có "khuôn mặt" điều hành.*

**3 chủ đề khoảng cách lớn:**
1. **Gắn kết (integration debt)** — module mới là các ốc đảo: không phát event, không có luồng cảnh báo hợp nhất, không lên `/api/v1`, không federate, không lái các overview.
2. **Quản lý toàn cảnh** — không có Ecosystem Command Center; ~16 dashboard phân mảnh; fleet không live.
3. **Cockpit từng-thiết-bị** — không có trang chi tiết máy/robot hợp nhất; drill/cross-link gãy; robot không live.
Cộng thêm nợ **linh hoạt/mở rộng** (registry hard-code, singleton in-process, lỗ tenant, soft-FK).

---

## 2. Câu hỏi 1 — Kiến trúc tầng-trên đủ mạnh/linh hoạt chưa? (Agent C)

**Verdict: "Bộ khung xuất sắc, cơ bắp mới bị gắn rời."** Scorecard:

| Chiều | Đánh giá | Bằng chứng |
|---|---|---|
| Extensibility / plugin | 🟡 Adequate (mixed) | Chỉ `ot/driverRegistry` là plug-in thật; `equipmentAdapter.ADAPTER_KINDS`, `capabilityModel.AdapterKind`, `programmingAdapter.PROGRAMMING_KINDS`, `shared/module-registry.SYSTEM_MODULES` đều **hard-code** — thêm kind/module = sửa 4–6 file core. `ADAPTER_SDK.md` tự thừa nhận "core change, reviewed". |
| **Golden-thread cohesion** | 🔴 **Weak** | `eventBus` chỉ 5 publisher/5 subscriber. `order.created→fleetOrchestrator` rồi **chết** (không có `task.completed`). `SAFETY_EVENT` + `quality_gate.breach` phát ra **0 subscriber**. Twin/IR/PdM/Anomaly/Governance **không phát gì**. |
| Multi-tenant + federation của layer mới | 🟡 tenancy Adequate / federation Weak | Fleet/safety/twin/standards có `corporateCode+factoryId`+RLS. NHƯNG `programming.ts` (IR), `ai.ts` (anomaly), `mes.ts` (PdM) **không có cột tenant / RLS**. Aggregator chỉ roll-up **1 category "overall"**; fleet/safety/twin/IR/PdM/anomaly **single-site**. |
| Open API / SDK | 🟡 Adequate (hẹp) | `/api/v1` chỉ phủ equipment/ingest/orchestration/edge/ERP. Fleet/safety/twin/IR/PdM/anomaly/governance **chỉ tRPC nội bộ** — bên thứ ba không dùng được. |
| Data-model coherence | 🟡 Adequate | Spine mạnh, nhưng quan hệ là **soft-ref** (`integer("machineId")` + index, **không** `.references()` FK) — toàn vẹn do app enforce, chỉ 4 schema dùng FK thật. |
| Governance & lifecycle | 🟢 Strong | `deviceTypeRegistry` (inheritance + SemVer), `conformanceTest` (fixture rule), chạy CI — đạt chuẩn ecosystem. |
| Rigidity / scale | 🔴 Weak | `eventBus`/`telemetryBus` là singleton in-process (**Redis fan-out chưa nối** — trần 1 server); `routers.ts` ~159 router hand-wire; federation là puller 1-KPI cố định. |

**Giữ (đã đạt chuẩn):** capability/PackML model · telemetry bus · governance conformance · bất biến HITL/dry-run · kỷ luật tenant trên Khối 2/3/7.

---

## 3. Câu hỏi 2 — Quản lý có nhìn được TOÀN CẢNH không? (Agent A)

**Verdict: KHÔNG có single pane of glass — chỉ là bộ sưu tập ~16 pane.**

- **Không có Ecosystem Command Center** hiển thị đồng thời-live: site → factory → line → station → machine → robot + status + task fleet + alarm chuẩn hóa + safety + AI + material/order + energy. Các ứng viên gần nhất mỗi cái chỉ phủ 1 lát: DigitalTwinCenter (1 factory, view-only, không alarm/order/energy), OpsConsole (chỉ alarm, không device/robot/OEE/task live), Dashboard (1 factory quality/OEE), FederationDashboard (site scoreboard poll, không drill/alarm).
- **Không có luồng cảnh báo LIVE hợp nhất** — ~8 tên event (`inspection:alert`/`andon:event`/`safety:event`/`spc:violation`/`alert:escalation`/`maintenance:alert`/`downtime:*`/`oee:update`), mỗi cái 1 trang tiêu thụ; **NotificationCenter toàn cục chỉ nghe `inspection:alert`** — safety/andon/SPC/escalation không tới. `eventBus` server-side có shape `DomainEvent` chuẩn nhưng **in-process, không re-broadcast xuống client**.
- **Fleet không live** — poll-only, **không phát socket nào** → robot/AMR/task vô hình với mọi overview.
- **Federation = scoreboard site-level, không panorama:** không drill site→factory→device (chỉ deep-link mở app site khác tab mới); `siteClient` fetch `details[]` rồi **vứt đi**; roll-up chỉ `category:"overall"`; **OEE luôn N/A** (`siteClient.ts:194` hard-code null); alert không aggregate; **không có `site:` socket room**.
- **Phân mảnh vẫn còn** (doc 12 "11 dashboard" → nay ~16): 2 twin surface (2D `/digital-twin` vs 3D `/digital-twin-center`), OEE ở 3 nơi, WIP ở 3 nơi, 4–5 trang quản lý dashboard.
- **Backbone linh hoạt (capability/device-type registry) không lái overview nào** — thêm device type mới KHÔNG tự xuất hiện trên bất kỳ command surface; mỗi dashboard hard-code query máy/OT/robot.
- **Bug tiềm ẩn:** `useRealtimeDashboard` mở socket THỨ HAI nghe event server không phát (dead hook); `emitMqttMessage` gửi `machine:${machineCode}` trong khi room keyed theo `machineId` (lạc room); `alert:escalation`/`machine:model_available` emit-only.

---

## 4. Câu hỏi 3 — Frontend máy & robot đủ hoàn chỉnh chưa? (Agent B)

**Verdict: KHÔNG có cockpit hợp nhất cho máy, KHÔNG có cho robot** — rải rác 6–9 trang đảo.

Ma trận hoàn chỉnh (rút gọn): mỗi facet nằm ở 1 trang khác nhau, **không trang nào gộp được nửa số facet**.

| Facet | MÁY | ROBOT |
|---|---|---|
| Identity + capability (per-instance) | 🟡 chỉ name/type/location | 🟡 chỉ code/vendor/kind |
| Live telemetry (UDM đầy đủ) | 🔀 sparkline (UnifiedDeviceMonitor) + UDM (FieldDevices) 2 trang | 🔀 RobotControl + FieldDevices (joint/battery/zone/firmware) 2 trang |
| Health/PdM | ✅ MachineHealthMonitoring (trang riêng) | ❌ không có PdM robot |
| OEE | ✅ OEEDashboard (trang riêng) | — |
| Recipe+version | 🔀 không lọc theo máy | — |
| Alarm chuẩn hóa (ISA-18.2) | 🟡 không có danh sách per-máy | 🟡 chỉ estop/errorText |
| Program/IR + deploy | 🔀 IrEditor (không chọn được robot) | 🔀 IrEditor không robot-scoped |
| Genealogy | 🟡 load-history recipe | ❌ chỉ job log |
| 3D/twin | 🟡 whole-scene, không per-device | 🟡 không có joint/pose viz |
| Teach/jog | ❌ | 🟡 TeachJogPanel **chỉ preview local**, chôn trong EngineeringWorkspace |
| Safety zone/reaction | 🟡 SafetyWorkforce | 🟡 zone_id raw |
| Behavior anomaly | 🟡 card | ✅ RobotModelHealth (trang riêng) |

**Gãy nghiêm trọng:**
- **Không có route `/machine/:id` hay `/robot/:id`** — không có trang chi tiết per-asset.
- **Cross-link không mang id** — Fleet hiện `assignedDeviceId` nhưng không click được; FactoryLiveMap3D drill nhưng đích mở un-scoped; `/machine-status` **redirect vòng về `/device-monitor` (dead-end)**; MachineStatusMonitor dialog giàu nhất giờ **mồ côi**.
- **QR scan → `/ai-chat?machine=` (trợ lý)**, không phải trang máy — dù đã parse `.../machine/<code>` nhưng không route nào phục vụ.
- **Realtime phân mảnh** — RobotControl/FieldDevices/FleetOrchestration/RobotModelHealth dùng `useQuery` **không refetchInterval** (tĩnh tới khi refetch tay); **robot telemetry KHÔNG nối socket** dù X1 đã có cột joint/heartbeat.
- **Không per-robot twin** (joint/pose kinematics), dù T2b/T2a đã có FK chain + glTF.

---

## 5. Bảng khoảng cách hợp nhất (xếp hạng)

| # | Khoảng cách | Nguồn | Mức | Đòn bẩy |
|---|---|---|---|---|
| G-1 | **Event loop hở** — fleet/PdM/anomaly/IR/twin không phát event; SAFETY_EVENT/quality_gate.breach 0 subscriber; NotificationCenter điếc | C, A | 🔴 Cao | RẤT cao — bus đã có sẵn |
| G-2 | **Không có luồng alarm LIVE hợp nhất** xuống client (eventBus không re-broadcast) | A, C | 🔴 Cao | Cao |
| G-3 | **Không có Ecosystem Command Center** (toàn cảnh live đa-tầng) | A | 🔴 Cao | Cao |
| G-4 | **Không có cockpit `/machine/:id` & `/robot/:id`**; drill/cross-link/redirect/QR gãy | B | 🔴 Cao | Cao (thuần aggregation) |
| G-5 | **Robot/Fleet không live** (không socket) dù schema đã sẵn | A, B | 🟠 TB | TB |
| G-6 | **`/api/v1` không expose** fleet/safety/twin/IR/PdM/anomaly/governance | C | 🟠 TB | TB |
| G-7 | **Federation 1-KPI, không drill/alert/OEE**, `details[]` bị vứt, không `site:` room | A, C | 🟠 TB | TB |
| G-8 | **Registry hard-code** (adapter/kind/module) — thêm mới = sửa core | C | 🟠 TB | TB |
| G-9 | **Lỗ tenant/RLS**: programming(IR)/anomaly/PdM | C | 🟠 TB | Thấp (schema) |
| G-10 | **Singleton in-process** (eventBus/telemetryBus) — trần 1 server | C | 🟡 Thấp* | *cao khi scale ≥2 site |
| G-11 | **Phân mảnh dashboard ~16** (2 twin, OEE×3, WIP×3) | A | 🟡 Thấp | TB |
| G-12 | **Soft-FK** (không `.references()`) + bug socket dead-code | C, A | 🟡 Thấp | Thấp |

---

## 6. KẾ HOẠCH NÂNG CẤP (chờ duyệt)

Gom theo chủ đề, ưu tiên theo **đòn bẩy** (G-1 mở khóa mọi thứ). Mọi pha giữ kỷ luật: flag OFF mặc định · không mở đường điều khiển mới · typecheck + vite build + test xanh · migration additive · seam trung thực.

| Pha | Tên | Nội dung | Đóng gap | Phụ thuộc |
|---|---|---|---|---|
| **U1** | **Event Backbone hợp nhất** *(đòn bẩy cao nhất)* | Cho fleet (`task.assigned/completed`), PdM (`workorder.created`), anomaly (`anomaly.detected`), IR (`program.deployed`), twin (derived state) **phát domain event**. Thêm subscriber cho `SAFETY_EVENT` + `quality_gate.breach` (webhook fan-out + rulesEngine + KB ingest). **Re-broadcast eventBus → client** dưới 1 event chuẩn hóa `alerts:stream` + `ecosystem:event`. Sửa bug socket dead-code (dup socket, machineCode/id mismatch). | G-1, G-2, G-12 | — |
| **U2** | **Ecosystem Command Center** (`/command-center`) | 1 màn hình toàn cảnh: **cây phân cấp live** site→factory→line→station→machine→robot (định nghĩa node lái bởi `deviceTypeRegistry`/capability → device type mới tự xuất hiện; site lái bởi federation rollup) · **twin 3D** factory chọn (nhúng DigitalTwinCenter, overlay fleet task + safety zone) · **rail cảnh báo live hợp nhất** (từ U1 `alerts:stream`) · **KPI strip** (oee:update/WIP/energy/AI insight). Thay 5 query polled của OpsConsole bằng 1 feed live. | G-3, G-2 | U1 |
| **U3** | **Machine & Robot Cockpit** | `/machine/:id` — gộp identity+capability resolved, live UDM+PackML, health/PdM, OEE, alarm chuẩn hóa per-máy (query mỏng mới), recipe+version+deploy per-máy, genealogy, 3D model, control gated, timeline. `/robot/:id` — telemetry+UDM đầy đủ (joint/battery/estop/zone), **joint/pose viz + per-robot twin**, job+task, IR robot-selectable, **teach/jog nối gate thật** (thay preview local), safety zone, anomaly. **Wire robot telemetry lên socket**; sửa redirect dead-end + QR→`/machine/:code`; mọi list/scene navigate mang id + back. | G-4, G-5 | U1 (live), (T2a/T2b cho joint viz đã có) |
| **U4** | **Mở nền tảng (API + registry data-driven)** | Extend `/api/v1` + scopes cho fleet/safety/twin/IR/PdM/anomaly/governance (ít nhất read). Chuyển `ADAPTER_KINDS`/`PROGRAMMING_KINDS`/`SYSTEM_MODULES` sang **manifest register-and-go** (như `driverRegistry`) → thêm vendor/kind/module không sửa core. | G-6, G-8 | — |
| **U5** | **Federation Panorama** | `siteClient` **giữ `details[]`** + rollup per-`category` (schema đã có cột) + tiêu thụ endpoint `events` per-site (alert roll-up) + `site:` socket room; tổng quát roll-up sang fleet/safety/twin/PdM. Drill site→factory→device trong Command Center (U2). | G-7 | U1, U2 |
| **U6** | **Tenant + Scale hardening** | Backfill tenant cột + RLS cho `programming.ts`/`ai.ts`(anomaly)/`mes.ts`(PdM). Nối **Redis fan-out** sau eventBus/telemetryBus (bỏ trần 1-server). Cân nhắc FK thật hoặc contract soft-ref + integrity check cho asset↔task↔program↔genealogy. | G-9, G-10, G-12 | — |
| **U7** | **Hợp nhất dashboard** | Dedupe: gộp 2 twin surface, OEE×3→1 nguồn, WIP×3→1, dọn 4–5 trang quản lý dashboard; redirect trang trùng về Command Center/cockpit (theo nguyên tắc doc 12). | G-11 | U2, U3 |

**Thứ tự khuyến nghị:** `U1` (backbone) → `U2` + `U3` (song song, đều tiêu thụ U1) → `U4`/`U5` → `U6`/`U7`.

**Ước lượng đòn bẩy:** U1+U2+U3 giải quyết ~80% cảm nhận "chưa đạt ecosystem/toàn cảnh/cockpit" của bạn; U4–U7 là hardening để bền vững khi scale.

---

## 7. Bước kế tiếp

Bạn **review §6** → chọn phạm vi + thứ tự (làm hết, hay bắt đầu U1→U2→U3, hay chỉ một phần) → tôi gọi các agent chuyên môn thực thi từng pha (flag OFF, commit từng pha, cổng test+build, không đụng phần cứng).

**Điểm mạnh cần giữ nguyên khi nâng cấp:** capability/PackML model, unified telemetry bus, governance conformance, bất biến HITL/dry-run, kỷ luật tenant Khối 2/3/7 — mọi nâng cấp phải nâng phần yếu LÊN ngang các chuẩn này, không hạ chuẩn.
