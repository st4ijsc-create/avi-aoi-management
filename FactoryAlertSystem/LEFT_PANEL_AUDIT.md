# 🔍 AUDIT: LEFT PANEL (Column 1) — StationDetailScreen.tsx

**File:** `src/screens/StationDetailScreen.tsx` (~5250 lines)  
**Phạm vi:** KPI Strip, Inspection Points Table, PCB Canvas, data flow từ MQTT + API  
**Ngày audit:** 2025-07-14

---

## TÓM TẮT KIẾN TRÚC DATA FLOW

### Nguồn dữ liệu Left Panel:
1. **KPI Strip** (FirstPassYield, FinalYield, Output, RetestRate):
   - Nguồn: **REST API A7** (`getStationStatistics`) → `updateStationData(sid, { kpi })` → Zustand `station.kpi`
   - Selector: `selectStationKPI` → đọc `station?.kpi`
   - Trigger: `stationTimeRange` thay đổi / polling / refresh

2. **Inspection Points Table** (TotalInspected, NG%, NTF%):
   - Nguồn: **REST API A10** (`getStationPointDetail`) → ghi trực tiếp vào `pointDataMap[sid][key]`
   - Hiển thị: JSX đọc `pointDataMap[key]` inline (line ~5066)
   - Trigger: `stationTimeRange` thay đổi / polling / refresh

3. **PCB Canvas markers** (status, position, defectRate):
   - Nguồn: `productPoints` useMemo → merge `productMeasurementPoints` (API) + `pointDataMap` (API A10 + MQTT)
   - Alert flash: `alertedProductPointIds` / `newlyAlertedProductPointIds` từ MQTT Alert

4. **Point list (`displayPoints`)**:
   - `productPoints.length > 0 ? productPoints : points` (line ~5049)
   - `productPoints`: từ `productMeasurementPoints` (API) + `pointDataMap`
   - `points`: từ Zustand `selectActiveStationPoints` (MQTT station.points)

---

## CÁC VẤN ĐỀ TÌM THẤY

---

### 🔴 P0-01: DUPLICATED A10 applyPointData CODE — 3 bản copy gần giống nhau

**Mức độ:** P0 (Critical — maintenance debt, inconsistency risk)  
**Dòng:** ~4090–4160 (stationTimeRange effect), ~4360–4420 (polling), ~4520–4570 (handleRefresh)

**Mô tả:**  
Logic ghi A10 response vào `pointDataMap` được copy-paste 3 lần gần giống nhau:
- **stationTimeRange effect** (line ~4090): Có helper `applyPointData()` với logic reset cũ + apply mới → gọi `setState({ pointDataMap })`
- **Station polling** (line ~4360): Copy-paste inline, **KHÔNG reset keys cũ** trước khi apply
- **handleRefresh** (line ~4520): Copy-paste inline, **KHÔNG reset keys cũ** trước khi apply

**Vấn đề:**
1. Polling + refresh **không reset** data cũ khi API trả ít points hơn → **stale point data còn lại** với giá trị cũ
2. Nếu sửa logic ở 1 chỗ, 2 chỗ còn lại bị outdated
3. `stationTimeRange` effect có reset prefix-based, nhưng polling thì không

**Đề xuất fix:**
```typescript
// Extract thành 1 hàm dùng chung
const applyA10Response = useCallback((sid: string, resp: A10Response, resetStale: boolean) => {
  const store = useStationInspectionStore.getState();
  const currentMap = { ...store.pointDataMap };
  if (!currentMap[sid]) currentMap[sid] = {};
  const stationMap = { ...currentMap[sid] };
  
  if (resetStale) {
    // Reset A10-sourced fields for current product prefix
    const prefix = selectedProduct?.code ? `${selectedProduct.code}::` : null;
    Object.keys(stationMap).forEach(k => {
      if (prefix ? k.startsWith(prefix) : true) {
        stationMap[k] = { ...stationMap[k], totalInspections: 0, ngCount: 0, defectRate: 0, ... };
      }
    });
  }
  
  // Apply points (shared logic)
  // ...
  
  currentMap[sid] = stationMap;
  useStationInspectionStore.setState({ pointDataMap: currentMap });
}, [selectedProduct?.code]);
```

