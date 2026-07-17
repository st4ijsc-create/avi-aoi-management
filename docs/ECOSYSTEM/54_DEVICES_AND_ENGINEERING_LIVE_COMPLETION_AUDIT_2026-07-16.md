# Doc 54 — Đánh giá hoàn thiện LIVE: Module "Thiết bị & Giám sát" + "Kỹ thuật & Điều khiển"

**Ngày:** 2026-07-16 · **Nhánh:** `automation-orchestration-r0` · **Phương pháp:** 3 subagent audit code/backend/DB (đọc mã + SQL live) + audit LIVE bằng Playwright (đa persona engineer1/operator1, ~15 màn, có ảnh chụp + console + network) · **Trạng thái:** ĐÃ DUYỆT (A→E, Đ1-Đ5) + **ĐÃ THỰC THI** — xem §9.

> Phạm vi theo yêu cầu: không chỉ code/backend/DB mà cả **frontend từng màn, từng element + chức năng gắn với element, bố cục/màu sắc/thiết kế**. Báo cáo này gộp cả 5 lớp.

---

## 0. Điều kiện môi trường (đọc trước — ảnh hưởng cách diễn giải)

| Điều kiện | Ảnh hưởng |
|---|---|
| **Model AI GGUF fail load (CUDA OOM)** | AI chat, Programming Copilot *generate*, embedding, AI orchestration advisor, exec-summary **offline**. Mọi nút "AI" sẽ lỗi — đây là điều kiện HW, **không tính là bug UI**. |
| **Seed chỉ phủ module Thiết bị** | `seed-test-data.mjs` seed **0 bảng Engineering**; `seed-automation-demo` chưa chạy → nhiều màn Engineering + MQTT/Edge/UNS/Recipe **rỗng data** (xem §4). |
| **`.env` nói "không có timescaledb" là SAI** | DB thật **CÓ** timescaledb, 7 hypertable + retention/compression. Comment .env lỗi thời. |
| **Hai server chạy song song (3000 + 3001)** | Cùng phục vụ `dist` mới; không ảnh hưởng kết quả. |
| **Bất thường git với `client/`** | `git status`/`git log` báo file client tôi vừa tạo/sửa là "sạch"/do commit CŨ thêm — bất khả thi. **Git ở môi trường này không đáng tin cho `client/`**; đừng dựa vào git để xác định đã/chưa commit. |
| **Locale test = English** | Bộc lộ nhiều nhãn hardcode tiếng Việt + raw i18n key (xem §6). |

---

## 1. Tóm tắt điều hành

Hai module này là **phần lõi và được xây tốt nhất** của hệ thống. Backend Engineering đặc biệt vững về an toàn (gate deploy/actuation thật, nhiều lớp; preview không chạm thiết bị; copilot từ chối logic an toàn). Backend Devices phần lớn REAL, và **đã đóng** lỗ hổng doc-51 (MQTT topic ACL, claim-token). Tuy nhiên còn:

- **2 lỗ hổng P0 bảo mật credential máy** (Devices) — rò `apiKey` plaintext + phi-admin tự đặt key/tự duyệt.
- **Chuỗi lỗ hổng RBAC "chỉ bit per-user, không sàn role"** — nhiều mutation nghiệp vụ viewer ghi được.
- **Data-integrity**: thiếu UNIQUE chống trùng OEE/health, WORM chỉ tuyên bố chưa thực thi, N+1 fleet @60s, robot_telemetry không retention.
- **Frontend**: 1 bug dữ liệu người dùng thấy được (OEE dashboard rỗng dù có 897 dòng), nhiều màn **rỗng data** (do seed thiếu), i18n hỗn hợp EN/VN + vài raw-key, vài chỗ RBAC UI hiển thị nút mà role không dùng được.

**Điểm honest (thang 100, "production-ready"):**

| Trục | Devices & Monitoring | Kỹ thuật & Điều khiển |
|---|---|---|
| Backend đúng đắn/REAL | 74 | 82 |
| An toàn/RBAC | 55 (2×P0) | 68 (P1 interlock) |
| Data-integrity | 60 | 66 |
| Frontend render/UX | 72 | 78 |
| Độ đầy dữ liệu (live) | 62 | 40 (seed trống) |
| Thiết kế/bố cục/màu | 80 | 82 |
| i18n hoàn chỉnh | 55 | 58 |
| **Tổng ~** | **~65** | **~68** |

Khoảng cách tới "chuyên nghiệp hoá" ≈ **an ninh hoá RBAC + đóng 2 P0 + seed đủ để hết rỗng + i18n + vài bug FE**, KHÔNG phải viết lại.

---

## 2. Xác nhận: các thay đổi tôi vừa làm (doc 41) — ĐÃ KIỂM CHỨNG LIVE

| Thay đổi | Trạng thái live |
|---|---|
| **Programming Copilot Dock** (extension) | ✅ Chạy end-to-end. Rail phải hiện trên Engineering Workspace (badge "Engineering Workspace", có Apply), IR/POU (badge **"Advisory"** + note copy-only), **persist mở** khi chuyển trang, KHÔNG hiện trên hub/non-editor. i18n EN resolve đúng. |
| **Dedupe menu Copilot** | ✅ Sidebar chỉ còn **1** "Programming Copilot". |
| **Menu Devices tái cấu trúc** | ✅ Sections mới render: Monitoring / Connect & Setup / (Device Control) / Maintenance & Alerts; connectivity đã nằm trong "Connect & Setup" (breadcrumb xác nhận). |
| **Connectivity tab 2 tầng** | ⚠️ Code compile + logic đúng, nhưng **không xem được live** bằng engineer/operator (đều thiếu quyền `mqtt_monitoring` → Access Denied). Cần supervisor/admin để kiểm thị giác. |
| **i18n connectivity/dock (vừa thêm)** | ✅ Đã thêm 4 nhóm + 9 tab + 10 key dock cho vi/en/zh; JSON hợp lệ; dock hiển thị EN đúng. |
| **Menu quirk cần kiểm** | ⚠️ `edge-nodes/robot-control/control-plane` đều `section:"control"` trong code, nhưng sidebar render "Device Control" = {Robot Control, Factory Control Plane} còn "Edge Nodes" tách thành leaf riêng ở trang khác. Quirk render sidebar (data đúng) — cần soi component render section. |

---

## 3. MODULE "THIẾT BỊ & GIÁM SÁT" — phát hiện

### 3.1 P0/P1 Bảo mật & RBAC (backend, đã tự kiểm chứng)

