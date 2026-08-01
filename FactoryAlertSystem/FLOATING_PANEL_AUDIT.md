# FloatingPanel Comprehensive Audit Report

> **Scope**: `StationDetailScreen.tsx` FloatingPanel inner component + supporting service layer  
> **Files audited**: `StationDetailScreen.tsx`, `stationService.ts`, `types/index.ts`  
> **Date**: Auto-generated audit

---

## Section A — Props Interface (line 1600)

```typescript
const FloatingPanel: React.FC<{
  point: InspectionPoint | null;
  visible: boolean;
  onClose: () => void;
  t: typeof STATION_T.vi;
  language: 'vi' | 'en';
  errorImageUrls?: string[];           // ⚠ MQTT-sourced (see Issue #1)
  referenceImageUrls?: string[];       // ⚠ MQTT-sourced (see Issue #1)
  apiBaseUrl?: string;                 // unused inside component
  panelSections?: FloatingPanelSections;
  mpStatistics?: MpStatisticsItem | null;
  mpStatsLoading?: boolean;
  pointImages?: PointImageItem[];
  pointImagesLoading?: boolean;
  pointImagesTotal?: number;
  pointImagesFilter?: 'ALL' | 'OK' | 'NG' | 'NTF';
  onPointImagesFilterChange?: (filter) => void;
  onImagePress?: (imageUrl, label?, isNG?) => void;
  onViewFullReport?: () => void;
  onCorrelate?: () => void;
  defectPareto?: DefectParetoItem[];
  defectParetoLoading?: boolean;
  panelTimeRange?: PanelTimeRange;
  onTimeRangeChange?: (range) => void;
  panelMeasurements?: InspectionMeasurement[];
  panelMeasurementsLoading?: boolean;
  panelEvents?: InspectionEvent[];
  panelEventsLoading?: boolean;
}>
```

**Total props: 27**  
**All props are optional (with defaults) except**: `point`, `visible`, `onClose`, `t`, `language`

### Prop-by-Prop Commentary

| Prop | Source | Notes |
|------|--------|-------|
| `point` | `currentSelectedPoint` (derived from store + local) | Used for header info (id, name, type) |
| `errorImageUrls` | `pointDataMap[...].errorImageUrls` | **MQTT accumulated data** — still passed |
| `referenceImageUrls` | `pointDataMap[...].referenceImageUrls` + `productImages` | **MQTT + productImages** — hybrid source |
| `apiBaseUrl` | `settings.app.apiBaseUrl` | **Dead prop** — never referenced inside FloatingPanel |
| `mpStatistics` | C2 API via `getMeasurementPointStatistics` | Primary statistics source |
| `pointImages` | C4 API via `fetchMergedPointImages` → A10 fallback | API-sourced |
| `defectPareto` | C3 API via `getDefectPareto` | Station-wide, not point-specific |
| `panelMeasurements` | C5 API via `getInspectionMeasurements` | Point-specific |
| `panelEvents` | C6 API via `getInspectionEvents` | **Station-wide** — not point-filtered |

---

## Section B — State Variables (lines 3390–3430)

