# Phụ lục FE2 — Kiến trúc shell & layout ở mức mã (module Kỹ thuật & Điều khiển)

> Thuộc doc 81 (khảo sát sâu). 2026-09-26/27 · chỉ đọc mã · bằng chứng `file:line`. Bổ trợ phụ lục FE1 (đo layout trên màn hình thật).

## 1. App shell

Cả 14 trang bọc trong **một** shell `<DashboardLayout>` (`client/src/components/DashboardLayout.tsx`):

| Mảnh | Component / vị trí |
|---|---|
| Sidebar (rail 264px, thu gọn về icon) | `ui/sidebar.tsx`; điều hướng `CascadingNav` (desktop, Miller 3 cấp) / `MobileDrillNav` — `DashboardLayout.tsx:420-439` |
| Top bar | `<header data-app-chrome="header">` `:557-613`: SidebarTrigger, AppLauncherButton, SiteSwitcher, ⌘K CommandPalette, AIActionInboxLauncher, NotificationCenter, ShellAlertChip, FreshnessStrip, SiteHealthDot, ThemeToggle, LanguageSwitcher |
| **Breadcrumb #1 (shell)** | `:614-645`, vô điều kiện từ `buildBreadcrumbs(activePath, t)` |
| Page header | `<PageHeader>` (`components/patterns/PageHeader.tsx`) — từng trang tự gọi |
| **Breadcrumb #2** | `PageHeader.tsx:68-90` — prop `breadcrumbs` vẽ thêm một `<Breadcrumb>` |
| Banner shell | `PermissionExpiryBanner` (`:654`), `LicenseEnforcementBanner` (`:655`), `BetaBanner` khi route có cờ `beta` (`:661`) |
| Nút nổi "Trợ lý AI" | `AILocalChatBubble` mount ở `App.tsx:23-25`, `fixed bottom-6 right-6 z-50` (`AILocalChatBubble.tsx:1118`) |
| Copilot dock | `ProgrammingCopilotDock` mount ở `App.tsx:20-22`, `position:fixed` phải; **đẩy** trang bằng `document.body.style.paddingRight` khi viewport ≥900px, dưới đó chiếm toàn màn (`ProgrammingCopilotDock.tsx:52-61`); chỉ hiện khi một surface lập trình publish binding |
| BottomNav (mobile) | `:666-678` |

**Vì sao HAI breadcrumb:** shell luôn vẽ một cái; 11/14 trang lại gọi `buildBreadcrumbs(...)` lần nữa và truyền vào `PageHeader breadcrumbs` (EngineeringHub `:117-120`, EngineeringWorkspace, Fleet, Safety, EqIntegration, EqStandards, IrEditor, Interlock, Orchestration, PouStudio, Recipes). Chỉ ProgrammingCopilot và EngineeringStudioHub không gọi.

Chế độ: Simple/Advanced (`useNavMode`, `:292-312`), App Launcher (`useAppLauncherMode`, `:317`). Breakpoint (`hooks/useMobile.tsx:3-4`): mobile <768, tablet 768–1023 (rail tự thu gọn, `:124-138`), desktop ≥1024.

## 2. Primitive sẵn có (không cần cài thêm)

`react-resizable-panels` ^3.0.6 (→ `ui/resizable.tsx`), `cmdk` ^1.1.1, `vaul` ^1.1.2 (drawer), `@xyflow/react` ^12.11, `@tanstack/react-query` ^5, `sonner`. **Không có** `@tanstack/react-table`, `@dnd-kit`, store ngoài (zustand/jotai) — state các trang là `useState` phẳng.

