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
| Extensibility / plugin | ✅ **Good (U4b)** | Đã chuyển sang **register-and-go** cho cả 4 family: `registerEquipmentAdapter` / `registerCapabilityProfile` / `registerProgrammingAdapter` / `registerModule` (mirror `ot/driverRegistry`). Kind/class/module hiện có seed tại load → resolve y hệt; thêm mới = 1 lệnh `register…()`, không sửa core. `ADAPTER_SDK.md §8` thay caveat "core change, reviewed". *(Trước U4b: `ADAPTER_KINDS`/`AdapterKind`/`PROGRAMMING_KINDS`/`SYSTEM_MODULES` hard-code — thêm = sửa 4–6 file core.)* |
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
| G-6 | ✅ **ĐÃ ĐÓNG (U4a)** — `/api/v1` giờ expose READ cho fleet/safety/twin/programs/PdM/anomaly/governance + roll-up/cockpit (7 scope mới, 18 endpoint, reuse service, read-only) | C | 🟠 TB | TB |
| G-7 | ✅ **ĐÃ ĐÓNG (U5)** — Federation deepened: `siteClient` **giữ `details[]`** (không còn vứt) → drill site→station→device; rollup **per-`category`** (overall+inspection+oee+fleet+safety+pdm, dùng cột `category` sẵn có); **OEE thật** (feed `/api/external/oee/summary`, honest-null khi vắng); **alert roll-up** (feed `/api/external/alerts/summary` = andon+safety) → `federation.alertRollup()`; **`site:` socket room** (`site:{code}`+`sites:global`, emit `site:update` mỗi cycle); 3 procedure mới `siteDetail`/`alertRollup`/`categoryRollup`. Migration **0155** (3 cột jsonb additive). | A, C | 🟠 TB | TB |
| G-8 | ✅ **ĐÃ ĐÓNG (U4b)** — Registry hard-code (adapter/kind/module) → 4 registry data-driven `register…()` (register-and-go), behavior-preserving, union type giữ nguyên | C | 🟠 TB | TB |
| G-9 | **Lỗ tenant/RLS**: programming(IR)/anomaly/PdM | C | 🟠 TB | Thấp (schema) |
| G-10 | **Singleton in-process** (eventBus/telemetryBus) — trần 1 server | C | 🟡 Thấp* | *cao khi scale ≥2 site |
| G-11 | **Phân mảnh dashboard ~16** (2 twin, OEE×3, WIP×3) | A | 🟡 Thấp | TB |
| G-12 | **Soft-FK** (không `.references()`) + bug socket dead-code | C, A | 🟡 Thấp | Thấp |

---

## 6. KẾ HOẠCH NÂNG CẤP (chờ duyệt)

Gom theo chủ đề, ưu tiên theo **đòn bẩy** (G-1 mở khóa mọi thứ). Mọi pha giữ kỷ luật: flag OFF mặc định · không mở đường điều khiển mới · typecheck + vite build + test xanh · migration additive · seam trung thực.

| Pha | Tên | Nội dung | Đóng gap | Phụ thuộc |
|---|---|---|---|---|
| **U1** ✅ | **Event Backbone hợp nhất** *(đòn bẩy cao nhất)* | Cho fleet (`task.assigned/completed`), PdM (`workorder.created`), anomaly (`anomaly.detected`), IR (`program.deployed`), twin (derived state) **phát domain event**. Thêm subscriber cho `SAFETY_EVENT` + `quality_gate.breach` (webhook fan-out + rulesEngine + KB ingest). **Re-broadcast eventBus → client** dưới 1 event chuẩn hóa `alerts:stream` + `ecosystem:event`. Sửa bug socket dead-code (dup socket, machineCode/id mismatch). | G-1, G-2, G-12 | — |
| **U2** ✅ | **Ecosystem Command Center** (`/command-center`) | 1 màn hình toàn cảnh: **cây phân cấp live** site→factory→line→station→machine→robot (định nghĩa node lái bởi `deviceTypeRegistry`/capability → device type mới tự xuất hiện; site lái bởi federation rollup) · **twin 3D** factory chọn (nhúng DigitalTwinCenter, overlay fleet task + safety zone) · **rail cảnh báo live hợp nhất** (từ U1 `alerts:stream`) · **KPI strip** (oee:update/WIP/energy/AI insight). Thay 5 query polled của OpsConsole bằng 1 feed live. | G-3, G-2 | U1 |
| **U3** ✅ (BE §11 · FE §12) | **Machine & Robot Cockpit** | `/machine/:id` — gộp identity+capability resolved, live UDM+PackML, health/PdM, OEE, alarm chuẩn hóa per-máy (query mỏng mới), recipe+version+deploy per-máy, genealogy, 3D model, control gated, timeline. `/robot/:id` — telemetry+UDM đầy đủ (joint/battery/estop/zone), **joint/pose viz + per-robot twin**, job+task, IR robot-selectable, **teach/jog nối gate thật** (thay preview local), safety zone, anomaly. **Wire robot telemetry lên socket**; sửa redirect dead-end + QR→`/machine/:code`; mọi list/scene navigate mang id + back. | G-4, G-5 | U1 (live), (T2a/T2b cho joint viz đã có) |
| **U4** | **Mở nền tảng (API + registry data-driven)** | Extend `/api/v1` + scopes cho fleet/safety/twin/IR/PdM/anomaly/governance (ít nhất read). Chuyển `ADAPTER_KINDS`/`PROGRAMMING_KINDS`/`SYSTEM_MODULES` sang **manifest register-and-go** (như `driverRegistry`) → thêm vendor/kind/module không sửa core. | G-6, G-8 | — |
| **U4a** ✅ (API) | **Mở `/api/v1` cho module tầng-trên (READ)** — đóng **G-6** | 7 scope mới (`fleet/safety/twin/programs/pdm/anomaly/standards:read`) + tái dùng `equipment:read` cho roll-up/cockpit. 18 endpoint READ mới trong `server/api/v1/moduleReads.ts`, **tái dùng đúng service function** mà router tRPC gọi (không nhân đôi logic): fleet (`GET /fleet/tasks`,`/fleet/zones`), safety advisory (`/safety/events`,`/safety/zones`), twin (`/twin/scene-graph?factoryId`,`/twin/models`), programs (`/programs`,`/programs/:id/deployments`), pdm (`/pdm/risk?machineId`), anomaly advisory (`/anomaly/events`), standards (`/standards/device-types`,`/alarm-taxonomy`,`/compliance`), roll-up toàn cảnh (`/ecosystem/hierarchy`,`/ecosystem/kpi`), cockpit (`/machines/:id/detail`,`/robots/:id/detail`). **READ-ONLY tuyệt đối** — mọi ACTION (create task, deploy build, record safety event, publish device type, rollback model, ack anomaly) **cố ý giữ sau luồng gated tRPC hiện có** (perm+flag+HITL), KHÔNG mở đường điều khiển mới. OpenAPI (`/openapi.json`) tài liệu hóa đủ 18 path + 7 scope. Không migration, không dep mới, không flag mới (scope là grant trên api_keys). Tests: `moduleReads.test.ts` (21) — 401/403/200 mỗi endpoint, envelope, honest empty, 400 thiếu param, 404 absent, chứng minh reuse service; api/v1 full xanh (52), `npm run check` xanh. | G-6 | — |
| **U4b** ✅ (registry) | **Registry data-driven (register-and-go)** — đóng **G-8** | 4 registry theo family (mirror `ot/driverRegistry`): **equipment adapter** (`registerEquipmentAdapter`), **capability profile** (`registerCapabilityProfile`, 17 class seed), **programming adapter** (`registerProgrammingAdapter`), **module** (`registerModule`, `SEED_MODULES` seed). Mọi kind/class/module hiện có **seed tại load → resolve y hệt** (behavior-preserving); union type giữ nguyên cho type-safety. Thêm vendor/kind/module = 1 lệnh `register…()`, không sửa core switch/array. Tests: `registryU4b.test.ts` (equipment 9 + programming 5) + `module-registry.test.ts` chứng minh parity + new-kind register-and-go + unknown vẫn báo lỗi trung thực; full equipment/programming/standards/fleet regression xanh (258 tests). Doc: `ADAPTER_SDK.md §8`. **API `/api/v1` phần U4 do agent song song.** | G-8 | — |
| **U5** ✅ (BE) | **Federation Panorama** — đóng **G-7** | **Data-loss đã sửa:** `siteClient.fetchSiteKpis` **giữ `details[]`** (per-machine/station rows, trước bị fetch-rồi-vứt ở ~135) vào `SiteKpiSnapshot.detailRows`; **OEE thật** (không còn hard-code `oee:null` ở ~194) qua feed `/api/external/oee/summary` (units-weighted avg của live OEE), honest-null khi site cũ 404. **Rollup per-`category`** (dùng cột `category` sẵn có — KHÔNG cần cột mới cho nó): `rollupStore.upsertSnapshot` ghi hàng `overall`+`inspection`+`oee` (luôn) + `fleet`/`safety`/`pdm` (CHỈ khi feed trả lời → honest absence, không bịa hàng 0). **Alert roll-up:** feed `/api/external/alerts/summary` (andon chưa-resolve + safety non-near-miss=critical + near-miss) → `alertRollup` jsonb trên hàng `overall` → procedure `federation.alertRollup()` (tổng open/critical/nearMiss + top-N, `sitesWithAlertFeed` = cơ sở trung thực). **`site:` live layer:** room `site:{code}` + `sites:global`; aggregator emit `site:update` (freshness + headline KPI + alert counts) mỗi cycle poll thành công (gated bởi flag aggregator; error-isolated). **Tổng quát hoá:** `metrics` jsonb bag (fleet/safety/pdm) + 3 procedure mới `siteDetail({siteCode})` (drill station→device từ detailRows), `alertRollup()`, `categoryRollup({category})`. **Feeds site-side mới** (đọc-only, cùng auth `/api/external/*`): `oee`/`fleet`/`safety`/`pdm`/`alerts` summary. **Migration 0155** (additive/idempotent): 3 cột jsonb `detailRows`/`alertRollup`/`metrics` trên `site_kpi_rollup` (KHÔNG chạy). Giữ nguyên circuit-breaker/allSettled/staleness/read-only. Tests: `federationPanorama` (5) + `aggregatorSiteUpdate` (3) + `federationPanoramaRouter` (4) — details retained, per-category, real-OEE+honest-null, alert aggregate, Down/Stale honest, site:update emit, flag-off no-op; federation+ecosystem full xanh (57), `npm run check` xanh. **Còn lại (FE, U2):** Drill site→factory→device trong Command Center UI + subscribe `site:update`. | G-7 | U1, U2 |
| **U6** | **Tenant + Scale hardening** | Backfill tenant cột + RLS cho `programming.ts`/`ai.ts`(anomaly)/`mes.ts`(PdM). Nối **Redis fan-out** sau eventBus/telemetryBus (bỏ trần 1-server). Cân nhắc FK thật hoặc contract soft-ref + integrity check cho asset↔task↔program↔genealogy. | G-9, G-10, G-12 | — |
| **U7** ✅ (§15) | **Hợp nhất dashboard** | Phân loại 16 surface (CANONICAL/REDIRECT/KEEP-DIFFERENTIATED). Chỉ redirect **true dup** (`/custom-dashboard` → hub `dashboard-center` đã embed sẵn); giữ mọi view khác-biệt (2 twin, OEE, WIP-dispatch vs MES hub, drill/corporate/production — router+audience riêng, KHÔNG mất what-if/dispatch) + **cross-link** chúng về Command Center/nhau. Bảo toàn 100% chức năng. | G-11 | U2, U3 |