---

### 🔴 P0-02: Polling KHÔNG reset stale point data trước khi apply

**Mức độ:** P0 (Critical — stale data hiện trên UI)  
**Dòng:** ~4360–4420 (station-level polling effect)

**Mô tả:**  
Khi polling A10 API, nếu thời gian trôi qua và 1 point không còn xuất hiện trong response mới (ví dụ: không có inspection nào trong `stationTimeRange` mới), point đó **vẫn giữ data cũ** trong `pointDataMap`.

**Tình huống:**
1. Polling lần 1: A10 trả 5 points → pointDataMap có 5 entries
2. Thời gian hết range → Polling lần 2: A10 trả 3 points
3. **2 points cũ vẫn hiển thị data stale** (totalInspected, ngCount cũ)

So sánh: `stationTimeRange` effect (line ~4090) **có** logic `applyPointData(null)` reset toàn bộ trước khi apply, nhưng polling thì không.

**UI Impact:** Points Table hiện ra NG% từ khoảng thời gian cũ — misleading cho operator.

---

### 🟡 P1-01: `handleRefresh` KHÔNG dùng `cancelled` flag — race condition

**Mức độ:** P1 (High)  
**Dòng:** ~4480–4590

**Mô tả:**  
`handleRefresh` là `useCallback`, gọi 3 API đồng thời (doLoadProducts, A7, A10) nhưng **không có `cancelled` flag** để cancel nếu user refresh lại nhanh hoặc switch station.

```typescript
const handleRefresh = useCallback(async () => {
  // ... gọi doLoadProducts, A7, A10 đồng thời
  // KHÔNG có cancellation
  setTimeout(() => setRefreshing(false), 1000); // hardcoded 1s
}, [...]);
```

**Vấn đề:**
1. User nhấn refresh → switch station → response cũ ghi data vào station mới
2. `activeStationId` trong closure **là giá trị lúc gọi callback**, nhưng `sid = activeStationId` bind đúng. Tuy nhiên `setProducts()` / `setSelectedProduct()` ghi vào local state, không scope theo station → **data product cũ hiển thị cho station mới**

**Đề xuất fix:** Thêm `abortController` hoặc `staleGuard` check `activeStationId === sid` trước mỗi setState.

---

### 🟡 P1-02: `handlePointPress` tạo 5 API calls đồng thời KHÔNG có cancellation

**Mức độ:** P1 (High — race condition khi user tap nhanh 2 points)  
**Dòng:** ~3900–4070

**Mô tả:**  
Khi user tap 1 inspection point, `handlePointPress` gọi **5 API** đồng thời:
1. `getMeasurementPointStatistics` (stats)
2. `fetchMergedPointImages` (images)
3. `getDefectPareto` (pareto)
4. `getInspectionMeasurements` (measurements)
5. `getInspectionEvents` (events)

**KHÔNG có** `cancelled` flag hay `AbortController`. Nếu user tap point A rồi ngay lập tức tap point B:
- Response của A có thể đến **sau** B → ghi đè data B bằng data A
- Panel hiện sai data (point B nhưng stats/images của point A)

**Đề xuất fix:**
```typescript
const inflight = useRef<AbortController | null>(null);

const handlePointPress = useCallback((point) => {
  inflight.current?.abort();
  inflight.current = new AbortController();
  const signal = inflight.current.signal;
  // Pass signal to all fetch calls
}, [...]);
```

---

### 🟡 P1-03: `selectedProduct` dependency trong products useEffect — eslint-disable che lỗi

**Mức độ:** P1 (High — stale closure)  
**Dòng:** ~3618–3660

**Mô tả:**  
```typescript
useEffect(() => {
  // ...
  const kept = prevCode ? sorted.find(p => p.code === prevCode) : null;
  // ...
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeStationId, doLoadProducts]);
```

`selectedProduct?.code` được dùng bên trong (via `prevCode`) nhưng **bị exclude** khỏi deps array. Comment `eslint-disable` che cảnh báo.

