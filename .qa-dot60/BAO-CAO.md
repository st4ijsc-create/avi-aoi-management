# Đợt 60 — KHẢO SÁT: mọi trang canvas 3D và mọi trang trùng vai trò với Twin 3D

**Không sửa, không xoá một dòng mã sản phẩm nào.** Chỉ đo và đề xuất.
HEAD `af7460a0` · nhánh `feat/twin-3d-trung-tam` · worktree `D:/SOURCES/_twin_wt` · 2026-09-13.

Mọi con số dưới đây đo bằng lệnh, không kế thừa từ sổ. Script đo giữ trong
`.qa-dot60/_graph.mjs`, `_reach.mjs`, `_i18n.mjs`, `_dbcount*.mjs`; kết quả thô ở
`01-graph.json`, `02-live.json`, `04-i18n-mocoi.json`.

---

## 0. Phép đo dùng để phân biệt 3D thật với 2D

Không đoán theo tên tệp. Hai phép đo độc lập:

1. **Import thật** — `from "three" | "three/…" | "@react-three/…"`.
   → **28 module nguồn** (không kể test). Đây là tập "hạt giống".
2. **`getContext("webgl"|"experimental-webgl")`** — 3 chỗ (CommandCenter:761,
   MachineCockpit:287, RobotCockpit:261, TwinVanHanh:2098) và đều là **thăm dò
   khả năng WebGL**, không phải nơi vẽ.

Rồi **lan ngược đồ thị import** (`_graph.mjs`) để tìm mọi trang chạm tới hạt
giống → **15 trang**. Sau đó lọc bằng "có thật sự **dựng** cảnh không" (JSX
`<Canvas>` / `<CanhVanHanh>` / `<CanhNhaMay>` / `<Factory3DScene>` / `<FactoryFloor3D>`),
vì 2 trang chỉ import **hàm phụ trợ** `statusColor` nên bị đồ thị bắt oan.

### Bốn ứng viên brief nghi ngờ — ĐO XONG: cả bốn KHÔNG phải canvas gì cả

| tệp | dòng | `three` | `<canvas>` | `<svg>` | kết luận |
|---|---|---|---|---|---|
| `components/measurement-point-canvas/MeasurementPointCanvas.tsx` | 535 | 0 | 0 | 1 | **SVG** — (D) giữ |
| `components/orchestration/WorkflowGraphCanvas.tsx` | 444 | 0 | 0 | 0 | **DOM thuần** — (D) giữ |
| `components/programming/IrGraphCanvas.tsx` | 433 | 0 | 0 | 0 | **DOM thuần** — (D) giữ |
| `components/programming/PouCanvas.tsx` | 1200 | 0 | 0 | 0 | **DOM thuần** — (D) giữ |

`ProductModels.tsx`: `three` = **0**; chỉ `getContext("2d")` ×2 (xử lý ảnh). **Không phải 3D** — (D) giữ.
`CorporateLayout.tsx`: `three` = 0 **nhưng** dựng `<Factory3DScene>` (:1033) ⇒ **là 3D**. Đây là lý do phải lan đồ thị chứ không grep một tầng.

---

## 1. Bảng kiểm kê (mục 2 của brief)

`ai import` = số chỗ gọi **sống**, không tính test, không tính chú thích.

### 1a. Bốn màn Twin hiện tại — chuẩn để so trùng

| trang | route (lazy) | lối vào | quyền cổng | ai import | tính năng riêng | sửa cuối · dòng |
|---|---|---|---|---|---|---|
| `TwinVanHanh` | `/twin` ✓ | nav `nav.twin3d` | `navHref="/twin"` → `analytics_oee` **HOẶC** `machine_status` | App.tsx ×1 | nguồn sự thật hiện tại; gọi `twin.usdExport`, `twinCanh.*`, `factory.list` | 2026-09-13 · 3774 |
| `TwinLine` | `/twin/line/:id` ✓ | từ `/twin` (bấm Line) | `navHref="/twin"` (G67: **cố ý** không dùng `/twin/line/:id`) | App.tsx ×1 | cảnh Line + WIP + KPI nối | 2026-09-13 · 1086 |
| `TwinMay` | `/twin/may/:id` ✓ | từ `/twin` (bấm máy) | `navHref="/twin"` | App.tsx ×1 | nhúng `MachineCockpitBody` qua `NganNhung` | 2026-09-13 · 908 |
| `TwinStudio` | `/twin-studio` ✓ | nav `nav.twinStudio` | `settings_factory` **HOẶC** `machine_control` | App.tsx ×1 | `twinCanh.*` (dựng nhà xưởng, vùng an toàn, nhập bản vẽ) | 2026-09-13 · 269 |

### 1b. Trang 3D **CHẾT** — 0 route, 0 chỗ gọi sống