- **[P0-1] Rò `apiKey` máy plaintext cho MỌI user đăng nhập (kể cả viewer).** `machine.getById` (`hierarchyRouters.ts:1057`) dùng bare `protectedProcedure` trả `SELECT *` gồm cột `apiKey` (`hierarchy.ts:444`). Sibling `list` cố tình bỏ key, `getById` thì không → viewer đọc credential ingest → mạo danh máy, giả mạo inspection. **Mở lại đúng lớp lỗ hổng doc-51 vừa đóng.** Fix: strip `apiKey` khỏi `getById`/`getStats`.
- **[P0-2] Phi-admin đặt `apiKey` tuỳ ý + tự duyệt đăng ký máy.** `machine.update` (`hierarchyRouters.ts:1138`) = `requirePermission("settings_factory","canEdit")` (đã mở cho **engineer** ở doc-47), nhận `apiKey`(:1154)+`registrationStatus`(:1150) ghi thẳng. Non-admin đặt key đã biết → auth thành máy; lật `registrationStatus→approved` bỏ qua admin-only. Audit **che value → vô hình**. Fix: chuyển 2 field này sang path admin-only.
- **[P1-3] OEE/downtime/health viewer ghi được, một cái tới ERP outbox.** `mqttOeeRouters.ts:422,560,572,602` bare `protectedProcedure`: `calculateOEE`→ghi `oee_metrics`+ERP outbox; `startDowntime/endDowntime`; `calculateMachineHealth`. Viewer bơm dữ liệu OEE/downtime/health chảy vào ERP + PdM.
- **[P1-4] Ngưỡng chất lượng toàn nhà máy + ack chéo-user ai cũng ghi được.** `alertRouters.ts:394,450,347,260` — `yieldThreshold.update` bare ghi FPY/FY/NTF/UPH toàn factory; `alert.acknowledge` không kiểm scope → ack alert của user khác. UI gate `useCanWrite` nhưng **server không kiểm**.
- **[P1-5] Publish MQTT + config ai đăng nhập cũng chạy được.** Nhiều bare `protectedProcedure`: `testNGAlert` publish MQTT+FCM; `bulletin.triggerNow/sendTest`; analytics kết nối nhận input tuỳ ý → **đầu độc dữ liệu**.
- **[RBAC] Đọc inventory fleet không gate** (`statusTemplateRouters.ts:16-45`) — viewer đọc cả nhà máy + uptime.
- **[RBAC] Broker auth lỏng** — `aedes.authenticate` auto-insert deviceId lạ là PENDING + chấp nhận; password chỉ kiểm khi `MQTT_REQUIRE_PASSWORD`.
- **[RBAC UI] robot-control "403 lệch"** — engineer thấy toggle Enabled + nút Điều khiển/Test nhưng server `setEnabled/testConnection` là `adminProcedure` → bấm 403 (kiểm chứng LIVE). Onboarding Step4/5 admin-only cũng dead-end luồng engineer.

### 3.2 Data-integrity (backend)

- **N+1 @60s:** `getAllMachinesWithStatus` = `1+3N` query (`machine.ts:69`) không cap, refetch mỗi 60s → không scale hàng trăm máy. (factory-command đã viết set-based; path fleet thì chưa.)
- **State tạm giả làm live:** OEE Health tab đọc in-memory Map (rỗng sau restart); MQTT Replay ring in-memory 1000-cap.
- **Analytics SAI thầm lặng:** reconnect `successCount==failureCount==total` (đều `COUNT(eventType)`); heatmap `DOW-1` bỏ Chủ nhật + lệch nhãn 1 ngày.
- **Thiếu UNIQUE/idempotency:** `oee_metrics` không có unique `(machineId,timestamp,periodType)` → trùng dòng dưới đua; `workOrderNumber` dựa `Date.now()+random` không ràng buộc DB; `assignedTo` int không FK.
- **Secret at-rest plaintext:** broker password + `machines.apiKey` (trái với claim-token đã hash).

### 3.3 Frontend LIVE (từng màn)

| Màn | Render | Phát hiện |
|---|---|---|
| **/factory-command** (Chỉ huy nhà máy) | ✅ REAL data | KPI (3 chạy/33 chờ/20 vấn đề), rail "Vấn đề mở" đầy (Andon, WO quá hạn, nguy cơ hỏng 92-100% CRITICAL). Lưới 2D **rất tối giản** (ô màu, không nhãn/không nhóm Line). OEE factory = "—". Toàn bộ nhãn **hardcode VN**. |
| **/device-monitor** | ✅ cấu trúc xuất sắc | Tabs Fleet/Health&OEE/OEE&Downtime/Field, 51 device, adapter chips. **HOLLOW telemetry: ONLINE 0, tất cả "Unknown/never/no telemetry yet"** (heartbeats=0, không feed sống). i18n EN OK. |
| **/oee-dashboard** | ⚠️ **BUG DỮ LIỆU** | Avg OEE **0.0%**, "Machines monitored 0/36", "No OEE data available yet" **dù có 897 dòng oee_metrics seed**; Downtime cùng trang lại hiện 4937 phút → OEE read path lọc mất historical/join hỏng. Header hiện literal **"Subtitle"**. |
| **/cmms** (Bảo trì) | ✅ REAL | 13 WO (predictive P1/P2 + maintenance), badge P1-P3, status OPEN/COMPLETED/IN_PROGRESS. Trùng lối vào: nav có "Work Orders" riêng + tab "Lệnh CV" trong CMMS. Hardcode VN. |
| **/robot-control** | ✅ REAL 3 robot | "403 lệch" (xem RBAC). Mixed i18n trong cùng hàng. |
| **/connectivity** | 🔒 Access Denied | engineer + operator đều thiếu `mqtt_monitoring` → **cả 2 persona vận hành không mở được MQTT hub**. |
| **/operator** (home operator) | ✅ Thiết kế tốt | Touch-first, nút to, welcome guide, shift session. Mixed EN/VN. |

---

## 4. MODULE "KỸ THUẬT & ĐIỀU KHIỂN" — phát hiện

### 4.1 An toàn — ĐIỂM MẠNH (đã kiểm chứng)

Gate deploy nằm ở **service** không phải router: `programmingService.computeDeploy` chạy four-eyes → build-ok → **SoD** (confirmedBy≠requestedBy) → **Simulation Gate** → `adapter.deploy` **chỉ khi** `DPC_DEPLOY_ENABLED && confirmedBy` → verify-after-download. Gate đóng ⇒ ghi "simulated", HW path không chạy. IR/POU/copilot thuần preview, không chạm thiết bị. Copilot **hard-refuse** logic an toàn (regex gồm CJK 安全/急停) + validate mọi program qua adapter. **Đây là chuẩn mực cho phần còn lại của hệ thống.**

### 4.2 P1/P2 RBAC & governance

