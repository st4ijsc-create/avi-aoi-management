# Doc 59 — Audit IA Frontend + Kế hoạch hợp nhất giao diện theo vai trò (2026-07-18)

> **Yêu cầu (user):** audit frontend KHÔNG chỉ giao diện, mà cả **thiết kế · phân loại · bố cục** chức năng **đứng trên vai trò người dùng** để tiện lợi; KHÔNG chia quá nhiều tab/page rời rạc mà **tích hợp** các chức năng liên quan mật thiết thành **giao diện thống nhất**, hoàn thiện như **hệ sinh thái chuyên nghiệp**.
> **Phương pháp:** 3 agent chuyên môn audit song song (read-only) — (1) kiểm kê IA/surface, (2) phân mảnh theo vai trò, (3) blueprint hợp nhất. Nhánh `automation-orchestration-r0`.
> **Trạng thái:** CHỜ DUYỆT §9 trước khi thực thi.

---

## 1. Quy mô sprawl (số liệu)

- **207** `<Route>` (~171 route sống + 36 redirect) · **203** file `pages/*.tsx` · **51** file monolith >800 dòng · **10** nhóm nav · **~120** leaf menu.
- **9 trang ≥5 tab**: MachineCockpit 12 · RobotCockpit 12 · MasterDataManagement 10 · ConnectivityHub 9 · QualityCockpit 9 · DataSettings ~9 · TwinHub 6 · ProductModels 5 · MonitoringSettings 7.
- **Tâm chấn = miền THIẾT BỊ/OT**: cùng chức năng MQTT nằm ở 2 hub; fleet/health/OEE rải 6 nơi; "thêm thiết bị" 4-6 wizard.

## 2. 5 chủ đề phân mảnh (cắt ngang vai trò)

1. **★ Giao diện thống nhất ĐÃ XÂY nhưng KHÔNG tới được.** `MachineCockpit` (`/machine/:id`, 12 tab) + `RobotCockpit` — **không có menu**, chỉ drill. `ProcessAnalytics` (`/process-analytics`, doc-56 Đ3) + `DeviceOnboardingHubV2` (`/device-onboarding`, doc-56 Đ2b) — có route nhưng **không menu / cờ OFF**. ⇒ mọi vai trò rơi về các trang phân mảnh mà hub sinh ra để thay thế. (Chính là hệ quả của quyết định "hoãn menu tới Đ7" trong doc 56.)
2. **Giám sát fleet chia 3, dashboard KPI chia ~10.** "Máy tôi đâu / nhà máy thế nào" trả lời được từ `device-monitor` + `factory-command` + `line-view`; OEE/throughput lặp qua ~10 trang; nhiều trang tự nhận là "single pane" (`ControlTower`, `CommandCenter`).
3. **1 cấu hình logic bị xé qua nhiều NHÓM nav.** Tinh chỉnh 1 trạm = Engineering (`/recipes`,`/interlock-rules`) + Data-mgmt (`/products?tab=points|variants`) + Quality (`/measurement-point-health`) + Analytics (`/threshold-approvals`,`/oee-target-settings`). IA nhóm theo **loại artifact**, KHÔNG theo **máy/sản phẩm đang cấu hình**.
4. **Role-landing trỏ vào redirect-stub + lệch với sidebar.** `SupervisorHome` trỏ `/oee-dashboard`,`/spc-analysis` (đều là `<Redirect>` vào tab hub khác); `OperatorHome` có nút "Hỏi AI" trong khi Simple-mode ẩn cả nhóm AI.
5. **Simple/Advanced chỉ TRIM, rò công cụ quản lý xuống công nhân.** `filterNavGroupsByMode` giữ item `tier:'simple'` trong nhóm advanced ⇒ operator/quality vẫn thấy `/sla-cockpit`,`/war-room`,`/routing-master`… (công cụ supervisor/engineer) trong khi cockpit hợp nhất hữu ích lại bị ẩn.

## 3. Điểm mấu chốt: MÁY MÓC ĐÃ SẴN, chỉ thiếu 1 primitive