| Primitive | Ở đâu | Dùng trong 14 trang Engineering |
|---|---|---|
| Dialog | `ui/dialog.tsx` | **32** (Workspace 3, ECN 2, Recipe 4, Interlock 2, Orchestration 2, IR 1, POU 1, Fleet 7, Safety 3, EqStd 4, EqInteg 3) |
| AlertDialog | `ui/alert-dialog.tsx` | **12** trên 8 trang |
| **Sheet / Drawer** | `ui/sheet.tsx`, `ui/drawer.tsx`, đã gói thành `ContextDrawer` (`components/workspace/ContextDrawer.tsx`) | **0/14** |
| Popover | `ui/popover.tsx` | 0/14 |
| Command palette cục bộ | `ui/command.tsx` | 0/14 (chỉ ⌘K toàn cục) |
| Tabs | `ui/tabs.tsx` | 7/14 (Interlock uncontrolled `:372`; IR 2 nhóm; POU; Fleet/Safety/EqStd/EqInteg bằng `useState`) |
| **ResizablePanel / WorkspaceShell** | `ui/resizable.tsx`; `components/workspace/WorkspaceShell.tsx:44-52` | **0/14** — nhưng đã dùng ở 14 trang KHÁC (OpsConsole, TwinMay, RootCause, RepairStation, DeviceHub, MachineWorkspace, ReportingStudio…) |
| **TabbedHub** (tab đồng bộ `?tab=`) | `components/workspace/TabbedHub.tsx` | 0/14 (14 trang khác dùng) ⇒ 4 trang tab Engineering mất tab khi F5/back |
| **DataTable** (sort/filter/paginate) | `components/DataTable.tsx` ("thay ~80 trang tự viết", `:38-39`) | **0/14** — mọi bảng tự vẽ, không sort/phân trang |
| **EntityPicker / MachineSelect** | `components/patterns/EntityPicker.tsx`; `components/EntityCombobox.tsx` | **0/14** — chọn máy bằng `<Select>` thô (vd `EngineeringWorkspace.tsx:791-805`) |
| FilterBar (đồng bộ URL) | `components/FilterBar.tsx` | 1/14 (ECN `:361`) |
| EmptyState | `components/EmptyState.tsx` | **0/14** — ~72 đoạn rỗng tự vẽ |
| SectionCard | `components/patterns/SectionCard.tsx` | 4/14 |
| MetricCard / StatChip | `components/patterns/*` | 6/14; Workspace/ECN/Recipes/Interlock/Orchestration không có dải KPI |
| ConfirmWithReason (+OTP) | `components/patterns/ConfirmWithReason.tsx` | Orchestration rollback (`:1899-1917`) — mẫu tốt chưa lan |
| Status bar | — | **Chưa có** |

⇒ **Bằng chứng định lượng mạnh nhất:** 32 Dialog + 12 AlertDialog, **0 Sheet/Drawer/Popover**, 0 WorkspaceShell/TabbedHub/DataTable/EntityPicker trong module — trong khi các primitive này đã có và đã kiểm chứng ở 14 trang khác.

## 3. Cấu trúc từng trang

