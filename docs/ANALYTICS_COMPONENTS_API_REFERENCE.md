# Analytics Components & Hooks - API Reference

## 🎣 Custom Hooks

### `useAnalyticsBatch(params, enabledTabs)`

Batches multiple analytics queries for parallel execution.

**Parameters**:
```typescript
params: {
  startDate: string;        // yyyy-MM-dd
  endDate: string;          // yyyy-MM-dd
  machineId?: number;       // Optional filter
  productModel?: string;    // Optional filter
}

enabledTabs: {
  overview?: boolean;  // (default: true)
  trend?: boolean;
  machines?: boolean;
  spc?: boolean;
  forecast?: boolean;
  risk?: boolean;
}
```

**Returns**:
```typescript
{
  // Query states for each query
  trend: { data: TrendData[]; isLoading: boolean; isError: boolean; error?: Error; refetch: () => void }
  pareto: { data: ParetoData[]; ... }
  machPerf: { data: MachinePerf[]; ... }
  forecast: { data: ForecastData; ... }
  risk: { data: RiskData[]; ... }
  control: { data: ControlChartData; ... }
  shift: { data: ShiftData[]; ... }
  heatmap: { data: HeatmapData; ... }
  corr: { data: CorrelationData[]; ... }
  
  // Combined states
  isLoading: boolean;     // true if any query is loading
  isError: boolean;       // true if any query has error
  refetch: () => void;    // Refetch all queries
}
```

**Example**:
```typescript
const batch = useAnalyticsBatch(period, {
  overview: true,
  machines: activeTab === "machines",
});

if (batch.isLoading) return <Skeleton />;
if (batch.machPerf.data?.length) {
  return <Chart data={batch.machPerf.data} />;
}
```

---

### `usePagination(data, pageSize)`

Manages pagination state with localStorage persistence.

**Parameters**:
```typescript
data: T[];              // Array to paginate
pageSize?: number;      // Items per page (default: 10)
```

**Returns**:
```typescript
{
  pageIndex: number;                    // Current page (0-based)
  pageSize: number;                     // Items per page
  pageCount: number;                    // Total pages
  canPreviousPage: boolean;             // Can go back?
  canNextPage: boolean;                 // Can go forward?
  paginatedData: T[];                   // Current page items
  
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
  reset: () => void;                    // Reset to page 0
}
```

**Example**:
```typescript
const pagination = usePagination(machines, 20);

{pagination.paginatedData.map(machine => (
  <MachineRow key={machine.id} machine={machine} />
))}

<PaginationControls 
  pageIndex={pagination.pageIndex}
  pageSize={pagination.pageSize}
  onPageIndexChange={pagination.setPageIndex}
  onPageSizeChange={pagination.setPageSize}
/>
```

---

### `useAnalyticsErrorHandler()`

Parses analytics errors to user-friendly messages.

**Returns**:
```typescript
{
  parseError: (error: Error | TRPCError) => {
    message: string;        // Error message
    code: string;           // Error code (TIMEOUT, FORBIDDEN, etc)
    details?: string;       // Additional details
    retryable: boolean;     // Can user retry?
  }
  
  getUserMessage: (errorInfo: ParsedError) => string;  // User-friendly message
}
```

**Error Codes**:
- `TIMEOUT` - Query took too long
- `TOO_MANY_REQUESTS` - Rate limited
- `FORBIDDEN` - Permission denied
- `UNAUTHENTICATED` - Not logged in
- `INTERNAL_ERROR` - Server error
- `BAD_REQUEST` - Invalid parameters

**Example**:
```typescript
const { parseError } = useAnalyticsErrorHandler();

if (batch.isError && batch.trend.error) {
  const parsed = parseError(batch.trend.error);
  console.error(parsed.message);
  // Show retry button if parsed.retryable
}
```

---

## 📦 Components

### `<ChartCard />`

Wrapper component for analytics charts with export/refresh/error handling.

**Props**:
```typescript
{
  title: string;                              // Chart title
  description?: string;                       // Optional subtitle
  icon?: React.ComponentType;                 // Icon component
  isLoading?: boolean;                        // Show skeleton loader
  isError?: boolean;                          // Show error state
  errorMessage?: string;                      // Error message text
  onRefresh?: () => void;                     // Refresh button handler
  onExport?: (format: "csv"|"json"|"png"|"pdf") => void;
  showExport?: boolean;                       // (default: true)
  showRefresh?: boolean;                      // (default: true)
  showToggle?: boolean;                       // Show visibility toggle
  compact?: boolean;                          // Compact mode (smaller padding)
  children: React.ReactNode;
}
```

**Features**:
- Integrated skeleton loader during loading
- Error display with retry option
- Export dropdown menu
- Refresh button with spinner
- Optional visibility toggle