**Thứ tự khuyến nghị:** `U1` (backbone) → `U2` + `U3` (song song, đều tiêu thụ U1) → `U4`/`U5` → `U6`/`U7`.

**Ước lượng đòn bẩy:** U1+U2+U3 giải quyết ~80% cảm nhận "chưa đạt ecosystem/toàn cảnh/cockpit" của bạn; U4–U7 là hardening để bền vững khi scale.

---

## 7. Bước kế tiếp

Bạn **review §6** → chọn phạm vi + thứ tự (làm hết, hay bắt đầu U1→U2→U3, hay chỉ một phần) → tôi gọi các agent chuyên môn thực thi từng pha (flag OFF, commit từng pha, cổng test+build, không đụng phần cứng).

**Điểm mạnh cần giữ nguyên khi nâng cấp:** capability/PackML model, unified telemetry bus, governance conformance, bất biến HITL/dry-run, kỷ luật tenant Khối 2/3/7 — mọi nâng cấp phải nâng phần yếu LÊN ngang các chuẩn này, không hạ chuẩn.

---

## 8. U1 — Unified Event Backbone (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. ADDITIVE + backward-compatible: mọi event name / subscriber cũ giữ nguyên; publish mới là fire-and-forget error-isolated; luồng client là NEW event, không thay thế. Redis fan-out vẫn để lại cho U6. `twin.derived` để lại optional (chưa nối producer).

### 8.1 Taxonomy — envelope chuẩn hóa (`EcosystemEvent`)
Một envelope gọn duy nhất mọi event class map vào (server: `server/services/ecosystem/ecosystemEvents.ts`; client mirror: `client/src/hooks/useEcosystemEvents.ts`):
```
{ id, ts, kind, severity, source, scope:{siteCode?,factoryId?,machineId?,robotId?,lineId?}, title, detail? }
```
- **severity**: `info | low | medium | high | critical`.
- **kind**: `inspection | andon | safety | spc | quality_gate | escalation | maintenance | downtime | oee | task | workorder | anomaly | program | twin | ng | yield | event`.
- **alert-class** (đẩy thêm lên `alerts:stream`): inspection, andon, safety, spc, quality_gate, escalation, maintenance, anomaly, ng, yield.

### 8.2 Producers phát gì (U1-a)
| Module | Event mới | Điểm phát |
|---|---|---|
| Fleet | `task.assigned` | `taskAllocator.allocateTask` (success) + `fleetRouter.assign` |
| Fleet | `task.completed` / `task.failed` | `fleetRouter.completeTask` (mutation MỚI) + `task.failed` trong `rebalanceDeviceTasks` |
| PdM | `workorder.created` | `pdmAutoWorkOrderService.maybeCreatePredictiveWorkOrder` (sau insert) |
| Anomaly | `anomaly.detected` | `robotBehaviorAnomalyService.persistAndRaise` (robot) + `aoiImageEmbeddingWorker.runAnomalyAndEscalation` (image, chỉ khi isAnomaly) |
| IR/Programming | `program.deployed` | `programmingService.deployBuild` (mọi deployment: deployed/simulated/rejected) |
| Twin | `twin.derived` | helper `publishTwinDerived` sẵn sàng — **chưa nối producer** (optional) |

Publish qua helper typed fire-and-forget (`publishTaskEvent/publishWorkOrderCreated/publishAnomalyDetected/publishProgramDeployed`) — không bao giờ ném vào producer.

### 8.3 Subscribers cho event mồ côi + mới (U1-b)
- **Webhook fan-out**: `installEcosystemEventBridge` subscribe `safety.event`, `quality_gate.breach`, `anomaly.detected`, `workorder.created`, `task.*`, `program.deployed` → forward `ecosystem.<kind>` qua `webhookBridge.emit` (vẫn gated `WEBHOOKS_ENABLED`).
- **KB ingest**: các kind "significant" (safety/workorder/program/quality_gate/anomaly) → `ingestKnowledgeRecordAsync` (vẫn gated `RAG_AUTO_INGEST_ENABLED`) để AI "biết".
- **Orchestration (HITL)**: `rulesEngine` thêm advisory trigger cho `safety.event` + `anomaly.detected` (chỉ high/critical) → audit + notify + republish `orchestration.triggered` (aiWatcher sinh advisory). **KHÔNG BAO GIỜ lệnh thiết bị tự động** — bất biến HITL giữ nguyên.
- **Cờ**: toàn bộ side-effect OUTBOUND của U1 gated `ECOSYSTEM_EVENTS_ENABLED` (mặc định OFF) + cờ riêng của mỗi sink. Đăng ký in-process luôn bật (vô hại).

### 8.4 Luồng client chuẩn hóa (U1-c)
- `socket.ts::installEcosystemSocketBridge` subscribe eventBus (per-type, ~19 tên — legacy + U1) → chuẩn hóa → emit `ecosystem:event` (mọi class) + `alerts:stream` (alert class) tới `global` + room scoped (`factory:/line:/machine:`) đúng room model cũ (không rò tenant).
- Legacy emit-only (`alert:escalation`, `maintenance:alert`, `downtime:*`) nay CŨNG publish lên bus → vào luồng hợp nhất.
- Client: hook mới `useEcosystemEvents()` + `NotificationCenter` nghe `alerts:stream` → MỌI class cảnh báo (safety/andon/SPC/escalation/maintenance/anomaly/quality-gate) tới notifier toàn cục (trước chỉ `inspection:alert`).

### 8.5 Bug socket đã sửa (U1-d)
- `useRealtimeAlerts` (dead hook: socket THỨ HAI + nghe `yield:warning`/`ng:alert`/`qualityGate:triggered` server không phát) → viết lại dùng SHARED socket + `alerts:stream`.
- `emitMqttMessage` room mismatch `machine:${machineCode}` → resolve numeric `machineId` từ online-map, emit đúng room.
- `alert:escalation` (emit-only dead end) → nối vào luồng hợp nhất qua bus publish.