Đội đã xây đúng bộ máy hợp nhất — **KHÔNG cần rewrite**:
- **Hub tab compose thân trang trích sẵn** (`*Content`): `DeviceHub`/`ConnectivityHub`/`TwinHub`/`QualityCockpit`/`MonitoringSettings` + `ProcessAnalyticsPanel`.
- **Cockpit 1-aggregation-endpoint**: `MachineCockpit` ← `assetCockpit.machineDetail` (1 call, honest-null).
- **`ScopeFilterBar`** (URL-synced product/line/machine/date) + **`EntityPicker`** (MachineSelect/LineSelect/ProductModelSelect) = "context lock".
- **`⌘K CommandPalette`**, **persistent shell** (`APP_SHELL_PERSISTENT`), `DataTable`/`FilterBar`/`FormScaffold`/`AsyncBoundary`, `ui/resizable`+`ui/sheet`+`ui/drawer`, `patterns/*` (PageHeader/MetricCard/StatChip/StatusBadge/ImportExportBar…).

**Primitive CÒN THIẾU (đòn bẩy cao, nhỏ):**
- **`WorkspaceShell`** — master-detail chuẩn `[rail danh sách | main | ContextDrawer phải]` trên `ui/resizable`+`ui/sheet`, header nhận `ScopeFilterBar`. **Đây là mảnh biến "trang anh em" thành "workspace".**
- **`TabbedHub`** — tách logic `?tab=` parse + post-mount sync + `TabsList` (đang copy-paste ở 4 hub) thành khai báo `{value,labelKey,Content}[]`.
- **`ContextDrawer`** — panel phải chuẩn (AI copilot + Andon/issues) bọc `ui/sheet`.

## 4. Các cụm hợp nhất (9 cụm chính + phụ)

| Cụm | Hợp nhất | Từ (phân mảnh) → Thành (thống nhất) | Vai trò | Công |
|---|---|---|---|---|
| **A ★** | **Machine/Asset Workspace** | DeviceHub + MachineCockpit(drill) + RobotCockpit + StationAnalysis + ProcessAnalytics + SystemHealth → **1 master-detail**: rail fleet-live ⇄ main cockpit khoá `?machine=:id&tab=` ⇄ drawer copilot/Andon | operator/maint/eng/sup | **M** |
| **B** | **Command Center persona-layout** | ~13 màn overview (ControlTower/CommandCenter/FactoryCommand/WarRoom/MESControlTower/OpsConsole/Andon + 6 dashboard) → 1 `/control-tower` đổi layout theo persona (Exec/Sup/MES/Floor2D3D/AndonTV), 1 KPI-strip + 1 alarm-rail chung; route cũ redirect | sup/mgr/exec | **L** |
| **C** | **Device Connect + Connections** | DeviceOnboardingHubV2 (bật cờ) = **1 cửa thêm-thiết-bị** (3 wizard cũ + MachineRegistration redirect vào) · + "Connections" tab [Registry\|Adapters\|Edge\|Hot-folder\|Enroll\|MQTT] | eng/maint/admin | **M** |
| **D** | **Data Management master-detail** | DataSettings + MasterDataManagement + 8 sibling → rail entity-tree (Factory-model/Master-data/Governance) · main DataTable+FormScaffold · drawer audit+data-quality | steward/admin | **L** |
| **E** | **Product Workspace** | ProductModels + onboarding + mapping + comparison + golden/defect/recipe/gate → master-detail theo sản phẩm: tab [Models&Variants\|Points&Fiducials\|Spec\|Golden\|Defect\|Recipes\|Mapping] | proc/qual eng | **L** |
| **F** | **Quality "Diagnose" tab-group** | QualityCockpit + RCA + defect-prediction + causal-graph + correlation → thêm nhóm tab "Diagnose" cạnh SPC/Pareto (Pareto-bar → RCA seed) | qual | **M** |
| **G** | **Reporting Studio** | 11 màn report/export → 4 tab [Browse\|Build\|Export(PDF/PPTX/Excel là target)\|Compare] | analyst/mgr | **M** |
| **H** | **AI Studio (admin)** | ~15 route AI control-plane → hub tab [Models&Versions\|Monitoring&Perf\|Ops&Jobs\|Vision Lab\|Settings]; giữ AI Workspace read-open riêng | admin/ML | **M-L** |
| **I** | **Maintenance workspace** | MaintenanceHub+WorkOrders+TechnicianCopilot+MaintenanceHome → master-detail: queue WO+PM ⇄ detail/reliability ⇄ drawer RCA-copilot | maint | **S-M** |
| phụ | Engineering-Studio (IDE gộp) · Automation-Control cockpit · 6 role-home→1 Home role-aware · Settings gộp | | | S-L |