**Hệ quả:** Khi `selectedProduct` thay đổi do user chọn, effect này **không re-run** → là ý đồ đúng (chỉ fetch khi station đổi). Nhưng `prevCode` sẽ là **giá trị stale** từ render trước.

**Thực tế:** Trong trường hợp này, stale closure **không gây bug** vì `prevCode` chỉ dùng để giữ selection cũ. Nhưng pattern `eslint-disable` là code smell.

**Đề xuất:** Dùng `useRef` cho `selectedProduct` thay vì đọc trực tiếp trong effect:
```typescript
const selectedProductRef = useRef(selectedProduct);
selectedProductRef.current = selectedProduct;
```

---

### 🟡 P1-04: `stationTimeRange` effect thiếu `selectedProduct?.code` trong deps

**Mức độ:** P1 (High — nhưng thực tế ĐÚNG rồi)  
**Dòng:** ~4160

```typescript
}, [activeStationId, stationTimeRange, selectedProduct?.id, selectedProduct?.code]);
```

**Xác nhận:** Deps array **đã đúng**, bao gồm cả `selectedProduct?.id` và `selectedProduct?.code`. Effect re-run khi product thay đổi → OK.

**Không phải bug.** ✅

---

### 🟡 P1-05: `pointDataMap` selector tạo object reference mới mỗi render

**Mức độ:** P1 (Performance)  
**Dòng:** ~3342–3344

```typescript
const pointDataMap = useStationInspectionStore((s) =>
  activeStationId ? s.pointDataMap[activeStationId] || EMPTY_PDM : EMPTY_PDM,
);
```

**Vấn đề:**  
Selector phụ thuộc `activeStationId` từ **bên ngoài** store (local variable từ selector khác). Zustand `useStore(selector)` sử dụng **referential equality** (`Object.is`). Nếu `s.pointDataMap[activeStationId]` trả cùng object reference → không re-render.

Nhưng khi A10/polling ghi vào pointDataMap, nó tạo:
```typescript
currentMap[sid] = stationMap; // new reference mỗi lần
useStationInspectionStore.setState({ pointDataMap: currentMap });
```
→ `s.pointDataMap[activeStationId]` **luôn là reference mới** → selector luôn trả giá trị mới → **mọi component dùng pointDataMap đều re-render**.

**Impact:** `productPoints` useMemo phụ thuộc `pointDataMap` → recalculate mỗi poll → re-render toàn bộ canvas + points table.

**Đề xuất fix:** Dùng `useShallow` hoặc custom equality:
```typescript
const pointDataMap = useStationInspectionStore(
  useShallow((s) => activeStationId ? s.pointDataMap[activeStationId] || EMPTY_PDM : EMPTY_PDM)
);
```

---

### 🟠 P2-01: `handleRefresh` dùng `setTimeout(1000)` cố định thay vì chờ API xong

**Mức độ:** P2 (Medium)  
**Dòng:** ~4590

```typescript
setTimeout(() => setRefreshing(false), 1000);
```

**Vấn đề:**
- Nếu API nhanh (< 500ms): spinner vẫn hiện 1 giây — UX chậm
- Nếu API chậm (> 1s): spinner biến mất trước khi data cập nhật — user nghĩ đã xong nhưng data cũ

**Đề xuất fix:** Dùng `Promise.allSettled` rồi set `false`:
```typescript
const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  await Promise.allSettled([fetchProducts, fetchKPI, fetchA10]);
  setRefreshing(false);
}, [...]);
```

---

### 🟠 P2-02: `products` state sorting logic duplicated trong effect + handleRefresh

**Mức độ:** P2 (Medium — DRY violation)  
**Dòng:** ~3628–3640 (effect) và ~4490–4500 (handleRefresh)

**Mô tả:** Logic sort "parent products to end" được copy-paste:
```typescript
const sorted = [...list].sort((a, b) => {
  const aIsParent = list.some(p => p.code !== a.code && p.code.startsWith(a.code));
  const bIsParent = list.some(p => p.code !== b.code && p.code.startsWith(b.code));
  // ...
});
```

Nếu thay đổi sort logic, phải sửa 2 chỗ.

**Đề xuất:** Extract vào `sortProducts()` helper.

---