| State Variable | Type | Init Value | Setter | Used By |
|---|---|---|---|---|
| `mpStatistics` | `MpStatisticsItem \| null` | `null` | `setMpStatistics` | FloatingPanel, computed vars |
| `mpStatsLoading` | `boolean` | `false` | `setMpStatsLoading` | FloatingPanel loading UI |
| `pointImages` | `PointImageItem[]` | `[]` | `setPointImages` | FloatingPanel images section |
| `pointImagesLoading` | `boolean` | `false` | `setPointImagesLoading` | FloatingPanel loading UI |
| `pointImagesTotal` | `number` | `0` | `setPointImagesTotal` | FloatingPanel total count |
| `pointImagesFilter` | `'ALL' \| 'OK' \| 'NG' \| 'NTF'` | `'ALL'` | `setPointImagesFilter` | Filter tabs + API calls |
| `defectPareto` | `DefectParetoItem[]` | `[]` | `setDefectPareto` | FloatingPanel pareto chart |
| `defectParetoLoading` | `boolean` | `false` | `setDefectParetoLoading` | FloatingPanel loading UI |
| `panelMeasurements` | `InspectionMeasurement[]` | `[]` | `setPanelMeasurements` | FloatingPanel measurements table |
| `panelMeasurementsLoading` | `boolean` | `false` | `setPanelMeasurementsLoading` | FloatingPanel loading UI |
| `panelEvents` | `InspectionEvent[]` | `[]` | `setPanelEvents` | FloatingPanel events section |
| `panelEventsLoading` | `boolean` | `false` | `setPanelEventsLoading` | FloatingPanel loading UI |
| `panelTimeRange` | `PanelTimeRange` | `'today'` | `setPanelTimeRange` | Time range dropdown, API date params |
| `localSelectedPoint` | `InspectionPoint \| null` | depends | `setLocalSelectedPoint` | Guards API calls in effects |
| `panelVisible` | `boolean` | (implicit) | `setPanelVisible` | Guards rendering + polling |

**Total panel-related state: 15 variables (+ their setters)**

---

## Section C — Data Fetch Flow: `handlePointPress` (line 3895)

**Trigger**: User taps an inspection point on the PCB heatmap canvas.

### Flow Diagram

```
User taps point
  │
  ├─ setLocalSelectedPoint(point)
  ├─ setSelectedPoint(point.id)     // Zustand store
  ├─ setPanelVisible(true)
  │
  └─ if (selectedProduct?.code) {
       │
       ├─ [C2] getMeasurementPointStatistics
       │    params: productCode, productModelId, pointDefId=point.id,
       │            stationId, startDate, endDate
       │    → setMpStatistics(found) or null
       │    ✅ sets loading: yes (setMpStatsLoading)
       │
       ├─ [C4] fetchMergedPointImages
       │    params: stationId, pointDefId=point.id, productCode,
       │            result=pointImagesFilter, startDate, endDate, limit=50
       │    → setPointImages(images), setPointImagesTotal(total)
       │    ✅ sets loading: yes (setPointImagesLoading)
       │
       ├─ [C3] getDefectPareto
       │    params: stationId, productCode, productModelId,
       │            startDate, endDate, limit=10
       │    ⚠ NO pointDefId — station-wide pareto
       │    ✅ sets loading: yes (setDefectParetoLoading)
       │
       ├─ [C5] getInspectionMeasurements
       │    params: pointDefId=point.id, stationId, productCode,
       │            productModelId, startDate, endDate, limit=30
       │    → maps to InspectionMeasurement[] with spec from pointDef
       │    ✅ sets loading: yes (setPanelMeasurementsLoading)
       │
       └─ [C6] getInspectionEvents
            params: stationId, startDate, endDate, limit=50
            ⚠ NO pointDefId — station-wide events
            → maps EventItem to InspectionEvent (time, desc, type)
            ✅ sets loading: yes (setPanelEventsLoading)
     }
```

### Dependencies Array
```typescript
[setSelectedPoint, selectedProduct?.code, activeStationId,
 pointImagesFilter, panelTimeRange, fetchMergedPointImages]
```

### Observations
1. All 5 API calls fire **in parallel** (no await chaining) — good for performance.
2. Each call has proper loading → data → error → finally(loading=false) pattern.
3. `pointDefId` is `point.id` (string like "MP-01") passed to APIs expecting `number | string` — works because the service converts with `String()`.
4. C3 and C6 are **station-wide**, not point-filtered (see Issues).
5. `selectedProduct?.id` is optional; `Number(undefined)` → `NaN` — but guarded by ternary so safe.

---

## Section D — Refresh Flow 1: `panelTimeRange` Effect (line 3754)

**Trigger**: User changes time range dropdown (today/yesterday/week/month).

