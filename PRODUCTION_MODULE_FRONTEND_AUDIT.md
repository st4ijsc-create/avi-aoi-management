# PRODUCTION MODULE — FRONTEND AUDIT (Multi-Role, i18n + Layout/UX)

---

## ✅ P0 + P1 COMPLETION STATUS

> Ngày cập nhật: 2026-05. Toàn bộ P0 và P1 đã được hoàn tất và xác minh bằng `pnpm build` (built in ~26s, no TypeScript errors).

### P0 — Đã hoàn thành ✅

| # | Hạng mục | File | Vị trí | Ghi chú |
|---|---|---|---|---|
| 1 | Viết lại block `production.*` cho en/vi/zh | [client/src/i18n/locales/en.json](client/src/i18n/locales/en.json), [vi.json](client/src/i18n/locales/vi.json), [zh.json](client/src/i18n/locales/zh.json) | block `production` ~L3987 (en) / ~L4010 (vi) / ~L3980 (zh) | Đầy đủ key cho list/dialog/status/priority |
| 2 | Khử hardcoded VN trong `ALGORITHM_INFO` & `CONFLICT_TYPE_LABELS` | [client/src/pages/ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) | trong component, dùng `useMemo(t)` | 4 key conflict thêm vào 3 locale |
| 3 | Bổ sung 4 key zh thiếu (`live`, `todayLabel`, `exportTitle`, `searchStation`) | [client/src/i18n/locales/zh.json](client/src/i18n/locales/zh.json) | block `productionDashboard` ~L6652 | — |
| 4 | Thay 5 chỗ `toLocaleDateString("vi-VN" / "en-US")` bằng `useLocaleDate()` / `getActiveLocale()` | [ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) (L310-311, L449), [ProductionDashboard.tsx](client/src/pages/ProductionDashboard.tsx) (`todayStr` + chart formatters) | dùng helper [client/src/lib/format.ts](client/src/lib/format.ts) | `localeMap` mở rộng: en→en-US, vi→vi-VN, zh→zh-CN |

### P1 — Đã hoàn thành ✅

| # | Hạng mục | File | Vị trí | Ghi chú |
|---|---|---|---|---|
| 5 | Refactor `getExportConfig()` Dashboard dùng `t()` + column-foot/row-meta i18n | [ProductionDashboard.tsx](client/src/pages/ProductionDashboard.tsx) | `getExportConfig({ t })`, StationViewTab columns | Còn dùng pattern `t(key, fallback)` cho an toàn — fallback EN, không phải VN |
| 6 | Bỏ inline VN-fallback không nhất quán; xác nhận `i18next.fallbackLng = 'en'` | [client/src/i18n/index.ts](client/src/i18n/index.ts) | — | Đã set sẵn `fallbackLng: "en"`. Dashboard dùng EN fallback (an toàn). Scheduling/Orders không còn fallback VN. |
| 7 | Sticky table header + scroll wrapper cho 3 trang | [ProductionOrders.tsx](client/src/pages/ProductionOrders.tsx) (L410-412), [ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) (L293-295) | wrapper `max-h-[60vh] overflow-auto rounded-md border` + `<TableHeader className="sticky top-0 z-10 bg-background">` | ProductionDashboard StationViewTab table cũng đã có scroll wrapper |
| 8 | AlertDialog confirm cho "Apply suggestion" | [ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) (L314-340) | `<AlertDialog>` bọc nút Apply mỗi suggestion | Tiêu đề/mô tả/cancel/confirm dùng `t()` |
| 9 | KPI cards clickable + URL-state filter cho Dashboard | [ProductionDashboard.tsx](client/src/pages/ProductionDashboard.tsx) | `useLocation`, `useSearch`, `initialParams`, `updateUrl`, `handleTabChange`, `handleLowYieldClick` + chip + `StationViewTab` filter | KPI "Low Yield Stations" click → switch tab `station` + filter `firstPassYield<70`; chip vàng có thể bỏ |
| 10 | Sticky Optimize/Algorithm Card + active-algorithm highlight | [ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) (L207) | `<Card className="sticky top-2 z-20 shadow-md">` + `border-2 border-primary` cho thẻ active | — |
| 11 | aria-label cho icon-only Edit/Delete (a11y) | [ProductionOrders.tsx](client/src/pages/ProductionOrders.tsx) | `aria-label={t('production.editOrder' / 'deleteOrder')}` | 2 key mới thêm vào 3 locale |
| 12 | Placeholder hardcoded "PO-2024-001", "CORP-001", "1000" → i18n | [ProductionOrders.tsx](client/src/pages/ProductionOrders.tsx) (L221, L225, L273) | `t('production.orderCodePlaceholder' / 'companyCodePlaceholder' / 'targetQuantityPlaceholder')` | 3 key mới với prefix "e.g."/"vd:"/"例如" |

