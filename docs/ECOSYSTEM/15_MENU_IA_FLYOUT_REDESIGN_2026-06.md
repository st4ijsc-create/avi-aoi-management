# 15 · Menu IA + Flyout/Mega-menu Redesign

> Ngày: 2026-06-30 · Nhánh: `main` (đề xuất nhánh `menu-ia-flyout`)
> Đầu vào: thiết kế tham khảo (4 loại menu dọc + Quick Access Drawer) + hiện trạng `client/src/lib/navigation.tsx` + `client/src/components/DashboardLayout.tsx` + IA 8 nhóm (doc 12 §7).
> Trạng thái: M1–M4 đã build. **R1 (2026-06-30): sửa lại mô hình tương tác sidebar → cascading 3 cấp** (xem §11).
> Nguyên tắc bất biến: **0 route bị xoá, 0 link gãy, 0 thay đổi RBAC/permission.** Đây là tổ chức lại + lớp UX, không phải consolidation trang (việc đó thuộc doc 12 P1).

---

## 11. R1 — Sửa mô hình tương tác sidebar: Cascading 3 cấp (Miller-column)

> Phản hồi user (2026-06-30): cách render M1 (sub-header + trang phẳng trong sidebar) và flyout-rail M2 **CHƯA đúng**. Mô hình đúng = **menu phân tầng 3 cấp**. Dữ liệu (module→section/category→item) ở M1 **giữ nguyên**; chỉ thay phần **render sidebar**. M3 (Command Palette ⌘K) và M4 (Mega-menu ⌘\\) **giữ nguyên**, bổ trợ.

### Mô hình tương tác (đã chốt với user)
- **Cấp 1 — Rail icon hẹp (~56px):** mỗi **module** (8 nhóm) là 1 icon + tooltip tên. **Click** module → mở Cấp 2 cho module đó (toggle). Active khi route hiện tại thuộc module.
- **Cấp 2 — Cột categories trượt ra (~240px, floating cạnh rail):** liệt kê **category** (các `section` của module). Mỗi category là 1 hàng có chevron ⟩. Header = tên module.
  - Module **có** `sections` (Production/Devices/Analytics/AI/Admin) → Cấp 2 hiện **category**; orphan-items (bucket `key:null`) hiện thẳng dạng item.
  - Module **không** có `sections` (Overview/Quality/Me) → Cấp 2 hiện **thẳng các trang** (item) — không có Cấp 3.
- **Cấp 3 — Floating panel các trang (~240px, cạnh hàng category):** **hover** 1 category → hiện panel chứa **item** của category đó. Click item → điều hướng + đóng toàn bộ.
- **Trigger:** Cấp 1→2 = **click**; Cấp 2→3 = **hover** (có close-delay + Esc). Click ngoài → đóng Cấp 2&3. Điều hướng → đóng.

### Triển khai
- **Component mới `client/src/components/CascadingNav.tsx`** — nhận `groups` (đã lọc `visibleGroups`), `currentPath`, `onNavigate`. State `activeModuleId` (click) + `hoverCategoryKey` (hover). Dùng lại `groupItemsBySection` (M1). Cấp 2/3 là panel floating absolute, z-index cao, click-outside/Esc để đóng.
- **`DashboardLayout.tsx`:** thay phần nav trong `SidebarContent` — bỏ nhánh accordion mở rộng (M1 render) **và** flyout-rail (M2) trên **desktop**; dùng `CascadingNav`. Sidebar thành **rail cố định ~56px** (đơn giản hoá logic resize/width cho nav). Header (M3 search, M4 mega) + footer user-menu **giữ nguyên**.
- **Mobile (`useIsMobile`):** giữ Sheet drawer dạng **tap-drill** (tap module → categories → tap category → items, có nút back) hoặc fallback accordion M1 — không dùng hover.
- **Giữ nguyên:** `navigation.tsx` data + `groupItemsBySection`, lọc quyền/license, `CommandPalette.tsx`, `MegaMenuOverlay.tsx`.

### R2 (2026-06-30) — Material 3 Navigation Rail style
- **Cấp 1** = MD3 collapsed rail (80px): icon + nhãn dưới + **pill active indicator** (nền bo tròn quanh icon khi active).
- **Cấp 2** = MD3 expanded rail: category/item là **hàng pill bo tròn**; mũi-tên-xuống-expand của MD3 → thay bằng floating Cấp 3 (giữ chevron-phải).
- **Cấp 3** = giữ nguyên (ItemRow `variant="default"`; thêm `variant="pill"` cho item phẳng Cấp 2).
- File: `CascadingNav.tsx` (RailButton, category pill, ItemRow variant), `DashboardLayout.tsx` (RAIL_WIDTH 64→80).

