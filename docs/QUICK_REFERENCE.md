# AI Analytics Components - Quick Reference Card

## 🎣 Custom Hooks

### useAnalyticsBatch
**Purpose**: Execute 9 analytics queries in parallel
```typescript
const batch = useAnalyticsBatch(period, { 
  machines: activeTab === "machines" 
});

// Access: batch.trend, batch.machPerf, batch.forecast, etc
// Combined: batch.isLoading, batch.isError, batch.refetch()
```

### usePagination
**Purpose**: Manage table pagination with persistence
```typescript
const pag = usePagination(data, 10);  // 10 items per page

// Use: pag.paginatedData, pag.pageIndex, pag.setPageIndex()
// Persists: pageSize in localStorage
```

### useAnalyticsErrorHandler
**Purpose**: Parse errors to user-friendly messages
```typescript
const { parseError, getUserMessage } = useAnalyticsErrorHandler();
const parsed = parseError(error);  // {message, code, retryable}
```

---

## 🧩 Components

### ChartCard
**Wrapper for all charts** with export/refresh/errors
```tsx
<ChartCard
  title="Daily Trend"
  icon={TrendingUp}
  isLoading={isLoading}
  onRefresh={() => refetch()}
  onExport={(format) => handleExport(format)}
>
  {data && <Chart data={data} />}
</ChartCard>
```

### MetricCard
**KPI display** with trend indicators
```tsx
<MetricCard
  label="Yield Rate"
  value="96.5%"
  icon={Target}
  color="green"
  trend={{ direction: "up", change: 2.3 }}
/>
```

### TrendIndicator
**Trend arrow** (↑/↓/→) with % change
```tsx
<TrendIndicator
  direction="down"
  value={5.2}
  size="lg"
  variant="badge"
/>
```

### DateRangeSelector
**Smart date picker** with presets & persistence
```tsx
<DateRangeSelector
  startDate={start}
  endDate={end}
  onDateChange={(s, e) => {}}
/>
// Presets: 7d, 14d, 30d, 90d, month, quarter
```

### PaginationControls
**Table pagination** UI (10/20/50/100 items)
```tsx
<PaginationControls
  pageIndex={pag.pageIndex}
  onPageIndexChange={pag.setPageIndex}
  onPageSizeChange={pag.setPageSize}
  // ... other props
/>
```

### HeatmapGrid
**Machine defect heatmap** by hour
```tsx
<HeatmapGrid
  data={heatmapData}
  showLegend
/>
```

### AdvancedTooltip
**Rich tooltip** for Recharts
```tsx
<Tooltip content={<AdvancedTooltip unit="%" decimalPlaces={2} />} />
```

### AnalyticsErrorBoundary
**Error boundary** for sections
```tsx
<AnalyticsErrorBoundary title="Machines">
  <MachineChart />
</AnalyticsErrorBoundary>
```

---

## 📦 Constants

```typescript
// Colors
ANALYTICS_COLORS: [blue, green, red, ...]

// Chart heights
CHART_HEIGHT: { small: 200, medium: 250, large: 350, xLarge: 400 }

// Pagination
PAGINATION: { DEFAULT_PAGE_SIZE: 10, pageSizeOptions: [10, 20, 50, 100] }

// Date presets
DATE_RANGE_PRESETS: [7d, 14d, 30d, 90d, month, quarter]

// localStorage keys
LOCAL_STORAGE_KEYS.lastDateRange
LOCAL_STORAGE_KEYS.lastActiveTab
LOCAL_STORAGE_KEYS.pageSize
```

---

## 💾 Export Utilities

```typescript
import { exportToCSV, exportToJSON, exportChartToPNG } from '@/lib/exportUtils';

exportToCSV(data, 'filename.csv');
exportToJSON(data, 'filename.json');
exportChartToPNG('elementId', 'filename.png');
```

---

## 🚀 Performance Tips

1. **Always use batch queries** (not individual queries)
2. **Lazy-load by tab**: Set `enabledTabs` appropriately
3. **Paginate tables** with >50 rows
4. **Use React.memo** for expensive components
5. **Memoize callbacks** with useCallback
6. **Memoize computed values** with useMemo

---

## ⚠️ Common Mistakes

❌ **DON'T**: Make 9 separate useQuery calls
✅ **DO**: Use useAnalyticsBatch hook

❌ **DON'T**: Render 1000+ table rows
✅ **DO**: Use usePagination with 10-100 rows

❌ **DON'T**: Ignore error states
✅ **DO**: Wrap in AnalyticsErrorBoundary

❌ **DON'T**: Leave manual loading states
✅ **DO**: Use ChartCard wrapper

❌ **DON'T**: Lose user's date selection
✅ **DO**: Use DateRangeSelector with persistence

---

## 📊 Performance Targets

- Load time: **< 1 second**
- First render: **< 50ms**
- Lighthouse: **>= 95**
- Mobile: **100% responsive**
- Accessibility: **WCAG AA**

---

## 🔍 Debugging

```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Build
pnpm build

# Dev server
pnpm dev
```

**Chrome DevTools**:
- Performance tab: Check load time < 1s
- Network tab: Should see 1 batch query (not 9)
- React DevTools: Check component renders
- Coverage: Check CSS/JS usage

---

## 📞 Documentation

- **Components**: `ANALYTICS_COMPONENTS_API_REFERENCE.md`
- **Examples**: `BEFORE_AFTER_COMPARISON.md`
- **Deployment**: `IMPLEMENTATION_CHECKLIST.md`
- **Overview**: `AI_ANALYTICS_FRONTEND_IMPROVEMENTS.md`

---

## ✅ Pre-Deployment

- [ ] Type check passes
- [ ] Linting passes
- [ ] Build succeeds
- [ ] Local test works (load time < 1s)
- [ ] No console errors
- [ ] Query batching verified (1 request)
- [ ] Export functionality works
- [ ] Mobile responsive
- [ ] Accessible (Tab navigation works)

---

**Quick Links**:
- 📖 Full Docs: See `INDEX.md` in docs folder
- 💾 Source: `client/src/hooks/`, `client/src/components/analytics/`, `client/src/lib/`
- 📝 Page: `client/src/pages/AIInspectionAnalyticsPage.tsx`

---

**Print this card and keep it on your desk!** 📌

Last Updated: 2026-05-05 | v2.0.0
