# Doc 36 — App Launcher IA: Tái cấu trúc menu để bán theo module (Phương án A)

> Trạng thái: **CHỜ DUYỆT** — không code gì cho tới khi chủ dự án chốt §9 (các quyết định) + §10 (thứ tự wave).
> Ngày: 2026-07-06 · Nhánh: `automation-orchestration-r0`
> Bối cảnh: menu trái 9 nhóm quá tải (~150 route), khó bán "theo chức năng/module". Đã chọn **Phương án A — App Launcher** (kiểu Odoo/Microsoft 365): một nút mở lưới "app đã mua"; chọn app thì menu trái chỉ hiện chức năng của app đó; top-shell dùng chung. Yêu cầu bổ sung: **bóc các sub-menu bên trong trang (vd `/monitoring-setting`) ra ngoài và sắp xếp lại.**

---

## 1. Phát hiện audit (căn cứ để thiết kế)

Nguồn: `client/src/lib/navigation.tsx`, `shared/module-registry.ts`, `client/src/App.tsx` (150 `<Route>`), + 13 trang hub, + 10 component khung điều hướng.

| # | Phát hiện | Hệ quả cho phương án |
|---|---|---|
| F1 | **Lệch ID nghiêm trọng**: `navGroupId` trong module-registry (`monitoring, ai-analytics, ot-control, data-management…`) **không khớp** `group.id` trong navigation (`devices, engineering, ai, admin…`). `isNavGroupAllowed(group.id)` ⇒ `getModuleByNavGroup` trả `undefined` ⇒ **allow mặc định** (no-op). | Việc "khóa/bán theo module" hiện **không thực sự hoạt động**. Phải hợp nhất ID trước tiên (W0). |
| F2 | Nav thực tế có **9 nhóm** (Overview, Production, Quality, Devices, **Engineering**, Analytics, AI, Admin, Me), không phải 8. Engineering đã tách khỏi Devices nhưng registry vẫn gộp nó trong `MOD_OT_CONTROL`. | App catalog phải liệt kê đủ 9 và quyết định Engineering là SKU riêng hay không (D2). |
| F3 | **13 trang là "hub thật"** (có điều hướng đa-mục bên trong). 7 hub đã hỗ trợ **deep-link `?tab=`** (bóc menu = 1 dòng, không refactor); 3 hub (MES, Master Data, Ops Console) dùng tab **state thuần** (muốn deep-link phải thêm đọc `?tab=`). | Bóc sub-menu khả thi, chi phí thấp cho 7 hub, thêm nhẹ cho 3 hub. Xem §4. |
| F4 | Các hub **`*-setting`** (monitoring/analytics) **chủ yếu là vỏ bọc**: phần lớn tab con của chúng ĐÃ là route độc lập (`/mqtt-clients`, `/report-builder`…). | Trong mô hình app, các hub này **thừa** — bỏ vỏ, đưa thẳng route con lên menu app. Đây là điểm làm sạch lớn. |
| F5 | `RouteGuard` chỉ gác **role + permission**, **chưa gác license-module**. Deep-link tới route của app chưa mua vẫn vào được (chỉ ẩn UI). | Phải thêm **license guard** (dùng `isRouteAllowed`) để "app chưa mua" thực sự bị chặn — điều kiện tiên quyết để bán. |
| F6 | **Top context-bar** trong `DashboardLayout` (search ⌘K, AI inbox, chuông cảnh báo, site-health, theme/lang, site switcher, user-menu) **đã gần như là top-shell dùng chung** cần có. | Tái dùng gần nguyên; chỉ tách thành component `TopShell` riêng. |
| F7 | `lib/domains.ts` (`DOMAINS` — 8 tile icon+label+blurb+landing) + `MegaMenuOverlay` (overlay lưới full-screen) **đã là bộ khung sẵn** cho App Launcher. | Refactor thay vì viết mới: `DOMAINS`→App registry, `MegaMenuOverlay`→`AppLauncherOverlay`. |

---

## 2. Kiến trúc đích — 3 lớp