### 🟠 P2-03: `pointCounts` selector đếm MQTT points, KHÔNG phản ánh displayPoints

**Mức độ:** P2 (Medium — UI mismatch)  
**Dòng:** Store line 1243–1254, Screen line ~3327

```typescript
// Store selector
export const selectPointCounts = (state) => {
  const station = selectActiveStation(state);
  const points = station.points; // ← MQTT points
  return { all: points.length, fail: ..., warn: ..., pass: ... };
};
```

**Vấn đề:** `pointCounts` đếm **MQTT `station.points`**, nhưng UI hiển thị **`displayPoints`** (product measurement points khi có). Khi `productMeasurementPoints` có 20 points nhưng MQTT có 5 points → FilterTabs hiện sai counts.

**Xem lại:** FilterTabs không còn dùng trong JSX hiện tại (đã thay bằng table header). Nếu `pointCounts` không dùng ở đâu trong left panel → **không có ảnh hưởng trực tiếp**. Nhưng vẫn là data inconsistency.

---

### 🟠 P2-04: `panelTimeRange` ref guard pattern — skip đúng nhưng fragile

**Mức độ:** P2 (Medium — correctness risk)  
**Dòng:** ~3810–3815

```typescript
const panelTimeRangeRef = useRef(panelTimeRange);
useEffect(() => {
  if (panelTimeRangeRef.current === panelTimeRange) return; // skip initial
  panelTimeRangeRef.current = panelTimeRange;
  // ... 6 API calls
}, [panelTimeRange, panelVisible, localSelectedPoint, ...]);
```

**Vấn đề:** Guard `if (ref.current === value) return` chỉ skip khi **panelTimeRange không đổi**. Nhưng nếu `localSelectedPoint` thay đổi và `panelTimeRange` vẫn giữ nguyên → effect **KHÔNG re-fetch** cho point mới. 

Thực tế: `localSelectedPoint` thay đổi → `handlePointPress` đã fetch data mới rồi. Nên guard này **đúng intent** (chỉ re-fetch khi time range thay đổi). Nhưng nếu user đổi product mà time range giữ nguyên → **data cũ**.

**Scenario bug:**  
1. User mở panel point A, time range = today
2. User đổi product (handleProductSelect → closePanel)
3. User mở panel point B, time range = today (default)
4. `panelTimeRangeRef.current === 'today'` → **skip re-fetch** ngay lần đầu

**Fix thực tế:** Reset `panelTimeRangeRef.current` trong `handleClosePanel`:
```typescript
panelTimeRangeRef.current = 'today'; // hoặc undefined
```

---

### 🟠 P2-05: `pointImagesFilter` ref guard — tương tự P2-04

**Mức độ:** P2 (Medium)  
**Dòng:** ~3780–3790

```typescript
const pointImagesFilterRef = useRef(pointImagesFilter);
useEffect(() => {
  if (pointImagesFilterRef.current === pointImagesFilter) return;
  // ...
}, [pointImagesFilter, ...]);
```

**Cùng vấn đề:** Nếu user đóng panel → mở point mới → filter vẫn là 'ALL' (default) → ref guard skip re-fetch. Nhưng `handleClosePanel` reset `setPointImagesFilter('ALL')` → OK vì filter reset về 'ALL', ref cũng giữ 'ALL'. 

**Không bug** trong trường hợp này vì `handleClosePanel` reset filter. ✅

---

### 🟢 P3-01: `proactive polling` thiếu `selectedProduct.id` trong dep nhưng đã có `selectedProduct?.id`

**Mức độ:** P3 (Low — false alarm)  
**Dòng:** ~4453

```typescript
}, [proactivePollingEnabled, proactivePollingIntervalSec, activeStationId, 
    selectedProduct?.code, selectedProduct?.id, stationTimeRange]);
```

**Xác nhận:** Deps đã bao gồm `selectedProduct?.id`. ✅ Không lỗi.

---

### 🟢 P3-02: `topNgPoints` tính từ `pointDataMap` toàn bộ, không filter theo product

**Mức độ:** P3 (Low — cosmetic)  
**Dòng:** ~3752–3762