## 5. Guardrails (bắt buộc khi hợp nhất)

- **RBAC per-tab**: mỗi tab giữ ĐÚNG `requiredPermission` của route cũ + honest empty/locked khi bị chặn (`usePermissions` như các trang đã làm). KHÔNG nới guard để "vừa tab".
- **Deep-link bất biến**: mọi route cũ thành `<Redirect to="/workspace?tab=…">` + giữ post-mount `useEffect` sync (bookmark/breadcrumb/⌘K key theo URL).
- **Cờ additive default-OFF + byte-reversible**: mỗi workspace sau 1 cờ; trang cũ vẫn mount tới khi green-gate; nhờ trích `*Content`, old = shell + cùng body ⇒ flip cờ là khác biệt duy nhất.
- **Chống mega-monolith**: compose KHÔNG inline (`React.lazy`/tab, file workspace ~80 dòng) · 1 aggregation-endpoint/workspace · mỗi tab 1 file <~600 dòng (kỷ luật đã áp ở DataSettings/ProductModels).

## 6. Trình tự đề xuất

- **QW (quick-win, ~nửa ngày, RỦI RO THẤP NHẤT)** — vá chủ đề #1 ngay: đưa `MachineCockpit`/`ProcessAnalytics`/`DeviceOnboardingHubV2` vào menu (navHref + quyền), bật cờ wizard V2 sau green-gate, sửa role-landing trỏ thẳng (bỏ redirect-stub). *Không cần WorkspaceShell.*
- **P0 — Primitives**: `WorkspaceShell` + `TabbedHub` + `ContextDrawer`; chứng trên `DeviceHub` (refactor tab, KHÔNG đổi UX) sau cờ `WORKSPACE_SHELL_ENABLED` OFF.
- **P1 — Cụm A (flagship)**: Machine Workspace; `/machine/:id`,`/machine-status`,`/oee-dashboard`,`/machine-health` redirect vào `/device-monitor?machine=…`.
- **P2 — Cụm B**: gộp 13 overview → ControlTower persona-layout (giảm surface nhiều nhất).
- **P3 — Cụm C,D**: Connect + Data-Management (tái dùng WorkspaceShell).
- **P4 — Cụm E,F,G,H,I** song song · **P5** — phụ (Settings/role-home/Engineering).

## 7. Vì sao A trước

Cao ROI hằng ngày nhất (operator/maint/eng sống ở miền máy mỗi ca), rủi ro thấp (2 nửa đã production-wired: `UnifiedDeviceMonitorContent` + `MachineCockpit` trên 1 aggregation-endpoint — chỉ cần shell + `?machine=`), và **ép** 2 primitive ra đời ⇒ C/D/E/I sau chủ yếu là lắp ráp.

---

## 8. Điều KHÔNG làm (giữ nguyên)

- Không rewrite framework/data — chỉ **lắp ráp** phần đã có, gated + reversible.
- Không gộp AI-Workspace read-open (chat/hub/insight) vào AI-Studio admin.
- Không đụng backend/RBAC matrix (chỉ dùng lại guard hiện có per-tab).

## 9. QUYẾT ĐỊNH CHỜ DUYỆT