```
┌─────────────────────────────────────────────────────────────────┐
│ TOP-SHELL (dùng chung — LUÔN hiện, mọi app, mọi role)            │
│  ⊞ App Launcher   🔎 ⌘K   🤖 AI Chat   🔔 Cảnh báo   📥 Inbox    │
│  ☀ Hôm nay        🌐 Site   👤 Người dùng (Me)   ◐ Theme/Lang    │
├───────────────┬─────────────────────────────────────────────────┤
│ MENU TRÁI     │                                                 │
│ (chỉ chức năng│              NỘI DUNG APP ĐANG MỞ                │
│  của 1 APP    │                                                 │
│  đang chọn)   │   Breadcrumb: App › Section › Trang             │
│  + Simple/Adv │                                                 │
└───────────────┴─────────────────────────────────────────────────┘

Bấm ⊞  →  LƯỚI APP (chỉ app ĐÃ MUA sáng; chưa mua = 🔒 "Dùng thử/Nâng cấp")
```

- **Lớp 1 — Top-shell dùng chung**: không bán rời, không khóa theo module. Gồm App Launcher, search ⌘K, AI Chat (read-open), chuông, Inbox/Hôm nay, menu người dùng (nhóm "Me"), site switcher, theme/lang. Đây là "khung" bất biến của hệ sinh thái.
- **Lớp 2 — App Launcher (trục License L1)**: lưới các app = SKU. `allowedModules` quyết định sáng/khóa. Click app đã mua → đặt app active + điều hướng landing. Click app khóa → trang nâng cấp (`/modules`).
- **Lớp 3 — App workspace (trục RBAC L2 + Simple/Advanced L3)**: menu trái chỉ render chức năng của app đang mở, lọc tiếp bằng role/permission + nav mode.

Ba trục quyền độc lập (đã thống nhất ở thảo luận trước):

| Lớp | Trả lời | Cơ chế | Đơn vị |
|---|---|---|---|
| L1 License | Công ty **mua** gì? | `module-registry` + `isRouteAllowed` (+ license guard mới) | tenant (SKU) |
| L2 RBAC | User này **được** gì? | `getFilteredNavGroups`, `requiredRole/Permission`, RouteGuard | user |
| L3 Simple/Adv | Gọn hay đầy đủ? | `tier`, `filterNavGroupsByMode`, `useNavMode` | role/sở thích |

---

## 3. Danh mục APP = SKU (bản đề xuất — cần duyệt §9)

Mỗi app = 1 tile launcher = 1 module license = 1 `navGroupId` (sau khi hợp nhất). **In đậm** = SKU bán được; *nghiêng* = core/dùng chung (không bán rời).

### 3a. App dùng chung (core — luôn có, không phải tile bán)
| App (hiển thị) | Module | Route tiêu biểu | Ghi chú |
|---|---|---|---|
| *📊 Tổng quan* | CORE_DASHBOARD | `/dashboard` `/command-center` `/ops-console` `/andon` `/drill-down` `/dashboard-center` | Landing mặc định |
| *⚙ Quản trị & Cấu hình* | CORE_ADMIN + CORE_SETTINGS + MOD_DATA_MANAGEMENT | users, role-builder, audit-logs, license, api-keys, backup, system-config, **master-data / products / product-mapping / layout / workstation / process / datasettings / settings / admin-setting** | Gồm cả Master Data (D5) |
| *👤 Cá nhân (Me)* | CORE_AUTH | inbox, today, operator, profile, change-password, sessions, request-role, user-guide, about | Trong menu người dùng top-shell |