★★★ Phát hiện lớn nhất của đợt: `/digital-twin` **không còn trỏ vào `TwinHub`**.
`App.tsx:357-361` nay là một `<Redirect>` tra bảng `dinhTuyenTwinCu`. `TwinHub`
vì thế **không được import ở bất kỳ đâu** ngoài một tệp test — và 5 trang mà nó
là người gọi *duy nhất* rơi theo.

| trang | route | ai import (sống) | test | dựng 3D? | tính năng riêng (tRPC) | sửa cuối · dòng |
|---|---|---|---|---|---|---|
| `TwinHub` | **KHÔNG CÓ** | **0** | `twinHubTabBoTriXuong.unit.test.ts` (1/2 ca) | không (vỏ Tabs) | không gọi tRPC nào | 2026-09-13 · 140 |
| `DigitalTwinCenter` | **KHÔNG CÓ** | chỉ `TwinHub` | 0 | **CÓ** `<Canvas>` :819 | `twin.sceneGraph`, `twin.status`, `twin.replay`, `twin.usdExport` | 2026-08-21 · 936 |
| `DigitalTwinDashboard` | **KHÔNG CÓ** | chỉ `TwinHub` | 0 | không (đồ thị 2D) | `digitalTwin.twinState` / `defectHeatmap` / `stationLoadHeatmap` / `predictionOverlay` / `whatIf` | 2026-07-07 · 606 |
| `FactoryLiveMap3D` | **KHÔNG CÓ** | chỉ `TwinHub` | 0 | **CÓ** `<FactoryFloor3D>` :177 | `machineStatus.listWithStatus` (đã có ở Twin) | 2026-07-12 · 240 |
| `FactoryFloorEditor` | **KHÔNG CÓ** | chỉ `TwinHub` | (nhắc trong 1 test) | không (SVG; chỉ mượn `statusColor`) | `factoryZone.*` ×4, `factory.updateFloorDims`, `factory.uploadFloorPlan`, `machine.updateLayout` | 2026-07-31 · 604 |
| `CellTwinPlayer` | **KHÔNG CÓ** | chỉ `TwinHub` | 0 | không | `orchestration.simulate` (đã có ở Twin) | 2026-08-21 · 770 |

**Component chỉ 6 trang trên dùng — mồ côi theo:**

| component | ai dựng | dòng |
|---|---|---|
| `components/FactoryFloor3D.tsx` | chỉ `FactoryLiveMap3D` (+ `FactoryFloorEditor` mượn `statusColor`) | 209 |
| `components/twin/ArticulatedRobot.tsx` | chỉ `DigitalTwinCenter:242` | 196 |
| `components/factory-scene/FactoryScene3D.tsx` | **0 chỗ dựng** (`FactoryCommandView` đã chuyển sang `CanhNhaMay`) | 516 |
| `components/factory-scene/machineMesh.tsx` | chỉ `FactoryScene3D` | 159 |

### 1c. Trang 3D **SỐNG**, trùng vai trò một phần với Twin

| trang | route | lối vào | quyền | ai import | tính năng riêng | trùng với | sửa cuối · dòng |
|---|---|---|---|---|---|---|---|
| `FactoryCommandView` | `/factory-command` ✓ | nav ×1 (0 link trong app) | `requirePermission="machine_status"` | App.tsx ×1 | `factoryCommand.overview` + `machineDetail`; **đã chạy KIT MỚI** `CanhNhaMay` | **trùng nặng `/twin`** (cùng phạm vi 1 nhà máy, cùng kit) | 2026-09-06 · 823 |
| `CommandCenter` | `/command-center` ✓ | nav ×1 + **10 chỗ link sống** ở 8 tệp (Home ×2, controlTower ×2, RelatedViews, DashboardLayout, MESControlTower, OEEDashboard, ProductionDashboard, WipLineBalance) | `requirePermission="machine_status"` | App.tsx ×2 | `commandCenter.hierarchy/kpiSummary/recentAlerts/status` + `<Canvas>` riêng :863 dùng `twin.sceneGraph` | trùng **cảnh 3D** với `/twin`; **không trùng** cây phân cấp + rail cảnh báo | 2026-08-21 · 1596 |
| `CorporateLayout` | `/corporate-layout` ✓ | **0 nav**, 1 link (`CorporateManagement.tsx:611`) | `requirePermission="dashboard_corporate"` | App.tsx ×1 | `corporateFactoryStats.*` ×3, `factory.updateMapPosition` — **bản đồ NHIỀU nhà máy**, mỗi nhà máy một khối | **không trùng** — trên Twin một bậc (liên nhà máy) | 2026-08-18 · 1292 |
| `MachineCockpit` | `/machine/:id` ✓ | `MachineQuickScan`, `AndonBoard`, `CommandCenter`, `nganXuLyLogic` (nút trong Twin) | `machine_status` | App.tsx, `NganNhung`, `MachineWorkspace`, `TwinMay` = **4** | tab 3D `<Canvas>` riêng :239 (drei `<Gltf>`), + toàn bộ cockpit 2D | Twin **nhúng lại nó**, không dựng lại | 2026-09-11 · 1293 |
| `RobotCockpit` | `/robot/:id` ✓ | `CommandCenter`, `FleetOrchestration`, `RobotControl`, `nganXuLyLogic` | `machine_status` | App.tsx, `NganNhung` = **2** | telemetry khớp robot, teach/jog, `<Canvas>` :277 | Twin nhúng lại | 2026-09-10 · 955 |