### 8.6 Không migration
U1 thuần runtime event (không bảng mới). Không dùng số migration nào.

### 8.7 Cổng chất lượng
`npm run check` (tsc) PASS · `npx vite build` PASS · test mới `ecosystemEvents.test.ts` 11/11 · fleet+programming+anomaly 75/75 · orchestration 46/46 — tất cả xanh.

---

## 9. U2 — Ecosystem Command Center: BACKEND aggregation (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. READ-ONLY, KHÔNG migration, KHÔNG flag (thuần aggregation). Đây là tầng **AGGREGATION MỎNG** trên các service ĐÃ CÓ — không nhân đôi data path, không thêm data thiết bị, không mở đường điều khiển. FE (trang `/command-center`) do một agent khác dựng, tiêu thụ router này. `commandCenter.*` gọi các helper trong `server/services/ecosystem/commandCenterService.ts`.

### 9.1 Router `commandCenter` (register trong `server/routers.ts`)
RBAC: mọi procedure `protectedProcedure` + `requirePermission("machine_monitoring","canView")` (giống twin/fleet/safety). Tenant scope qua `scope.corporateCode` / `scope.factoryId` (tùy chọn). Mọi procedure gắn thêm `status` (live-vs-poll).

| Procedure | Input | Output (shape) |
|---|---|---|
| `status` | — | `{ liveAlertsEnabled:boolean, mode:"live"\|"polling" }` — bật khi `ECOSYSTEM_EVENTS_ENABLED` (U1) ON → FE subscribe `alerts:stream`; tắt → FE poll `recentAlerts`. |
| `hierarchy` | `{ scope?:{factoryId?,corporateCode?} }` | `{ sites: HierarchyNode[], status }` |
| `kpiSummary` | `{ scope? }` | `{ oee,wip,alarms,energy,aiInsights,sites,fleet, status }` — mỗi field `KpiField<T>={value,source,available}` |
| `recentAlerts` | `{ scope?, limit?≤200 }` | `{ alerts: SeedAlert[], status }` (seed cho rail; delta live qua U1 `alerts:stream`) |

**`HierarchyNode`**: `{ id, kind:"site"\|"factory"\|"line"\|"station"\|"machine"\|"robot", code, name, deviceType?(resolved), status:"ok"\|"warn"\|"down"\|"idle"\|"unknown", counts:{activeAlarms,activeTasks,offline}, refId, children? }`. Cây: `sites[] → factories[] → lines[] → stations[] → {machines[],robots[]}`.

**`SeedAlert`** = envelope U1 `EcosystemEvent`: `{ id, ts, kind, severity, source, scope:{siteCode?,factoryId?,machineId?,robotId?,lineId?}, title, detail? }`.

### 9.2 Nguồn mỗi field (BẰNG CHỨNG không nhân đôi)
| Field | Aggregates from (hàm ĐÃ CÓ) |
|---|---|
| Cây per-factory (line→station→device + state/task) | `twin/sceneGraph.buildSceneGraph` (REUSE làm xương sống — chỉ PROJECT + roll-up) |
| `deviceType` mỗi máy | `standards/deviceTypeRegistry.resolveForMachineType` (seed từ `capabilityModel` DEFAULT_PROFILES) → **type mới tự xuất hiện** |
| `oee` | `oeeService.getAllMachinesOEELive` (mean các factor live; KHÔNG tính lại OEE) |
| `wip` | `wip_tracking` (data path MES Control Tower) đếm unit chưa exit |
| `alarms` | `andon_events` (chưa resolve, bucket theo state) + `safety_events` (non-near-miss = critical) |
| `energy` | **HONEST null** (`available:false`) — chưa có hàm rollup tổng-kwh/co2 toàn estate (energyRouter chỉ per-recipe/peak/forecast). KHÔNG bịa số 0. |
| `aiInsights` | `aiActionInbox.countInbox(user)` (scoped theo user) |
| `sites` | federation `site_kpi_rollup` + freshness (reporting/stale/down) |
| `fleet` | `tasks` (pending/assigned/running) + `robots` (online) — đếm trạng thái, KHÔNG chạy lại allocation |
| Seed alerts | `andon_events` + `safety_events` → map vào envelope U1 (`andonToSeed`/`safetyToSeed`) |

### 9.3 Status roll-UP + registry-driven
- `deviceStatus`: running→ok, idle→idle, held/stopped→warn, aborted/estop/offline→down, else unknown.
- `rollUpStatus`: **WORST-of-children** (rank down>warn>unknown>idle>ok) → 1 máy `down` làm station/line/factory `down`; alarm active nâng leaf lên ≥`warn`. Counts cộng dồn mọi tầng.
- Device type **registry-driven**: resolve qua seed (capabilityModel) → thêm machineType/type mới KHÔNG sửa router; unknown → fallback `Equipment` (không ném).

### 9.4 Honest seams / caveats
- **Federation depth (U5 ✅ BE)**: roll-up giờ **per-category** (overall/inspection/oee/fleet/safety/pdm) + **giữ `details[]`** → drill site→station→device khả dụng qua `federation.siteDetail`. Site LOCAL expand đầy đủ; site REMOTE cũ (không phục vụ feed mới) là leaf roll-up với category vắng = **honest-null** (không bịa 0). FE drill trong Command Center + subscribe `site:update` là phần còn lại của U5 (nằm ở U2). Tiêu thụ đúng những gì aggregator đã landed.
- **Energy** null trung thực (chưa có rollup tổng).
- **Perf**: `hierarchy` fan-out 1 `buildSceneGraph`/factory (mỗi cái vài select có index + 1 telemetry select/robot). Map machineType + alarm-count đã HOIST ra ngoài vòng lặp factory. Narrow bằng `scope.factoryId` cho estate lớn. Read-only + fail-safe (no-DB → cây rỗng / null, không ném).
- **Live-vs-poll**: `status.mode` cho FE biết seed (`recentAlerts`) + subscribe live (`alerts:stream`, U1) hay chỉ poll.

### 9.5 Cổng chất lượng
`npm run check` (tsc) PASS · test mới `commandCenterService.test.ts` 23/23 · twin+fleet+ecosystem+standards+equipment 202/202 — tất cả xanh. KHÔNG commit (theo yêu cầu). BACKEND-only.

---

## 10. U2 — Ecosystem Command Center: FRONTEND (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. Trang `/command-center` — single pane of glass, tiêu thụ router `commandCenter.*` (§9) + luồng live U1 (`useEcosystemEvents`). ADDITIVE + read-only, KHÔNG commit. File chính: `client/src/pages/CommandCenter.tsx`.

### 10.1 Layout 3-pane (responsive) + KPI strip
- **TOP · KPI STRIP** — 7 `MetricCard` (DS F1b): OEE (mean), WIP/bottleneck, Alarms (crit/high), Fleet (tasks/robots online), Sites (reporting/stale/down), AI insights, Energy. **Energy honest "—"** khi `available:false` (không bịa 0). Badge **LIVE** (xanh, khi `status.mode==="live"` = `ECOSYSTEM_EVENTS_ENABLED` ON) vs **POLLING** (hổ phách).
- **LEFT · CÂY PHÂN CẤP LIVE** — tree đệ quy `site→factory→line→station→machine→robot`: status-dot theo token ngữ nghĩa (ok=success / warn=warning / down=destructive / idle+unknown=muted), icon theo kind, `deviceType` chip cho leaf, badge đếm alarms/tasks/offline. **Chọn node** → lọc center + rail theo scope subtree. Leaf máy/robot có nút **"Open cockpit"** → `/machine/:refId` hoặc `/robot/:refId` (route do **U3** giao — wire sẵn, resolve khi U3 land). Poll `hierarchy` **10s** cho roll-up freshness.
- **CENTER · TWIN/OVERVIEW** — twin 3D **compact** cho factory đang chọn: query `twin.sceneGraph` RIÊNG cho factory đó (không import phá `DigitalTwinCenter`; TÁI DÙNG cách tiếp cận three.js của twin — Canvas/OrbitControls/Grid/blocks tô màu theo state). **Fallback status-grid** (line→station→device tô màu theo hierarchy) khi scene rỗng HOẶC WebGL không có → KHÔNG bao giờ vỡ build/trang.
- **RIGHT · ALARM RAIL HỢP NHẤT** — seed từ `recentAlerts`, LIVE-append từ `useEcosystemEvents({alertsOnly:true})` (dedupe theo `id`, cap 100, mới nhất trước). Mỗi alert: `StatusBadge` severity (critical/high→error, medium→warning, else info), kind, title, source, thời gian tương đối, click → điều hướng tới asset cockpit (machine/robot) hoặc trang nguồn (andon→`/ops-console`, safety→`/safety-workforce`). Rail lọc theo scope node đang chọn.