- **[P1] Interlock thiếu sàn role.** `interlockRouter.ts:66-192` mọi mutation chỉ `requirePermission("interlock",...)` (bit per-user, không sàn). `enable` (:156) chỉ cần `interlock/canEdit` → bật rule an toàn-kề (tiền đề engine auto stop_line). Đây là **surface điều khiển DUY NHẤT không sau `actuationProcedure`**. `interlock.approve` (:136) bare protectedProcedure + inline admin check → **bỏ qua 2FA**. (Giảm nhẹ: engine auto cần 3 cờ đều off.)
- **[P2] Governance không maker/checker RBAC.** `equipmentStandardsRouter` submit/review/publish cùng `machine_control/canCreate` → 1 người submit→duyệt→publish.
- **[Med] Authoring program chỉ bit, không sàn** (`saveFlow/createArtifact/buildArtifact`) — bit lạ trên viewer cho phép compile.
- **[Low] Copilot review/explain không refuse** phân tích logic an toàn (chỉ generate/complete/translate refuse).

### 4.3 Data-integrity

- **[Med] Đua số version:** `saveFlow`/`createArtifact` = `max()+1` không transaction → 2 save đồng thời đụng unique index → **500 thô** thay vì CONFLICT sạch.
- **[Low] Idempotency nuốt reject:** trả lại row cũ theo `idempotencyKey` bất kể status → deploy đã reject không thử lại được.
- **`orchestration.simulate` nạp cả bảng `machines` rồi filter in-memory** (perf).

### 4.4 Frontend LIVE (từng màn)

| Màn | Render | Phát hiện |
|---|---|---|
| **/engineering-home** | ✅ Đẹp | Hub-and-spoke, card + Beta, golden-thread banner, empty-state gọn. |
| **/engineering** (Workspace) | ✅ + Dock của tôi chạy | Chỉ 1 project "DEMO" tag **stub** → gần rỗng (builds/deployments/sim = 0). |
| **/ir-editor** | ✅ Functional | Block palette + canvas + Lint OK + transpile. Banner preview. **Dock overlay che ~30% phải** (Version/Save khuất) — cân nhắc push-layout/resizable. |
| **/pou-studio** | ✅ Tốt | KPI + LAD/FBD/SFC + **Transpile→ST sinh code thật**. Không rỗng (default client-side). |
| **/engineering-changes** (ECN) | 🔒 Access Denied | **engineer bị chặn** — ECN gate `masterdata` (kỹ sư không có) → người đáng lẽ tạo ECN không mở được. Nên gate lại theo `machine_control`/engineering. |
| **/recipes** | ✅ cấu trúc, **HOLLOW** | "Recipe codes (0)", "Deployment history (0)" (DB recipes=0). |
| **/interlock-rules** | ✅ 1 rule seed | **RBAC UI**: badge "View Only" nhưng vẫn hiện nút New rule/Disable/edit (khớp P1 backend). |
| **/orchestration-studio** | ✅ Functional | Visual builder + AI advisor (sẽ fail — AI offline). |
| **/fleet-orchestration** | ✅ cockpit, **HOLLOW** | 9 KPI đều 0, task queue rỗng (fleet_* trống; seed-automation-demo chưa chạy). |

---

## 5. Bảng "màn rỗng vì thiếu seed" (nguyên nhân chính khiến cảm giác chưa hoàn thiện)

Seed hiện chỉ phủ Devices. Chạy seed Engineering + automation-demo sẽ **lấp phần lớn cảm giác rỗng**:

- Engineering Workspace (builds/deployments/sim = 0), Recipes (0), Interlock events (0), **ECN (0)**, Fleet (tất cả 0), Equipment standards (device_types/master_alarms = 0), **MQTT dashboards** (mqtt_* = 0), Edge nodes (0), UNS designer (0), Changeover mapping (0, seed no-op vì product_models=0).
- Device Monitor telemetry (heartbeats=0 → ONLINE 0), OEE dashboard (đọc không ra 897 dòng — **bug đọc, không phải thiếu data**).

---

## 6. Cross-cutting

**i18n (bộc lộ ở locale EN):** raw key ở Login ("Login subtitle/Username placeholder/…"), Account menu ("Title"), OEE header ("Subtitle"); hardcode VN ở FactoryCommand/CMMS/ECN/War-room/Feeder/Changeover; mixed EN/VN trong cùng hàng (robot-control, operator home).

**RBAC pattern hệ thống:** "chỉ bit per-user, không sàn role" + route-guard **chỉ ở client** → biên thực sự là procedure server, mà nhiều mutation là bare `protectedProcedure`. Đây là chủ đề xuyên suốt cả 2 module.

**2FA không đồng nhất:** engineer1 bị hỏi OTP, operator1 không — dù seed đặt `two_factor_enabled=true` cho cả hai.

**Thiết kế/bố cục/màu:** nhất quán, dark + teal accent, spacing tốt, empty-state/denied-state đẹp, KPI card rõ. Điểm trừ: lưới 2D factory-command quá tối giản; dock overlay che editor; vài nhãn lowercase ("Avg oee"). Tổng thể **8/10 hình thức**.

---

## 7. KẾ HOẠCH NÂNG CẤP & HOÀN THIỆN (đề xuất — chờ duyệt)

Sắp theo **rủi ro giảm dần**. Mỗi đợt là một lô agent chuyên môn thực thi, green-gate (`NODE_OPTIONS=--max-old-space-size=8192 tsc` + build) sau mỗi đợt.

### Đợt A — P0 BẢO MẬT CREDENTIAL (chặn ship)
1. Strip `apiKey` khỏi `machine.getById`/`getStats`/mọi full-row return (P0-1).
2. Gỡ `apiKey`+`registrationStatus` khỏi schema `machine.update`; chuyển sang path admin-only + step-up (P0-2).
3. Hash `machines.apiKey` + broker password at-rest (theo claim-token đã có).

### Đợt B — AN NINH HOÁ RBAC ĐỒNG BỘ
4. Thêm `writeProcedure`/sàn role dưới MỌI mutation nghiệp vụ: OEE/downtime/health (P1-3), yieldThreshold + alert.ack/create (P1-4), MQTT publish/config/analytics (P1-5), device-config (edge/adapter/hot-folder).
5. Interlock: `create/update/enable/disable/delete/resolveEvent` → `actuationProcedure`; `approve` → `adminProcedure` (2FA) (P1 Eng).
6. Gate đọc inventory fleet (`machineStatus.*`, `robot.telemetry/jobs`).
7. Sửa "403 lệch" robot-control (ẩn nút khi không đủ quyền) + ECN gate lại theo engineering thay `masterdata`.
8. Governance equipment: SoD `reviewedBy≠requestedBy`.