### 3b. App bán được (mỗi tile = 1 SKU)
| # | App (hiển thị) | Module đề xuất | Route thuộc app (rút gọn) | Quyết định liên quan |
|---|---|---|---|---|
| 1 | **🖥 Giám sát máy** | MOD_MONITORING | device-monitor, machine-health, oee-dashboard, factory-live-map, field-devices, mqtt-*, machine/aoi-onboarding, machine-registration, device-adapters, uns-mapping, hot-folders, edge-nodes, system-health, digital-twin-center, technician-copilot, work-orders, alerts | D3 (Alerts) |
| 2 | **🏭 Sản xuất (MES)** | MOD_PRODUCTION | production-dashboard, mes-control-tower, wip-dashboard, traceability, digital-twin, history, aoi-packages, production-orders/scheduling/signoff, history-export-scheduling, bom-management, product-comparison, routing-master, feeder-verify | — |
| 3 | **✔ Chất lượng** | **MOD_QUALITY (mới, tách khỏi Analytics)** | quality-cockpit, quality-home, quality-gate-templates, golden-samples, defect-catalog, measurement-point-health, repair-station, defect-heatmap, defect-prediction, root-cause-analysis, nonconformance, threshold-approvals | **D1** |
| 4 | **📈 Phân tích & Báo cáo** | MOD_ANALYTICS | reports, scheduled-reports, report-builder, category-analytics, correlation-analysis, data-comparison, realtime-report, energy-analytics, carbon-dashboard, pdf-reports, powerpoint-export, oee-target-settings, engineering-changes | D1 |
| 5 | **🤖 AI** | MOD_AI | ai-hub, ai-chat, management-insight, ai-local-kb, ai-brain, ai-monitoring, ai-performance, ai-models, model-versions, ai-settings, ai-active-learning, ai-batch-jobs, ai-data-processing, ai-time-series, ai-reports, ai-quality-gate, ai-image-search, ai-advanced-vision-lab, anomaly-banks, mask-annotation, causal-graph, ai-inspection-analytics, ai-gguf-models, robot-model-health, programming-copilot* | — |
| 6 | **🛠 Kỹ thuật & Điều khiển** | MOD_OT_CONTROL (± tách MOD_ENGINEERING) | engineering-home, engineering, recipes, interlock-rules, orchestration-studio, ir-editor, pou-studio, programming-copilot*, fleet-orchestration, safety-workforce, equipment-standards, equipment-integration, factory-floor-editor, rf-test-cell, cell-twin, control-plane, robot-control | **D2** |
| 7 | **🏢 Đa nhà máy** | MOD_CORPORATE (± MOD_FEDERATION) | corporate-dashboard, corporate-layout, corporate-management, sites, federation-dashboard, modules | **D4** |

*`programming-copilot`, `digital-twin-center`, `causal-graph`, `robot-model-health` là **route liệt kê chéo** (2 app). Xử lý: mỗi route có **1 "app chủ"** để định breadcrumb/active, nhưng được **liệt kê chéo** ở app phụ. Bảng app registry (§6) cho phép `primaryApp` + `alsoIn[]`.

---

## 4. Bóc sub-menu trong trang ("hub hoisting") — yêu cầu bổ sung

Nguyên tắc phân loại (không bóc tràn lan để tránh rối lại):
- **Hub-vỏ-bọc** (tab con ĐÃ là route thật): **bỏ vỏ**, đưa route con thẳng lên menu app; trang hub thành redirect hoặc bỏ khỏi menu.
- **Hub-cấu-hình-tab-riêng** (tab chỉ tồn tại bên trong hub): **bóc thành entry deep-link `?tab=`** gom dưới 1 section của app.
- **Workspace-cockpit** (tab là các "view" của cùng một không gian làm việc): **giữ trang**, nhưng thêm entry deep-link cho các tab lớn để xuất hiện trong menu app (3 hub cần thêm đọc `?tab=`).