- **EngineeringHub (202 dòng):** PageHeader + breadcrumb tự build (`:117-156`) → banner luồng vàng tĩnh (`:158-167`) → `PendingReviewStrip` (`:170`) → 6 nhóm ToolTile từ `GROUPS` tĩnh (`:58-109`). Không coupling. Nguồn cho activity bar của EngineeringShell.
- **EngineeringStudioHub (70 dòng):** chỉ `HubLauncher categories` (`:17-61`) — trùng vai Hub, danh sách lệch nhau.
- **ProgrammingCopilot (70 dòng):** PageHeader → hint viết inline khác chuẩn (`:37-48`) → Card bọc `ProgrammingCopilotPanel variant="full"`.
- **EngineeringWorkspace (1982 dòng, phức tạp nhất):** ≈40 `useState` (`:225-585`), 9 query. Bố cục: PageHeader (`:691-715`) → hint (`:717-733`) → FeatureStatusGate (`:737-748`) → lưới `280px | 1fr`: Explorer card + dialog tạo project (`:752-892`) | cột chính: GoldenThreadStepper (`:940-956`) → card `gt-editor` (`:959-1131`) → `gt-copilot` (`:1131-1151`) → `gt-builds` (`:1151-1206`) → `gt-deploy` (`:1206-1383`) → `gt-fleet` (`:1383-1623`) → `gt-monitor` (`:1623-1789`) → 2 Dialog + 3 AlertDialog. **Coupling:** chọn `projectId` (`:878-884`) reset `artifactId/buildId/simResult/diagnostics` — một selection điều khiển 6 card qua state phẳng ⇒ **phải nâng state lên Context/reducer TRƯỚC** khi tách bất kỳ card nào; `gt-fleet`, `gt-monitor` là ứng viên flyout/tab đầu tiên.
- **EngineeringChanges (700 dòng):** PageHeader + FilterBar thật (`:361`) → bảng (`:364-425`) → AlertDialog reject/approve (`:427-480`, giữ nguyên object hàng) — **sạch nhất, dễ tách nhất**.
- **RecipeManagement (985 dòng):** PageHeader (không hint) → card tóm tắt (`:336`) → lưới list mã (`:421-473`) | chi tiết phiên bản (`:474-670`) → lịch sử deploy (`:671-734`) → 4 Dialog + 2 AlertDialog. `selectedCode` điều khiển 2 query; diff là `useMemo` phái sinh (`:270-287`) — khớp ListDetailLayout.
- **InterlockRuleManagement (778 dòng):** Tabs **uncontrolled** Rules/Events (`:372`) → Dialog form rule (~130 dòng, `:597-731`) → Dialog test/evaluate (`:732-777`) — bản chất đã là side-panel công cụ ⇒ flyout "chỉ đổi vỏ".
- **OrchestrationStudio (2169 dòng):** PageHeader + Simulate/Deploy/Run (`:1372-1404`) → hint + 2 banner (`:1406-1430`) → card AI advisor (`:1433-1530`) → canvas (`:1539-1613`) + inspector (`:1614-1630`) + run/queue (`:1631-1651`) → Saved workflows (`:1652-1723`) → Dialog "Version history" 165 dòng (`:1867-2032`, danh sách + diff JSON + rollback ConfirmWithReason+OTP) → `RunMonitor` (`:2033-2169`).
- **IrEditor (1688 dòng):** PageHeader → hint + banner flag-off + honesty note (`:1235-1260`) → toolbar card (`:1263-1373`) → **3 cột `grid-cols-12` cố định**: palette (cột 3) / canvas (cột 5) / Tabs Inspector|Transpile (cột 4, `:1509-1630`) → Tabs Diff|Merge (`:1635-1657`). **Gần nhất với EngineeringShell** — chỉ cần đổi sang ResizablePanelGroup.
- **PouStudio (637 dòng):** soi gương IrEditor quy mô nhỏ; Tabs Transpile→ST | PLCopen XML (`:496-497`).
- **FleetOrchestration (2006 dòng, 7 Dialog):** Tabs `useState` 5 tab map/tasks/operations/resources/charging (`:251`, `:692-976`) + 7 Dialog form nhỏ ⇒ CockpitLayout + FlyoutHost.
- **SafetyWorkforce (1175 dòng):** Tabs 3 tab cockpit/workforce/collaboration (`:197`); tab collaboration có state-machine `phase` sống ⇒ cẩn trọng unmount.
- **EquipmentStandards (1590 dòng):** Tabs 5 tab (`:141`); tab hierarchy đã có rail+detail (`:409-457`); tab `crs` (`:688-799`) giống hệt luồng duyệt ECN.
- **EquipmentIntegration (1266 dòng):** Tabs 4 tab (`:116`); tab recipes (`:366-483`) là bản thứ 3 của mẫu phiên bản + rollback.

## 4. Trùng lặp → component dùng chung