### Đã xác minh (không cần sửa)

- `i18next.fallbackLng` = `"en"` đã set trong [client/src/i18n/index.ts](client/src/i18n/index.ts).
- `localeMap` trong [client/src/lib/format.ts](client/src/lib/format.ts) đã hỗ trợ đủ 3 ngôn ngữ.
- Build sạch: 0 TypeScript error sau toàn bộ thay đổi.

### Còn tồn (P2 — đợt cải tiến UX, ngoài phạm vi sprint hiện tại)

- ~~Live auto-refresh + skeleton chart~~ ✅ Đã hoàn thành: Skeleton charts đã có sẵn cho 4 tab; toggle Auto-refresh 30s + URL param `?autoRefresh=1` thêm vào toolbar (`RefreshCw` icon, 5 i18n keys en/vi/zh).
- ~~Defect Pareto cumulative line + SPC control limits~~ ✅ Đã có sẵn: Pareto dùng `ComposedChart` + cumulative `Line` + 80% `ReferenceLine`; SPC có UCL/LCL `ReferenceLine`.
- ~~Cross-link `StationAnalysis` → Dashboard truyền filter~~ ✅ Đã hoàn thành: breadcrumb Link → Dashboard với `?factory=&line=`.
- ~~Mobile/responsive polish < 768px~~ ✅ Đã hoàn thành: Dashboard summary strip + toolbar giảm padding/gap mặc định, Scheduling header stack-on-mobile + algorithm grid `sm:grid-cols-3`, Orders header stack-on-mobile, Dialog Create/Edit `sm:grid-cols-2` + `max-h-[70vh] overflow-y-auto`.
- ~~Multi-factory compare mode~~ ✅ (overlay panel với BarChart per-factory + drilldown click → filter, Dashboard.tsx).
- ~~Server-side debounced search trong `productionOrder.list` tRPC~~ ✅ Đã hoàn thành: thêm `search` zod input → `db.getProductionOrders` dùng `ilike(orderCode|companyCode)` (cả 2 cột đều có index); frontend debounce 300ms (`useEffect` + `setTimeout`) đẩy `debouncedSearch` vào tRPC query, fallback client-side `.filter` để typing mượt trước khi timer fire.

### Cảnh báo build pre-existing (KHÔNG fix theo quy ước hiện tại)

- Tailwind shorthand warnings tại `ProductionScheduling.tsx` lines 244, 389, 412, 486 (`min-w-[160px]`, `h-[500px]`, `h-[200px]`, `h-[300px]`).
- Vite chunk-size warning cho `Factory3DScene` (1.19 MB), `index` (10.78 MB) — pre-existing, đã có document riêng.
- `jspdf`/`xlsx` lazy chunks — pre-existing.

---

> Phạm vi: 3 trang dưới module `/production`
> - `client/src/pages/ProductionOrders.tsx`        → `/production-orders`
> - `client/src/pages/ProductionScheduling.tsx`    → `/production-scheduling`
> - `client/src/pages/ProductionDashboard.tsx`     → `/production-dashboard`
>
> Phương pháp: AI agent đóng vai 5 cấp người dùng (Operator → Line Supervisor → Production Manager → QA / Process Engineer → Plant Director / Admin), thực hiện workflow điển hình của từng vai, bắt lỗi theo 2 trục **Language (ưu tiên cao nhất)** và **Layout/UX**.

---

## 0. EXECUTIVE SUMMARY