| Hub | Route | Loại | Xử lý đề xuất | Công |
|---|---|---|---|---|
| MonitoringSettings | `/monitoring-setting` | Vỏ bọc | **Bỏ vỏ** — 6 tab (machine-registration, device-mgmt, mqtt-clients/topics/replay/profiles/ng-rate) đã là route → hiện trực tiếp trong app *Giám sát*. Trang setting → optional redirect. | Thấp (đã `?tab=`) |
| AnalyticsSettings | `/analytics-setting` | Vỏ bọc | **Bỏ vỏ** — scheduled-reports/pdf/report-builder/powerpoint/correlation/data-comparison đã là route; các tab-only (annotation-*, quality-gate-templates) → deep-link. | Thấp |
| Settings | `/settings` | Cấu hình tab-riêng | **Bóc** 5 tab (yield-thresholds, alerts, report-templates, scheduled-reports, notification-sounds) → section "Cấu hình chất lượng/báo cáo" trong app Quản trị. | Thấp (đã `?tab=`) |
| AdminSettings | `/admin-setting` | Cấu hình tab-riêng | **Bóc** 16 mục (user-access, communication, monitoring, system-tools) → sections trong app Quản trị; các mục là route (license/api-docs/backup/import-export) link thẳng, các mục tab-only (smtp/email-template/cache-stats/data-seeding/system-config) deep-link. | Trung bình |
| DataSettings | `/datasettings` | Cấu hình tab-riêng | **Bóc** ~13 mục (factories/workshops/lines/stations/machines, shifts/stages, product-categories/mapping, process, seed-data) → section "Master Data / Hạ tầng" app Quản trị. | Trung bình (đã `?tab=`) |
| DashboardCenter | `/dashboard-center` | Cấu hình tab-riêng | **Bóc** 3 tab (custom-dashboard, templates, marketplace) → section trong Tổng quan. | Thấp (đã `?tab=`) |
| QualityCockpit | `/quality-cockpit` | Workspace-cockpit | **Giữ**; thêm deep-link 4–5 tab lớn (SPC, Pareto, Heatmap, Gates, Annotation) vào menu app *Chất lượng*. QualityCockpit đọc `?tab=` init nhưng **không ghi lại URL** khi đổi tab → sửa để đồng bộ URL. | Trung bình |
| MESControlTower | `/mes-control-tower` | Workspace-cockpit | **Giữ**; thêm đọc `?tab=` + deep-link 6 tab (WIP, Cân bằng, Truy xuất, Lệnh SX, Phiên, Bảo trì). | Trung bình (thêm `?tab=`) |
| MasterDataManagement | `/master-data` | Workspace-cockpit | **Giữ**; thêm đọc `?tab=` + deep-link các nhóm chính (Nhà cung cấp, Vật tư, Khách hàng, Kỹ năng, Công cụ, UOM, Lịch, Tồn kho). | Trung bình (thêm `?tab=`) |
| AuditLogs | `/audit-logs` | Workspace-cockpit | **Giữ** (đã `?tab=` + redirect command/enhanced). Không cần bóc thêm. | — |
| OpsConsole | `/ops-console` | Workspace nhỏ | **Giữ** 2 tab (War-room/Center). Không bóc. | — |
| ProductionDashboard | `/production-dashboard` | Workspace | **Giữ** 4 view. Optional deep-link. | — |
| AIHub / EngineeringHub | `/ai-hub` `/engineering-home` | Đã là launcher con | **Giữ** làm trang landing của app; đích của tile đã là route riêng → tự thành entry menu app. | — |

> Kết quả: 5 hub `*-setting`/dashboard-center **tan vào menu app** (làm sạch mạnh); 3 workspace-cockpit được **thêm deep-link** để tab lớn hiện trong menu; phần còn lại giữ nguyên.

---

## 5. Mô hình quyền — cách hoạt động cụ thể trong Phương án A

1. **Đăng nhập → app mặc định theo role** (tái dùng `landingPathForRole`):
   - Operator/nhân viên → vào thẳng workspace vận hành (Sản xuất hoặc Me/operator), **Simple mode**, launcher thu gọn (chỉ app có quyền).
   - Engineer/admin → launcher đầy đủ + **Advanced** + ⌘K.
2. **Lưới launcher** = `modulesWithStatus` lọc theo `allowedModules`: app mua = sáng, chưa mua = 🔒 (nút "Dùng thử/Nâng cấp" → `/modules`).
3. **Mở 1 app** → `useActiveApp` đặt app active → menu trái = `buildModuleL2(group_của_app)` đã qua `getFilteredNavGroups` (L2) + `filterNavGroupsByMode` (L3).
4. **Deep-link tới route app chưa mua** → **license guard mới** (`isRouteAllowed`) chặn ở tầng route (không chỉ ẩn UI). RBAC guard giữ nguyên.
5. **Top-shell** luôn hiện bất kể app/role (search tìm **xuyên mọi app đã mua** — truyền `accessibleGroups` cho CommandPalette).

---

## 6. Kế hoạch component (từ audit khung điều hướng)