### 10.2 Live-vs-poll
- `commandCenter.status.mode` lái badge + hành vi rail: **live** → subscribe `alerts:stream` (U1); **polling** → CŨNG poll `recentAlerts` mỗi **15s** làm fallback (khi live, tắt poll để tránh trùng). Hierarchy + KPI luôn poll (10s / 15s) vì là aggregate chậm, không phải delta live.

### 10.3 Trạng thái rỗng/degraded trung thực
- Không site → "No sites reporting"; federation off/single-site → 1 site LOCAL (từ backend); energy null → "—"; scene rỗng/WebGL off → status-grid; không factory layout → "No line/station layout".

### 10.4 Wire-up
- **Route**: `/command-center` trong `client/src/App.tsx` (lazy, `RouteGuard requirePermission="machine_monitoring"`, `AIPageWrapper`).
- **Nav**: item ĐẦU TIÊN/nổi bật của module OVERVIEW trong `client/src/lib/navigation.tsx` (icon Gauge, gated machine_monitoring).
- **i18n nav**: `nav.commandCenter` / `nav.commandCenterDesc` thêm en/vi/zh (VI: "Trung tâm Điều hành Hệ sinh thái"). In-page qua `t("cmd.*","English default")` fallback (không sửa locale cho nội dung trang).

### 10.5 Cổng chất lượng
`npm run check` (tsc) **PASS** · `npx vite build` **PASS** (chunk `CommandCenter-*.js` emit, code-split). KHÔNG commit (theo yêu cầu). Twin: **embed compact 3D** (tái dùng cách của DigitalTwinCenter, query scene-graph riêng) với **status-grid fallback** — chọn hướng này để an toàn build (không phụ thuộc internals non-export của DigitalTwinCenter, không rủi ro WebGL). File sửa: `client/src/pages/CommandCenter.tsx` (mới), `client/src/App.tsx`, `client/src/lib/navigation.tsx`, `client/src/i18n/locales/{en,vi,zh}.json`, doc 21 (§6/§10).

---

## 11. U3 — Machine & Robot Cockpit: BACKEND aggregation + robot live socket (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. Đóng **G-4** (không có cockpit `/machine/:id` & `/robot/:id`) + **G-5** (robot/fleet không live) ở tầng backend. **Thuần AGGREGATION** trên các service đã có + **một** wiring socket cho robot telemetry. **Không mở đường điều khiển mới** (control vẫn qua gated dispatcher hiện hữu). **Không migration.** ADDITIVE, read-only, KHÔNG commit. Trang cockpit do một agent FE riêng dựng — phần này chỉ cung cấp API + live feed.

### 11.1 Router `assetCockpit` (đăng ký trong `server/routers.ts`)
File mới: `server/routers/assetCockpitRouter.ts` (mỏng) + `server/services/ecosystem/assetCockpitService.ts` (assembly, giống mẫu `commandCenterService` của U2). Mọi procedure gated `machine_monitoring/canView`, read-only, tenant surface qua `identity.corporateCode` (lấy từ factory của máy):

- **`machineDetail({ machineId })`** → `NOT_FOUND` nếu máy không tồn tại; ngược lại 1 object gồm các section, **mỗi section honest-null khi nguồn vắng/tắt/lỗi** (`{ value, source, available }`):
  - `identity` — code/name/machineType/model/manufacturer + đường phân cấp station→line→(workshop)→factory + `corporateCode`. *(join hierarchy schema)*
  - `resolvedCapability` — `{ equipmentClass, adapterKind, deviceType, commands[], telemetryTags[], packmlStates[] }`. *(`capabilityModel.getCapabilitiesForMachine` ⊕ `deviceTypeRegistry.resolveForMachineType`)*
  - `liveState` — `{ status, lastStatusChange, heartbeatStatus, lastHeartbeat, connected }`. *(`db/machine.getLatestMachineStatus` + `getLatestMachineHeartbeat` — UDM/PackML/connection)*
  - `health` — `{ failureRisk, maintenanceUrgency, predictedTimeframeHours, recommendedMaintenanceDate, mtbfHours, mttrHours, rulHours }`. *(`predictiveMaintenanceService.computeFailureRisk` + `computeReliabilityStats`)* — `rulHours` = horizon dự báo của PdM (honest: chưa có RUL regressor riêng).
  - `oee` — `{ availability, performance, quality, oee }`. *(`oeeService.getMachineOEELive`)* — honest-null khi không có uptime/production data (không bịa 0).
  - `alarms` — danh sách chuẩn hoá per-máy (xem §11.3). *(`assetCockpitService.machineAlarms`)*
  - `recipes` — `{ loadHistory[] }`. *(`recipeVersioningService.listLoadHistory`)*
  - `programs` — `{ projects[], deployments[] }`. *(`program_projects.deviceId` + `program_deployments` theo `projectId`)*
  - `genealogy` — traceability gần đây theo `stationCode`. *(`genealogy_chain`)*
  - `model3d` — `{ modelUri, modelKind, conversionStatus }` hoặc null. *(`twin/modelRegistry.resolveModel({ machineId })`)*
  - `gatedActions[]` — **METADATA ONLY**: `{ name, label, riskLevel, requiredPermission, packmlCommand?, paramsSchema[] }` từ capability commands. Đây chỉ là các lệnh user *được phép đề xuất*; **thực thi vẫn qua gated dispatcher** — router này KHÔNG chạy lệnh.

- **`robotDetail({ robotId })`** → `NOT_FOUND` nếu robot không tồn tại; ngược lại:
  - `identity` — `{ id, code, name, vendor, kind, model, status, lineId, stationId, isEnabled, lastSeenAt }`. *(robots row)*
  - `liveTelemetry` — `{ mode, busy, estop, speedPct, pose, jointStates, batteryPct, safetyZoneId, firmwareVersion, lastHeartbeat, ts }`. *(robot_telemetry mới nhất — UDM đầy đủ)*
  - `capability` + `gatedActions[]` — `capabilityModel.getDefaultCapability("ROBOT")` (có `e_stop`/`run_job`/`abort` — metadata).
  - `jobs` — robot_jobs gần đây. `tasks` — fleet `tasks` (assignedDeviceId + assignedDeviceKind='robot'). `programs` — `program_projects.deviceId` (IR/robot flows). `safety` — `safety_events` (robotId). `anomalies` — **đọc** `robot_behavior_anomalies` gần đây (KHÔNG re-detect). `alarms` — feed chuẩn hoá per-robot từ safety (§11.3). `model3d` — `resolveModel({ equipmentId:"robot:{id}" })`.
  - `kinematicModel` — `{ model, isSample, note }` từ `sim/kinematicModel.resolveKinematicModel` (theo kind: arm/cobot→UR-ish 6-DOF `SAMPLE_ARM_6DOF`; scara/agv→`SAMPLE_SCARA` 4-DOF). **HONEST: đây là SAMPLE chain (chưa có URDF thật — import URDF thật là T2a)**, gắn cờ `isSample:true` + note.

- **`machineAlarms({ machineId, limit? })`** → `{ alarms[] }` — query mỏng per-máy (xem §11.3).

**Chứng minh không trùng lặp:** service này KHÔNG tự tính health/oee/alarm/kinematic — mỗi section GỌI hàm đã có rồi PROJECT kết quả vào shape cockpit. Mỗi section ghi kèm `source` (chuỗi tên hàm nguồn) để kiểm chứng.

### 11.2 Robot telemetry LIVE (đóng G-5)
- **Room + emit** trong `server/_core/socket.ts`: thêm join/leave `robot:{robotId}` vào `subscribe`/`unsubscribe` (giống room `twin:`/`device:`), và helper `emitRobotTelemetry(evt)` phát `robot:telemetry` vào room đó (no-op khi `io` chưa init — tests/headless).
- **Điểm phát**: trong `server/services/robot/robotIngest.ts` (`ingestRobotState`), **sau khi persist** row robot_telemetry + cập nhật registry, gọi `emitRobotTelemetry` **fire-and-forget + error-isolated** (try/catch riêng — lỗi socket KHÔNG bao giờ vỡ persist path) mang UDM gọn (`mode/busy/estop/speedPct/pose/jointStates/batteryPct/safetyZoneId/firmwareVersion/status/ts`). → Robot Cockpit LIVE (trước đây robot pages là poll/static).
- **Flag**: emit telemetry là **transport-only, KHÔNG phải đường điều khiển** ⇒ không thêm gate mới (an toàn — như `emitDeviceDeltas`/`emitTwinDeviceDeltas`). Producer (robotIngest) đã tự gated bởi `ROBOT_GATEWAY_ENABLED` ở tầng manager; khi off thì ingest không chạy → không phát → FE giữ poll (backward-compatible). *(Optional U1 ecosystem-stream emit trên state-change đáng chú ý: bỏ qua ở pha này — bus đã nhận e-stop qua safety-audit hook; giữ diff tối thiểu.)*