### R3 (2026-06-30) — Tối ưu cảm ứng (tablet/phone), MD3 adaptive
- **A. Touch-aware:** hook `useIsCoarsePointer()` (`matchMedia('(pointer: coarse)')`). Cảm ứng → Cấp 2/3 mở bằng **tap**, tắt hover open/close + timer.
- **B. Vùng chạm ≥48dp:** rail/pill cao hơn khi `coarse`.
- **C. Kẹp/lật ngang:** `useAnchoredPosition(anchorEl, panelWidth)` — panel sát mép phải thì lật trái / kẹp viewport (hết cắt mép trên tablet dọc; lợi cả desktop).
- **D. Drill 1 cột trên touch:** `coarse` → tap category **mở items inline** trong panel Cấp 2 (accordion, chevron xoay xuống) thay vì panel Cấp 3 riêng → tránh tràn 3 cột.
- **E. MD3 Bottom Navigation (phone <768px):** `BottomNav.tsx` — tối đa 4 module + nút "Menu" mở drawer; main thêm `pb-20`. i18n `nav.menu` (vi/en/zh).
- Phone <768px = bottom bar + drawer drill; Tablet 768–1024px = MD3 rail (tap); Desktop ≥1024px = MD3 rail (hover). typecheck+build sạch.

### R4 (2026-06-30) — Inline accordion (Cấp 1+2 sổ thẳng xuống), chỉ Cấp 3 floating
- Phản hồi user: bỏ kiểu rail icon + cột Cấp 2 trượt ra; muốn **category sổ thẳng xuống** ngay dưới module (như accordion ban đầu) cho gọn, **chỉ Cấp 3 giữ floating**.
- **Cấp 1:** sidebar rộng lại (264px) — module là hàng (icon + nhãn + chevron-xuống); click → toggle accordion.
- **Cấp 2:** category **inline** sổ xuống dưới module (không còn panel nổi). Module phẳng → trang inline.
- **Cấp 3:** desktop hover category → **floating menu** cạnh hàng (giữ Cấp 2 gọn); touch tap → mở items inline.
- Bỏ `RailButton` + `Level2Panel` (floating) khỏi `CascadingNav.tsx`; header desktop hiện logo+tên; RAIL_WIDTH 80→264. A–E (touch/flip/bottom-bar) vẫn còn. typecheck+build sạch.

### R5 (2026-06-30) — i18n vi + hub-pages lên Cấp 2
- **Ngôn ngữ (vi):** dịch 7 category + 7 item còn tiếng Anh sang tiếng Việt (giữ acronym AI/MES/BOM/MQTT/OT). zh đã đủ. 118 key đều có ở 3 ngôn ngữ.
- **Hub → Cấp 2 bấm-thẳng:** chỉ **trang-hub có menu con dọc bên trong** (kiểu `/monitoring-setting`) — `HUB_ROUTES` = {monitoring-setting, analytics-setting, settings, admin-setting, datasettings, dashboard-center} — được nâng lên **mục Cấp 2 bấm thẳng** (không Cấp 3). Mọi trang khác giữ nguyên 3 cấp. Category chỉ giữ khi còn ≥2 mục non-hub. `navigation.tsx`: `HUB_ROUTES`/`isHubItem`/`L2Entry`/`buildModuleL2`. `CascadingNav` + `MobileDrillNav` + `Level3Panel` dùng `buildModuleL2`. (Bản đầu hiểu rộng = mọi trang có tab → đã sửa hẹp lại đúng nhóm settings-hub.)
- Module phẳng (Overview/Quality/Me) không đổi (vốn đã L2). typecheck+build sạch.

### Nghiệm thu R1
- [ ] Rail chỉ icon; click module mở cột Cấp 2 (categories); hover category mở Cấp 3 (items); click item điều hướng + đóng.
- [ ] Module phẳng (Overview/Quality/Me): Cấp 2 hiện thẳng trang, không Cấp 3.
- [ ] Click ngoài / Esc / điều hướng → đóng panel. Active module/route highlight đúng.
- [ ] Lọc quyền/license nguyên vẹn (chỉ đọc `visibleGroups`). Mobile không vỡ.
- [ ] ⌘K palette + ⌘\\ mega-menu vẫn chạy độc lập. `npm run check` + `npm run build` sạch.

---

## 1. Mục tiêu

Nâng menu hiện tại (accordion dọc, danh sách phẳng dài) lên mô hình **đa tầng có ngữ cảnh** như thiết kế tham khảo:

1. **Gom logic (Cấp-2 section):** mỗi nhóm phình to được chia thành các phân nhóm có nhãn — thuần tổ chức, giữ nguyên route.
2. **Flyout "trượt ra" (Cấp 2):** ở chế độ rail thu gọn, hover/kh?click nhóm mở **panel trượt ra** (thay vì dải icon phẳng hoặc đẩy dọc).
3. **Command Palette (Ngăn kéo duyệt nhanh):** ⌘/Ctrl+K — search toàn menu + Recent + Favorites; ô search gắn header.
4. **Mega-menu overlay (Duyệt nhanh):** lớp phủ toàn màn hình hiển thị mọi nhóm + section cùng lúc.

## 2. Hiện trạng (đã khảo sát)

| Hạng mục | Thực tế |
|---|---|
| File dữ liệu menu | `client/src/lib/navigation.tsx` — `navGroups: NavGroup[]`, 8 nhóm, ~101 mục |
| File render | `client/src/components/DashboardLayout.tsx` — `NavGroupComponent` dùng Radix `Collapsible` (accordion, mở 1 nhóm/lần) |
| Lọc quyền | `getFilteredNavGroups(role, hasPermission, hasAnyCategoryPermission)` + license `isNavGroupAllowed`/`isRouteAllowed` — **GIỮ NGUYÊN** |
| Sub-section | Chỉ tồn tại dưới dạng **comment** trong `navigation.tsx` (vd `// — MQTT / telemetry —`) |
| Chế độ thu gọn | Dải icon phẳng toàn bộ ~101 mục (không nhóm) |
| Command palette | `client/src/components/ui/command.tsx` (cmdk v1.1.1) **đã có, chưa nối** |
| Mega-menu | Chưa có |
| Số mục/nhóm | Devices&OT=23, Admin=21, AI=20, Analytics=14, Production=12, Me=8, Overview=5, Quality=4 |
| Stack | shadcn + Radix + Tailwind v4 + Framer Motion (animation) + i18n vi/en/zh (`nav.*`) |

## 3. IA mới — phân Cấp-2 section (đầy đủ, không bỏ sót mục)

> `sectionKey` = khóa ổn định; nhãn hiển thị là i18n `nav.section.<sectionKey>`. Mục giữ nguyên `href`/quyền.

### Nhóm 1 · OVERVIEW — *không cần section* (5 mục, để phẳng)
dashboard · ops-console · dashboard-center · drill-down · corporate-dashboard

### Nhóm 2 · PRODUCTION (4 section)
| sectionKey | Mục |
|---|---|
| `mes` | production-dashboard · mes-control-tower · wip-dashboard · traceability · digital-twin |
| `inspection` | history · aoi-packages |
| `ordersSchedule` | production-orders · production-scheduling · production-signoff · history-export-scheduling |
| `bom` | bom-management |

### Nhóm 3 · QUALITY — *không cần section* (4 mục, để phẳng)
quality-cockpit · quality-home · quality-gate-templates · defect-heatmap

### Nhóm 4 · DEVICES & OT (5 section)
| sectionKey | Mục |
|---|---|
| `monitoring` | device-monitor · machine-health · oee-dashboard · factory-live-map |
| `telemetry` | mqtt-dashboard · mqtt-bulletin · mqtt-replay · mqtt-clients |
| `onboarding` | machine-onboarding · machine-registration · device-adapters · edge-nodes · robot-control · control-plane |
| `engineering` | engineering · recipes · interlock-rules · orchestration-studio · factory-floor-editor · rf-test-cell · cell-twin |
| `maintenance` | technician-copilot · work-orders · alerts · mqtt-alerts · monitoring-setting |

### Nhóm 5 · ANALYTICS (4 section)
| sectionKey | Mục |
|---|---|
| `reports` | reports · scheduled-reports · report-builder · pdf-reports · powerpoint-export |
| `analysis` | category-analytics · correlation-analysis · data-comparison · realtime-report |
| `energy` | energy-analytics · carbon-dashboard |
| `targetsSettings` | threshold-approvals · oee-target-settings · analytics-setting |

### Nhóm 6 · AI (4 section — khớp comment hiện có)
| sectionKey | Mục |
|---|---|
| `aiWorkspace` | ai-chat · ai-hub · management-insight |
| `aiControlPlane` | ai-brain · ai-monitoring · ai-performance · ai-models · model-versions · ai-settings |
| `aiOps` | ai-active-learning · ai-batch-jobs · ai-data-processing · ai-time-series · ai-reports |
| `aiVision` | ai-quality-gate · ai-image-search · ai-advanced-vision-lab · anomaly-banks · mask-annotation · causal-graph |