### THÊM MỚI
| Thành phần | Vai trò |
|---|---|
| `lib/apps.ts` — **App registry hợp nhất** | Single source `{ appId, navGroupId, moduleCode, icon, label, blurb, landingHref, primaryRoutes[], alsoIn[] }`, hợp nhất `navGroups` + `SYSTEM_MODULES` + `DOMAINS`. **Sửa lệch ID F1.** Là trục của cả launcher lẫn license. |
| `AppLauncherButton` | Nút ⊞ ở top-shell (kế thừa phím tắt ⌘\). |
| `AppLauncherOverlay` | Lưới app đã mua/khóa. **Refactor từ `MegaMenuOverlay`** (đổi item→app tile, nguồn = app registry + `modulesWithStatus`). |
| `AppSidebar` | Menu trái theo 1 app. **Tái dùng `ItemRow`/`Level3Panel`/`MobileDrillNav`** từ CascadingNav; nguồn = `buildModuleL2(app.group)`. |
| `useActiveApp` | Suy ra app hiện tại từ route (`getGroupByHref`) + persist + điều hướng landing khi đổi app. |
| License route guard | Bọc route bằng `isRouteAllowed` — đóng gap F5. |
| `TopShell` (tách file) | Đưa top context-bar hiện có ra component dùng chung. |

### SỬA
- `DashboardLayout.tsx` — thay khối `<Sidebar>`(CascadingNav 9 nhóm) bằng `AppLauncherButton` + `AppSidebar`; giữ top-bar/breadcrumb/banner/auth-gate/logic lọc; dời user-menu + Simple/Advanced lên top-shell.
- `MegaMenuOverlay.tsx` → `AppLauncherOverlay`.
- `CascadingNav.tsx` — bỏ tầng L1-mọi-nhóm + CollapsedRail; giữ linh kiện con cho `AppSidebar`.
- `BottomNav.tsx` — 4 đích = 4 app hay dùng; nút "Menu" mở launcher.
- `lib/domains.ts` — nâng/nhập vào `lib/apps.ts`, gắn license.

### TÁI DÙNG NGUYÊN
`CommandPalette.tsx` (⌘K, cân nhắc truyền `accessibleGroups`), `RelatedViews.tsx`, `RouteGuard.tsx`, `hooks/useNavMode.ts`, `lib/breadcrumbs.ts`, top context-bar hiện có.

---

## 7. Tính mở rộng (thiết kế để thêm module rẻ)

- Thêm 1 SKU mới = `registerModule(manifest)` (register-and-go đã có) **+ 1 entry trong `lib/apps.ts`** → **1 tile tự xuất hiện** trong launcher, menu trái không đổi kích thước (vẫn 1 app/lần). Chi phí rối = 0.
- Plugin/marketplace (doc 33 SYNAPSE, `MOD_FEDERATION` đã có "Modules Marketplace") = mỗi plugin đăng ký 1 app entry → 1 tile. Không đụng menu cũ.
- App registry là nơi duy nhất phải sửa khi tách/gộp SKU về sau → tránh sửa rải rác.

---

## 8. Lộ trình thực thi (đề xuất — green-gate `tsc`+`build` mỗi wave, cờ mới OFF)

| Wave | Nội dung | Rủi ro |
|---|---|---|
| **W0 — Nền** | `lib/apps.ts` hợp nhất + **sửa lệch ID F1** (đồng bộ `navGroupId` ↔ `group.id`), tách `MOD_QUALITY`/quyết định D1–D5 vào registry. **Chưa đổi UI.** Green-gate. | Thấp — thuần data/mapping |
| **W1 — Launcher + shell** | `AppLauncherOverlay` + `AppLauncherButton` + `useActiveApp` + `AppSidebar` + `TopShell`, sau cờ `APP_LAUNCHER_V2`. Sidebar cũ vẫn chạy khi cờ OFF. | Trung bình |
| **W2 — Bóc hub** | Bỏ vỏ 5 hub `*-setting`/dashboard-center; thêm `?tab=` cho MES/MasterData + deep-link QualityCockpit; sắp lại menu app theo §4. | Trung bình |
| **W3 — License thật** | License route guard (`isRouteAllowed`), tile khóa + upsell `/modules`, chặn deep-link app chưa mua. | Trung bình — chạm bảo mật |
| **W4 — Mobile + dọn** | `BottomNav` theo app, kiểm tra Simple/Advanced trong app, gỡ CascadingNav L1 cũ, bật cờ pilot. | Thấp |

---

## 9. QUYẾT ĐỊNH CẦN CHỐT (trước/khi bắt đầu W0)