### Đợt C — DATA-INTEGRITY & CORRECTNESS
9. Fix **OEE dashboard đọc rỗng** (P1 FE — cửa sổ/join) — ưu tiên cao vì user thấy ngay.
10. UNIQUE chống trùng: `oee_metrics(machineId,timestamp,periodType)`, `machine_health_history(machineId,timestamp)`.
11. WORM thực thi: REVOKE UPDATE/DELETE (hoặc trigger append-only) trên `command_log`/`program_deployments`/`robot_jobs`/`product_inspections`.
12. `robot_telemetry` add retention 365d.
13. Version-append race → txn+retry → CONFLICT sạch. Idempotency: bỏ short-circuit trên trạng thái rejected.
14. Fix analytics reconnect (COUNT success/fail) + heatmap DOW. Persist OEE-health + MQTT-replay vào bảng thật thay in-memory.
15. Thay N+1 fleet-status bằng query set-based + phân trang.

### Đợt D — LẤP DỮ LIỆU (hết rỗng)
16. Viết/chạy seed Engineering (projects/artifacts/builds/deployments/sim, recipes, interlock_events, ECN, equipment device_types/master_alarms) + `seed-automation-demo` (fleet) + MQTT/edge/uns + heartbeats để Device Monitor có telemetry sống + changeover mapping (cần product_models trước).

### Đợt E — i18n & FE POLISH
17. Điền raw key Login/Account/OEE ("Subtitle"/"Title"/…); i18n-hoá FactoryCommand/CMMS/ECN/War-room/Feeder/Changeover; dứt điểm mixed EN/VN.
18. Nâng lưới 2D factory-command (nhãn máy, nhóm theo Line, mini-KPI). Dock: đổi overlay→push-layout hoặc resizable để không che editor. Soi quirk render "Device Control/Edge Nodes".
19. Gỡ trùng lối vào Work Orders (item vs tab CMMS). Chuẩn 2FA đồng nhất mọi role.

### Đợt F — (không phải code) chủ nhà máy/HW
20. Bật đúng thứ tự cờ an toàn TRƯỚC khi `DPC_DEPLOY_ENABLED`: `DPC_VERSION_REVIEW_ENABLED`, `DPC_DEPLOY_APPROVAL_ENABLED`, `ACTUATION_STEPUP_2FA`. Default-deny broker. Dọn `.env` (comment timescaledb sai; `RETENTION_OT_TELEMETRY_DAYS=0`).

---

## 8. Quyết định cần anh chốt

- **Đ1:** Phạm vi thực thi ngay — chỉ **A+B+C** (bảo mật + RBAC + correctness, ưu tiên cao nhất) hay **A→E** (thêm seed + i18n + polish)?
- **Đ2:** ECN nên mở cho **engineer** (gate `machine_control`) hay giữ `masterdata`?
- **Đ3:** Connectivity/MQTT hub có nên cho **operator/engineer xem (read-only)** không, hay giữ admin/supervisor?
- **Đ4:** Đợt D (seed) — seed rộng để demo "đầy đủ", hay chỉ seed tối thiểu cho QA?
- **Đ5:** WORM (Đợt C-11) làm bằng REVOKE grant hay trigger append-only?

---

## 9. THỰC THI (2026-07-16) — kết quả

User duyệt **A→E** + Đ1(A→E)/Đ2(ECN→engineer)/Đ3(MQTT read-only operator+engineer)/Đ4(seed rộng)/Đ5(WORM=REVOKE). Thực thi tuần tự, green-gate (`NODE_OPTIONS=--max-old-space-size=8192 tsc` + `vite build`) sau mỗi đợt.

| Đợt | Kết quả | Green-gate |
|---|---|---|
| **A — P0 credential** | `machine.getById` strip apiKey; 2 UI leak → regenerate-and-copy admin-only; `update` bỏ apiKey + gate registrationStatus admin. | tsc 0 |
| **Đ2 — ECN engineer** | nav + route-guard + **EngineeringChanges.tsx** đổi `masterdata`→`machine_control` (ecnRouter server đã cho engineer sẵn). **Verify LIVE: engineer1 mở ECN đầy đủ 3 ECN + nút xem xét/duyệt/triển khai.** | — |
| **B — RBAC** | ~25 mutation gated (mqtt/oee/alert/status/robot/interlock/equipment/authoring); interlock→actuation, approve→admin(+2FA); alert.ack owner-scope; robot-control ẩn nút non-admin (403-lệch); Đ3 grant mqtt-view operator/engineer + mig 0277. | tsc 0 + build ✓ |
| **C — correctness + migration** | version-race→CONFLICT retry (programming/ir); analytics reconnect SUM/CASE + heatmap DOW; N+1 fleet→set-based 4 query. **3 migration ÁP LÊN DB (owner aoi):** 0278 dedup+UNIQUE (xoá 95 dòng health trùng), 0279 WORM REVOKE per-table (command_log/product_inspections=DELETE-only vì có UPDATE paths; program_deployments/robot_jobs=DELETE-only), 0280 robot_telemetry retention 365d. | tsc 0 + build ✓ |
| **D — seed rộng** | `seed-engineering-data.mjs` (11 bảng) + re-run `seed-test-data` (fix recency) + `seed-automation-demo` (fleet). **+108 heartbeats, +252 oee (tươi), +3 programs/recipes/interlock-events, ECN, device_types, +6 orchestration_runs, mqtt/edge/uns, fleet zones/tasks.** | seed OK |
| **E — i18n** | 114 key/locale ×3 (factoryCommand 48 + cmms 66); fix placeholder Login/OEE/account "Title"→"Sessions". | tsc 0 + build ✓ |

### QA verify LIVE (engineer1, port 3000, bundle mới)
- ✅ **OEE Dashboard: 33.8% / 36-36 máy** (trước 0.0% / 0-36 "no data") — fix seed-recency + i18n subtitle.
- ✅ **Recipes: 3 codes** SEED-RCP-AOI/AVI/SPI-L1 + 3 deployment (trước "0 No data yet").
- ✅ **ECN engineer: full access** 3 ECN + action buttons (trước Access Denied → no-permission).
- ✅ **i18n Login**: "Choose how you want to sign in" / "Enter your username" (trước raw key "Login subtitle"...).
- ✅ 0 console error mọi màn kiểm.