- **QĐ-A (phạm vi & nhịp):** (a) QW trước → P0+P1 (Machine Workspace) → dừng nghiệm thu → mở rộng; **hay** (b) thẳng P0+P1; **hay** (c) chạy cả chương trình A→I.
- **QĐ-B (flagship đầu):** Cụm **A Machine Workspace** (khuyến nghị) / B Command Center / D Data-Management.
- **QĐ-C (thực thi):** sau duyệt, tôi thực thi theo mô hình doc-56 — mỗi bước **cờ default-OFF + green-gate (tsc+test+esbuild) + LIVE proof**, redirect giữ deep-link, commit tách từng bước.
- **QĐ-D (QW làm ngay?):** cho phép làm QUICK-WIN (menu-wiring + bật cờ wizard) NGAY như bước độc lập rủi-ro-thấp trong lúc chờ duyệt A-C?

*Phụ lục: 3 báo cáo agent đầy đủ (IA inventory / role-fragmentation / consolidation blueprint) lưu trong transcript phiên; các phát hiện đã tổng hợp ở §1-§7.*

---

## 10. THỰC THI (USER DUYỆT 2026-07-18: thẳng A+B+C+D, flagship A, QW ngay, bật mặc định)

11 commit `dc7e81e1`→`8718e611` (mọi bước tsc 0 + reversible qua cờ):
- **QW** `dc7e81e1`: ProcessAnalytics + DeviceOnboarding vào nav. **P0** `b5ee687e`: primitives WorkspaceShell/TabbedHub/ContextDrawer (DeviceHub 80→33, unit 6 pass). **P1+P1.1** `7eacb7c4`/`a9fbd9b1`: Machine Workspace (tách MachineCockpitBody, rail⇄cockpit?machine=⇄AI-drawer + fleet-wide tabs). **P2** `7eb706f8`: ControlTower đã persona-shell → theme #4 stub. **Default-ON** `9a622c80`. **Cụm C** `38fa9a07`: onboarding 4-6→1. **Cụm D** `8718e611`: Data Hub master-detail.

### §10.1 — BROWSER-VERIFY LIVE (Playwright, 2026-07-18)
Dev server `:3010` (vite) + user no-2FA `wsverify`(admin để bypass gate). Kết quả:
- **`/device-monitor` = Machine Workspace RENDER ĐÚNG**: rail trái = danh sách máy thật (SCRW/GLUE/ESP32 pilot + SIM-L1/2/3 kèm machineType) + filter; main no-selection = TabbedHub fleet-wide [OEE|Health|Field].
- **Click "Máy bắt vít pilot 01" → `?machine=243` → cockpit nhúng** đầy đủ 12 tab (gồm "Process results" doc-56), header ONLINE, KHÔNG nút Back (embedded=true). Nút **AI copilot** mở **ContextDrawer** "Device AI copilot" (MachineAISummary: Diagnose/Ask-AI/Anomaly/Failure-risk).
- **`/device-onboarding` (Cụm C)**: "Add device — One entry point" + 3 thẻ class (Optical 4 · Automation 18 · IoT 2 types); nav "Connect & Setup" có "Add Device (unified)", 2 wizard cũ đã GỠ.
- **`/data-management` (Cụm D)**: rail 3 nhóm ⇄ main launcher ToolTile (Products/onboarding/mapping/component-library).
- **0 lỗi render từ code doc-59**; 1 console-error duy nhất = policy "admin phải bật 2FA" của chính test-user (không phải bug). Screenshot: ws-noselect/ws-cockpit/ws-drawer/data-hub.png.

### §10.2 — Cụm E–I ĐÃ HOÀN TẤT (workflow 5-agent design + critic verified → hiện thực + Playwright LIVE)

Workflow thiết kế 5-agent (read-only) + critic đã kiểm chứng approach khớp *Content thực trên disk (E 2/9 · F 4/6 · G 6/10 · H 0/17 · I 0/4 embeddable). Hiện thực (mọi cụm tsc 0 + Playwright render đúng, additive — route con giữ nguyên):