```
panelTimeRange changes
  │
  ├─ Guard: if (!panelVisible || !localSelectedPoint || !selectedProduct?.code) return
  ├─ panelTimeRangeRef.current = panelTimeRange  (stale-closure guard)
  │
  ├─ [C2] getMeasurementPointStatistics → setMpStatistics
  │    ✅ sets loading: yes
  │
  ├─ [C4] fetchMergedPointImages → setPointImages, setPointImagesTotal
  │    ✅ sets loading: yes
  │
  ├─ [C3] getDefectPareto → setDefectPareto
  │    ✅ sets loading: yes
  │
  ├─ [C5] getInspectionMeasurements → setPanelMeasurements
  │    ✅ sets loading: yes
  │
  └─ [C6] getInspectionEvents → setPanelEvents
       ✅ sets loading: yes
```

### Race Condition Guard
Uses `panelTimeRangeRef.current === panelTimeRange` check inside `.then()` callbacks so that stale responses (from a previous range selection) are discarded. **However**, in-flight requests are NOT cancelled — the ref guard only prevents state updates from stale responses. Actual fetch calls with `AbortController` are needed for true cancellation.

### Dependencies Array
```typescript
[panelTimeRange, panelVisible, localSelectedPoint, selectedProduct?.code,
 activeStationId, pointImagesFilter, fetchMergedPointImages]
```

---

## Section E — Refresh Flow 2: Proactive Polling Effect (line 4087)

**Trigger**: `setInterval` fires every `max(15, proactivePollingIntervalSec)` seconds while panel is open.

```
Timer fires
  │
  ├─ Guard: !proactivePollingEnabled || !panelVisible || !localSelectedPoint
  │         || !selectedProduct?.code || !activeStationId → cleanup
  │
  ├─ [C2] getMeasurementPointStatistics → setMpStatistics
  │    ❌ NO loading indicator
  │
  ├─ [C3] getDefectPareto → setDefectPareto
  │    ❌ NO loading indicator
  │
  ├─ [C4] fetchMergedPointImages → setPointImages, setPointImagesTotal
  │    ❌ NO loading indicator
  │
  ├─ [C5] getInspectionMeasurements → setPanelMeasurements
  │    ❌ NO loading indicator
  │
  └─ [C6] getInspectionEvents → setPanelEvents
       ❌ NO loading indicator
```

### Key Differences from `handlePointPress`
| Aspect | handlePointPress | Proactive Polling |
|--------|-----------------|-------------------|
| Loading indicators | ✅ Yes | ❌ No — silent |
| Error handling | `console.warn` + fallback | `.catch(() => {})` — **silent swallow** |
| Stale data protection | N/A (first load) | None — no ref guard |
| Initial reset | `setMpStatistics(null)`, etc. | No reset — overwrites in-place |

### Observations
1. **Silent error swallowing**: All `.catch(() => {})` means network errors, server errors, and timeouts are invisible. No logging, no user feedback.
2. **No stale guard**: Unlike the `panelTimeRange` effect, polling uses no ref check. If a slow response comes back after the user closed and re-opened the panel for a different point, old data would overwrite new data.
3. **Measurements mapping duplicated**: The `resp.data.measurements.map(...)` logic with `pointDef` spec string construction is copy-pasted from `handlePointPress`. Should be extracted to a helper.

---

## Section F — Computed Variables (lines 1671–1694)