### 11.3 Feed alarm chuẩn hoá per-asset (query audit báo thiếu)
`machineAlarms(machineId, limit)` + `robotAlarms(robotId, vendor, limit)` → mỗi phần tử `{ standardCode, severity, description, recommendedAction, ts, source, raw }` theo ISA-18.2:
- **Máy**: kéo `andon_events` gần đây của máy → map `reason`→`standardCode` (safety→SAFETY_STOP, quality→QUALITY_ALARM, material→MATERIAL_STARVE, maintenance→MAINTENANCE_REQUIRED, setup→SETUP_CHANGEOVER) + `state`→severity (red/call→critical, yellow→high). **HONEST**: `andon_events` KHÔNG lưu `nativeCode` thô của vendor — một raw device alarm đã được `alarmNormalizer` chuẩn hoá THÀNH andon ở upstream (I1/N-6), nên tại đây ta map tín-hiệu-đã-chuẩn-hoá vào envelope taxonomy theo `reason`. *(OT ingest hiện chưa có alarm surface → không có thêm nguồn raw; ghi nhận trung thực.)*
- **Robot**: kéo `safety_events` (robotId) → thử `alarmTaxonomy.mapAlarm(vendor, eventType)` trước (khớp code chuẩn nếu có), else suy ra `SAFETY_{EVENTTYPE}` + severity (near-miss→high, else→critical).

### 11.4 Test (mock service nền)
File: `server/services/ecosystem/assetCockpitService.test.ts` (11) + `server/services/robot/robotIngest.test.ts` (3) — **tất cả xanh**:
- `machineDetail` ráp đủ section + honest-null nguồn bị disable/throw (health), honest-null OEE khi không có data, `NOT_FOUND` (null) khi máy vắng, `gatedActions` chỉ metadata.
- `robotDetail` ráp đủ + resolve kinematic **SAMPLE** (cobot→6-DOF, agv→SCARA 4-DOF), honest-null telemetry khi vắng, `NOT_FOUND`.
- `machineAlarms`/`robotAlarms` chuẩn hoá raw→ISA-18.2 (thứ tự newest-first, shape contract).
- robot telemetry emit **fires** on ingest (mock socket) + **error-isolated** (throwing emit không vỡ ingest) + phản ánh e-stop trong status.
- **Regression**: chạy lại robot/fleet/equipment/safety/programming/ecosystem = **342/342 xanh** (25 files, gồm commandCenter U2).

### 11.5 Cổng chất lượng
`npm run check` (tsc) **PASS** (exit 0). KHÔNG commit (theo yêu cầu). File sửa/mới: `server/routers/assetCockpitRouter.ts` (mới), `server/services/ecosystem/assetCockpitService.ts` (mới), `server/services/ecosystem/assetCockpitService.test.ts` (mới), `server/services/robot/robotIngest.test.ts` (mới), `server/routers.ts` (đăng ký `assetCockpit`), `server/_core/socket.ts` (room `robot:{id}` + `emitRobotTelemetry`), `server/services/robot/robotIngest.ts` (emit wiring), doc 21 (§6/§11).

### 11.6 Ghi chú trung thực (honest-null + sample)
- **kinematic = SAMPLE, chưa phải URDF thật** (T2a). `isSample:true` + note nói rõ; khi T2a land, `resolveKinematicModel` trả chain resolve-từ-registry thay cho sample.
- **model3d** honest-null khi chưa đăng ký model cho máy/robot.
- **health/oee** honest-null khi không có uptime/production/PdM data (không bịa 0). **rulHours** = PdM horizon (không phải RUL regressor riêng).
- **genealogy** là traceability sản phẩm theo `stationCode` (không phải "machine health genealogy").
- **anomalies** ĐỌC rows gần đây (không gọi `detectAndRaiseForRobot` — hàm đó có side-effect raise alert).

---

## 12. U3 — Machine & Robot Cockpit: FRONTEND + drill/QR fixes (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. Hai trang cockpit hợp nhất per-asset tiêu thụ `assetCockpit.*` (§11) + live socket, cộng sửa mọi drill/cross-link/QR gãy (G-4). ADDITIVE + read-only, KHÔNG mở đường điều khiển mới, KHÔNG commit. F1b patterns (PageHeader/MetricCard/StatusBadge/SectionCard/EmptyState) + shadcn Tabs + three.js/drei (no new deps). Typesafe qua `inferRouterOutputs<AppRouter>["assetCockpit"][...]`. i18n `t("cockpit.*","English default")` fallback.

### 12.1 `MachineCockpit.tsx` (route `/machine/:id`)
Tabbed cockpit trên `machineDetail(id)` (một call). Tabs + nội dung tổng hợp:
- **Overview** — KPI strip (OEE · failure-risk · active-alarms · connection) + 3 card: identity + đường phân cấp (station→line→factory→corporate) · resolvedCapability (equipmentClass/adapterKind/deviceType + PackML states chips + telemetry-tag chips) · liveState (status/PackML/heartbeat/connection).
- **Health/PdM** — RadialGauge failure-risk + MetricCards MTBF/MTTR/RUL(PdM horizon)/predicted-timeframe + recommended-maintenance date. Honest empty khi `available:false`.
- **OEE** — 4 RadialGauge (availability/performance/quality/OEE) — thay cho việc import OEEDashboard (viz vẽ lại gọn bằng SVG, không Recharts).
- **Alarms** — danh sách ISA-18.2 chuẩn hoá per-máy (`machineDetail.alarms`; cùng nguồn `machineAlarms`).
- **Recipes** — recipe load/deploy history. **Programs** — projects + deployments. **Genealogy** — traceability theo station. Mỗi tab honest-empty.
- **3D** — drei `<Gltf src={modelUri}>` (Suspense) khi có model, else primitive block; WebGL-guard → thông báo trung thực khi không có WebGL (giống DigitalTwinCenter).
- **Actions** — list `gatedActions` (label + riskLevel badge + requiredPermission + packmlCommand). **METADATA ONLY** — nút "Propose" điều hướng `/control-plane?machineId=…&command=…` (gated surface hiện hữu). KHÔNG chạy lệnh; banner cảnh báo read-only.
- **Live**: subscribe shared socket room máy + `telemetry:sample` → nudge refetch `machineDetail` (poll 10s nền).

### 12.2 `RobotCockpit.tsx` (route `/robot/:id`) — LIVE
Tabbed trên `robotDetail(id)`, LIVE qua room `robot:{id}` / event `robot:telemetry` (đóng G-5): overlay UDM gọn đè lên section polled (socket thắng per-field), badge **LIVE/POLLING** + **E-STOP** khi estop. Tabs:
- **Overview** — KPI (mode/speed/estop/battery) + identity + liveTelemetry đầy đủ (mode/busy/estop/speed/zone/firmware/heartbeat/sample-ts) + battery progress + capability summary.
- **Joints** — **viz 2D joint-bar** (xem §12.4): mỗi joint (non-fixed) của kinematic chain vẽ thanh vị-trí-live vs limit band + đơn vị °/mm theo joint type + cảnh báo near-limit; hiện `isSample` note; TCP pose từ live telemetry (không FK client).
- **Jobs** · **Tasks** (fleet) · **Programs** (IR, nút Open IR→`/ir-editor`) · **Safety** (zone reactions) · **Anomalies** (đọc) · **Alarms** (ISA-18.2 per-robot) — mỗi tab honest-empty.
- **3D** — `<Gltf>` else primitive cylinder (WebGL-guard).
- **Teach/Jog** — **promote `<TeachJogPanel>`** (import từ `components/engineering`, self-contained `{value,onChange}`) + hiển thị buffer tmscript. **Gated honest**: banner "PREVIEW/GATED — jog chỉ đổi pose preview local; chạy robot thật cần `robotCommandDispatcher` (ROBOT_CONTROL_ENABLED + HITL)". Panel KHÔNG dispatch gì.
- **Actions** — `gatedActions` metadata; "Propose"→`/robot-control?robotId=…&command=…`. KHÔNG chạy lệnh.

### 12.3 Gated / teach-jog KHÔNG chạy trực tiếp (bất biến giữ nguyên)
- `gatedActions` là **METADATA từ capability** (backend §11.1). Cockpit chỉ HIỂN THỊ + nút "Propose" → **điều hướng** tới control surface gated hiện hữu (`/control-plane` cho máy, `/robot-control` cho robot) mang query `?…&command=…`. KHÔNG có tRPC mutation dispatch nào gọi từ cockpit (audit xác nhận RobotControl cố tình read-only; motion đi qua `robotCommandDispatcher` nội bộ + HITL/dry-run). Cockpit tôn trọng seam đó.
- **TeachJogPanel** tạo tmscript buffer LOCAL — không có đường execute; giữ nguyên bản chất preview (component tự khai báo honest).