- **HubLauncher primitive** (`components/workspace/HubLauncher.tsx`): rail category ⇄ ToolTile launcher + PER-TILE RBAC (ẩn tile thiếu quyền + category rỗng). Nền cho E/H/I.
- **E** `/product-workspace` (`7b6152f3`): 2 nhóm × 5 tile, per-tile 5 quyền, nav gate history_view (bậc thấp nhất). LIVE: 2 nhóm + note "Kỹ thuật" trên Recipe.
- **H** `/ai-studio` (`7b6152f3`): 5 nhóm (17 surface), admin-only route, giữ /robot-model-health standalone. LIVE: rail 5 nhóm ⇄ ToolTile.
- **I** `/maintenance-hub` (`7b6152f3`): launcher an toàn (thay master-detail-rebuild vì 0/4 *Content). LIVE render OK.
- **F** `/quality-cockpit?tab=diagnose` (`f2a69803`): nhóm tab "Chẩn đoán" nhúng 4 *Content (RCA/dự đoán/nhân quả/tương quan) cạnh SPC/Pareto. ADDITIVE — KHÔNG redirect/widen-guard (tránh RBAC-regression critic cảnh báo). LIVE: tab Chẩn đoán selected → nested RCA.
- **G** `/reporting-studio` (`d5e9dd1b`): TabbedHub 4 tab (Tạo/Lịch/Xuất-nested-PDF-PPTX/So-sánh) nhúng 6 *Content, route mới (không đụng Reports.tsx 1311 dòng). LIVE: 4 tab + ?tab=export nested.

**Green cuối doc-59: tsc 0 · vite build 35s · Playwright LIVE render 8 surface (workspace/onboarding/data-hub/ai-studio/product/maintenance/quality-diagnose/reporting-studio) 0 lỗi code.** 6 commit thực thi E-I: `7b6152f3`(E/H/I+HubLauncher) `f2a69803`(F) `d5e9dd1b`(G).

### §10.3 — CỤM PHỤ + NAV-COLLAPSE (workflow 4-agent design + critic → hiện thực + Playwright LIVE) — commit `337a74ea`

- **HubLauncher honor `requiredRole`**: tile admin-role (vd /system-config) ẩn cho non-admin → hết dead-end (critic risk#1).
- **Settings Hub** `/settings-hub`: 5 nhóm (hệ thống/bảo mật/thiết bị/AI/mục tiêu), tile admin gate requiredRole. LIVE: 5 nhóm + note "Admin".
- **Engineering-Studio** `/engineering-studio`: 4 nhóm (soạn/điều phối/an toàn/chuẩn), per-tile gate theo **ROUTE THẬT** (fleet-orchestration/control-plane/robot-control=machine_control dù nav khai machine_status — route là nguồn thật). GIỮ /engineering-home. LIVE render đúng.
- **NAV-COLLAPSE 28 row**: `COLLAPSED_INTO_HUB` set (16 AI→ai-studio · 5 data→data-management · 4 product→product-workspace · 3 reporting→reporting-studio) lọc trong `getFilteredNavGroups` áp CẢ admin. **Nguyên tắc: chỉ ẩn khi gate row == gate hub** (permission độc lập, không bao hàm). GIỮ /scheduled-reports (reports_schedule≠reports_view — critic bắt lỗi), /robot-model-health + /causal-graph (non-admin, hub admin-only), tier:simple core. Route KHÔNG xoá → deep-link + ⌘K sống; reversible (bỏ href khỏi set). LIVE: /data-management group mở → master-data/operator-badges/data-quality vắng sidebar.
- **DataManagementHub → HubLauncher** (per-tile RBAC) — hết dead-end tile.
- **Role-home: HOÃN** (critic: merge 6 role-home đánh nhau RBAC 6-route, KHÔNG giảm route do hardcode Login/BottomNav/RouteGuard/Home + mig 0184 role_dashboard_defaults, mất kiosk-operator 430 dòng / KPI-admin / NG-ack-quality; LOC≈0).

**Green cuối doc-59: tsc 0 · vite build 39.76s · Playwright LIVE 10 surface 0 lỗi code.** 19 commit `dc7e81e1`→`337a74ea`. Cleanup: test-user + dev server + artifacts xóa.

**CÒN (follow-up nhỏ):** full-embed G (tách Reports/HistoryExport) · Connections-hub (overlap MQTT MonitoringSettings⇄ConnectivityHub) · role-home (nếu đổi ý về tradeoff) · gom thêm nav-collapse khi có hub mới.