| # | Quyết định | Lựa chọn | Khuyến nghị |
|---|---|---|---|
| **D1** | **Chất lượng** là SKU riêng hay thuộc Phân tích? | (a) `MOD_QUALITY` riêng · (b) gộp trong `MOD_ANALYTICS` | **(a) riêng** — Quality đã là nhóm nav riêng, bán được độc lập cho khách chỉ cần QC. |
| **D2** | **Kỹ thuật & Điều khiển**: 1 SKU hay tách? | (a) giữ chung `MOD_OT_CONTROL` · (b) tách `MOD_ENGINEERING` (authoring: IR/POU/copilot/recipe) khỏi `MOD_OT_CONTROL` (device write/interlock/fleet/twin) | **(b) tách** — Engineering là nhóm nặng nhất; tách giúp bán "lập trình" tách khỏi "điều khiển OT nhạy cảm". |
| **D3** | **Cảnh báo** (`MOD_ALERTS`) | (a) gộp vào Giám sát máy · (b) giữ SKU riêng | **(a) gộp** — alerts gắn chặt monitoring; SKU riêng quá nhỏ. |
| **D4** | **Corporate + Federation** | (a) 1 app "Đa nhà máy" · (b) 2 app riêng | **(a) 1 app** — cùng câu chuyện multi-site; đơn giản hóa. |
| **D5** | **Master Data / Data Management** | (a) trong app Quản trị · (b) app "Dữ liệu chủ" riêng bán được | **(a)** cho gọn; chọn (b) nếu muốn bán gói master-data riêng. |
| **D6** | Còn giữ **Simple/Advanced** bên trong app không? | (a) giữ · (b) bỏ (app đã thu hẹp bề mặt) | **(a) giữ** — vẫn hữu ích cho app nặng như Kỹ thuật/AI. |
| **D7** | Trang hub `*-setting` sau khi bỏ vỏ | (a) redirect về app landing · (b) xóa hẳn route | **(a) redirect** — an toàn cho bookmark/deep-link cũ. |

---

## 10. Rủi ro & phòng ngừa

- **R1 — Lệch ID (F1)**: nếu không sửa ở W0, lưới "app đã mua" hiển thị sai. → W0 là bắt buộc, có test mapping app↔module↔route.
- **R2 — Route liệt kê chéo**: `primaryApp` + `alsoIn[]` trong app registry; breadcrumb/active theo `primaryApp`.
- **R3 — Deep-link cũ/bookmark**: giữ mọi redirect hiện có (19 cặp) + D7 redirect cho hub bỏ vỏ.
- **R4 — Regression điều hướng**: giữ sidebar cũ sau cờ `APP_LAUNCHER_V2` OFF tới hết W4; pilot theo role.
- **R5 — License guard chặn nhầm**: mặc định app core không guard; chỉ guard route SKU; test theo từng module.

---

## 11. Việc cần người dùng làm (ngoài code)
- Chốt §9 (D1–D7). → **ĐÃ DUYỆT toàn bộ khuyến nghị (2026-07-06).**
- Xác nhận danh mục app §3 khớp cách bán thực tế (giá theo app).
- Sau W3: cập nhật license mẫu (`allowedModules`) cho môi trường demo/bán.

---

## 12. KẾT QUẢ THỰC THI (2026-07-06) — W0→W4 XONG & GREEN

Green-gate mỗi wave: `tsc --noEmit` sạch · `npm run build` (client+server+worker) OK · editions+licenseHardening test 26/26 pass. **Hai cờ mới đều mặc định OFF** → bản production không đổi cho tới khi pilot bật.

**W0 — Nền** (`shared/module-registry.ts`, `shared/editions.ts`, `client/src/lib/apps.ts`):
- Sửa lệch ID `navGroupId`↔`group.id` (F1). Thêm **MOD_QUALITY** (D1), **MOD_ENGINEERING** (D2); **MOD_ALERTS** fold vào MOD_MONITORING (D3, routes=[] giữ đăng ký back-compat). `/modules`→CORE_ADMIN (upsell luôn tới được).
- Route ownership authoritative + không trùng (26/26 check). `getModuleByRoute` tolerant query-string.
- `lib/apps.ts`: 10 app (7 SKU + 3 core) + `getAppForRoute/isAppAllowed/scopeGroupsToApp/listApps`. Editions ceiling machine+line thêm 2 SKU.