### Nhóm 7 · ADMIN (4 section)
| sectionKey | Mục |
|---|---|
| `securityAccess` | admin-home · users · role-builder · audit-logs?tab=enhanced · sessions · api-keys · license |
| `platform` | sites · federation-dashboard · modules · backup-restore · admin-setting · settings |
| `masterData` | master-data · products · product-mapping · corporate-management |
| `factoryConfig` | layout · workstation-management · process-management · datasettings |

### Nhóm 8 · ME — *không cần section* (8 mục, để phẳng)
inbox · today · operator · profile · change-password · request-role · user-guide · about-system

> **Quy tắc:** nhóm ≤ ~8 mục để phẳng (Overview/Quality/Me); nhóm > 10 mục bắt buộc có section. Thứ tự section theo bảng trên (`sectionOrder`).

## 4. Thay đổi kỹ thuật theo file

### 4.1 `client/src/lib/navigation.tsx`
- Thêm field vào `NavItem`:
  ```ts
  /** Cấp-2 section key (i18n nav.section.<key>); item cùng key gom 1 nhóm con */
  section?: string;
  ```
- Thêm vào `NavGroup` (tùy chọn, để cố định thứ tự + nhãn):
  ```ts
  /** Thứ tự + nhãn section của nhóm; nếu bỏ trống → render phẳng */
  sections?: { key: string; label: string }[];
  ```
- Gán `section` cho từng item theo §3.
- Helper mới (thuần, không phá API cũ):
  ```ts
  export function groupItemsBySection(group: NavGroup): { key: string|null; label: string|null; items: NavItem[] }[]
  ```
  Lọc-trống section (nếu mọi item trong 1 section bị ẩn do quyền → bỏ section đó). Áp dụng **sau** `getFilteredNavGroups`.

### 4.2 i18n — `client/src/i18n/locales/{en,vi,zh}.json`
Thêm cụm `nav.section.*` cho 17 sectionKey (mes, inspection, ordersSchedule, bom, monitoring, telemetry, onboarding, engineering, maintenance, reports, analysis, energy, targetsSettings, aiWorkspace, aiControlPlane, aiOps, aiVision, securityAccess, platform, masterData, factoryConfig). Bản dịch vi/en/zh đầy đủ.

### 4.3 `client/src/components/DashboardLayout.tsx` (M1 + M2)
- **M1:** `NavGroupComponent` render sub-header section (uppercase, muted, nhỏ) giữa các cụm khi `group.sections` tồn tại; dùng `groupItemsBySection`. Giữ accordion Cấp-1.
- **M2:** Thay nhánh `isCollapsed` (dải icon phẳng) bằng **flyout**: rail icon-only; hover/click 1 icon nhóm → `Popover`/floating panel (Radix `HoverCard` hoặc Framer Motion) hiện tên nhóm + section + items. Áp dụng `groupItemsBySection`. Có delay đóng + bàn phím (Esc, mũi tên).

### 4.4 `client/src/components/CommandPalette.tsx` (MỚI — M3)
- Dùng `command.tsx` (cmdk) sẵn có; `CommandDialog` mở bằng ⌘/Ctrl+K (global listener) + ô search ở header (`DashboardLayout` header, cạnh ThemeToggle).
- Nguồn lệnh: làm phẳng `visibleGroups` (đã lọc quyền/license) → mỗi item 1 command (icon + nhãn + group/section làm hint). Enter → `setLocation(href)`.
- **Recent:** lưu localStorage `nav-recent` (5 mục gần nhất). **Favorites:** localStorage `nav-favorites` (ghim/bỏ ghim từ palette). Hiển thị 2 nhóm trên cùng khi search rỗng.
- i18n placeholder + nhóm headings.

### 4.5 `client/src/components/MegaMenuOverlay.tsx` (MỚI — M4)
- Lớp phủ toàn màn hình (`Dialog` fullscreen / overlay) — nút "Duyệt nhanh" ở header + phím tắt (vd ⌘/Ctrl+\\).
- Lưới các nhóm; trong mỗi nhóm hiển thị section + items dạng cột (giống panel phải của ảnh tham khảo). Dùng `visibleGroups` đã lọc. Click item → đóng + điều hướng.
- Tái dùng `groupItemsBySection`; không trùng logic quyền.