| Variable | Derivation | Fallback | Issue? |
|----------|-----------|----------|--------|
| `effectiveDefectRate` | `mpStatistics.ngRate` | `point.defectRate` | ⚠ Falls back to **MQTT-sourced** `point.defectRate` |
| `effectiveStatus` | Derived from `mpStatistics.ngRate` thresholds (>5→fail, >2→warn, else pass) | `point.status` | ⚠ Falls back to **MQTT-sourced** `point.status` |
| `effectiveMeasurements` | `panelMeasurements` (C5 API) | — | ✅ API-only |
| `effectiveTrend` | `mpStatistics?.trendPeriods ?? []` | `[]` (empty) | ✅ API-only |
| `trendDirection` | `effectiveTrend[last] - effectiveTrend[last-1]` | `0` | ✅ Correct |
| `trendLabel` | Direction → 'Rising'/'Falling'/'Stable' | — | ✅ Correct |
| `failedParams` | `effectiveMeasurements.filter(m => m.status === 'ng').length` | — | ✅ Correct |
| `sc` (statusColor) | `STATUS_COLORS[effectiveStatus]` | — | ✅ |
| `statusLabel` | Language-dependent label | — | ✅ |

---

## Section G — Rendering Sections

Each section is gated by `panelSections` (from `FloatingPanelSections` in settings):

### 1. Header (always shown)
- Status badge (PASS/WARN/FAIL) with icon
- Point type badge
- Point code + name
- Defect rate bar (`effectiveDefectRate`)
- Close button

### 2. Time Range Dropdown (always shown)
- `<TimeRangeDropdown>` component
- Calls `onTimeRangeChange(setPanelTimeRange)`

### 3. Statistics Section (`sections.statistics`)
- Loading skeleton when `mpStatsLoading`
- Shows: Total Count, OK Count, NG Count, NG Rate
- Source: `mpStatistics` (C2 API)

### 4. Trend / Sparkline (`sections.statistics`)
- `<GradientSparkline>` using `effectiveTrend` (trendPeriods from C2)
- Shows trend direction label
- No data fallback: "No trend data"

### 5. Defect Pareto (`sections.defects`)
- Loading skeleton when `defectParetoLoading`
- `<ParetoChartSvg>` bar chart
- Source: `defectPareto` (C3 API)
- ⚠ Station-wide, not filtered by the selected point

### 6. Result Images (`sections.captures`)
- Filter tabs: ALL / OK / NG / NTF
- Loading skeleton when `pointImagesLoading`
- **Primary**: `pointImages` from C4 API
- **Fallback**: If `pointImages` empty AND `errorImageUrls.length > 0`, shows MQTT-sourced error images + reference images in separate sections
- `<RealCaptureCard>` for each image
- Shows total count badge

### 7. Measurements Table (`sections.measurements`)
- Loading skeleton when `panelMeasurementsLoading`
- Table with columns: Parameter, Value, Spec, Status
- Status color: red for NG, green for OK
- Source: `panelMeasurements` (C5 API)

### 8. Events (`sections.events`)
- Loading skeleton when `panelEventsLoading`
- `<EventRow>` list with time dot + description
- Color-coded by type (fail/warn/pass)
- Source: `panelEvents` (C6 API)
- ⚠ Station-wide, not point-specific

### 9. Action Buttons (always shown)
- "View Full Report" → `onViewFullReport`
- "Correlate" → `onCorrelate`

---

## Section H — Cleanup: `handleClosePanel` (line 4073)

```typescript
const handleClosePanel = useCallback(() => {
  setPanelVisible(false);
  setMpStatistics(null);
  setPointImages([]);
  setPointImagesTotal(0);
  setDefectPareto([]);
  setPanelMeasurements([]);
  setPanelEvents([]);
}, [setSelectedPoint]);
```

### Coverage Check

| State Variable | Reset? | Reset Value |
|---|---|---|
| `panelVisible` | ✅ | `false` |
| `mpStatistics` | ✅ | `null` |
| `mpStatsLoading` | ❌ **MISSING** | — |
| `pointImages` | ✅ | `[]` |
| `pointImagesLoading` | ❌ **MISSING** | — |
| `pointImagesTotal` | ✅ | `0` |
| `pointImagesFilter` | ❌ **MISSING** | stays at last value |
| `defectPareto` | ✅ | `[]` |
| `defectParetoLoading` | ❌ **MISSING** | — |
| `panelMeasurements` | ✅ | `[]` |
| `panelMeasurementsLoading` | ❌ **MISSING** | — |
| `panelEvents` | ✅ | `[]` |
| `panelEventsLoading` | ❌ **MISSING** | — |
| `panelTimeRange` | ❌ **MISSING** | stays at last value |
| `localSelectedPoint` | ❌ **MISSING** | stays at last point |