### 12.4 Lựa chọn joint viz: **2D readout** (không 3D FK arm)
FK solver + DH chain nằm SERVER-SIDE (`sim/kinematicModel.ts`), KHÔNG export xuống client; port FK để lái arm 3D thêm rủi ro build/regression mà lợi ích thấp so với data trung thực đang có (live `jointStates` + per-joint limits của sample chain). ⇒ Joints vẽ **thanh 2D** giá-trị-live vs limit — chính xác, không phụ thuộc, luôn build. Tab **3D** vẫn render glTF thật của model registry qua `<Gltf>`. (Nếu/khi T2a có URDF thật + export FK client, có thể nâng lên 3D arm sau — seam để mở.)

### 12.5 Sửa drill / cross-link / QR gãy (G-4) — file · before→after
- **`App.tsx`** — đăng ký `/machine/:id` + `/robot/:id` (lazy, `RouteGuard requirePermission="machine_monitoring"`, `AIPageWrapper`). KHÔNG thêm top-nav (đây là :id detail, tới bằng drill).
- **`MachineQuickScan.tsx`** — QR/scan: *before* `→ /ai-chat?machine=<code>`; *after* resolve code→numeric id từ `machine.list` → `→ /machine/:id` (primary). Fallback `/ai-chat?machine=<code>` khi chưa resolve được id; thêm helper `goAiChat` (AI-chat vẫn là lựa chọn secondary).
- **`UnifiedDeviceMonitor.tsx`** (nút "Chi tiết" máy) — *before* `→ /machine-status` (dead-end); *after* `→ /machine/${r.id}`.
- **`FleetOrchestration.tsx`** (`assignedDeviceId`) — *before* text `#id` không click; *after* button `→ /robot/${tk.assignedDeviceId}` (thêm import `useLocation`).
- **`DigitalTwinCenter.tsx`** (inspector) — *before* chỉ hiển thị device; *after* nút "Open cockpit" `→ /robot|/machine/${selected.refId}` theo `selected.kind` (thêm `useLocation` + `ExternalLink`).
- **`FactoryLiveMap3D.tsx`** (nút "Giám sát chi tiết") — *before* `→ /machine-status`; *after* `→ /machine/${selected.id}` (label→"Mở cockpit máy").
- **`RobotControl.tsx`** (row robot) — *before* row chỉ select local; *after* thêm nút "Cockpit" `→ /robot/${r.id}` (thêm `useLocation`).
- **`RobotModelHealth.tsx`** (cell robot trong bảng anomaly) — *before* text không click; *after* button `→ /robot/${a.robotId}` (thêm `useLocation`).
- **CommandCenter** (U2) đã link `/machine|robot/:refId` — **nay resolve** (route đã đăng ký).
- **`/machine-status`** redirect vẫn giữ (→`/device-monitor`); rich per-machine detail nay tới được qua `/machine/:id` (drill từ device-monitor / twin / live-map / command-center / QR).

### 12.6 Cổng chất lượng
`npm run check` (tsc) **PASS** (exit 0) · `npx vite build` **PASS** (`✓ built in ~17s`, code-split chunk `MachineCockpit-*.js` ~65 kB + `RobotCockpit-*.js` ~72 kB emit). KHÔNG commit (theo yêu cầu). File mới: `client/src/pages/MachineCockpit.tsx`, `client/src/pages/RobotCockpit.tsx`. File sửa: `client/src/App.tsx`, `client/src/components/MachineQuickScan.tsx`, `client/src/pages/UnifiedDeviceMonitor.tsx`, `client/src/pages/FleetOrchestration.tsx`, `client/src/pages/DigitalTwinCenter.tsx`, `client/src/pages/FactoryLiveMap3D.tsx`, `client/src/pages/RobotControl.tsx`, `client/src/pages/RobotModelHealth.tsx`, doc 21 (§6/§12).

### 12.7 Ghi chú trung thực
- **Joint viz = 2D** (không 3D FK) — lý do §12.4 (FK server-side, không export client).
- **kinematic = SAMPLE** (isSample note hiển thị) cho tới URDF thật (T2a).
- **model3d/health/oee/alarms/recipes/programs/genealogy** honest-empty ("—" / EmptyState) khi section `available:false` — không bịa số.
- **Gated actions + teach/jog** KHÔNG execute từ cockpit — chỉ propose/preview, điều hướng tới gated surface (§12.3).

---

## 13. U5 — Federation Panorama: FRONTEND (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. Hoàn tất phần **FE còn lại của U5** (§6 / G-7): nâng `client/src/pages/FederationDashboard.tsx` **ADDITIVE** trên scoreboard F2 đã có (giữ nguyên hoạt động cũ), tiêu thụ 3 procedure mới `federation.siteDetail`/`alertRollup`/`categoryRollup` + live room `sites:global`. Dùng pattern F1b (`MetricCard`/`StatusBadge`/`SectionCard`) + shadcn (`Tabs`), typesafe qua `inferRouterOutputs<AppRouter>["federation"][...]`, i18n `t("federation.*","English default")` fallback (không sửa locale). **KHÔNG commit.** File sửa: `client/src/pages/FederationDashboard.tsx` + doc 21.

### 13.1 Drill site → factory/station/device (`siteDetail`)
- Mỗi hàng site trong lưới "Per-site KPIs" nay **click để mở drill** (chevron ▸/▾, `aria-expanded`; nút "Open site ↗" `stopPropagation` để không toggle). Drill fetch `siteDetail({siteCode})` (enabled chỉ khi có hàng mở).
- Tree hiển thị **station → device** từ `detailRows` đã retained: mỗi station là 1 nhóm (tên + đếm device), mỗi device có throughput/cycle-time + `StatusBadge` suy từ yield (≥98 ok · ≥90 warn · <90 down · 0 inspection → idle · yield null → unknown).
- **Trung thực:** site REMOTE/cũ `hasDetail:false` → **không bịa tree**; hiện note "No detail feed (older site)" + nút deep-link mở app remote (fallback cũ giữ nguyên). Freshness badge + `asOf` hiển thị trên đầu drill.

### 13.2 Panel alert roll-up (`alertRollup`)
- `SectionCard` mới: 4 `MetricCard` (Open · Critical · Near-miss · Sites-with-alert-feed = `sitesWithAlertFeed/sitesTotal`) + bảng **top-alerts** (severity `StatusBadge`, site, title/kind, count, time).
- **Trung thực:** khi `sitesWithAlertFeed < sitesTotal` hiện note "sites without a feed contribute nothing (not a fabricated 0)"; rỗng → phân biệt "no alert feed yet" vs "no open alerts".

### 13.3 Tabs per-category (`categoryRollup`)
- Segmented control (shadcn `Tabs`): **Inspection · OEE · Fleet · Safety · PdM** → `categoryRollup({category})`. Lưới per-site: freshness/yield/OEE/throughput/NG + cột động cho `metrics` bag (union key, `humanizeMetricKey`).
- **Trung thực:** site không có feed category → badge "no feed" + mọi giá trị **"—"** (dash, KHÔNG bao giờ 0); OEE thật hiện ra nơi có. Metric totals hiện kèm **contributing-site count** (`metricReporting`) — honest basis, "—" khi 0 site đóng góp.

### 13.4 Live `site:update` + LIVE/POLLING
- `useEffect` subscribe `sites:global` qua `getSharedSocket` (như CommandCenter/DigitalTwinCenter): `emit("subscribe",{sitesGlobal:true})` on connect, `on("site:update")` → overlay theo `siteCode` (freshness + headline KPI yield/ng/throughput/oee + alert counts) merge lên hàng đã poll (live thắng cho các trường headline; các trường chậm giữ từ poll). Cleanup `unsubscribe` + `releaseSharedSocket`.
- Badge **LIVE** (xanh, `Radio`) khi đã nhận ≥1 `site:update` (aggregator emit) vs **POLLING** (hổ phách, `Clock`) mặc định trung thực. **Fallback:** `siteRollups` + alert/category poll **30s** luôn chạy → khi aggregator/socket OFF vẫn tươi (không phụ thuộc live). Tooltip phân biệt socket-connected-nhưng-chưa-push vs live-off.

### 13.5 CommandCenter (tùy chọn) — **BỎ QUA (có chủ đích)**
Không nối `site:update`/`siteDetail` vào `CommandCenter.tsx`: cây `commandCenter.hierarchy` là aggregate server-side (`HierarchyNode`, id dạng `site:CODE`), muốn live-merge phải mutate nested node + splice subtree federation-shape vào `HierarchyNode` — **rủi ro regression** trang U2 đã ship (semantics live-vs-poll riêng, đã poll 10s đủ tươi cho site level). Theo chỉ dẫn "if risky, skip and note" ⇒ bỏ qua để **build an toàn**; seam để mở nếu sau này cần.