**W1 — Launcher + shell** (cờ `APP_LAUNCHER_V2`, OFF): `AppLauncherOverlay` (lưới app, tile khóa+upsell), `AppLauncherButton` (⊞ + tên app), `useActiveApp`, scope menu trái theo app, header đổi tên theo app, ⌘K search xuyên app. i18n `nav.app.*` (vi/en/zh). Verified: 10 app, **0 item mồ côi**, cross-move đúng (feeder-verify/routing→Sản xuất, robot-control→Kỹ thuật).

**W2 — Bóc hub**: QualityCockpit ghi `?tab=` khi đổi tab; MES + MasterData thêm đọc+ghi `?tab=`. Deep-link menu: Quality Cockpit 5 view (section "cockpit"), Master Data 5 tab (tier advanced). Config-hub `*-setting` tab-only (settings/admin-setting/datasettings factories/shifts/smtp…) **hoãn bóc** (giữ in-page menu; route con đã surface) — follow-up.

**W3 — License thật** (cờ `LICENSE_ROUTE_GUARD`, OFF): `RouteGuard` thêm license gate (tenant-level, độc lập role, chỉ khi query settled — không flash lúc load) → màn upsell "Chưa kích hoạt / Nâng cấp"→`/modules`. Verified 8/8 (SKU route chặn khi chưa mua, cho qua khi mua, query-tolerant, /modules+core luôn qua).

**W4 — Mobile**: BottomNav "Menu" mở launcher khi cờ ON; mobile drawer dùng menu app-scoped; Simple/Advanced hoạt động trong app. CascadingNav L1 cũ "gỡ" bằng cách feed nhóm đã scope (không xóa code — vẫn tái dùng cho menu app).

### Bật pilot (operator)
- `localStorage.setItem('APP_LAUNCHER_V2','true')` (hoặc `VITE_APP_LAUNCHER_V2=true`) → bật App Launcher.
- `localStorage.setItem('LICENSE_ROUTE_GUARD','true')` (hoặc `VITE_LICENSE_ROUTE_GUARD=true`) → bật khóa route theo license (chỉ bật khi license mẫu đã đủ module cho khách, tránh chặn nhầm).

### Follow-up — ĐÃ LÀM (2026-07-06, green: tsc+build+19 test)
- ✅ **Active-highlight `?tab=`**: `isNavItemActive` giờ phân biệt tab (item pin `?tab=X` chỉ sáng khi URL `tab=X`); `DashboardLayout` truyền path kèm `?search` (qua `useSearch`) cho nav. Verified 11/11.
- ✅ **Bottom bar mobile theo app**: `BottomNav` nhận `items?` — ở launcher mode hiện top item của app đang mở (thay landing nhóm toàn cục); "Menu"→launcher.
- ✅ **vitest include `shared/**`**: `shared/module-registry.test.ts` giờ chạy CI (7 test pass).
- ✅ **Bóc DataSettings**: 5 deep-link tab-only (factories/lines/stations/shifts/stages — không có route riêng) vào admin ▸ factoryConfig, tier advanced, label tái dùng `settings.sidebar.*`.

### Follow-up — ĐÃ LÀM tiếp (commit `f37b8c0`): BÓC MENU-TRONG 6 HUB
Audit 4-agent xác nhận 6 hub có menu-dọc-trong-page (monitoring/analytics/settings/
admin-setting/datasettings/dashboard-center, cùng pattern `div.w-64 + Tabs + ?tab=`).
- **Ẩn menu dọc trong cả 6** (`w-64…` → `hidden`, tag `data-legacy-hub-menu`); nội dung tab full-width, điều hướng qua menu trái.
- **analytics-setting REDUNDANT** (mọi tab là route độc lập) → redirect `/reports`, gỡ khỏi menu.
- **monitoring-setting**: 6/7 tab đã là route ở menu trái; thêm deep-link tab nội bộ device-management.
- **dashboard-center** → 3 deep-link (Tổng quan). **settings/admin-setting/datasettings**: bóc tab nội bộ (không route) → deep-link `?tab=` app Quản trị (tier advanced, dùng lại `*.sidebar.*` label key).
- Verified Playwright: menu-trong ẩn, content full-width, redirect OK, 0 pageerror. (Bỏ qua tab dev-tool: seed-data, admin overview.)

### Follow-up — CÒN LẠI
- Refactor/gỡ `MegaMenuOverlay` khi bỏ hẳn menu cổ điển (hiện giữ cho toggle "Menu cổ điển").