### Follow-up còn lại (ngoài A→E hoặc phát sinh khi QA)
1. **A3 — hash apiKey + broker password at-rest** (HOÃN có chủ đích): cần viết lại đường ingest-verify (so hash) + migration cho key hiện có. Lỗ hổng LEAK + SELF-SET đã đóng ở Đợt A nên không gấp; làm riêng cẩn thận.
2. **BUG 2FA lockout (phát hiện khi QA):** seed user có `two_factor_enabled=true` nhưng `two_factor_secret=null` (operator1/supervisor1/maint1) → UI hỏi 2FA nhưng không có mã hợp lệ → **khoá đăng nhập**. engineer1 có secret (login được). Fix: seed set 2FA OFF cho test-user, HOẶC sinh + lưu secret cho mỗi user. (Cũng là lỗi luồng auth: enable-2FA phải set secret nguyên tử.)
3. **Cosmetic (đợt polish riêng):** dock copilot overlay→push-layout; lưới 2D `/factory-command` phong phú hơn (nhãn máy, nhóm Line, mini-KPI).
4. **i18n còn sót:** trang ECN (EngineeringChanges) còn vài nhãn VN trong locale EN ("Mọi trạng thái/Bắt đầu xem xét/Từ chối/Gửi duyệt/Đánh dấu triển khai") — E phủ FactoryCommand+CMMS (ưu tiên), ECN để đợt i18n sau.
5. **Chủ nhà máy (Đợt F, không code):** bật cờ an toàn đúng thứ tự trước `DPC_DEPLOY_ENABLED`; default-deny broker; dọn `.env` (comment timescaledb sai; `RETENTION_OT_TELEMETRY_DAYS=0`).

### Ghi chú vận hành
- Toàn bộ thay đổi **uncommitted** (git môi trường này không đáng tin cho `client/` — xem §0; user tự kiểm + commit).
- Migration 0277-0280 đã áp DB `aoi_management@5434` (owner `aoi`). 4 migration cũ tồn đọng (0057/0066/0125-RLS/0234) **CHỦ ĐÍCH không áp** (không thuộc doc 54).
- Dev server chạy nền cổng 3000 (có mọi thay đổi). Server 3001 của user đã tắt trong lúc thực thi.

### §9b — Follow-up ĐÃ LÀM NỐT (2026-07-16, user duyệt)

**1. BUG 2FA-lockout — FIXED + verify LIVE.** `seed-test-data.mjs > ensureUser` giờ sinh + lưu `two_factor_secret` (speakeasy) cho mọi user (backfill COALESCE — giữ secret engineer1 sẵn có). Re-run seed → 4 persona đều có secret; `print-otp.mjs <user>` cho mã hợp lệ. **Verify LIVE: operator1 đăng nhập 2FA thành công** (trước khoá cứng).
- Tiện thể xác nhận **Đ3 + tab 2 tầng connectivity của tôi (doc-41) LẦN ĐẦU thấy LIVE:** operator1 mở /connectivity (trước Access Denied) → MQTT Dashboard render với hàng tab chính **Monitoring | Diagnostics | Alerting | Configuration** + tab con **Overview | Devices | Topics & Messages**; MQTT seed hiển thị (3 clients, 6 messages, 100% delivery). i18n EN đúng.

**2. A3 hash-at-rest — làm phần AN TOÀN, phần rủi ro nêu rõ:**
- ✅ **Broker password leak — FIXED:** `mqttClientManagement.listProfiles`/`getProfile` (protectedProcedure) TRƯỚC trả full row gồm `password` plaintext cho mọi user → **strip `password`, chỉ trả `hasPassword: boolean`** (mirror fix apiKey P0-1). tsc 0. (Đây là bề mặt lộ thực sự — đã đóng.)
- ℹ️ **apiKey**: đường hiện đại `api_keys` ĐÃ hash-at-rest (SHA-256, mig 0126/0178). Cột plaintext `machines.apiKey` chỉ là đường LEGACY yếu, điều khiển bởi env `MACHINE_SHARED_KEY_ALLOWED` — **`.env.example` đã ship secure-default `=false`**. Hash cột legacy là SAI hướng; retire hẳn (provision api_keys cho máy hiện có + clear cột) = việc operator + migration (Đợt F), KHÔNG đổi default runtime kẻo vỡ ingest máy chưa rotate.
- ⏭️ **Broker password ENCRYPT-at-rest (còn lại):** password dùng để KẾT NỐI broker ngoài (outbound) → cần **mã hoá thuận nghịch** (AES-GCM + managed key + migration + decrypt-on-connect), KHÔNG phải hash. Là feature key-management riêng, chưa làm (tránh vỡ kết nối broker); **bề mặt lộ đã đóng ở trên** nên không gấp.

### §9c — Broker encrypt-at-rest + Đợt F (2026-07-16, user duyệt)

**Part 1 — Broker password AES-GCM encrypt-at-rest (feature trọn vẹn):**
- Mới `server/services/security/secretBox.ts`: AES-256-GCM, format `enc:v1:<b64(iv|tag|ct)>`, key từ `SECRET_ENCRYPTION_KEY` (fallback derive từ `JWT_SECRET` qua scrypt), **passthrough legacy plaintext** (transitional), idempotent. **Crypto verify PASS** (roundtrip/passthrough/idempotent/null).
- Wire `mqttClientManagementRouter`: encrypt-on-write (`createProfile`/`updateProfile`/`importProfiles`), strip password khỏi read (`listProfiles`/`getProfile` — đã làm §9b) + **bỏ password khỏi `exportProfiles`** (protectedProcedure — trước export cả credential).
- `scripts/backfill-broker-passwords.ts` (chạy: 0 profile có password → không cần convert, feature sẵn cho write tương lai). `.env.example` doc `SECRET_ENCRYPTION_KEY`. tsc 0.

**Part 2 — Đợt F (config + provisioning, verify LIVE):**
- **Provision api_keys:** `scripts/provision-machine-api-keys.mjs` — hash `machines.apiKey` HIỆN CÓ của 15 máy vào `api_keys` (path hash-at-rest 0178) → **15 api_keys rows created**. Máy giữ key cũ, auth qua path hash → tắt legacy an toàn.
- **.env (backup `.env.doc54F.bak`):** `MACHINE_SHARED_KEY_ALLOWED=true→false` (tắt legacy shared plaintext); `MQTT_REQUIRE_PASSWORD=true` (default-deny broker — thiết bị không password vẫn chạy); và vì `DPC_DEPLOY_ENABLED=true` sẵn → **bật 3 lớp bảo vệ deploy**: `DPC_VERSION_REVIEW_ENABLED`, `DPC_DEPLOY_APPROVAL_ENABLED`, `ACTUATION_STEPUP_2FA` (OTP tươi mỗi lệnh actuation).
- **Restart dev server + verify LIVE:** boot 200 không lỗi; operator1 device-monitor render OK (39 device, "Offline/12h" thay "Unknown/never"). MACHINE_CODE_ONLY_ALLOWED **giữ default** (không tắt — tránh vỡ sim ingest).