---

## 2. Phân loại A/B/C/D

### (C) Trang chết — 0 lối vào, 0 chỗ gọi sống → **đề xuất xoá**

**Bằng chứng 0 tham chiếu** (`_reach.mjs`: lan xuôi từ `App.tsx`/`main.tsx`, bỏ test — 808 module sống, 6 trang này **không nằm trong**):

```
TwinHub               LIVE? NO   importers: []            tests: 1
DigitalTwinCenter     LIVE? NO   importers: [TwinHub]     tests: 0
DigitalTwinDashboard  LIVE? NO   importers: [TwinHub]     tests: 0
FactoryLiveMap3D      LIVE? NO   importers: [TwinHub]     tests: 0
FactoryFloorEditor    LIVE? NO   importers: [TwinHub]     tests: 0
CellTwinPlayer        LIVE? NO   importers: [TwinHub]     tests: 0
```

`RfTestCellSim` và `Layout` cũng là tab của `TwinHub` **nhưng vẫn SỐNG** nhờ route
riêng (`/rf-test-cell`, `/layout/:id`) ⇒ **không nằm trong danh sách xoá**.

**Danh sách đủ tệp sẽ xoá (C) — 10 tệp, 4.376 dòng:**

| # | tệp | dòng |
|---|---|---|
| 1 | `client/src/pages/TwinHub.tsx` | 140 |
| 2 | `client/src/pages/DigitalTwinCenter.tsx` | 936 |
| 3 | `client/src/pages/DigitalTwinDashboard.tsx` | 606 |
| 4 | `client/src/pages/FactoryLiveMap3D.tsx` | 240 |
| 5 | `client/src/pages/FactoryFloorEditor.tsx` | 604 |
| 6 | `client/src/pages/CellTwinPlayer.tsx` | 770 |
| 7 | `client/src/components/FactoryFloor3D.tsx` | 209 |
| 8 | `client/src/components/twin/ArticulatedRobot.tsx` | 196 |
| 9 | `client/src/components/factory-scene/FactoryScene3D.tsx` | 516 |
| 10 | `client/src/components/factory-scene/machineMesh.tsx` | 159 |

Kèm theo:
- **test**: `client/src/pages/twinHubTabBoTriXuong.unit.test.ts` — **§2 (1 ca)** phải bỏ
  (đọc `TABS` của `TwinHub`); **§1 (1 ca)** đo `LayoutContent` vẫn chạy được vì
  `Layout.tsx` sống.
- **route**: không phải xoá route nào (6 trang này **không có route**). **Giữ nguyên**
  5 dòng `<Redirect>` `/digital-twin`, `/factory-live-map`, `/factory-floor-editor`,
  `/cell-twin`, `/digital-twin-center`, `/layout` — chúng trỏ tới `/twin` / `/twin-studio` / `/rf-test-cell`, **không** trỏ vào 6 trang này.
- **mục nav**: 1 mục `href: "/digital-twin"` (`navigation.tsx:439-446`). Xoá được, **nhưng đọc mục 4 rủi ro trước**.
- **barrel**: `client/src/components/factory-scene/index.ts` phải bỏ dòng 5
  (`export { FactoryScene3D, … }`) và `sceneTypes.ts` giữ nguyên (`FactoryScene2D` còn sống).
- **i18n**: xem mục 4.

### (A) Trùng hẳn vai trò, 0 tính năng riêng → không có món nào sạch

Không món nào trong nhóm sống đạt "0 tính năng riêng". Ứng viên gần nhất là
`FactoryCommandView` nhưng nó giữ router riêng `factoryCommand.*` ⇒ xếp (B).

### (B) Có tính năng riêng chưa có ở Twin → di trú rồi mới bỏ