1. **Breadcrumb kép** (shell + `PageHeader.breadcrumbs`, 11 trang) → bỏ prop `breadcrumbs` khỏi PageHeader.
2. **Banner "Khi nào dùng"** chép tay 9 trang (+1 khác class) → `<WhenToUseHint>`.
3. **Ba kiểu tab-state** (TabbedHub 0 trang / `useState` 4 trang / uncontrolled 1 trang) → chuyển sang TabbedHub (`?tab=`).
4. **Danh sách phiên bản + diff + rollback** viết lại 4 lần (Workspace, Recipes, Orchestration, EqIntegration) → `<VersionHistoryPanel>` + `<JsonDiffView>` + `<RollbackConfirm>` (trên ConfirmWithReason).
5. **Hàng đợi duyệt/từ chối** 2 lần (ECN, EqStandards CR) → `<ApprovalQueue>` / `<TransitionDialog>`.
6. **Bộ lọc rời không đồng bộ URL** (Fleet, Safety, EqStd, Interlock) → FilterBar / `useUrlFilters`.
7. **Chọn máy bằng `<Select>` thô** → `MachineSelect`.
8. **~72 empty-state tự vẽ** → EmptyState.
9. **Bảng tự vẽ** → DataTable.
10. **Dải KPI không nhất quán** (5 trang không có) → slot `chips` của PageHeader.
11. **Mọi tương tác phụ là modal giữa màn hình** (44 dialog, 0 sheet) → `FlyoutHost`.
12. **Hai hub cạnh tranh** → gộp.

## 5. Hệ layout đề xuất (mức mã)

- **EngineeringShell** (`components/engineering/shell/EngineeringShell.tsx`): props `activityItems` (từ `GROUPS`), `explorer`, `editorTabs`, `bottomPanel`, `rightInspector`, `statusBar`; dựng trên ResizablePanelGroup. Cho: EngineeringWorkspace, IrEditor, PouStudio.
- **ListDetailLayout**: lớp mỏng trên WorkspaceShell. Cho: Recipes, EqStandards/hierarchy, ECN (danh sách + flyout chi tiết), Interlock.
- **CockpitLayout**: lớp trên TabbedHub + slot StatChipRow + NoticeStack. Cho: Fleet, Safety, EqStandards, EqIntegration.
- **FlyoutHost** (`components/patterns/FlyoutHost.tsx`): một stack sheet phải mỗi trang, `useFlyout()` `open/close/push`, đồng bộ URL `?flyout=key&flyoutId=…`, trên `ui/sheet.tsx`. Khởi động bằng `VersionHistoryFlyout`.
- **NoticeStack**: gộp hint/flag-off/honesty/sim-gate thành một dải thu gọn được; `WhenToUseHint` là atom con.
- **PageHeader**: bỏ `breadcrumbs`; thêm slot `chips`.

| # | Trang | Công | Lý do thứ tự / rủi ro |
|---|---|---|---|
| 1 | EngineeringChanges | S | sạch nhất; soát `engineeringChangesEcnUx.unit.test.ts` |
| 2 | InterlockRuleManagement | S/M | Tabs→TabbedHub; dialog test→flyout |
| 3 | RecipeManagement | M | ListDetail; giữ `useMemo` phái sinh `:270-287` |
| 4 | EquipmentIntegration | M | Cockpit; VersionHistoryFlyout lần 3; tab acquisition có worker sống |
| 5 | SafetyWorkforce | M/L | tab collaboration không được unmount giữa chừng; sửa `.dom.test` cùng lúc |
| 6 | EquipmentStandards | L | sau khi có ApprovalQueue |
| 7 | FleetOrchestration | L | 7 Dialog — sau khi FlyoutHost ổn định |
| 8 | OrchestrationStudio | L | VersionHistoryFlyout dùng chung; giữ nguyên ConfirmWithReason + OTP |
| 9 | EngineeringWorkspace | L | **nâng ~40 useState lên Context/reducer trước**; rủi ro cao nhất |
| 10 | IrEditor + PouStudio | L | sau khi EngineeringShell kiểm chứng ở bước 9 |
| 11 | Hub + StudioHub | S | quyết định gộp trước |
| 12 | ProgrammingCopilot | S | nội dung → editor tab |

**Rủi ro xuyên suốt:** key i18n "whenToUse" riêng từng trang phải giữ; 5 trang có `*.dom.test.tsx` mới (Workspace, EqInteg, EqStd, Fleet, Safety) phải sửa cùng lúc; `FeatureStatusGate` phải giữ 4 trạng thái (loading/off/on/error); ConfirmWithReason + OTP và maker-checker phải giữ nguyên độ dài lý do và độ "tươi" OTP khi đưa vào component chung.