**Lưu ý sau Đợt F:**
- `ACTUATION_STEPUP_2FA=true` → mỗi lệnh actuation (robot/deploy) cần **OTP tươi** — test actuation sẽ cần mã mỗi lần (đúng thiết kế production).
- Console-noise mới thấy (không phải regression F): `/device-monitor` fire `deviceAdapter.list` bất kể quyền → operator1 (không machine_control) nhận 403 log. FE nên `enabled: hasPermission("machine_control")` trước khi query — polish nhỏ.
- `.env.doc54F.bak` giữ lại làm điểm khôi phục; xoá khi chắc chắn.

### §9d — Commit/push + cosmetic (2026-07-16, user duyệt)

**Commit + push (2 commit lên `fresh` github):**
- `d467c6b5` feat(doc54): toàn bộ A→E + Đ1-5 + follow-ups (2FA/broker) + Đợt F (54 files). Migration 0277-0280 đã áp DB (files committed). `.env`/`.bak`/tool-junk gitignore, KHÔNG lọt secret.
- `e495d954` polish(doc54): 4 cosmetic.
- Ghi chú git: anomaly một phần (file turn-trước nằm sẵn trong tree HEAD) — commit là snapshot working-tree nên bắt TRỌN (đã verify markers có trong HEAD).

**Cosmetic (4/4 DONE, green-gate tsc0+build):**
1. Dock push-layout: mở rail đẩy nội dung (body padding-right) trên viewport rộng, không che editor.
2. Lưới 2D: hiện mã máy ở fit-all cho fleet ≤60 + font lớn hơn (hết "ô màu trơ").
3. ECN i18n: +43 key ×3 locale (component đã t()-wired sẵn) → EN/ZH hết fallback VN.
4. FE-gate: `deviceAdapter.list`+edge query gate machine_control view → **verify LIVE operator1 0 console error** (trước 3× 403). Bonus: factory OEE hiện 30% (trước "—").

**doc 54 — TOÀN BỘ HOÀN TẤT & ĐÃ PUSH.** Còn lại chỉ việc operator/HW ngoài phạm vi code.

---

## 10. TÁI ĐÁNH GIÁ độ hoàn thiện (hậu-remediation, 2026-07-17) — CHỜ DUYỆT

**Phương pháp:** 3 subagent chấm lại độc lập code/backend/DB theo trạng thái HIỆN TẠI (spot-check file + SQL live) + tôi lái Playwright đánh giá frontend/thiết kế đa persona. Đây là đo lại độ hoàn thiện SAU khi đã thực thi §9/§9b/§9c/§9d.

### 10.1 Scorecard: TRƯỚC (§1) → SAU (hậu-fix)

| Trục (thang 100) | Thiết bị & Giám sát | Kỹ thuật & Điều khiển |
|---|---|---|
| Backend đúng đắn/REAL | 74 → **82** | 82 → **84** |
| An toàn / RBAC | 55 → **80** | 68 → **83** |
| Data-integrity | 60 → **78** | 66 → **80** |
| Frontend render/UX | 72 → **80** | 78 → **82** |
| Độ đầy dữ liệu | 62 → **80** | 40 → **80** |
| Thiết kế/bố cục/màu | 80 → **80** | 82 → **82** |
| i18n | 55 → **72** | 58 → **70** |
| **TỔNG** | **~65 → ~78** | **~68 → ~81** |

*(DB/data-integrity riêng: ~60 → **78**.)* **Cải thiện ~+13 điểm/module.** Khoảng cách còn lại tới "production" = **polish + vài surface RBAC bị sót + độ-thực dữ liệu**, KHÔNG phải kiến trúc.

### 10.2 Đã verify vững (hậu-fix)
- **2 P0 đóng thật** (getById strip apiKey; update reject apiKey/registrationStatus non-admin). **~25 mutation gated** (writeProcedure/actuation/admin). **Interlock**→actuation, approve→admin+2FA. **Broker secret** strip read + AES-256-GCM encrypt-at-rest (secretBox đúng). **Analytics** SUM/CASE + DOW fixed. **N+1 fleet** → set-based.
- **DB (SQL live):** UNIQUE `uq_oee_metrics_*`/`uq_machine_health_*` tồn tại **0 dup**; **WORM REVOKE hiệu lực trên `avi_app`** (command_log INSERT+SELECT only; product_inspections/program_deployments/robot_jobs mất DELETE); robot_telemetry retention **365d**; **15 machine api_keys** hashed. Row-counts lấp đầy (program 4, recipes 3, interlock_events 3, ECN 3, edge 3, uns 15, heartbeats 108, mqtt 3/6/31, oee 897, health 38k, robot_telemetry 159k).
- **Deploy-gate (Engineering):** four-eyes→build→SoD→sim-gate→adapter chỉ khi enabled+signed→verify-after-download; inbox `ai_pending_actions` + dispatcher re-verify `NOT_CONFIRMED` → formality-four-eyes KHÔNG chạm HW.
- **Live QA (Playwright):** OEE 35.1%/36-36, Recipes 3, ECN engineer full, connectivity 2-tier, 2FA-lockout hết, 0 console error.

### 10.3 Đánh giá FRONTEND/thiết kế (từng màn/element/bố cục/màu)
**Điểm mạnh:** identity nhất quán dark+teal, content-first (canvas ≥70%); Engineering Hub hub-and-spoke + Beta badge + golden-thread; Operator home touch-first đúng persona; OEE/CMMS/Device-Monitor dùng DataTable + badge priority/status + chart (OEE comparison bar chart thật); POU Studio KPI + LAD/FBD/SFC + transpile ST thật; empty/denied-state đẹp; Copilot Dock rail polish + safety note; connectivity 2-tier tab sạch. **Hình thức ~8/10.**
**Điểm yếu/còn lại:**
- **[DESIGN] Canvas 2D `/factory-command` vẫn crude** — ô chữ nhật màu 1 hàng, nhãn giữa hiện "—" khó đọc, chưa group Line trực quan, không legend. Tweak nhỏ (showAllCodes+font) CHƯA đủ; phàn nàn gốc "sơ sài" của user CÒN.
- **[DATA-hệ thống] Seed-staleness:** OEE/telemetry cũ đi theo thời gian (thấy live: OEE 30%→"—" sau ~16h; re-seed → 35.1% lại). Màn phụ thuộc live-window tự rỗng.
- **i18n partial:** FactoryCommand/CMMS/ECN đã key-hóa; còn mixed EN/VN ở robot-control rows, operator home, vài chỗ.
- **RBAC-UI:** interlock vẫn hiện nút hành động khi "View Only" (robot-control đã fix).