```typescript
const arr = Object.entries(pointDataMap)
  .map(([id, data]) => {
    const pt = points.find(p => p.id === id); // MQTT points
    return { id, name: pt?.name || id, ngRate: data.defectRate || 0 };
  })
```

**Vấn đề:** `pointDataMap` chứa keys dạng `productCode::pointId`. `points.find(p => p.id === id)` tìm trong MQTT points bằng bare `id`, nhưng `id` ở đây là `productCode::pointId` → **không match** → `name` fallback thành key string như `"GB300::123"`.

**Impact:** NG Rate Bubble hiện tên point dạng `GB300::123` thay vì tên thật `"LED检测点"`.

**Fix:**
```typescript
const bareId = id.includes('::') ? id.split('::')[1] : id;
const pt = points.find(p => p.id === bareId) 
  || productMeasurementPoints.find(p => String(p.id) === bareId);
```

---

### 🟢 P3-03: Proactive polling `firstPollTimer` + `setInterval` — first poll delayed correctly

**Mức độ:** P3 (Low — info)  
**Dòng:** ~4440–4450

```typescript
const firstPollTimer = setTimeout(fetchStationData, intervalMs);
const timer = setInterval(fetchStationData, intervalMs);
return () => { cancelled = true; clearTimeout(firstPollTimer); clearInterval(timer); };
```

**Xác nhận:** First poll delayed by `intervalMs` để tránh duplicate với `stationTimeRange` effect initial fetch. Cleanup đúng. ✅

---

### 🟢 P3-04: `Image.getSize` callback không check mounted/cancelled

**Mức độ:** P3 (Low — minor memory leak warning)  
**Dòng:** ~4850–4860

```typescript
useEffect(() => {
  if (referenceImageUri && !referenceImageUri.startsWith('data:')) {
    Image.getSize(referenceImageUri, (w, h) => {
      setDetectedImgW(w); // possible setState after unmount
      setDetectedImgH(h);
    }, () => { ... });
  }
}, [referenceImageUri]);
```

**Vấn đề:** `Image.getSize` không cancellable. Nếu component unmounts trước khi callback fires → React warning "setState on unmounted component". 

**Impact:** Chỉ warning log, không crash. React 18+ chấp nhận noop cho setState sau unmount.

---

## TỔNG KẾT

| Mức độ | Số lượng | Issues |
|--------|----------|--------|
| 🔴 P0  | 2        | Duplicated A10 code; Polling không reset stale data |
| 🟡 P1  | 4*       | Race conditions (refresh, pointPress); stale closure; pointDataMap perf |
| 🟠 P2  | 5        | setTimeout hardcoded; sort duplication; pointCounts mismatch; ref guards |
| 🟢 P3  | 4        | topNgPoints naming; Image.getSize; deps confirmation |

*P1-04 confirmed NOT a bug.

### TOP 3 ƯU TIÊN SỬA:
1. **P0-01 + P0-02:** Extract `applyA10Response()` helper, dùng chung cho cả 3 chỗ, đảm bảo reset stale data
2. **P1-02:** Thêm `AbortController` cho `handlePointPress` ngăn race condition khi tap nhanh
3. **P1-05:** Dùng `useShallow` cho `pointDataMap` selector → giảm unnecessary re-renders

---

## KẾT LUẬN

Left panel data flow tổng thể **ĐÚNG kiến trúc**: KPI từ A7 API, Points từ A10 API, cả hai ghi vào Zustand store hoặc local state, auto-update qua polling. MQTT chỉ dùng cho canvas alert flash (đúng intent).

**Điểm mạnh:**
- `stationTimeRange` effect có cancellation pattern (`let cancelled = false`)
- Product-scoped pointDataMap keys (`productCode::pointId`) ngăn cross-product data leak
- `handleClosePanel` reset toàn bộ states → clean state machine
- `proactivePolling` có debounced first poll tránh duplicate

**Điểm yếu chính:**
- Code duplication A10 logic 3 chỗ → inconsistent behavior (reset vs no-reset)
- Thiếu cancellation trong `handlePointPress` và `handleRefresh` → race conditions
- `pointDataMap` selector gây unnecessary re-renders mỗi poll cycle