**Example**:
```typescript
<ChartCard
  title="Daily Trend"
  icon={TrendingUp}
  isLoading={isLoading}
  onRefresh={() => refetch()}
  onExport={handleExport}
>
  {data?.length && <ResponsiveContainer>...</ResponsiveContainer>}
</ChartCard>
```

---

### `<MetricCard />`

Displays KPI metrics with trend indicators and color coding.

**Props**:
```typescript
{
  label: string;                              // Metric label
  value: string | number;                     // Metric value
  unit?: string;                              // Unit (e.g., "days", "%")
  icon?: React.ComponentType;                 // Icon component
  color?: "green"|"red"|"yellow"|"blue"|"purple"|"cyan";
  isLoading?: boolean;                        // Show skeleton
  
  trend?: {
    direction: "up" | "down" | "stable";     // Trend direction
    change: number;                           // % change
    label?: string;                           // Optional label
  };
  
  comparison?: string;                        // Comparison text
}
```

**Example**:
```typescript
<MetricCard
  label="Yield Rate"
  value="96.5"
  unit="%"
  icon={Target}
  color="green"
  trend={{ direction: "up", change: 2.3 }}
/>
```

---

### `<TrendIndicator />`

Displays trend direction with percentage change and p-value.

**Props**:
```typescript
{
  direction: "up" | "down" | "stable";       // Trend direction
  value: number;                              // % change
  label?: string;                             // Label text
  size?: "sm" | "md" | "lg";                 // (default: "md")
  
  variant?: "inline" | "badge" | "full";     // (default: "inline")
  // inline: Compact inline display
  // badge: Badge-style with direction
  // full: Card-style with breakdown
  
  compactMode?: boolean;                      // Space-constrained UI
  pValue?: number;                            // Statistical p-value
}
```

**Example**:
```typescript
<TrendIndicator
  direction="down"
  value={5.2}
  label="Defect Rate"
  size="lg"
  variant="badge"
/>
// Output: ↓ 5.2% (Good - defect rate is decreasing)
```

---

### `<DateRangeSelector />`

Smart date range selection with presets and localStorage persistence.

**Props**:
```typescript
{
  startDate: string;                          // yyyy-MM-dd format
  endDate: string;                            // yyyy-MM-dd format
  onDateChange: (start: string, end: string) => void;
  compact?: boolean;                          // Compact mode
  persistToStorage?: boolean;                 // (default: true)
}
```

**Features**:
- Quick presets: 7d, 14d, 30d, 90d, month, quarter
- Custom date inputs with validation
- localStorage persistence (lastDateRange key)
- Duration display (e.g., "30 days of data")
- Disables future dates

**Example**:
```typescript
<DateRangeSelector
  startDate={startDate}
  endDate={endDate}
  onDateChange={(start, end) => {
    setStartDate(start);
    setEndDate(end);
  }}
/>
```

---

### `<PaginationControls />`

Pagination UI component for tables.

**Props**:
```typescript
{
  pageIndex: number;                          // Current page (0-based)
  pageSize: number;                           // Items per page
  pageCount: number;                          // Total pages
  canPreviousPage: boolean;
  canNextPage: boolean;
  totalItems: number;                         // Total items
  
  onPageIndexChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
  
  compact?: boolean;                          // Compact UI
}
```

**Page Size Options**: 10, 20, 50, 100

**Example**:
```typescript
<PaginationControls
  pageIndex={pagination.pageIndex}
  pageSize={pagination.pageSize}
  pageCount={pagination.pageCount}
  canPreviousPage={pagination.canPreviousPage}
  canNextPage={pagination.canNextPage}
  totalItems={machines.length}
  onPageIndexChange={pagination.setPageIndex}
  onPageSizeChange={pagination.setPageSize}
/>
```

---

### `<HeatmapGrid />`

Enhanced heatmap visualization for hourly defect rates.

**Props**:
```typescript
{
  data: Array<{
    machineCode: string;
    hour: number;              // 0-23
    defectRate: number;        // 0-100
    total: number;             // Inspection count
  }>;
  
  onExport?: (format: string) => void;
  showLegend?: boolean;                       // (default: true)
}
```

**Features**:
- Color gradient: green → yellow → orange → red
- Interactive hover with detailed tooltip
- Legend with color meanings
- Responsive horizontal scroll
- Ring effect on hover

**Example**:
```typescript
<HeatmapGrid
  data={heatmapData}
  showLegend
  onExport={(format) => exportHeatmap(format)}
/>
```

---

### `<AdvancedTooltip />`

Enhanced Recharts tooltip with confidence scores and status badges.

**Props**:
```typescript
{
  active?: boolean;                           // From Recharts
  payload?: Array<{ value: any; ... }>;       // From Recharts
  label?: string;                             // From Recharts
  
  currency?: boolean;                         // Format as currency
  decimalPlaces?: number;                     // (default: 2)
  unit?: string;                              // (e.g., "%", "ms")
}
```