### 10.4 ĐÍNH CHÍNH báo cáo trước (subagent phát hiện)
- **§9c SAI về step-up-2FA:** `ACTUATION_STEPUP_2FA=true` **KHÔNG** làm deploy family cần OTP tươi. `deployBuild/approveDeployment/rollbackDeployment/deployToFleet` dùng `actuationProcedure` = chỉ kiểm **cờ 2FA tài khoản** (`require2FA`), KHÔNG phải `requireFreshTotp`. Chỉ `orchestration.deployWorkflow` (deployProcedure) mới OTP-tươi. → Cờ đang **inert** trên deploy family (xem G2).
- **§3.2 SAI về workOrderNumber:** thực ra `maintenance_work_orders_workOrderNumber_unique` ĐÃ tồn tại (0 dup) — KHÔNG phải gap.

### 10.5 KẾ HOẠCH NÂNG CẤP còn lại (đề xuất — CHỜ DUYỆT)

**Đợt G1 — RBAC surface bị sót (HIGH, ship-blocker):**
- Gate `mqttAlert` mutations còn bare protectedProcedure (`mqttOeeRouters.ts:1083/1107/1132/1140/1160` create/update/delete/toggle/resolve) — Wave B sót sub-router này; viewer CRUD được luật cảnh báo MQTT. + `mqttClientManagementRouter.ts:1648/1776/1795` (updateAlertConfig/ack/resolve). Fix: writeProcedure + requirePermission(mqtt_monitoring).
- **G2 (đính chính):** đổi `deployBuild/approveDeployment/rollbackDeployment/deployToFleet` → `deployProcedure` (+ nhận `totpCode`) để `ACTUATION_STEPUP_2FA` thực sự yêu cầu OTP tươi (hoặc bỏ claim).

**Đợt G3 — Data resilience (MED):**
- Live machine-health READ hydrate từ `machine_health_history` khi Map lạnh (hết "—" sau restart).
- Fix seed-staleness: **continuous-sim feeder** (đẩy status_logs/heartbeat/oee liên tục) HOẶC OEE fallback last-known `oee_metrics` khi live-window rỗng.
- Idempotency: bỏ short-circuit trên trạng thái `rejected/failed` (deploy retry được); partial-UNIQUE `product_inspections(idempotencyKey)`.

**Đợt G4 — DB referential hardening (MED):**
- Thêm FK `machineId→machines(id)` trên bảng thường (non-hypertable): edge_nodes, mqtt_clients, engineering_changes, tasks, interlock_events (+ maintenance_work_orders.assignedTo).
- Retire cột legacy `machines.apiKey` (null/drop sau khi chắc 15 máy auth qua api_keys hash).

**Đợt G5 — Design & i18n polish (LOW):**
- **Redesign canvas 2D** `/factory-command`: nhãn máy rõ, group theo Line, legend màu, mini-KPI mỗi ô (đúng phàn nàn gốc).
- Sweep i18n VN-in-EN còn lại (ECN leftovers, robot-control rows, operator home, FactoryCommand misc).

**Đợt G6 — Security hardening (LOW/defense-in-depth):**
- Copilot review/explain refuse phân tích logic an toàn; equipment-governance thêm writeProcedure floor; `orchestration.simulate` dùng inArray; startup-assert DB role KHÔNG superuser (bảo toàn WORM); set explicit `SECRET_ENCRYPTION_KEY` + doc "không rotate ẩu".

**Đợt G7 — Seed realism (LOW):** lấp bảng còn rỗng (factory_zones/safety_zones/recipe_sets/mqtt_message_history/mqtt_connection_status) + heartbeat/robot_job dày hơn.

**Ngoài code (chủ nhà máy/HW):** áp migration production; HW-FAT; Timescale cutover; bật LICENSE_MODULE_GATE_ENABLED (SKU) nếu cần.

### 10.6 Quyết định cần chốt
- **G-Đ1:** Thực thi ngay **G1+G2** (RBAC sót + step-up-2FA) — HIGH, nên làm trước?
- **G-Đ2:** Seed-staleness fix bằng **continuous-sim feeder** hay **OEE fallback last-known** (đơn giản hơn)?
- **G-Đ3:** Retire `machines.apiKey`: **null giá trị** (giữ cột) hay **drop cột** (migration)?
- **G-Đ4:** Redesign canvas 2D (G5) — làm ngay hay để đợt UX riêng?
- **G-Đ5:** Phạm vi thực thi: **G1-G4** (chức năng/an toàn/data) hay **G1-G7** (thêm design+polish+realism)?

---

## 11. LỘ TRÌNH TRIỂN KHAI NHÀ MÁY theo GIAI ĐOẠN (0→3) — audit + kế hoạch chi tiết (CHỜ DUYỆT)

Re-frame theo thứ tự ưu tiên triển khai của nhà máy (thay vì module/wave). 4 subagent đánh giá độ **sẵn-sàng-TRIỂN-KHAI** (không chỉ "màn render" mà "có dùng được ở nhà máy thật") + SQL live.

### 11.1 Ma trận độ sẵn-sàng triển khai

| Giai đoạn | Điểm deploy-ready | Cổng chặn chính | Kết luận |
|---|---|---|---|
| **GĐ0 — Master data** | **60** | Data/kích-hoạt (framework 85, data-completeness **15**) | Framework MẠNH, gần đủ màn; nhưng CHƯA load data thật lần nào + bulk MP-coordinate không có → không set được ở quy mô 100s sản phẩm |
| **GĐ1 — Kết nối + Monitor + Cảnh báo** | **70** | Activation posture (code REAL, ship flag-OFF) | Driver protocol THẬT (mở socket/lib), ingest production-grade; nhưng 15 adapter disabled, dashboard phụ thuộc derived-table chỉ sim ghi, chưa HW-FAT |
| **GĐ2 — Thống kê/phân tích/báo cáo** | **70** | 3 số-SAI live + realtime single-node | Reporting production-grade; nhưng Cpk≈1 giả, owner-notify throw, WIP sai nhãn; realtime chưa HA |
| **GĐ3 — Lập trình + điều khiển + AI** | **~81** | AI model offline + HW-FAT + step-up-2FA | Authoring/deploy-gate an toàn nhiều lớp THẬT; nhưng model AI chưa chạy (CUDA OOM), deploy chạm máy cần FAT, step-up-2FA inert |

**Chủ đề xuyên suốt:** cả 4 giai đoạn là **framework đẳng cấp** — cổng triển khai đồng nhất là **kích-hoạt + data thật + HW-FAT + config transport**, KHÔNG phải viết lại.

### 11.2 ⭐ Insight liên-giai-đoạn (đòn bẩy cao nhất)
Ba phát hiện độc lập cùng MỘT gốc: **không có service nào tính `daily_statistics` / machine-presence từ telemetry THẬT được ingest — chỉ sim-live-daemon làm.**
- GĐ1: `upsertDailyStatistics` (db/statistics.ts) **zero live caller**; `machinePresenceService` (MACHINE_PRESENCE_ENABLED **OFF**).
- GĐ2: OEE honest-null → máy thiếu factor bị drop → fleet-OEE rỗng; `oeeSnapshotScheduler` default-OFF → `oee_metrics` sparse.
- Live (tôi thấy): OEE 30%→"—" sau 16h (seed cũ đi).
→ **Wire "live derived-table writer" (GĐ1-T3) là fix đòn-bẩy cao nhất**: bật nó thì OEE/health/monitoring + phần lớn GĐ2 tự sống với máy thật. Nếu không, kết nối máy thật vẫn ra dashboard rỗng.