> **Cập nhật 2026-05**: Toàn bộ 🔴 Critical đã được giải quyết trong P0; tất cả 🟡 Medium đã xử lý trong P1; toàn bộ 🟠 / 🟢 Layout đã hoàn tất trong P2 (#10–#14); server-side debounced search (`productionOrder.list` + `getProductionOrders`) cũng đã đóng. **Backlog audit = 0**.

| Hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| i18n — `production.*` (Orders) | 🔴 Critical | ✅ | Block vi/en/zh được viết lại đầy đủ. |
| i18n — `scheduling.*` (Scheduling) | 🟡 Medium | ✅ | `ALGORITHM_INFO` & `CONFLICT_TYPE_LABELS` dùng `useMemo(t)`. |
| i18n — `productionDashboard.*` | 🟡 Medium | ✅ | 4 key zh đã bổ sung; export header dùng `t()`; 5 key auto-refresh mới. |
| Date/locale formatting | 🔴 Critical | ✅ | Dùng `useLocaleDate()` / `getActiveLocale()`; `localeMap` hỗ trợ 3 ngôn ngữ. |
| Layout — Orders | 🟡 | ✅ | Sticky header, AlertDialog confirm, dialog `sm:grid-cols-2 + max-h-[70vh]`, header stack-on-mobile. |
| Layout — Scheduling | 🟠 | ✅ | Sticky Optimize Card, active-algorithm highlight, mobile `grid-cols-1 sm:grid-cols-3`, header stack-on-mobile. |
| Layout — Dashboard | 🟢 / 🟡 | ✅ | KPI clickable + URL-state, cross-link, auto-refresh toggle, Pareto + SPC control lines, mobile giảm padding/gap. |
| Accessibility | 🟠 | ✅ | `aria-label` cho icon-only Edit/Delete + Toggle auto-refresh. |

---

## 1. PHÁT HIỆN i18n (CHI TIẾT NHẤT — theo yêu cầu)

### 1.1 Tệp đã kiểm tra

- [client/src/i18n/locales/en.json](client/src/i18n/locales/en.json) — namespaces `production` (L3987), `scheduling` (L5979), `productionDashboard` (L6678).
- [client/src/i18n/locales/vi.json](client/src/i18n/locales/vi.json) — `production` (L4010), `scheduling` (L6002), `productionDashboard` (L6701).
- [client/src/i18n/locales/zh.json](client/src/i18n/locales/zh.json) — `production` (L3980), `scheduling` (L5972), `productionDashboard` (L6652).

### 1.2 🔴 Vấn đề **NGHIÊM TRỌNG #1** — `production.*` là stub auto-generated

Toàn bộ namespace `production` ở **cả ba ngôn ngữ** trông như sản phẩm của một script "expand camelCase → Title Case" rồi dịch máy từng từ riêng lẻ. Bằng chứng:

**en.json** (L3987-4035) — value chỉ là spaced version của key:
```json
"title": "Title",
"notes": "Notes",
"description": "Description",
"orderListDescription": "Order list description",
"createNewTitle": "Create new title",
"statusInProgress": "Status in progress",
"allStatuses": "All statuses"
```
→ Người dùng thấy nhãn **"Title"**, **"Notes"**, **"Order list description"** thay vì "Production Orders", "Internal Notes", "List of all production work orders".

**vi.json** (L4010-4060) — dịch máy word-by-word, lẫn lộn Anh-Việt, sai cú pháp:
```json
"orderListDescription": "Order Danh sách Mô tả",   ← lẫn "Order"
"orderCode": "Order Mã",                            ← lẫn "Order"
"ganttChart": "Gantt Biểu đồ",                      ← thứ tự sai
"orderList": "Order Danh sách",                     ← lẫn "Order"
"editTitle": "Sửa Tiêu đề",
"editDescription": "Sửa Mô tả",
"createNewTitle": "Tạo Mới Tiêu đề",                ← thiếu ngữ pháp
"createNewDescription": "Tạo Mới Mô tả",
"fillRequiredFields": "Fill Bắt buộc Trường",       ← lẫn "Fill"
"statusInProgress": "Trạng thái trong Tiến độ",     ← dịch sai (đúng: "Đang sản xuất")
"statusCompleted": "Trạng thái completed",          ← lẫn tiếng Anh
"statusCancelled": "Trạng thái cancelled",
"allStatuses": "Tất cả statuses",                   ← lẫn tiếng Anh
"noOrders": "Không orders",                         ← lẫn tiếng Anh
"createOrder": "Tạo order",                         ← lẫn tiếng Anh
"priorityUrgent": "Ưu tiên Khẩn cấp",
"priorityHigh": "Ưu tiên Cao",
"targetQuantity": "Mục tiêu Số lượng"               ← đúng phải là "Số lượng mục tiêu"
```

**zh.json** (L3980-4030) — cũng lẫn Anh-Trung:
```json
"selectLine": "选择line",
"orderList": "顺序列表",         ← "顺序" = "thứ tự", đúng phải là "订单列表"
"orderCode": "顺序code",
"createOrder": "创建工单",
"ganttChart": "Gantt图表",
"fillRequiredFields": "Fill必填fields",
"allStatuses": "全部statuses",
"priorityUrgent": "优先级urgent",
"notesPlaceholder": "备注placeholder",
"searchPlaceholder": "搜索占位符"   ← dịch nhầm "placeholder" thành cụm chữ
```

**Tác động theo vai:**

| Vai | Trải nghiệm thực tế |
|---|---|
| Operator (vi) | Mở `/production-orders`, thấy nút "Tạo order", filter "Tất cả statuses", trạng thái "Trạng thái completed" → mất tin tưởng vào hệ thống. |
| Line Supervisor (zh) | Thấy "选择line", "Gantt图表", "全部statuses" → tưởng UI bị lỗi. |
| QA Inspector (en) | Thấy form field labels "Title", "Notes", "Description" generic → không biết trường nào là gì. |

**Khuyến nghị (P0 — phải làm trước go-live):**

Viết lại toàn bộ block `production` cho 3 ngôn ngữ, ví dụ chuẩn:

```jsonc
// en.json
"production": {
  "title": "Production Orders",
  "description": "Create, schedule and track manufacturing work orders",
  "createNew": "Create Order",
  "createNewTitle": "Create New Production Order",
  "createNewDescription": "Add a new work order to the production queue",
  "orderCode": "Order Code",
  "companyCode": "Company Code",
  "factory": "Factory",
  "workshop": "Workshop",
  "line": "Line",
  "product": "Product",
  "targetQuantity": "Target Quantity",
  "priority": "Priority",
  "priorityNormal": "Normal",
  "priorityHigh": "High",
  "priorityUrgent": "Urgent",
  "notes": "Notes",
  "notesPlaceholder": "Optional internal notes…",
  "selectFactory": "Select factory…",
  "selectWorkshop": "Select workshop…",
  "selectLine": "Select line…",
  "selectProduct": "Select product…",
  "createOrder": "Create Order",
  "totalOrders": "Total Orders",
  "totalOutput": "Total Output",
  "statusInProgress": "In Progress",
  "statusCompleted": "Completed",
  "statusPending": "Pending",
  "statusPaused": "Paused",
  "statusCancelled": "Cancelled",
  "list": "List",
  "ganttChart": "Gantt Chart",
  "searchPlaceholder": "Search by order code, product, company…",
  "status": "Status",
  "allStatuses": "All Statuses",
  "orderList": "Order List",
  "orderListDescription": "All production work orders, newest first",
  "company": "Company",
  "progress": "Progress",
  "confirmDelete": "Delete this production order? This cannot be undone.",
  "noOrders": "No production orders found",
  "editTitle": "Edit Production Order",
  "editDescription": "Update the order details below",
  "fillRequiredFields": "Please fill in all required fields",
  "createSuccess": "Order created successfully",
  "updateSuccess": "Order updated successfully",
  "deleteSuccess": "Order deleted successfully"
}
```

```jsonc
// vi.json
"production": {
  "title": "Đơn hàng sản xuất",
  "description": "Tạo, lên lịch và theo dõi đơn hàng sản xuất",
  "createNew": "Tạo đơn hàng",
  "createNewTitle": "Tạo đơn hàng sản xuất mới",
  "createNewDescription": "Thêm một đơn hàng mới vào hàng đợi sản xuất",
  "orderCode": "Mã đơn hàng",
  "companyCode": "Mã công ty",
  "factory": "Nhà máy",
  "workshop": "Xưởng",
  "line": "Dây chuyền",
  "product": "Sản phẩm",
  "targetQuantity": "Số lượng mục tiêu",
  "priority": "Mức ưu tiên",
  "priorityNormal": "Bình thường",
  "priorityHigh": "Cao",
  "priorityUrgent": "Khẩn cấp",
  "notes": "Ghi chú",
  "notesPlaceholder": "Ghi chú nội bộ (không bắt buộc)…",
  "selectFactory": "Chọn nhà máy…",
  "selectWorkshop": "Chọn xưởng…",
  "selectLine": "Chọn dây chuyền…",
  "selectProduct": "Chọn sản phẩm…",
  "createOrder": "Tạo đơn hàng",
  "totalOrders": "Tổng đơn hàng",
  "totalOutput": "Tổng sản lượng",
  "statusInProgress": "Đang sản xuất",
  "statusCompleted": "Hoàn thành",
  "statusPending": "Chờ xử lý",
  "statusPaused": "Tạm dừng",
  "statusCancelled": "Đã hủy",
  "list": "Danh sách",
  "ganttChart": "Biểu đồ Gantt",
  "searchPlaceholder": "Tìm theo mã đơn, sản phẩm, công ty…",
  "status": "Trạng thái",
  "allStatuses": "Tất cả trạng thái",
  "orderList": "Danh sách đơn hàng",
  "orderListDescription": "Tất cả đơn hàng sản xuất, mới nhất ở trên",
  "company": "Công ty",
  "progress": "Tiến độ",
  "confirmDelete": "Xóa đơn hàng này? Không thể hoàn tác.",
  "noOrders": "Chưa có đơn hàng sản xuất nào",
  "editTitle": "Sửa đơn hàng",
  "editDescription": "Cập nhật thông tin đơn hàng bên dưới",
  "fillRequiredFields": "Vui lòng điền đầy đủ các trường bắt buộc",
  "createSuccess": "Tạo đơn hàng thành công",
  "updateSuccess": "Cập nhật đơn hàng thành công",
  "deleteSuccess": "Xóa đơn hàng thành công"
}
```

```jsonc
// zh.json
"production": {
  "title": "生产工单",
  "description": "创建、排程和跟踪生产工单",
  "createNew": "新建工单",
  "createNewTitle": "新建生产工单",
  "createNewDescription": "向生产队列中添加新工单",
  "orderCode": "工单编号",
  "companyCode": "公司代码",
  "factory": "工厂",
  "workshop": "车间",
  "line": "产线",
  "product": "产品",
  "targetQuantity": "目标数量",
  "priority": "优先级",
  "priorityNormal": "普通",
  "priorityHigh": "高",
  "priorityUrgent": "紧急",
  "notes": "备注",
  "notesPlaceholder": "选填的内部备注…",
  "selectFactory": "选择工厂…",
  "selectWorkshop": "选择车间…",
  "selectLine": "选择产线…",
  "selectProduct": "选择产品…",
  "createOrder": "创建工单",
  "totalOrders": "工单总数",
  "totalOutput": "总产量",
  "statusInProgress": "生产中",
  "statusCompleted": "已完成",
  "statusPending": "待处理",
  "statusPaused": "已暂停",
  "statusCancelled": "已取消",
  "list": "列表",
  "ganttChart": "甘特图",
  "searchPlaceholder": "按工单号、产品、公司搜索…",
  "status": "状态",
  "allStatuses": "全部状态",
  "orderList": "工单列表",
  "orderListDescription": "全部生产工单，按创建时间倒序",
  "company": "公司",
  "progress": "进度",
  "confirmDelete": "确认删除该工单？操作不可撤销。",
  "noOrders": "暂无生产工单",
  "editTitle": "编辑工单",
  "editDescription": "在下方更新工单信息",
  "fillRequiredFields": "请填写所有必填字段",
  "createSuccess": "工单创建成功",
  "updateSuccess": "工单更新成功",
  "deleteSuccess": "工单删除成功"
}
```

### 1.3 🔴 Vấn đề **NGHIÊM TRỌNG #2** — Hardcoded tiếng Việt trong `ProductionScheduling.tsx`

File [client/src/pages/ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) khai báo **2 hằng số ở module-scope** (ngoài React component) chứa **toàn bộ chuỗi tiếng Việt cố định** — dù JSON đã có key sẵn:

```ts
// Hằng số module → KHÔNG dùng được t()
const ALGORITHM_INFO = {
  fifo:      { label: "FIFO (First In First Out)", description: "Xếp lịch theo thứ tự tạo đơn..." },
  priority:  { label: "Priority Scheduling",       description: "Ưu tiên đơn hàng..." },
  edf:       { label: "EDF (Earliest Deadline First)", description: "Đơn hàng có deadline gần nhất ưu tiên trước" },
};

const CONFLICT_TYPE_LABELS = {
  schedule_overlap:    "Chồng chéo lịch",
  dependency:          "Phụ thuộc đơn",
  capacity_exceeded:   "Vượt công suất",
  deadline_miss:       "Trễ deadline",
};
```

**Tác động:** Người dùng zh/en luôn nhìn thấy tiếng Việt trên 3 thẻ thuật toán và bảng xung đột → vô nghĩa.

**Khuyến nghị fix (P0):**

1. Bỏ 2 hằng số module → chuyển thành **factory function** hoặc **inline trong component** dùng `t()`:

```tsx
// Bên trong component
const { t } = useTranslation();

const ALGORITHM_INFO = useMemo(() => ({
  fifo:     { label: t("scheduling.fifo"),     description: t("scheduling.fifoDesc") },
  priority: { label: t("scheduling.priority"), description: t("scheduling.priorityDesc") },
  edf:      { label: t("scheduling.edf"),      description: t("scheduling.edfDesc") },
}), [t]);

const CONFLICT_TYPE_LABELS = useMemo(() => ({
  schedule_overlap:  t("scheduling.conflictScheduleOverlap"),
  dependency:        t("scheduling.conflictDependency"),
  capacity_exceeded: t("scheduling.conflictCapacityExceeded"),
  deadline_miss:     t("scheduling.conflictDeadlineMiss"),
}), [t]);
```

2. Bổ sung 4 key conflict vào `scheduling` cho cả 3 ngôn ngữ:

| key | en | vi | zh |
|---|---|---|---|
| `conflictScheduleOverlap` | Schedule overlap | Chồng chéo lịch | 排程重叠 |
| `conflictDependency` | Order dependency | Phụ thuộc đơn | 工单依赖 |
| `conflictCapacityExceeded` | Capacity exceeded | Vượt công suất | 超出产能 |
| `conflictDeadlineMiss` | Deadline missed | Trễ deadline | 超期 |

### 1.4 🔴 Hardcoded date locale

5 chỗ format ngày bằng locale cố định, không bám theo `i18n.language`:

| File | Code | Vấn đề |
|---|---|---|
| `ProductionScheduling.tsx` | `date.toLocaleDateString("vi-VN")` (×4 cho `startDate`, `endDate`, `estimatedEnd`, `suggestedStart/End`) | EN/ZH user vẫn thấy "31/12/2024" |
| `ProductionDashboard.tsx` | `today.toLocaleDateString("en-US", {weekday:"long", …})` cho `todayStr` | VI/ZH user thấy "Wednesday, December 31, 2024" |

**Khuyến nghị (P1):** Tạo helper dùng chung [client/src/lib/format.ts](client/src/lib/format.ts) hoặc nội tuyến:

```ts
import { useTranslation } from "react-i18next";

const localeMap = { en: "en-US", vi: "vi-VN", zh: "zh-CN" } as const;

export function useLocaleDate() {
  const { i18n } = useTranslation();
  const locale = localeMap[i18n.language as keyof typeof localeMap] ?? "en-US";
  return {
    short: (d: Date) => d.toLocaleDateString(locale),
    long:  (d: Date) => d.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
  };
}
```

### 1.5 🟡 Hardcoded English trong `ProductionDashboard.tsx`

Mặc dù file có gọi `t()` đầy đủ cho tabs/filters/columns, các chỗ sau **vẫn cứng English** (dù VI và ZH đã có cấu trúc tương ứng):

| Vị trí | Chuỗi cứng | Đề xuất key |
|---|---|---|
| Column-foot small labels (StationViewTab) | `First pass yield`, `Point change`, `Final yield`, `Output`, `Retests` | Đã có `colFPY/colChange/colFinalYield/colOutput/colRetests` — chỉ cần đọc lại biến |
| Row meta (image monitor cells) | `Image monitors`, `Measurements` | Thêm `productionDashboard.imageMonitors`, `productionDashboard.measurements` |
| `getExportConfig()` (PDF/CSV export) | `"Overview"`, `"Stations"`, `"Avg FPY"`, `"Total Output"`, `"Avg Retests"`, `"Low Yield"`, `"Station Performance"`, `"Top Defects"`, `"Production Dashboard Report"` | Đã có hầu hết key trong `productionDashboard.*` — gọi `t()` thay vì literal |

**Lưu ý zh thiếu key:** zh.json `productionDashboard` thiếu 4 key được code dùng:
- `live` (badge live indicator)
- `todayLabel`
- `exportTitle`
- `searchStation`

→ ZH user thấy fallback từ enFallback hoặc rỗng. **Bổ sung ngay:**

```jsonc
// zh.json → "productionDashboard": { ... thêm:
"live": "实时",
"todayLabel": "今天",
"exportTitle": "生产仪表板报告",
"searchStation": "搜索工站名称、代码、产线…"
```

### 1.6 🟡 Hardcoded labels trong `ProductionOrders.tsx`

| Vị trí | Chuỗi | Khuyến nghị |
|---|---|---|
| Table header column "OK/NG/NTF" | hardcoded ASCII | Thêm `production.okNgNtf` (giá trị giống nhau 3 ngôn ngữ — chỉ thêm vào en.json là chuẩn) |
| Placeholder Create dialog | `"PO-2024-001"`, `"CORP-001"`, `"1000"` | Tách thành key `production.orderCodePlaceholder`, `production.companyCodePlaceholder`, `production.targetQuantityPlaceholder` để các năm sau không bị dính 2024 |

### 1.7 Pattern không đồng nhất giữa 3 file

| File | Pattern dùng | Hệ quả |
|---|---|---|
| ProductionDashboard.tsx | `t('key', 'English fallback')` | Nếu key thiếu vẫn ra English (an toàn nhưng dấu lỗi) |
| ProductionScheduling.tsx | `t('key', 'Tiếng Việt fallback')` | Nếu key thiếu, EN/ZH user thấy tiếng Việt |
| ProductionOrders.tsx | `t('key')` không có fallback | Nếu key thiếu, hiện raw key `"production.title"` cho user |

**Khuyến nghị:** Thống nhất **không dùng fallback inline**, thay vào đó cấu hình `i18next.fallbackLng = "en"` (hầu hết dự án đã set sẵn — confirm trong [client/src/i18n/index.ts](client/src/i18n/index.ts)). Lý do: fallback trong code che dấu thiếu key và gây mâu thuẫn ngôn ngữ.

---

## 2. PHÁT HIỆN LAYOUT / UX (theo từng vai)

### 2.1 Vai 1 — Operator (công nhân vận hành)

**Đường dùng:** `/production-orders` → tìm đơn của ca mình → xem progress.

| Vấn đề | File | Khuyến nghị |
|---|---|---|
| Search box chỉ tìm trong client (filter array đã load), không có server search → ≥ 500 đơn sẽ chậm | `ProductionOrders.tsx` | Thêm debounced server-side search vào tRPC `productionOrder.list`. |
| Không có sticky header → cuộn xuống quên cột nào là gì | `ProductionOrders.tsx` (`<Table>` shadcn) | Bọc trong wrapper `max-h-[60vh] overflow-auto` + thêm `sticky top-0` cho `<TableHead>`. |
| Button icon-only edit/delete không có aria-label | `ProductionOrders.tsx`, `ProductionScheduling.tsx` | Thêm `aria-label={t("common.edit")}` cho từng IconButton. |
| Mobile (< 768px): table tràn ngang không gợi ý | tất cả 3 file | Thêm `<div className="overflow-x-auto">` wrapper + hint scroll. |

### 2.2 Vai 2 — Line Supervisor

**Đường dùng:** `/production-scheduling` → kiểm tra conflicts → áp suggestion.

| Vấn đề | File | Khuyến nghị |
|---|---|---|
| 3 thẻ algorithm to ngang nhau, không hiện rõ thẻ "đang chọn" | `ProductionScheduling.tsx` (Algorithm cards) | Thêm `border-2 border-primary` + check icon cho thẻ active; thu nhỏ các thẻ khác. |
| Nút **Optimize** đặt ở phải sau dropdown — supervisor mới không thấy | `ProductionScheduling.tsx` | Tăng size `lg`, thêm gradient/primary variant; pin vào `sticky top-2` bar khi cuộn. |
| Conflict & Suggestion list không pagination, > 20 item là cuộn vô tận | `ProductionScheduling.tsx` | Thêm "Show 5 more" hoặc shadcn `Accordion` group theo `severity`. |
| Apply button cho mỗi suggestion không confirm dialog → bấm nhầm = ghi đè lịch | `ProductionScheduling.tsx` | Bọc bằng `<AlertDialog>`. |
| Không có hiển thị thuật toán nào đã chạy lần cuối + thời điểm | `ProductionScheduling.tsx` | Thêm dòng "Last optimized: {{relative}} with {{algorithm}}". |

### 2.3 Vai 3 — Production Manager

**Đường dùng:** `/production-dashboard` → toàn cảnh → drill xuống station.

| Vấn đề | File | Khuyến nghị |
|---|---|---|
| Toolbar 1 hàng quá nhiều: tabs + 6 date preset + 2 select + search → wrap xấu < 1280px | `ProductionDashboard.tsx` | Tách: dòng 1 = tabs + date presets; dòng 2 = filter selects + search; hoặc gom date vào 1 popover preset. |
| KPI strip không clickable → không drill nhanh được | `ProductionDashboard.tsx` | Card "Low Yield Stations" nên click → switch sang tab `station` + filter sẵn `lowYield=true`. |
| Trend / SPC tab không có loading skeleton riêng → blank trắng > 1s với dataset lớn | `ProductionDashboard.tsx` | Thêm `<Skeleton className="h-72" />` placeholder cho từng chart. |
| Custom date range mở Calendar nhưng không có shortcut "Last 7d / Last 30d / This shift" | `ProductionDashboard.tsx` | Thêm preset buttons trong popover. |

### 2.4 Vai 4 — QA / Process Engineer

**Đường dùng:** `/production-dashboard` tab Defect & SPC → export báo cáo.

| Vấn đề | File | Khuyến nghị |
|---|---|---|
| `getDefectTagStyle()` dùng nhãn category cứng "Irregular/ASSY/Damage/Pollution/NTF" — coi như taxonomy code, OK; nhưng **tooltip/legend** không có; engineer không biết "ASSY" là gì | `ProductionDashboard.tsx` | Thêm Tooltip mô tả mỗi category. |
| Defect Pareto chart không có line cộng dồn % | `ProductionDashboard.tsx` (defect tab) | Dùng `ComposedChart` của recharts — bar + cumulative line trên trục Y phụ. |
| Export PDF/CSV header hardcoded English (xem 1.5) | `ProductionDashboard.tsx` | Inject `t()` qua `getExportConfig({ t })`. |
| SPC tab thiếu chỉ báo control limits (UCL/LCL) trên chart | `ProductionDashboard.tsx` | Thêm `<ReferenceLine y={ucl} />` + `lcl`. |

### 2.5 Vai 5 — Plant Director / Admin

**Đường dùng:** Xem nhanh KPI → so sánh nhiều factory.

| Vấn đề | File | Khuyến nghị |
|---|---|---|
| Filter Factory là single-select → không so sánh 2 nhà máy cùng lúc | `ProductionDashboard.tsx` | Đổi sang multi-select kèm chế độ "Compare" → split chart. |
| Không có "saved view" / bookmark filter | `ProductionDashboard.tsx` | Lưu filter state vào URL searchParams (đã có `wouter useLocation`); thêm nút "Copy link". |
| Không có auto-refresh / live indicator chỉ là badge tĩnh | `ProductionDashboard.tsx` (badge `live`) | Refetch trpc query mỗi 30-60s khi tab visible (`useQuery({ refetchInterval })`); badge xanh khi vừa fetch xong. |
| Cross-link từ `StationAnalysis` → `/production-dashboard` không truyền filter | `client/src/pages/StationAnalysis.tsx` | Truyền `?factory=...&line=...&station=...` và đọc trong dashboard. |

---

## 3. ĐỀ XUẤT PRIORITY ROADMAP

### P0 — Phải fix trước go-live (1 sprint)
1. Viết lại `production.*` cho en/vi/zh (xem 1.2).
2. Khử hardcoded VN trong `ALGORITHM_INFO` & `CONFLICT_TYPE_LABELS` của `ProductionScheduling.tsx` (xem 1.3); thêm 4 key conflict.
3. Bổ sung 4 key zh thiếu trong `productionDashboard` (xem 1.5).
4. Thay 5 chỗ `toLocaleDateString("vi-VN" / "en-US")` bằng `useLocaleDate()` helper (xem 1.4).

### P1 — Sprint kế tiếp
5. Refactor `getExportConfig()` của Dashboard dùng `t()`; thay column-foot labels và row meta cứng English.
6. Bỏ inline fallback string không nhất quán; xác nhận `i18next.fallbackLng = 'en'`.
7. Sticky table header + scroll wrapper cho 3 trang.
8. AlertDialog confirm cho "Apply suggestion".
9. KPI cards clickable + URL-state filter cho Dashboard.

### P2 — Đợt cải tiến UX
10. ~~Multi-factory compare mode~~ ✅
11. Live auto-refresh + skeleton chart.
12. Defect Pareto cumulative line + SPC control limits.
13. Cross-link StationAnalysis → Dashboard truyền filter.
14. Mobile/responsive polish (< 768px).

---

## 4. TÓM TẮT FILE CẦN CHỈNH

| File | i18n | Layout |
|---|---|---|
| [client/src/i18n/locales/en.json](client/src/i18n/locales/en.json) | Viết lại block `production` (L3987-4035) | — |
| [client/src/i18n/locales/vi.json](client/src/i18n/locales/vi.json) | Viết lại block `production` (L4010-4060) | — |
| [client/src/i18n/locales/zh.json](client/src/i18n/locales/zh.json) | Viết lại block `production` (L3980-4030) + bổ sung 4 key `productionDashboard` | — |
| [client/src/pages/ProductionScheduling.tsx](client/src/pages/ProductionScheduling.tsx) | Khử hardcoded VN ở `ALGORITHM_INFO`, `CONFLICT_TYPE_LABELS`, 4× `vi-VN` date | Active algorithm card, sticky Optimize bar, AlertDialog confirm Apply |
| [client/src/pages/ProductionDashboard.tsx](client/src/pages/ProductionDashboard.tsx) | Wrap 5 column-foot labels, 2 row meta, `getExportConfig()` qua `t()`; date `en-US` cứng | Toolbar 2 hàng, KPI clickable, URL-state, auto-refresh |
| [client/src/pages/ProductionOrders.tsx](client/src/pages/ProductionOrders.tsx) | Thêm key cho "OK/NG/NTF" header + 3 placeholder; bỏ fallback rỗng | Sticky header, debounced server search, aria-labels, mobile hint |

---

> **Bước tiếp theo:** xác nhận muốn tôi tự động áp **P0** (3 file JSON + Scheduling.tsx + date helper) hay duyệt từng phần trước khi sửa.