### Dependency Array Bug
```typescript
[setSelectedPoint]
```
This array includes `setSelectedPoint` but the callback body does NOT call `setSelectedPoint`. Conversely, the callback uses 7 setters (`setPanelVisible`, `setMpStatistics`, etc.) that are NOT in the dependency array. Since `useState` setters are stable references this is functionally safe, but it's misleading and would trigger an `exhaustive-deps` lint warning.

---

## Section I — Issues Found

### Critical Issues

#### Issue #1: MQTT Image Fallback Still Active
**Location**: FloatingPanel invocation site (lines 5192–5201) + FloatingPanel rendering (images section)  
**Problem**: When C4 API returns no images, the panel falls back to `errorImageUrls` and `referenceImageUrls` sourced from `pointDataMap` — which is MQTT accumulated data. Per stated architecture, panel data should come ONLY from APIs.  
**Impact**: Mixed data sources. MQTT images may show stale data from a different time range than what's selected in the panel dropdown.  
**Fix**: Remove `errorImageUrls`/`referenceImageUrls` props entirely, or source them from a separate API call instead of MQTT `pointDataMap`.

#### Issue #2: MQTT Fallback in Computed Variables
**Location**: FloatingPanel lines 1671–1677  
**Problem**: `effectiveDefectRate` falls back to `point.defectRate` and `effectiveStatus` falls back to `point.status` when `mpStatistics` is null. Both `point.defectRate` and `point.status` originate from MQTT accumulated data.  
**Impact**: First render (while C2 API is loading) and API failure cases show MQTT-derived numbers.  
**Fix**: Show loading state / "—" when `mpStatistics` is null instead of falling back to MQTT data.

#### Issue #3: Events (C6) Not Point-Filtered
**Location**: handlePointPress line 4049, polling effect line 4173, panelTimeRange effect  
**Problem**: `getInspectionEvents` is called with only `stationId`, `startDate`, `endDate`. The `InspectionEventsParams` interface has no `pointDefId` field. The events shown are **station-wide**, not specific to the selected inspection point.  
**Impact**: User sees events for the entire station when they expect to see events for the specific measurement point they tapped.  
**Fix**: Either add `pointDefId` support to the C6 API, or clearly label the events section as "Station Events" rather than implying they're point-specific.

#### Issue #4: Defect Pareto (C3) Not Point-Filtered
**Location**: handlePointPress line 3974, `DefectParetoParams` interface  
**Problem**: `getDefectPareto` is called without `pointDefId`. The `DefectParetoParams` interface has no `pointDefId` field. The pareto chart shows station-wide defect distribution.  
**Impact**: The pareto chart in a **point-level** detail panel shows station-level data. This is potentially intentional (showing where this point ranks vs others) but is not documented or labeled.  
**Fix**: If intentional, add a "Station-wide" label. If not, add `pointDefId` parameter support.

### High Issues

#### Issue #5: Silent Error Swallowing in Proactive Polling
**Location**: Polling effect lines 4087–4194  
**Problem**: All 5 API calls have `.catch(() => {})` — errors are completely swallowed with no logging, no state update, no user feedback.  
**Impact**: Network failures, server errors, and timeouts during polling are invisible. Data may silently become stale without any indicator.  
**Fix**: At minimum, add `console.warn` logging. Ideally, set a "last poll failed" state to show a subtle indicator.