### 11.3 Kế hoạch chi tiết theo giai đoạn (deployment-ordered)

**GĐ0 — Master data (làm TRƯỚC NHẤT):**
- P0.1 [L] Wire **MP-coordinate bulk import** (Gerber/centroid/CAD→auto-place); nay `dataRouters.ts:320` hardcode positionX/Y=0, `cad_import_jobs` chưa nối → điểm-đo geometry-less, phải đặt tay từng điểm.
- P0.2 [M] **Load master data thật** + backfill componentCode/BOM (suppliers/materials/UoM/calendars/routing/BOM = 0; 34/34 điểm no componentCode → traceability/feeder/ERP-routing/Pareto inert).
- P0.3 [S] Unify RBAC bulk-import (`dataRouters.import*`/`productRouters.importList` admin-only → mở engineer) — hết single-admin bottleneck.
- P0.4 [M] Data-quality gate: mở rộng DQ dashboard sang hierarchy+points; **chặn map máy khi product under-configured** (0,0-points/no-threshold) → không feed junk spec-gate cho GĐ1.
- P0.5 [S-M] First-run factory bootstrap + tách sim/real (corporates 0; 22,995 inspection sim lẫn DB); import operator-badge/routing/BOM bulk.

**GĐ1 — Kết nối + Monitor + Cảnh báo:**
- P1.1 [M · HW] **Activate + provision adapter/endpoint per line** (flip OT_GATEWAY/MTCONNECT/CFX/HOT_FOLDER/MQTT/SECS_GEM=true; 15 adapter disabled→trỏ endpoint thật; tag mapping).
- P1.2 [M · no-HW] ⭐ **Wire live derived-table writers** (upsertDailyStatistics + machinePresenceService + OEE_SNAPSHOT_ENABLED) — đòn bẩy §11.2, làm OEE/health sống với máy thật.
- P1.3 [M · no-HW] **Config alert transports + seed rules** (SMTP/FCM/Forge unset; 0 rule; ngRate chỉ MQTT/FCM) — hiện out-of-box chỉ in-app WS.
- P1.4 [S · no-HW] **Flip durability+security go-live** (INSPECTION/OT_STORE_FORWARD, ANDON_SLA/ALERT_ESCALATION_SWEEP; MACHINE_CODE_ONLY_ALLOWED default-allow; +G1 gate mqttAlert còn bare).
- P1.5 [S] Thêm `slmp` vào deviceAdapter enum (driver+DB đã support).
- P1.6 [L · HW] **HW-FAT/commissioning** vs device thật (validate firmware quirk); complete scaffold FOCAS/IO-Link/Euromap63/SCPI **chỉ nếu** có máy class đó.

**GĐ2 — Thống kê/phân tích/báo cáo:**
- P2.1 [S] **Fix 3 số-SAI trust-blocker:** Cpk≈1 giả (productionDashboardRouter:509→dùng utils/spc), owner-notify throw (alertEvaluationService:111 boolean che hàm), WIP bottleneck sai nhãn (wipIngestService:460).
- P2.2 [M] OEE-trust: provision ideal-cycle-time + align production-count window với availability window + reconcile 2 OEE definitions (relabel uptime% vs SEMI-E10 6-state).
- P2.3 [M-L] Realtime HA: Redis adapter + REDIS_URL + leader-lock broadcaster/scheduler + move in-memory cooldown/dedup→Redis; impl BROKER_DISCONNECT/CLIENT_OFFLINE duration (nay hardcode 0); war-room push.
- P2.4 [M] Reporting breadth: mobile push FCM/APNs; SendGrid/SES fallback + bundle CJK font; paginate row-cap; report-builder server-render+schedule.
- P2.5 [M] Analytics coverage: compute takt/util/balance; downtime Pareto + MTBF/MTTR; recursive genealogy.

**GĐ3 — Lập trình + điều khiển + AI (làm SAU CÙNG):**
- P3.1 [M · HW] **Deploy AI model server** (llama-server đủ VRAM) — Copilot generate/AI-chat/exec-summary/orchestration-advisor chết khi model offline; AI-assist là cốt lõi GĐ3.
- P3.2 [S] **Step-up-2FA** (G2): deployBuild/approve/rollback/deployToFleet → deployProcedure + totpCode (nay ACTUATION_STEPUP_2FA inert).
- P3.3 [L · HW] **HW-FAT deploy** chạm PLC/robot thật (DPC_DEPLOY_ENABLED on + adapter thật + nghiệm thu 2-eyes). Chỉ bật SAU khi GĐ1/GĐ2 vững.
- P3.4 [S] Copilot review/explain refuse safety-logic; idempotency bỏ swallow-reject; orchestration.simulate inArray.

### 11.4 Đường tới-hạn (thứ tự khuyến nghị)
`GĐ0 (load data + MP-coord + DQ-gate)` → `GĐ1 (activate + ⭐derived-writer + transport + FAT)` → `GĐ2 (fix 3 trust-stat + OEE-reconcile + HA)` → `GĐ3 (AI-model + step-up-2FA + HW-deploy)`. **Không lập trình/điều khiển máy (GĐ3) trước khi monitor được (GĐ1) — đúng thứ tự anh đề ra.** Ưu tiên tuyệt đối: **P1.2 derived-writer** (mở khóa cả GĐ1+GĐ2 cho máy thật).

### 11.5 Quyết định cần chốt
- **L-Đ1:** Bắt đầu ngay **GĐ0 (load master data + MP-coord import)** hay **GĐ1 (activate connectivity + derived-writer)** trước? (GĐ0 là tiền đề data, nhưng derived-writer P1.2 là đòn bẩy — có thể làm song song).
- **L-Đ2:** MP-coordinate: đầu tư **CAD/Gerber auto-place** (L) hay tạm **CSV x,y thủ công** (S) cho pilot?
- **L-Đ3:** Có nhà máy/HW thật để **HW-FAT** (P1.6/P3.3) chưa, hay tiếp tục Full-Sim?
- **L-Đ4:** Realtime **HA (Redis multi-instance)** cần ngay (P2.3) hay chấp nhận single-node cho pilot?
- **L-Đ5:** Phạm vi thực thi đợt tới: **GĐ0+GĐ1 (nền + kết nối/monitor)** hay full **GĐ0→GĐ3**?