| món | tính năng chưa có ở Twin | khối lượng ước lượng |
|---|---|---|
| `FactoryCommandView` (`/factory-command`, 823 dòng) | `factoryCommand.overview` + `machineDetail` — một hợp đồng API gộp sẵn mà Twin không dùng. Cảnh đã là kit mới (`CanhNhaMay`) ⇒ **phần 3D không cần di trú** | **trung bình**: hoặc đổi Twin sang đọc `factoryCommand.overview`, hoặc đổi `/factory-command` thành redirect `/twin`. ⚠ Sổ ghi `factoryCommand.overview` **0 scope tenant** (G113) — nếu bỏ màn, kiểm luôn router |
| `CommandCenter` (`/command-center`, 1596 dòng) | cây phân cấp + KPI strip + rail cảnh báo hợp nhất (`commandCenter.*` ×4). Cảnh 3D thì **trùng** `/twin` và còn là `<Canvas>` drei **đời cũ** (không qua kit twin3d) | **lớn**: 4 thủ tục + 1 cảnh. Bước rẻ trước: **bỏ riêng tab 3D** của nó, giữ 3 panel dữ liệu ⇒ giảm 1 context WebGL và 1 bản sao `twin.sceneGraph` |
| `DigitalTwinDashboard` (đã chết, ở nhóm C) | `digitalTwin.twinState` / `defectHeatmap` / `stationLoadHeatmap` / `predictionOverlay` là **4 thủ tục không nơi nào khác gọi** | **nhỏ**: các thủ tục vẫn ở server, không mất; chỉ mất *màn hiển thị*. `whatIf` và `wipFlowState` **đã có ở Twin** (`useMoPhongTwin.ts:111`, `usePhanTichLine.ts:78`) |
| `FactoryFloorEditor` (đã chết, ở nhóm C) | `factoryZone.*` CRUD + `factory.updateFloorDims/uploadFloorPlan` + `machine.updateLayout` | xem **mục 3** — đo DB cho thấy **không còn là tính năng thật** |

### (D) Giữ

`CorporateLayout` (phạm vi **liên nhà máy**, trên Twin một bậc) ·
`MachineCockpit` · `RobotCockpit` (Twin **nhúng** chứ không thay) ·
`RfTestCellSim` · `Layout` · `MeasurementPointCanvas` · `WorkflowGraphCanvas` ·
`IrGraphCanvas` · `PouCanvas` · `ProductModels` · `Factory3DScene` (CorporateLayout dùng) ·
`FactoryScene2D` (FactoryCommandView dùng).

---

## 3. Kiểm lại 4 câu "⛔ KHÔNG XOÁ" — đo hôm nay, không kế thừa

### ① `MachineCockpit` — "MachineWorkspace nhúng" → **VẪN ĐÚNG** ✅

- `MachineWorkspace.tsx:78`: `<MachineCockpitBody machineId={selectedId} embedded />`
- `MachineCockpit.tsx:747`: `export function MachineCockpitBody(…)`
- `DeviceHub.tsx:49` render `<MachineWorkspace/>` khi `isWorkspaceShellEnabled()`.
  **Mặc định = BẬT**: `hubState.ts:48` `return import.meta.env.VITE_WORKSPACE_SHELL_ENABLED !== "false"`,
  và **không `.env` nào đặt biến này** (chỉ `.env.example:1391` đang comment) ⇒ `/device-monitor` **là** Machine Workspace.
- Thêm 2 người gọi nữa: `NganNhung.tsx:92` (lazy, đường Twin) và route `/machine/:id`.
- **4 chỗ gọi sống.** Giữ.

### ② `RobotCockpit` — "đích di trú, `nganXuLyLogic` trỏ vào" → **VẪN ĐÚNG** ✅

- `NganNhung.tsx:95`: `lazy(() => import("@/pages/RobotCockpit").then(m => m.RobotCockpitBody))`;
  `RobotCockpit.tsx:327` export đúng tên đó.
