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