### 13.6 Trạng thái degraded trung thực
- Federation flag off / <2 sites → giữ nguyên messaging cũ ("needs ≥2 sites", empty-state "No sites enrolled", `crossSiteComparisonReady` note).
- Category null → **"—"** (không 0); remote no-detail → note honest + deep-link; alert-feed vắng → excluded + note; aggregator stopped → panel health cũ giữ nguyên; live off → POLLING badge + 30s poll.

### 13.7 Cổng chất lượng
`npm run check` (tsc) **PASS** (exit 0) · `npx vite build` **PASS** (`✓ built in ~18s`, chunk `FederationDashboard-*.js` ~82 kB emit). KHÔNG commit (theo yêu cầu). File sửa duy nhất (FE): `client/src/pages/FederationDashboard.tsx` (additive) + doc 21 (§6 dòng G-7/U5 "còn lại FE" nay ✅, §13 này).

---

## 14. U6 — Tenant + Scale hardening (ĐÃ THỰC THI — 2026-07-01)

> Nhánh `automation-orchestration-r0`. ADDITIVE + behavior-preserving: KHÔNG đổi bất kỳ query behavior nào, KHÔNG mở đường điều khiển mới, mọi cờ mặc định OFF. Migration 0156 additive/idempotent — **KHÔNG chạy**. KHÔNG commit (theo yêu cầu). KHÔNG thêm dep nặng (Redis adapter chỉ wire `ioredis` **đã có sẵn**).

### 14.1 U6-a — Tenant scope + inert RLS cho 3 nhóm "lỗ tenant" (G-9)
Audit tìm ra 3 nhóm bảng KHÔNG có cột tenant + KHÔNG có RLS (khác các bảng Khối-2/3/7 đồng nhất). Migration `0156_tenant_scope_isolation_holes.sql` backfill **cột tenant + inert RLS** theo đúng pattern 0145/0153:

| Nhóm | Bảng | File schema |
|---|---|---|
| Device Programming / IR | `program_projects`, `program_artifacts`, `program_builds`, `program_sim_runs`, `program_deployments`, `program_symbols` | `drizzle/schema/programming.ts` |
| IMAGE anomaly (bank/profile) | `ai_anomaly_memory_bank`, `ai_anomaly_profiles` (`robot_behavior_anomalies` đã scope ở `aiLoop.ts`) | `drizzle/schema/ai.ts` |
| Predictive / maintenance (PdM) | `maintenance_schedules`, `maintenance_work_orders` | `drizzle/schema/mes.ts` |

- Mỗi bảng: `ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50)` + `"factoryId" integer` (nullable) → hàng cũ = `NULL` = unscoped = allow-all dưới policy inert (backward-compatible).
- `ENABLE RLS` + `tenant_select`/`tenant_modify` policy dùng helper chung `app_tenant_allows(NULL, "corporateCode")` — **no-op** trừ khi `TENANT_RLS_ENABLED=true` set GUC. Block RLS bọc `DO` guard (bỏ qua bảng vắng / helper thiếu). Idempotent (`IF NOT EXISTS`/`DROP POLICY IF EXISTS`, không pg enum mới).
- Schema TS cập nhật khớp migration. Tracking ở `docs/ECOSYSTEM/PHASE1_TENANT_RLS_ROLLOUT.md` (mục "U6-a").
- **KHÔNG đổi query behavior** — thuần schema + inert policy.

### 14.2 U6-b — Redis fan-out abstraction sau eventBus + telemetryBus (G-10)
`eventBus.ts` + `telemetryBus.ts` là EventEmitter in-process (trần 1 server). Thêm abstraction pub/sub nhỏ `server/_core/busFanout.ts`:
- **Mặc định (flag OFF): thuần in-process** — KHÔNG tạo client Redis, `publish()` no-op, zero overhead. Hành vi cũ giữ nguyên 100%.
- **Opt-in** (`EVENTBUS_REDIS_ENABLED=true` + `REDIS_URL`): mỗi event/telemetry batch **phát sinh cục bộ** được publish lên Redis channel; event từ instance KHÁC được subscribe lại và inject vào bus cục bộ → multi-instance chia sẻ event.
- **`ioredis` ĐÃ có sẵn** trong repo (package.json) → khi có `REDIS_URL` là fan-out THẬT (không phải seam). Không cài thêm dep.
- **Honest seam**: flag ON nhưng không có client (thiếu `REDIS_URL`/dep/kết nối fail) → log **một lần** + ở lại in-process, KHÔNG giả lập cross-instance.
- **Loopback-safe**: mỗi message mang `origin` = id process này; message nhận từ Redis có `origin` trùng → drop (đã deliver cục bộ); message inject từ Redis KHÔNG re-publish lên Redis (đường inject tách khỏi đường publish). eventBus: inject qua `emitLocal` (không fan-out lại). telemetryBus: `broadcastAndTap(rows, remote=true)` chỉ re-broadcast socket (KHÔNG re-insert DB, KHÔNG re-fan-out).
- API mới nhỏ: `eventBus.fanoutActive`/`eventBus.close()`, `isTelemetryFanoutActive()`/`closeTelemetryFanout()`.

### 14.3 U6-c — Soft-ref contract + integrity check (G-12)
Các link asset↔task↔program↔genealogy là `integer("...Id")`/`varchar("...Code")` soft-ref (không `.references()` FK). **KHÔNG** bulk-add FK (rủi ro hàng mồ côi làm fail migration). Thay bằng:
1. **Soft-ref contract** (ghi ở đây §14.3): các cột reference bảng nào (app-enforced):
   - `tasks.assignedDeviceId` → `robots.id` (chỉ khi `assignedDeviceKind='robot'`)
   - `program_projects.deviceId` → `machines.id` ∪ `robots.id` (bound device, một trong hai registry)
   - `genealogy_chain.stationCode` → `stations.code` (varchar soft-ref)
   - `safety_events.robotId` → `robots.id`
2. **`server/services/ecosystem/integrityCheck.ts`** (READ-ONLY): quét 4 soft-ref trên, báo cáo orphan (soft-ref non-null trỏ vào hàng không tồn tại) + sample. SELECT-only, không mutate, DB-absent → honest empty, lỗi 1 rule → skip rule đó (cô lập).
3. Procedure admin đọc: `ecosystemAdmin.softRefIntegrity` (`server/routers/ecosystemAdminRouter.ts`, gated `protectedProcedure` + `requirePermission("admin_system","canView")`) → cho VISIBILITY integrity mà không cần FK migration rủi ro.

### 14.4 Cờ + docs
- `.env.example`: thêm `EVENTBUS_REDIS_ENABLED` (+ note `REDIS_URL`; `ioredis` sẵn có). `TENANT_RLS_ENABLED` đã có sẵn.
- `PHASE1_TENANT_RLS_ROLLOUT.md`: thêm mục U6-a (bảng + pattern + fail-open + rollback + test).

### 14.5 Cổng chất lượng
`npm run check` (tsc) **PASS** (exit 0). Test mới: `busFanout.test.ts` (5 — in-process default / opt-in publish+subscribe / remote inject / loopback-safe / honest-seam) + `integrityCheck.test.ts` (4 — planted orphan / clean / DB-absent skipped / per-rule error isolated) + `tenantScopeU6.test.ts` (11 — schema có cột tenant khớp migration). Regression: ecosystem + programming full **xanh** (182/182 gồm test mới). Full suite 2522 passed (1 fail `productionScheduling.ws4` là test stochastic **có sẵn**, xanh khi chạy riêng — không liên quan U6). File mới: `drizzle/0156_tenant_scope_isolation_holes.sql`, `server/_core/busFanout.ts`, `server/services/ecosystem/integrityCheck.ts`, `server/routers/ecosystemAdminRouter.ts` + 3 test. File sửa: `drizzle/schema/{programming,ai,mes}.ts`, `server/_core/eventBus.ts`, `server/services/telemetryBus.ts`, `server/routers.ts`, `.env.example`, `PHASE1_TENANT_RLS_ROLLOUT.md`, doc 21 (§14 này).

### 14.6 Ghi chú trung thực
- **Redis fan-out CẦN client + URL thật**: `ioredis` có sẵn nên chỉ cần set `REDIS_URL` + `EVENTBUS_REDIS_ENABLED=true` là chạy thật; thiếu URL → seam (log-once, in-process) — KHÔNG bịa cross-instance.
- **FK cố ý KHÔNG force-add**: G-12 đóng bằng contract + integrity **visibility** (read-only), tránh rủi ro orphan làm fail migration. Cân nhắc FK thật chỉ sau khi integrity report sạch trên staging.
- **Migration 0156 KHÔNG chạy** (additive/idempotent, áp bằng migrate step thường). Enforcement RLS vẫn cần app connect bằng role NON-owner + wrap query trong `runWithTenantScope` khi bật cờ (adoption incremental, như các pass RLS trước).