- `nganXuLyLogic.ts:269` phát ra lối đi `{ href: "/robot/${id}", quyen: "machine_status" }`,
  và chú thích ngay trên ghi rõ 5/6 mục sổ kiểm (#24 teach/jog · #25 joints · #27 sparkline ·
  #28 tab safety/anomalies · #29 gatedActions) có đích là **GIỮ Ở COCKPIT**.
- **2 chỗ gọi sống** + route `/robot/:id` + 3 trang link tới. Giữ.

### ③ `DigitalTwinCenter` — "giữ chỗ gọi `usdExport` duy nhất" → ★★★ **SAI / ĐÃ HẾT HẠN** ❌

`twin.usdExport` có **3 chỗ gọi**, và **2 trong số đó đang sống**:

| chỗ gọi | trạng thái |
|---|---|
| `client/src/pages/TwinVanHanh.tsx:2213` | **SỐNG** (`/twin`, nút "Xuất USD" :2629) |
| `client/src/pages/SystemHealth.tsx:592` | **SỐNG** (nút "Tải USDA (.usda)" :643) |
| `client/src/pages/DigitalTwinCenter.tsx:606` | **CHẾT** (trang không có route) |

Ngoài ra `client/src/components/twin3d/van-hanh/xuatUsd.ts` (+ `xuatUsd.unit.test.ts`)
là tầng logic thuần đã có lưới. ⇒ **Lý do hoãn này đã hết hạn.** `DigitalTwinCenter`
không còn giữ gì riêng về USD.

Cái nó **thật sự** còn giữ riêng là **`twin.replay`** (:534, thanh tua lịch sử) và
**`twin.status`** (:397) và `<ArticulatedRobot>` (:242) — cả ba **0 nơi khác gọi**.
Đó mới là lý do đúng nếu chủ sở hữu muốn hoãn.

### ④ `TwinHub` — "0 tham chiếu twin3d" → **ĐÚNG, nhưng câu này đã lạc hậu** ⚠️

Đúng: `TwinHub.tsx` **không import gì từ `twin3d/`**.
Nhưng câu ấy viết khi `TwinHub` còn là route `/digital-twin`. **Hôm nay nó không
còn route nào** (`App.tsx:357` là `<Redirect>`), và **0 tệp sản phẩm import nó**.
⇒ Nó không phải "màn cũ chạy song song" nữa — nó là **mã chết**.
Chú thích `App.tsx:347` ("`TwinHub` và cả bảy màn con VẪN CÒN TRÊN ĐĨA — §11b cấm xoá")
là **lời khai còn lại của một quyết định cũ**, không phải phép đo.

---

## 4. Rủi ro từng món — đo, không đoán

### (a) 26 redirect cũ / lưới D-1 → **con số trong brief sai**

Bảng `dinhTuyenTwinCu.ts` có **13 dòng**, không phải 26
(`_dbcount`-style đếm bằng AST nhẹ: 13). Lưới e2e `e2e/twin-lo-y-redirect.spec.ts`
có **1 `test()`** lặp qua mảng 13 dòng — nhưng **tiêu đề test tự ghi "14 đường vào cũ"**,
tức chính nó cũng lệch 1 so với mảng nó đọc (nợ nhỏ, không thuộc đợt này).

**13 đích của bảng:** `/twin` ×7 · `/twin-studio` ×4 · `/rf-test-cell` ×1 · (và `/digital-twin` là *khoá*, không phải đích).
→ **Không đích nào là một trong 6 trang chết.** Xoá 6 trang **không làm đỏ lưới D-1**,
với điều kiện **giữ nguyên** các dòng `<Redirect>` trong `App.tsx` và giữ `/rf-test-cell` sống.

### (b) Test sẽ đỏ

| tệp | số ca đỏ | vì sao |
|---|---|---|
| `client/src/pages/twinHubTabBoTriXuong.unit.test.ts` | **1 / 2** | §2 `await import("./TwinHub")` lấy `TABS`. §1 (`LayoutContent`) không phụ thuộc TwinHub |

Ba tệp khác **chỉ nhắc tên trong chú thích**, không import ⇒ không đỏ:
`components/twin3d/van-hanh/nguonDuLieu.unit.test.ts:13` · `server/services/twin/twinAssets.p5.test.ts:15` ·
`server/services/twin/pipeline/modelConversionService.ts`.
E2E: **0 spec** nào mở 6 trang chết (spec duy nhất chạm URL cũ là lưới redirect ở (a)).

### (c) G67 — href chết trong nav

`hasAccessToItem` (`navigation.tsx:2546-2562`) duyệt `navGroups` tìm `href` **khớp
chính xác** và **`return false`** khi không thấy ⇒ href lạ = chặn im lặng **mọi người**.

Đo hai chiều:

1. **Chiều nav → route**: `navigation.tsx:439` có mục `href: "/digital-twin"`
   (`requiredPermission: "analytics_oee"`). Route `/digital-twin` là `<Redirect>` **vẫn còn** ⇒
   nếu xoá 6 trang mà **giữ** redirect thì mục nav này **vẫn tới đúng `/twin`** — **0 rủi ro**.
   Nếu chủ sở hữu muốn dọn cả mục nav trùng này thì **phải xoá mục nav + để redirect ở lại**
   (redirect phục vụ bookmark, không phục vụ menu).
2. **Chiều route → nav**: `grep 'navHref="/digital-twin"'` = **0 kết quả** ⇒ **không**
   `RouteGuard` nào tra ô nav `/digital-twin`. An toàn.
   (Kiểm thêm: `navHref="/twin/line/:id"` chỉ xuất hiện **trong chú thích cảnh báo** `App.tsx:385`,
   không phải mã sống — G67 ở đây đang được phòng đúng.)
3. `RelatedViews.tsx` / `breadcrumbs.ts`: **0** tham chiếu tới route chết.
4. Nhưng có **2 link trong app trỏ ra từ trang chết** (`FactoryLiveMap3D:210` → `/rf-test-cell`,
   `DigitalTwinCenter:885` → `/machine|/robot`) — chúng chết theo trang, không để lại href mồ côi.

### (d) i18n mồ côi

Đo bằng `_i18n.mjs` (quét `t("khoá")` trên toàn `client/src`, trừ test):

- khoá được 10 tệp chết dùng: **225**
- trong đó **không trang sống nào dùng**: **220**
- **có mặt thật trong `vi.json`/`en.json`/`zh.json`**: **214** (×3 ngôn ngữ ⇒ ~642 dòng JSON)
- 6 khoá còn lại chỉ có fallback inline, không có trong locale.

Nhóm tiền tố: `celltwin.*` (40) · `digitalTwin.*` (44) · `ffe.*` (39) · `flm.*` (26) ·
`twin.*` (49) · `twinHub.*` (5) · `cellTwin.maySo` · `common.gate.selectFactory`.

⚠ **Một âm tính giả đã bắt được**: `nav.digitalTwin` bị máy chấm "mồ côi" vì
`navigation.tsx:440` dùng nó dưới dạng **chuỗi `label:`**, không qua `t()`.
Nó chỉ thật sự mồ côi **nếu** mục nav `/digital-twin` cũng bị xoá. Danh sách đầy đủ
ở `.qa-dot60/04-i18n-mocoi.json`.

### (e) ★★★ Rủi ro "mất tính năng thật" của `FactoryFloorEditor` — đo bằng DB, **đã hết hạn**

Sổ (`VeVung.tsx:9-12`, `XuongThietKe.tsx:1080`) ghi: *"`FactoryFloorEditor.tsx:444` vẫn là
nơi DUY NHẤT CRUD vùng an toàn; xoá hôm nay là mất tính năng thật"*. Đo lại hôm nay:

**Đường thay thế đã dựng xong và ĐANG SỐNG:**
`XuongThietKe.tsx:110` `import { VeVung } from "./VeVung"` → dựng tại `:1064`.
`XuongThietKe` là tab của `TwinStudio` (`/twin-studio`, route thật). Nó ghi bằng
`twinCanh.luuVungAnToan` / `twinCanh.xoaVungAnToan`.

**Hai kho dữ liệu là HAI kho khác nhau** (`server/db/twinCanh.ts:1587` nói thẳng:
*"`factory_zones` (bảng cũ) dùng toạ độ 0–1; ở đây là mm"*). Đếm hàng thật (chỉ ĐỌC):

| bảng | hàng | thuộc đường |
|---|---|---|
| `factory_zones` | **0** | cũ (`FactoryFloorEditor`) |
| `safety_zones` | **0** | cũ |
| `machines.layoutPositionX` không rỗng | **0 / 43** | cũ (`machine.updateLayout`) |
| `machines.layoutPositionY` không rỗng | **0 / 43** | cũ |
| `machines.layout` không rỗng | **0 / 43** | cũ |
| `twin_dat_cho` | **82** | mới (`twinCanh`) |
| `twin_kich_thuoc_loai` | **24** | mới |
| `twin_vat_the` | **4** | mới |
| `twin_toa_nha` / `twin_tang` | **1 / 1** | mới |
| `machine_positions` / `factory_layouts` / `twin_ban_ghi` | 0 / 0 / 0 | — |

⇒ **Toàn bộ đường bố cục cũ đang giữ 0 hàng dữ liệu**, trong khi đường mới giữ 82 vị trí.
Xoá `FactoryFloorEditor` hôm nay **không mất hàng dữ liệu nào**. Cái mất là *khả năng
sửa `factory_zones` / `layoutPositionX,Y`* — nhưng cả ba cột/bảng đó **chỉ được đọc bởi
chính các trang chết** (`FactoryFloor3D.tsx:149`, `CellTwinPlayer.tsx:247`,
`FactoryFloorEditor.tsx:145`) ⇒ xoá cả cụm là **nhất quán**, không để lại nửa đường.

⚠ **Cái KHÔNG có đường thay thế**: `factory.uploadFloorPlan` (ảnh nền mặt bằng) và
`factory.updateFloorDims` (kích thước sàn m). `TwinStudio` có `NhapBanVe` nhưng nó đi qua
`twinCanh.*`, **không** gọi hai thủ tục này. Nếu có nhà máy nào đã tải ảnh nền qua
đường cũ thì sau khi xoá sẽ **không còn UI để sửa** (thủ tục server vẫn còn, không mất dữ liệu).

---

## 5. Thứ tự đề xuất thực hiện — an toàn trước, rẻ trước

| bước | món | vì sao ở vị trí này |
|---|---|---|
| **1** | Xoá 4 component mồ côi: `FactoryScene3D` + `machineMesh` (**0 chỗ dựng**), `ArticulatedRobot`, `FactoryFloor3D` — *sau* khi bước 2 xong với 2 cái cuối | `FactoryScene3D`/`machineMesh` (675 dòng) **không dính gì tới 6 trang chết** và có 0 người dựng ⇒ rẻ nhất, rủi ro gần 0. Chỉ cần sửa 1 dòng barrel |
| **2** | Xoá `TwinHub` + `DigitalTwinDashboard` + `CellTwinPlayer` + `FactoryLiveMap3D` (1.756 dòng) | 0 route, 0 import sống, 0 e2e, 0 dữ liệu riêng. `CellTwinPlayer`/`FactoryLiveMap3D` có tính năng **đã di trú xong** (`orchestration.simulate` → `useMoPhongTwin.ts:144`; UNS → `phuUns.ts` + `TwinVanHanh:195`) |
| **3** | Xoá `FactoryFloorEditor` (604 dòng) | Cần chủ sở hữu xác nhận **chấp nhận mất UI** `uploadFloorPlan`/`updateFloorDims` (mục 4e). Dữ liệu: 0 hàng |
| **4** | Xoá `DigitalTwinCenter` (936 dòng) | Mất **thật**: `twin.replay` (tua lịch sử) + `twin.status` + robot khớp nối. Ba thứ này **0 nơi khác có**. Nếu chủ sở hữu cần replay ⇒ đây là món (B) phải di trú trước |
| **5** | Dọn 214 khoá i18n mồ côi × 3 ngôn ngữ | Làm **sau cùng**, sau khi biết chính xác món nào bị xoá — dọn sớm sẽ dọn nhầm |
| **6** | Bỏ tab 3D của `CommandCenter` (giữ 3 panel dữ liệu) | Giảm 1 `<Canvas>` drei đời cũ + 1 bản sao `twin.sceneGraph`, giữ nguyên 4 thủ tục riêng; **10 lối vào sống** ⇒ không được xoá cả trang |
| **7** | Quyết `/factory-command`: gộp vào `/twin` hay giữ | Đắt nhất, cần thiết kế; và phải kiểm `factoryCommand.overview` scope tenant (G113) cùng lượt |

**Không đụng ở mọi bước**: 6 dòng `<Redirect>` trong `App.tsx` · `/rf-test-cell` ·
`/layout/:id` · `MachineCockpit` · `RobotCockpit` · `CorporateLayout` · `Factory3DScene` · `FactoryScene2D`.

---

## 6. Brief sai ở đâu — **6 chỗ**

| # | brief nói | đo được |
|---|---|---|
| 1 | "26 redirect cũ đang được lưới D-1 kiểm" (mục 5a) | Bảng `DICH_TWIN_CU` có **13** dòng. (Tiêu đề e2e tự ghi "14" — cũng lệch) |
| 2 | Sổ: "`DigitalTwinCenter` giữ chỗ gọi `usdExport` **duy nhất**" (mục 4) | **3 chỗ gọi**, 2 chỗ **đang sống** (`TwinVanHanh:2213`, `SystemHealth:592`) |
| 3 | Danh sách ứng viên (mục 1) **thiếu** `DigitalTwinDashboard` và `CellTwinPlayer` | Cả hai là tab `TwinHub`, đều nằm trong tập chết — **thiếu 2/6 món chính của đợt** |
| 4 | Liệt `ProductModels` vào ứng viên canvas 3D | `three` = **0**; chỉ `getContext("2d")`. Không phải 3D |
| 5 | Ngờ 4 tệp `*Canvas` "có thể chỉ là canvas 2D" | Mạnh hơn thế: cả 4 có **0 `<canvas>`** luôn — SVG/DOM thuần |
| 6 | Sổ: "`TwinHub` 0 tham chiếu twin3d ⇒ cũ/mới chạy song song" | Vế đầu đúng, **vế sau sai**: `/digital-twin` nay là `<Redirect>`, `TwinHub` **0 route, 0 import sống** ⇒ mã chết, không "chạy song song" |

*(Brief đúng ở: `WorkflowGraphCanvas`/`IrGraphCanvas`/`PouCanvas`/`MeasurementPointCanvas` không phải 3D; `CorporateLayout` có 3D; 4 trang Twin mới; G67 là rủi ro thật.)*

---

## 7. Những gì tôi KHÔNG đo được, và vì sao

1. **Chi phí bundle thật của `three.js`** — cần `vite build` vào `outDir` riêng để đo
   md5/kích thước chunk. Brief cấm rebuild `dist/` (3001/3008 đang phục vụ chủ dự án).
   ⚠ Vì vậy tôi **không khẳng định** "barrel `factory-scene/index.ts` kéo `FactoryScene3D`
   vào chunk của `FactoryCommandView`" — rollup **có thể** tree-shake re-export ES thuần.
   Phải đo mới biết.
2. **Nghiệm thu thị giác** — không mở trình duyệt (không chạy cổng 3060 vì đợt này
   thuần tĩnh + DB đọc). Vì thế tôi **không** khẳng định 6 trang chết "hiện ra 404";
   tôi chỉ khẳng định điều đo được: **không có `<Route>` và không có import sống**.
3. **Người dùng thật có còn bookmark `/digital-twin?tab=center` không** — cần log truy cập
   production, không có trong repo. Đây là lý do tôi đề nghị **giữ nguyên 6 `<Redirect>`**.
4. **`factory_zones` = 0 hàng trên DB dev** — đã đo trên DB dev (`avi_app@127.0.0.1:5434/aoi_management`).
   **Chưa đo trên production.** Trước khi xoá `FactoryFloorEditor`, cần chạy lại đúng 3 câu đếm
   ấy trên DB thật (bài học BG-127: độc lập phải ở MÔ HÌNH — nên đếm bằng 2 cách rời nhau).
5. **Quyền của vai non-admin** — chưa đăng nhập đo `hasAccessToItem` bằng tài khoản thật
   (admin bypass ⇒ đo bằng admin ra số 0). Kết luận G67 ở mục 4c là **đọc từ cơ chế**
   (`navigation.tsx:2546`), chưa phải đo sống.
6. **`twin.replay` có ai dùng ngoài UI không** (script, báo cáo, export) — chỉ quét `client/`;
   chưa quét mọi consumer server-side của chính thủ tục ấy.

---

## ★ DANH SÁCH NGẮN ĐỂ CHỦ SỞ HỮU TICK

> Mỗi dòng: món · hành động đề xuất · một câu lý do **có số**.

- [ ] **`FactoryScene3D.tsx` + `machineMesh.tsx`** — **XOÁ** — 675 dòng, **0 chỗ dựng**; `/factory-command` đã chuyển sang kit mới `CanhNhaMay` từ 2026-09-06.
- [ ] **`TwinHub.tsx`** — **XOÁ** — 140 dòng; `/digital-twin` nay là `<Redirect>` (`App.tsx:357`), **0 tệp sản phẩm import**, chỉ 1 ca unit test phải bỏ.
- [ ] **`DigitalTwinDashboard.tsx`** — **XOÁ** — 606 dòng, 0 route, 0 import sống; 2/6 thủ tục của nó (`whatIf`, `wipFlowState`) **đã có ở Twin**, 4 thủ tục còn lại vẫn nằm nguyên trên server.
- [ ] **`CellTwinPlayer.tsx`** — **XOÁ** — 770 dòng, 0 route; `orchestration.simulate` **đã chạy trong Twin** (`useMoPhongTwin.ts:144`) và ở 2 màn sống khác.
- [ ] **`FactoryLiveMap3D.tsx` + `FactoryFloor3D.tsx`** — **XOÁ** — 449 dòng, 0 route; phủ UNS **đã di trú** (`phuUns.ts` → `TwinVanHanh:195`), và 0/43 máy có `layoutPositionX/Y` để vẽ.
- [ ] **`FactoryFloorEditor.tsx`** — **XOÁ** (cần bạn xác nhận) — 604 dòng, 0 route; `factory_zones` = **0 hàng**, `machines.layout*` = **0/43**; đường thay thế `VeVung` đã sống trong `/twin-studio`. ⚠ Mất UI cho `uploadFloorPlan` + `updateFloorDims` (dữ liệu không mất).
- [ ] **`DigitalTwinCenter.tsx` + `ArticulatedRobot.tsx`** — **DI TRÚ RỒI XOÁ** — 1.132 dòng, 0 route; lý do cũ ("giữ `usdExport` duy nhất") **đã sai** — `usdExport` có 2 chỗ gọi sống. Nhưng `twin.replay` + `twin.status` + robot khớp nối là **0 nơi khác có**.
- [ ] **214 khoá i18n × 3 ngôn ngữ** — **XOÁ SAU CÙNG** — chỉ 10 tệp chết dùng; làm sau khi chốt danh sách trên (1 âm tính giả đã biết: `nav.digitalTwin`).
- [ ] **Mục nav `/digital-twin`** (`navigation.tsx:439`) — **XOÁ** — trùng với ô `/twin` ngay dưới; an toàn vì **0 `RouteGuard` nào tra `navHref="/digital-twin"``**. Giữ `<Redirect>` lại cho bookmark.
- [ ] **Tab 3D của `CommandCenter`** — **BỎ RIÊNG TAB 3D** — bỏ 1 `<Canvas>` drei đời cũ (`:863`) + 1 bản sao `twin.sceneGraph`; giữ nguyên 4 thủ tục `commandCenter.*` không nơi nào khác có và **10 lối vào sống** từ 8 tệp.
- [ ] **`/factory-command` (`FactoryCommandView`)** — **QUYẾT SAU** — 823 dòng, trùng phạm vi `/twin` và đã dùng chung kit; nhưng giữ router riêng `factoryCommand.*` (2 thủ tục) và sổ ghi nó **0 scope tenant** (G113) — nên gộp phải kèm rào quyền.
- [ ] **`CorporateLayout` · `MachineCockpit` · `RobotCockpit` · `RfTestCellSim` · `Layout`** — **GIỮ** — lần lượt: phạm vi liên nhà máy (trên Twin 1 bậc) · 4 chỗ gọi sống · 2 chỗ gọi sống + là đích di trú của 5/6 mục sổ kiểm · là đích redirect `?tab=rf` · route `/layout/:id` còn sống.
- [ ] **`MeasurementPointCanvas` · `WorkflowGraphCanvas` · `IrGraphCanvas` · `PouCanvas` · `ProductModels`** — **GIỮ** — đo được **0 import `three`** và **0 `<canvas>`** (4 tệp đầu là SVG/DOM; `ProductModels` chỉ `getContext("2d")`). Không thuộc phạm vi dọn 3D.