#### Issue #6: Incomplete Cleanup in `handleClosePanel`
**Location**: line 4073  
**Problem**: 6 state variables are not reset:
- `mpStatsLoading`, `pointImagesLoading`, `defectParetoLoading`, `panelMeasurementsLoading`, `panelEventsLoading` — loading flags
- `pointImagesFilter` — stays at last filter value  
- `panelTimeRange` — stays at last selected range  
- `localSelectedPoint` — stays at last point  
**Impact**: If a loading flag is `true` when panel closes (API still in-flight), re-opening the panel for a different point may briefly show a loading skeleton from the previous point before new data arrives. `pointImagesFilter` retaining its value means re-opening always shows the last filter, not 'ALL'.  
**Fix**: Reset all loading flags to `false`, reset `pointImagesFilter` to `'ALL'`, reset `panelTimeRange` to `'today'`, set `localSelectedPoint` to `null`.

#### Issue #7: No Request Cancellation on Time Range Change
**Location**: `panelTimeRange` effect (lines 3754–3893)  
**Problem**: When the user rapidly switches time ranges, all 5 API calls fire for each change. Previous in-flight requests are not cancelled. The ref guard (`panelTimeRangeRef.current === panelTimeRange`) only prevents **state updates** from stale responses, but the requests still complete and consume bandwidth.  
**Fix**: Use `AbortController` and cancel previous requests in the effect cleanup function.

### Medium Issues

#### Issue #8: Duplicated Measurements Mapping Logic
**Location**: handlePointPress (lines 4007–4040), polling effect (lines 4153–4173), panelTimeRange effect  
**Problem**: The `resp.data.measurements.map(...)` logic that builds `InspectionMeasurement[]` from `InspectionMeasurementItem[]` (including spec string construction from `pointDef`) is copy-pasted in 3 places.  
**Fix**: Extract to a helper function: `mapMeasurementItems(resp.data): InspectionMeasurement[]`.

#### Issue #9: Dead Prop — `apiBaseUrl`
**Location**: FloatingPanel props (line 1607), invocation (line 5196)  
**Problem**: `apiBaseUrl` is passed to FloatingPanel but never referenced inside the component. Image URLs are already fully resolved by the service layer.  
**Fix**: Remove the prop from the interface, destructuring, and invocation site.

#### Issue #10: Polling Has No Stale-Data Guard
**Location**: Polling effect (lines 4087–4194)  
**Problem**: Unlike the `panelTimeRange` effect which uses `panelTimeRangeRef` to guard against stale responses, the polling effect has NO guard. If a poll response arrives after the user has closed the panel and opened it for a different point, the old data overwrites the new point's data.  
**Impact**: Brief flash of wrong data for the wrong measurement point.  
**Fix**: Add a ref guard checking `localSelectedPoint.id` matches the point that initiated the request.

### Low Issues

#### Issue #11: `handleClosePanel` Dependency Array Mismatch
**Location**: line 4085  
**Problem**: Dependency array `[setSelectedPoint]` references a setter not used in the callback body. The 7 setters actually used are not listed.  
**Fix**: Change to `[]` (empty) since all `useState` setters are stable. Or list all used setters for documentation.

#### Issue #12: NTF Filter Client-Side Workaround  
**Location**: `fetchMergedPointImages` (line 3458)  
**Problem**: When `result === 'NTF'`, the code sends `result: 'ALL'` to C4 and then filters client-side: `img.result !== 'OK' && img.result !== 'NG'`. This fetches far more data than needed and relies on the assumption that anything not OK/NG is NTF.  
**Impact**: Performance penalty for NTF filter. Pagination `total` count will be wrong (shows ALL total, not NTF total).  
**Fix**: Request C4 API team to support NTF as a valid result filter. Or adjust `pointImagesTotal` after client-side filtering.

#### Issue #13: `panelTimeRange` Default Mismatch
**Location**: State init (line 3416) vs FloatingPanel default (line 1628)  
**Problem**: State initializes `panelTimeRange` to `'today'`, but the FloatingPanel prop default is `'month'`. If somehow the prop is not passed (impossible in current code, but fragile), the dropdown would show 'month' while data was fetched for 'today'.  
**Fix**: Align both defaults to the same value.