---

## 15. U7 — HỢP NHẤT DASHBOARD (đóng G-11) ✅

**Nguyên tắc (bảo thủ + đảo ngược được, theo doc 12):** chỉ redirect **true duplicate** về canonical (dùng `<Redirect>` như `/andon`→`/ops-console`), **GIỮ** mọi view có dữ liệu/đối tượng riêng, và **cross-link** thay vì xoá khi còn phân vân. **KHÔNG xoá file page** — redirect route là đủ (đảo ngược 1 dòng). Không mất dữ liệu/logic. Bằng chứng đọc từ code (router tRPC + tab của từng trang).

### 15.1 Bảng phân loại (16 surface)

| Trang / route | Quyết định | Dữ liệu phục vụ (bằng chứng) | Lý do |
|---|---|---|---|
| **CommandCenter** `/command-center` | **CANONICAL** (flagship U2) | `commandCenter.*` (KPI strip OEE/WIP/alarms/fleet/sites/AI/energy + cây phân cấp live + twin nhúng + rail cảnh báo live U1) | Single-pane-of-glass "xem-tất-cả live" → đích cross-link chung. |
| **Dashboard** `/dashboard` | **KEEP-DIFF** + cross-link | `getStatsWithComparison`/`getAllMachinesStats`/`getShiftStats`/`workstation.*`/live OEE socket; tab Overview/NG-Visual/Corporate/Custom | Landing vận hành OK/NG/NTF + NG-visual + shift; nặng, khác Command Center. Cross-link → command-center, ops-console. |
| **DashboardCenter** `/dashboard-center` | **CANONICAL hub** | Nhúng `EmbeddedCustomDashboard` + `EmbeddedDashboardTemplates` + `EmbeddedDashboardMarketplace` (3 tab) | Đã là hub quản-lý-dashboard; templates/marketplace **đã** redirect vào đây (pha trước). |
| **CustomDashboard** `/custom-dashboard` | **REDIRECT → `/dashboard-center?tab=custom-dashboard`** | `dashboardWidget.*` (builder layout người dùng) | Nội dung ĐÃ nhúng làm tab mặc định của hub; route standalone (không có trong nav) là dây thừa → redirect. File giữ + vẫn nhúng. |
| **DashboardTemplates** / **DashboardMarketplace** | REDIRECT (đã có, pha trước) | — | `/dashboard-templates`, `/template-marketplace`, `/dashboard-marketplace` đã redirect vào hub. Không cần đụng. |
| **DrillDownDashboard** `/drill-down` | **KEEP-DIFF** + cross-link | `drillDown.corporateStats/factoriesByCorporate/linesByFactory/machinesByLine` — drill corp→factory→line→machine + breadcrumb | UI drill tương tác riêng biệt; router riêng. Cross-link → command-center, corporate-dashboard. |
| **CorporateDashboard** `/corporate-dashboard` | **KEEP-DIFF** + cross-link | `corporateFactoryStats.yieldRateBy*`/`factory.list`/trend 6-tháng/live OEE; tab Overview/Comparison/Details | Roll-up cấp tập đoàn cho lãnh đạo (trend dài hạn), khác phạm vi. Cross-link → drill-down, command-center. |
| **ProductionDashboard** `/production-dashboard` | **KEEP-DIFF** + cross-link | `productionDashboard.getStationOverview/getDefectAnalysis/getTrendData/getSpcSummary` + `predictiveMaintenance.listRulForecast`; tab Station/Defect/Trend/SPC + Compare | Giám sát cấp trạm (FPY/retest/top-defect + RUL). Router riêng. Cross-link → mes-control-tower, command-center. |
| **OEEDashboard** `/oee-dashboard` | **KEEP-DIFF** + cross-link | `mqttClient.getAllOEE/getMachineOEE/getActiveDowntime/getDowntimeHistory/getMachineHealth/semiE10Breakdown`; tab OEE/Downtime/Health | Chuyên OEE + downtime + SEMI E10/ISO 22400 + ghi downtime. Cross-link → command-center, device-monitor. |
| **WipLineBalance** `/wip-dashboard` | **KEEP-DIFF** + cross-link | `wip.summary/dwellByStation/lineBalance/dispatch` — pie trạng thái + dwell/bottleneck + **pull-list điều phối** (reason FIFO/bottleneck/aging) | View WIP-dispatch **sâu** (recharts + sequencing). Router `wip.*` **khác** MES. **KHÔNG mất dispatch.** Cross-link ↔ mes-control-tower. |
| **MESControlTower** `/mes-control-tower` | **KEEP-DIFF** + cross-link | `mesControlTower.wipSummary/listWip/lineBalance/serialTrace/…` + orders + sessions + work-orders (6 tab) | Hub MES tổng hợp (WIP + trace genealogy + orders/sessions/maint). Router `mesControlTower.*` khác `wip.*`. Cross-link ↔ wip-dashboard. |
| **DigitalTwinDashboard** (2D) `/digital-twin` | **KEEP-DIFF** + cross-link | `digitalTwin.twinState/defectHeatmap/**whatIf**/stationLoadHeatmap/predictionOverlay` + `useTwinStream` | Có **what-if mô phỏng + WIP-flow + station-load + prediction** — **UNIQUE**, KHÔNG subsume bởi 3D. Cross-link → digital-twin-center, command-center. |
| **DigitalTwinCenter** (3D) `/digital-twin-center` | **KEEP-DIFF** + cross-link | `twin.status/sceneGraph/replay` — cảnh 3D glTF live + replay TimescaleDB | Trực quan 3D thuần, không có what-if. Cross-link → digital-twin (2D what-if), command-center. |

### 15.2 Thay đổi đã áp

- **Redirect (App.tsx, đảo ngược được):** `/custom-dashboard` → `/dashboard-center?tab=custom-dashboard` (dùng `<Redirect>`; gỡ import `CustomDashboard` đã thừa; file page giữ nguyên & vẫn nhúng trong hub). Đây là **true dup duy nhất** an toàn để redirect.
- **Nav cleanup (navigation.tsx):** KHÔNG cần gỡ mục — `/command-center` đã là item đầu/nổi bật của OVERVIEW (U2); `/custom-dashboard` vốn không có trong nav (chỉ reachable bằng URL trực tiếp). Mọi trang KEEP-DIFF vẫn reachable qua nav.
- **Cross-link (component mới `RelatedViews.tsx`, thuần điều hướng wouter `<Link>`, i18n `related.title` en/vi/zh + default fallback):** thêm rail "Related views" vào 7 trang khác-biệt:
  - `Dashboard` → command-center · ops-console
  - `OEEDashboard` → command-center · device-monitor
  - `DrillDownDashboard` → command-center · corporate-dashboard
  - `CorporateDashboard` → drill-down · command-center
  - `ProductionDashboard` → mes-control-tower · command-center
  - `WipLineBalance` ↔ `MESControlTower` (mỗi bên link bên kia) + command-center
  - `DigitalTwinDashboard` (2D) ↔ `DigitalTwinCenter` (3D) + command-center

### 15.3 Bảo toàn chức năng (không mất gì)

- **What-if / WIP-flow / station-load / prediction** của twin 2D → GIỮ (không redirect twin 2D về 3D).
- **Pull-list dispatch** (`wip.dispatch`) → GIỮ (không gộp WIP vào MES hub — router khác nhau).
- Mọi router tRPC riêng (drillDown/corporateFactoryStats/productionDashboard/mqttClient OEE) → GIỮ trang tương ứng.
- Redirect duy nhất chỉ trỏ tới nội dung **đã** nhúng sẵn (custom dashboard builder) → 0 mất dữ liệu.

### 15.4 Cổng chất lượng

`npm run check` (tsc --noEmit) **PASS** (exit 0). `npx vite build` **PASS** (`✓ built` ~18.6s; chỉ warning chunk-size **có sẵn**, không lỗi). File mới: `client/src/components/RelatedViews.tsx`. File sửa: `client/src/App.tsx` (redirect + gỡ import thừa), `client/src/pages/{Dashboard,OEEDashboard,DrillDownDashboard,CorporateDashboard,ProductionDashboard,WipLineBalance,MESControlTower,DigitalTwinDashboard,DigitalTwinCenter}.tsx` (cross-link), `client/src/i18n/locales/{en,vi,zh}.json` (`related.title`), doc 21 (§15 + bảng §6). **KHÔNG commit** (theo yêu cầu). **KHÔNG xoá page**, **KHÔNG dep mới**, i18n nguyên vẹn.