**Features**:
- Multiple payload entries with color indicators
- Confidence score badges
- Status badges (good/warning/error)
- Formatted values with units
- Card styling with backdrop blur

**Example**:
```typescript
<RechartsTooltip 
  content={<AdvancedTooltip decimalPlaces={1} unit="%" />} 
/>
```

---

### `<AnalyticsErrorBoundary />`

React error boundary for analytics components.

**Props**:
```typescript
{
  title?: string;                             // Error title
  onRetry?: () => void;                       // Retry handler
  children: React.ReactNode;
}
```

**Features**:
- Catches component-level errors
- Displays user-friendly error message
- Optional retry button
- Red-themed error card
- Logs errors to console

**Example**:
```typescript
<AnalyticsErrorBoundary title="Machine Analytics">
  <MachinePerformanceChart />
</AnalyticsErrorBoundary>
```

---

## 📚 Utilities

### `exportToCSV(data, filename)`

Exports array to CSV file.

**Parameters**:
```typescript
data: Array<Record<string, any>>;   // Array of objects
filename?: string;                   // Output filename
```

**Features**:
- Proper CSV escaping (quotes, commas)
- Headers from first object keys
- Automatic BOM for Excel compatibility

---

### `exportToJSON(data, filename)`

Exports array to formatted JSON file.

**Parameters**:
```typescript
data: Array<Record<string, any>>;
filename?: string;
```

---

### `formatChartDataForExport(data, title)`

Formats chart data for export with headers.

**Parameters**:
```typescript
data: Array<Record<string, any>>;
title: string;                      // Report title
```

---

### `generateReportHeader(title, dateRange, metadata)`

Generates CSV report header with metadata.

**Parameters**:
```typescript
title: string;
dateRange: { start: string; end: string };
metadata?: Record<string, string>;  // Custom fields
```

---

## 🎨 Constants

### `analyticsConstants.ts`

```typescript
// Colors
export const ANALYTICS_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#ef4444", // red
  // ... 7 more colors
];

// Chart dimensions
export const CHART_HEIGHT = {
  small: 200,
  medium: 250,
  large: 350,
  xLarge: 400,
};

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  pageSizeOptions: [10, 20, 50, 100],
};

// Date range presets
export const DATE_RANGE_PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  // ... 4 more presets
];

// Quality thresholds
export const THRESHOLD = {
  yield: { good: 0.95, warning: 0.90 },
  defect: { critical: 0.10, warning: 0.05 },
};

// localStorage keys
export const LOCAL_STORAGE_KEYS = {
  lastDateRange: "aiAnalytics_lastDateRange",
  lastActiveTab: "aiAnalytics_lastActiveTab",
  pageSize: "aiAnalytics_pageSize",
  chartPreferences: "aiAnalytics_chartPreferences",
};
```

---

## 🔄 Type Definitions

```typescript
// Data types
interface TrendData {
  date: string;
  total: number;
  pass: number;
  fail: number;
  defectRate: number;
  yieldRate: number;
}

interface MachinePerf {
  machineCode: string;
  totalInspections: number;
  yieldRate: number;
  avgCycleTime: number;
}

interface ParetoData {
  defectType: string;
  count: number;
  percentage: number;
  cumulativePercentage: number;
}

interface ForecastData {
  trend: "improving" | "declining" | "stable";
  rmse: number;
  historical: Array<{ date: string; value: number }>;
  predicted: Array<{ date: string; value: number; upper: number; lower: number }>;
}

interface RiskData {
  category: string;
  description: string;
  level: "critical" | "high" | "medium" | "low";
  score: number;
  recommendation?: string;
}

interface AnalyticsBatchResult {
  trend: QueryState<TrendData[]>;
  pareto: QueryState<ParetoData[]>;
  machPerf: QueryState<MachinePerf[]>;
  forecast: QueryState<ForecastData>;
  risk: QueryState<RiskData[]>;
  control: QueryState<ControlChartData>;
  shift: QueryState<ShiftData[]>;
  heatmap: QueryState<HeatmapData>;
  corr: QueryState<CorrelationData[]>;
  
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}
```

---

## 🚀 Performance Tips

1. **Query Batching**: Always use `useAnalyticsBatch` for multiple queries
2. **Pagination**: Use pagination for tables with >50 rows
3. **Memoization**: ChartCard and MetricCard use React.memo automatically
4. **Lazy Loading**: Set `enabledTabs` appropriately to skip unused queries
5. **Error Handling**: Always wrap sections in AnalyticsErrorBoundary

---

**Last Updated**: 2026-05-05  
**Version**: 2.0.0