---

## Section J — `fetchMergedPointImages` Analysis (line 3433)

### Signature
```typescript
const fetchMergedPointImages = useCallback(async (params: {
  stationId: string | number;
  pointDefId: string | number;
  productCode: string;
  result: 'ALL' | 'OK' | 'NG' | 'NTF';
  startDate: string;
  endDate: string;
  limit?: number;
}): Promise<{ images: PointImageItem[]; total: number }>
```

### Flow
```
fetchMergedPointImages(params)
  │
  ├─ Try C4 API: stationService.getInspectionImages({
  │    stationId, pointDefId, productCode, productModelId,
  │    result: (NTF→ALL, else as-is),
  │    startDate, endDate, limit, offset: 0
  │  })
  │  │
  │  ├─ If images returned:
  │  │   ├─ Client-side NTF filter (if result=NTF)
  │  │   ├─ Map InspectionImageItem → PointImageItem
  │  │   │   - id = measurementResultId
  │  │   │   - result: OK/NG forced (non-OK non-NG → 'NG')  ⚠
  │  │   └─ Return { images, total }
  │  │
  │  └─ If no images or C4 fails:
  │       │
  │       ├─ If result is OK or NTF → return empty
  │       │
  │       └─ Fallback to A10 API: stationService.getStationPointDetail(
  │            stationId, { startDate, endDate, productCode,
  │            productModelId, pointDefId, imageLimit })
  │            │
  │            └─ Map point.errorImages → PointImageItem (all result='NG')
```

### Dependencies
```typescript
[selectedProduct?.id]  // only productModelId changes trigger re-creation
```

### Issues Specific to fetchMergedPointImages

1. **Non-OK/Non-NG results coerced to 'NG'** (line 3474): `(img.result === 'OK' || img.result === 'NG') ? img.result : 'NG' as const` — any result type other than OK/NG (e.g., NTF, RETRY) is silently mapped to NG. This corrupts the result classification.

2. **A10 Fallback only for NG**: When C4 fails and `result === 'ALL'`, the code falls through to A10, but A10 only returns `errorImages` (NG). OK images are lost entirely in the fallback path.

3. **`offset: 0` hardcoded**: No pagination support. Only the first page of images is ever fetched. The `total` from pagination is recorded but never used for "load more" functionality.

4. **`productModelId` sourced from closure**: Uses `selectedProduct?.id` from the outer scope captured via `useCallback` dependency. If the product changes between the time the callback was created and when it's called, the wrong `productModelId` could be used. In practice this is unlikely since the callback is recreated when `selectedProduct?.id` changes.

---

## Summary Matrix

| API | Endpoint | Point-filtered? | Used By |
|-----|----------|-----------------|---------|
| C2 | `/api/external/inspections/trend` | ✅ `pointDefId` | Stats + Sparkline |
| C3 | `/api/external/inspections/defect-pareto` | ❌ Station-wide | Pareto Chart |
| C4 | `/api/external/inspections/images` | ✅ `pointDefId` | Result Images |
| C5 | `/api/external/inspections/measurements` | ✅ `pointDefId` | Measurements Table |
| C6 | `/api/external/inspections/events` | ❌ Station-wide | Events List |

| Category | Count |
|----------|-------|
| Critical Issues | 4 |
| High Issues | 3 |
| Medium Issues | 2 |
| Low Issues | 3 |
| **Total** | **12** |

### Priority Fix Order
1. **Issue #1 + #2**: Remove MQTT fallbacks (images + computed vars)
2. **Issue #6**: Complete cleanup in `handleClosePanel`
3. **Issue #5**: Add error logging to polling
4. **Issue #3 + #4**: Document or fix station-wide C3/C6 behavior
5. **Issue #7 + #10**: Add AbortController + stale guards
6. **Issue #8**: Extract duplicated measurement mapping
7. **Issue #9 + #11 + #12 + #13**: Dead prop, deps, NTF, defaults