### 4.6 Không đụng
`getFilteredNavGroups`, `usePermissions`, `useLicenseModules`, RBAC, route table, `App.tsx`. Mọi lớp UX mới chỉ **đọc** danh sách đã-lọc.

## 5. Phân pha thực thi (Agent dispatch)

| Pha | Agent (đề xuất) | Mission | File | Phụ thuộc |
|---|---|---|---|---|
| **M1** | `menu-ia-sections` | Thêm `section`/`sections` + gán theo §3 + `groupItemsBySection` + render sub-header + i18n `nav.section.*` (vi/en/zh) | `navigation.tsx`, `DashboardLayout.tsx`, 3 file i18n | nền tảng |
| **M3** | `menu-command-palette` | `CommandPalette.tsx` + ⌘K + ô search header + Recent + Favorites | mới + `DashboardLayout.tsx` | sau M1 (dùng section làm hint) |
| **M2** | `menu-flyout-rail` | Thay collapsed icon-strip bằng flyout panel Cấp-2 | `DashboardLayout.tsx` | sau M1 |
| **M4** | `menu-megamenu-overlay` | `MegaMenuOverlay.tsx` "Duyệt nhanh" + trigger header/phím tắt | mới + `DashboardLayout.tsx` | sau M1 |

Thứ tự khuyến nghị: **M1 → M3 → M2 → M4** (giá trị/rủi ro tốt nhất). M2/M3/M4 độc lập sau khi M1 xong.

## 6. Tiêu chí nghiệm thu

- [ ] Mọi nhóm >10 mục hiển thị sub-header section; nhóm nhỏ vẫn phẳng.
- [ ] **Không** route nào biến mất; số item hiển thị/role = trước (chỉ thêm nhãn nhóm).
- [ ] Lọc quyền/license vẫn đúng: section rỗng do quyền → ẩn cả nhãn.
- [ ] ⌘/Ctrl+K mở palette; gõ tên → tới đúng trang; Recent/Favorites hoạt động.
- [ ] Rail thu gọn: hover nhóm → flyout section+item (không còn dải icon phẳng).
- [ ] "Duyệt nhanh" overlay hiện mọi nhóm+section; click điều hướng + đóng.
- [ ] i18n vi/en/zh đủ khóa; không hiện key thô.
- [ ] `npm run build`/typecheck sạch; smoke 7 role (admin/supervisor/quality_inspector/operator/maintenance/viewer/user) thấy menu đúng phạm vi.

## 7. Quyết định đã chốt (2026-06-30 — "dùng mặc định")

1. **Nhãn section** theo §3 (bảng dưới, vi/en/zh đầy đủ).
2. **Phím tắt:** palette = ⌘/Ctrl+K; mega-menu "Duyệt nhanh" = ⌘/Ctrl+\\.
3. **Flyout Cấp-2:** kích hoạt bằng **hover** (có close-delay + Esc); click icon vẫn điều hướng tới trang mặc định của nhóm.
4. **Favorites/Recent:** **localStorage** (per-trình duyệt), không lưu server.

### Bảng nhãn section (authoritative)
| sectionKey | vi | en | zh |
|---|---|---|---|
| mes | MES | MES | MES |
| inspection | Kiểm tra | Inspection | 检验 |
| ordersSchedule | Đơn hàng & Lịch | Orders & Schedule | 订单与排程 |
| bom | BOM | BOM | BOM |
| monitoring | Giám sát | Monitoring | 监控 |
| telemetry | Telemetry / MQTT | Telemetry / MQTT | 遥测 / MQTT |
| onboarding | Onboarding & Adapters | Onboarding & Adapters | 接入与适配器 |
| engineering | Engineering & Control | Engineering & Control | 工程与控制 |
| maintenance | Bảo trì & Cảnh báo | Maintenance & Alerts | 维护与告警 |
| reports | Báo cáo | Reports | 报告 |
| analysis | Phân tích | Analysis | 分析 |
| energy | Năng lượng | Energy | 能源 |
| targetsSettings | Mục tiêu & Cài đặt | Targets & Settings | 目标与设置 |
| aiWorkspace | AI Workspace | AI Workspace | AI 工作区 |
| aiControlPlane | AI Control Plane | AI Control Plane | AI 控制台 |
| aiOps | AI Ops | AI Ops | AI 运维 |
| aiVision | AI Vision | AI Vision | AI 视觉 |
| securityAccess | Bảo mật & Truy cập | Security & Access | 安全与访问 |
| platform | Nền tảng | Platform | 平台 |
| masterData | Master Data | Master Data | 主数据 |
| factoryConfig | Cấu hình nhà máy | Factory Config | 工厂配置 |
