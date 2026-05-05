# Station Analysis — Hướng dẫn phát triển Android App

> Tài liệu mô tả chức năng trang **StationAnalysis** của hệ thống AVI-AOI và ánh xạ sang các External API để bên thứ 3 phát triển ứng dụng Android hiển thị tương tự.

---

## Mục lục

1. [Tổng quan giao diện](#1-tổng-quan-giao-diện)
2. [Bảng ánh xạ API](#2-bảng-ánh-xạ-api)
3. [Xác thực](#3-xác-thực)
4. [Tab 1 — Overview (Tổng quan)](#4-tab-1--overview-tổng-quan)
5. [Tab 2 — Station Detail (Chi tiết trạm)](#5-tab-2--station-detail-chi-tiết-trạm)
6. [Tab 3 — History & Defects (Lịch sử & Lỗi)](#6-tab-3--history--defects-lịch-sử--lỗi)
7. [Tab 4 — SPC Control (Kiểm soát SPC)](#7-tab-4--spc-control-kiểm-soát-spc)
8. [Tab 5 — QC Tool (7 công cụ QC)](#8-tab-5--qc-tool-7-công-cụ-qc)
9. [Tab 6 — AI Analysis (Phân tích AI)](#9-tab-6--ai-analysis-phân-tích-ai)
10. [Header KPI Strip](#10-header-kpi-strip)
11. [Date Range Filtering](#11-date-range-filtering)
12. [Android Implementation Guide](#12-android-implementation-guide)

---

## 1. Tổng quan giao diện

Trang **StationAnalysis** là dashboard phân tích toàn diện cho **một station (trạm kiểm tra)** duy nhất. Giao diện chia thành:

### Layout chính
```
┌──────────────────────────────────────────────────┐
│  HEADER: Station info + KPI Strip                │
│  [FPY%] [Final Yield%] [Change±%] [Output] [NG] [Retest%] │
├──────────────────────────────────────────────────┤
│  TOOLBAR: [Tab 1][Tab 2]...[Tab 6]  [Date Picker]│
├──────────────────────────────────────────────────┤
│                                                  │
│             TAB CONTENT AREA                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 6 Tab chính

| # | Tab | Icon | Mô tả |
|---|-----|------|--------|
| 1 | **Overview** | Activity | Tổng quan 4 panel: Hourly Yield, Top Defects, Mini SPC, AI Insights |
| 2 | **Station Detail** | Crosshair | Chi tiết từng điểm kiểm tra (inspection points) trên board |
| 3 | **History & Defects** | BarChart3 | Biểu đồ Pareto lỗi + Lịch sử NG |
| 4 | **SPC Control** | Target | Biểu đồ kiểm soát X̄ / MR với 8 Western Electric Rules |
| 5 | **QC Tool** | FileBarChart | 5 sub-tabs: Histogram, Scatter, Cause-Effect, Check Sheet, Stratification |
| 6 | **AI Analysis** | Brain | 2 sub-tabs: AI Analysis (anomaly/forecast/clustering), Diagnostics |

---

## 2. Bảng ánh xạ API

### Ánh xạ Internal → External API

| Chức năng (Internal) | External API | Method | Mô tả |
|----------------------|-------------|--------|--------|
| `getStationSummary` (KPI header) | **A2** + **A7** | GET | A2: station info + hierarchy; A7: KPI stats (FPY, yield, change) |
| `getHourlyYield` (biểu đồ theo giờ) | **C2** `groupBy=hour` | GET | `/api/external/inspections/trend?groupBy=hour&stationId={id}` |
| `getStationDefects` (Pareto lỗi) | **C3** | GET | `/api/external/inspections/defect-pareto?stationId={id}` |
| `getYieldControlChart` (SPC) | **D1** | GET | `/api/external/inspections/control-chart?stationId={id}` |
| `getFailHistory` (NG history) | **D4** | GET | `/api/external/inspections/fail-history?stationId={id}` |
| `getDiagnostics` (AI diagnostics) | **D5** | GET | `/api/external/inspections/diagnostics?stationId={id}` |
| `getHistogramData` (histogram) | **D2** | GET | `/api/external/inspections/histogram?stationId={id}` |
| `getScatterData` (scatter plot) | **D6** | GET | `/api/external/inspections/scatter?stationId={id}` |
| `getCheckSheetData` (check sheet) | **D7** | GET | `/api/external/inspections/check-sheet?stationId={id}` |
| `getCauseEffectData` (Ishikawa 6M) | **D8** | GET | `/api/external/inspections/cause-effect?stationId={id}` |
| `getStratificationData` (phân tầng) | **D3** | GET | `/api/external/inspections/stratification?stationId={id}` |
| `getAiAnalysis` (AI Analysis) | **D9** | GET | `/api/external/inspections/ai-analysis?stationId={id}` |
| `getStationDetail` (inspection points) | **A3** + **A8** + **A10** | GET | A3: point definitions; A8: per-point stats; A10: point detail + NG images |
| Yield comparison (change %) | **D10** | GET | `/api/external/inspections/yield-comparison?stationId={id}` |

### API bổ trợ

| API | Mô tả | Mục đích |
|-----|--------|----------|
| **A1** `GET /api/external/stations` | Danh sách tất cả stations | Chọn station (navigation) |
| **A4** `GET /api/external/stations/:id/reference-image` | Ảnh tham chiếu station | Hiển thị board/PCB layout |
| **A6** `GET /api/external/stations/:id/products` | Sản phẩm tại station | Product filter |
| **A9** `GET /api/external/stations/:id/fail-history` | NG history (simple) | Alternative cho D4 |
| **C4** `GET /api/external/inspections/images` | Ảnh kiểm tra | Xem ảnh NG/OK |
| **C6** `GET /api/external/inspections/measurements` | Giá trị đo từng point | Trend cho measurement point |

---

## 3. Xác thực

Tất cả API đều dùng **Master Key** qua header:

```
x-master-key: YOUR_MASTER_KEY
```

**Kotlin example:**
```kotlin
object ApiConfig {
    const val BASE_URL = "http://YOUR_SERVER:3001"
    const val MASTER_KEY = "YOUR_MASTER_KEY"
}

// OkHttp Interceptor
class AuthInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .addHeader("x-master-key", ApiConfig.MASTER_KEY)
            .build()
        return chain.proceed(request)
    }
}
```

---

## 4. Tab 1 — Overview (Tổng quan)

### Mô tả giao diện

Tab Overview hiển thị 4 panel dạng grid 2×2:

```
┌─────────────────────┬─────────────────────┐
│  📊 Hourly Yield    │  📋 Top Defects     │
│  (Bar+Line chart)   │  (Pareto bars)      │
├─────────────────────┼─────────────────────┤
│  📈 Mini SPC Chart  │  🧠 AI Insights     │
│  (Line + UCL/LCL)   │  (Alerts + text)    │
└─────────────────────┴─────────────────────┘
```

Phía trên cùng là dải **Alert banners** (nếu có critical/warning/info alerts).

### 4.1 Panel: Hourly Yield (Biểu đồ theo giờ)

**API:** `C2` — Inspection Trend (groupBy=hour)

```
GET /api/external/inspections/trend?stationId={id}&startDate={start}&endDate={end}&groupBy=hour
```

**Response data cần dùng:**
```json
{
  "trend": [
    {
      "period": "2024-01-15T08:00:00Z",
      "totalInspections": 45,
      "okCount": 43,
      "ngCount": 2,
      "ntfCount": 0,
      "yieldRate": 95.56
    }
  ]
}
```

**Hiển thị:**
- **Bar chart**: mỗi giờ hiển thị cột OK (xanh) và NG (đỏ) stacked
- **Line overlay**: yield rate (%) trên trục Y phải
- **X axis**: giờ (0h → 23h hoặc 6h → 6h+)

**Android chart code (MPAndroidChart):**
```kotlin
fun renderHourlyYield(chart: CombinedChart, data: List<TrendItem>) {
    // Bar data: OK + NG stacked
    val barEntries = data.mapIndexed { i, item ->
        BarEntry(i.toFloat(), floatArrayOf(
            item.okCount.toFloat(),
            item.ngCount.toFloat()
        ))
    }
    val barSet = BarDataSet(barEntries, "").apply {
        colors = listOf(Color.parseColor("#22c55e"), Color.parseColor("#ef4444"))
        stackLabels = arrayOf("OK", "NG")
    }

    // Line data: Yield %
    val lineEntries = data.mapIndexed { i, item ->
        Entry(i.toFloat(), item.yieldRate.toFloat())
    }
    val lineSet = LineDataSet(lineEntries, "Yield %").apply {
        color = Color.parseColor("#3b82f6")
        setDrawCircles(true)
        axisDependency = YAxis.AxisDependency.RIGHT
    }

    chart.data = CombinedData().apply {
        setData(BarData(barSet))
        setData(LineData(lineSet))
    }

    chart.axisRight.apply {
        axisMinimum = 0f
        axisMaximum = 100f
    }
    chart.xAxis.valueFormatter = IndexAxisValueFormatter(
        data.map { extractHour(it.period) }
    )
    chart.invalidate()
}
```

### 4.2 Panel: Top Defects (Pareto lỗi)

**API:** `C3` — Defect Pareto

```
GET /api/external/inspections/defect-pareto?stationId={id}&startDate={start}&endDate={end}&limit=10
```

**Response data cần dùng:**
```json
{
  "items": [
    {
      "pointCode": "P001",
      "pointName": "Solder Joint A",
      "ngCount": 80,
      "percentage": 32.0,
      "cumulativePercentage": 32.0
    }
  ]
}
```

**Hiển thị:**
- Danh sách ngang (horizontal bars) hoặc RecyclerView
- Mỗi hàng: `pointName` + bar biểu diễn `percentage`
- Có thể kết hợp Pareto line (cumulative %)

### 4.3 Panel: Mini SPC Chart

**API:** `D1` — Control Chart (SPC)

```
GET /api/external/inspections/control-chart?stationId={id}&startDate={start}&endDate={end}
```

**Response data cần dùng:**
```json
{
  "statistics": {
    "mean": 96.52,
    "ucl": 102.97,
    "lcl": 90.07
  },
  "points": [
    { "day": "2024-01-15", "yield": 97.5, "outOfControl": false }
  ]
}
```

**Hiển thị:**
- Line chart yield theo ngày
- 3 đường tham chiếu: UCL (đỏ nét đứt), Mean (xanh), LCL (đỏ nét đứt)
- Điểm out-of-control tô đỏ

### 4.4 Panel: AI Insights

**API:** `D5` — Diagnostics

```
GET /api/external/inspections/diagnostics?stationId={id}&startDate={start}&endDate={end}
```

**Response data cần dùng:**
```json
{
  "alerts": [
    { "level": "warning", "title": "Below Target Yield", "description": "..." }
  ],
  "patterns": [
    { "name": "Dominant Defect", "description": "...", "confidence": 0.9 }
  ],
  "recommendations": [
    { "priority": "medium", "action": "Focus on ...", "rationale": "..." }
  ]
}
```

**Hiển thị:**
- Alert banner ở trên (màu theo level: critical=đỏ, warning=vàng, info=xanh dương)
- Danh sách patterns với confidence bar
- Danh sách recommendations với icon priority

---

## 5. Tab 2 — Station Detail (Chi tiết trạm)

### Mô tả giao diện

Hiển thị danh sách tất cả inspection points (điểm kiểm tra) của station, kèm:
- **Product reference image** (ảnh board/PCB) với các điểm kiểm tra được đánh dấu tọa độ (positionX, positionY)
- **Per-point stats**: tổng kiểm tra, số NG, defect rate, status (pass/warn/fail)
- **Last measurement value**: giá trị đo gần nhất
- **Recent events**: 4 lần kiểm tra gần nhất cho mỗi point
- **NG error images**: ảnh lỗi NG gần nhất

### APIs cần gọi (3 calls parallel)

#### 1. Inspection Points
**API:** `A3`
```
GET /api/external/stations/{stationId}/inspection-points?productModelId={pmId}
```

**Response — danh sách point definitions:**
```json
{
  "data": {
    "productModel": { "id": 5, "code": "PRD001", "name": "Product A" },
    "inspectionPoints": [
      {
        "id": 42,
        "code": "P042",
        "name": "Component Height",
        "measurementType": "MEASUREMENT",
        "unit": "mm",
        "lowerLimit": 4.5,
        "upperLimit": 5.5,
        "nominalValue": 5.0,
        "positionX": 234,
        "positionY": 567,
        "cropWidth": 200,
        "cropHeight": 200,
        "isActive": true
      }
    ]
  }
}
```

#### 2. Per-point Statistics
**API:** `A8`
```
GET /api/external/stations/{stationId}/measurement-stats?startDate={start}&endDate={end}&productModelId={pmId}
```

**Response — thống kê cho từng point:**
```json
{
  "data": {
    "stats": [
      {
        "pointDefId": 42,
        "pointCode": "P042",
        "pointName": "Component Height",
        "totalCount": 500,
        "okCount": 485,
        "ngCount": 15,
        "ngRate": 3.0,
        "avgValue": 5.12,
        "minValue": 4.23,
        "maxValue": 5.89,
        "stddev": 0.34
      }
    ]
  }
}
```

#### 3. Point Detail + NG Error Images
**API:** `A10`
```
GET /api/external/stations/{stationId}/point-detail?startDate={start}&endDate={end}
```

**Hiển thị Android:**
```
┌──────────────────────────────────────────┐
│  📷 Product Reference Image              │
│  (với overlay dots cho từng point,       │
│   màu: xanh=pass, vàng=warn, đỏ=fail)   │
├──────────────────────────────────────────┤
│  📋 Inspection Points List               │
│  ┌────────────────────────────────────┐  │
│  │ P042 — Component Height    [FAIL]  │  │
│  │ Defect: 3.00%  |  500 inspected   │  │
│  │ Last: 5.23mm (OK)                 │  │
│  │ [NG Image 1] [NG Image 2]        │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │ P015 — Solder Joint       [PASS]  │  │
│  │ Defect: 0.20%  |  500 inspected   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Reference image:**
```
GET /api/external/stations/{stationId}/reference-image
```
→ Returns image binary (JPEG/PNG)

---

## 6. Tab 3 — History & Defects (Lịch sử & Lỗi)

### Mô tả giao diện

Hai phần chính:
1. **Defect Pareto chart** (biểu đồ Pareto đầy đủ với cumulative line)
2. **Fail History table** (danh sách NG gần đây)

### 6.1 Defect Pareto

**API:** `C3` — Defect Pareto (giống panel Overview nhưng hiển thị đầy đủ hơn)

```
GET /api/external/inspections/defect-pareto?stationId={id}&startDate={start}&endDate={end}&limit=20
```

**Hiển thị:**
- Bar chart (vertical): mỗi bar = 1 defect type, chiều cao = ngCount
- Line overlay: cumulative percentage (0% → 100%)
- 15 màu xoay vòng: `#ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #14b8a6, #f59e0b, #6366f1, #d946ef, #84cc16, #0ea5e9, #f43f5e`

### 6.2 Fail History

**API:** `D4` — Fail History (chi tiết)

```
GET /api/external/inspections/fail-history?stationId={id}&startDate={start}&endDate={end}&limit=50
```

**Response data cần dùng:**
```json
{
  "failHistory": [
    {
      "inspectionId": 1001,
      "serialNumber": "PCB20240115001",
      "overallResult": "NG",
      "inspectionTime": "2024-01-15T10:30:00Z",
      "cycleTime": 12.5,
      "machineCode": "M001",
      "machineName": "Machine 1",
      "failedPoints": [
        {
          "pointCode": "P042",
          "pointName": "Component Height",
          "measuredValue": "5.85",
          "result": "NG",
          "lowerLimit": 4.5,
          "upperLimit": 5.5,
          "unit": "mm",
          "hasImage": true
        }
      ]
    }
  ]
}
```

**Hiển thị Android (RecyclerView):**
```
┌──────────────────────────────────────────┐
│ 🔴 PCB20240115001  |  10:30 AM  |  M001 │
│ Cycle: 12.5s                              │
│ Failed points:                            │
│   • P042 Component Height: 5.85mm (>5.5) │
│   • P015 Solder Joint: NG                │
├──────────────────────────────────────────┤
│ 🔴 PCB20240115002  |  10:32 AM  |  M001 │
│ ...                                       │
└──────────────────────────────────────────┘
```

---

## 7. Tab 4 — SPC Control (Kiểm soát SPC)

### Mô tả giao diện

Biểu đồ kiểm soát đầy đủ với:
- **X̄ chart** (yield theo ngày) + reference lines (UCL, Mean, LCL)
- **MR chart** (Moving Range) ở dưới
- **Rule violations** — bảng vi phạm Western Electric Rules
- **Process capability**: Cpk, Ppk, σ

### API

**API:** `D1` — Control Chart (SPC)

```
GET /api/external/inspections/control-chart?stationId={id}&startDate={start}&endDate={end}
```

**Response data đầy đủ:**
```json
{
  "statistics": {
    "mean": 96.52,
    "stddev": 2.15,
    "ucl": 102.97,
    "lcl": 90.07,
    "cpk": 1.28,
    "ppk": 1.28,
    "mrMean": 1.85,
    "n": 30
  },
  "points": [
    {
      "day": "2024-01-15T00:00:00.000Z",
      "yield": 97.5,
      "total": 200,
      "ok": 195,
      "ng": 5,
      "zone": "C",
      "movingRange": 0,
      "outOfControl": false,
      "violatedRules": [],
      "ruleDescriptions": []
    },
    {
      "day": "2024-01-16T00:00:00.000Z",
      "yield": 88.0,
      "zone": "below",
      "outOfControl": true,
      "violatedRules": [1],
      "ruleDescriptions": ["Point beyond 3σ limit"]
    }
  ],
  "ruleViolations": [
    { "ruleNumber": 1, "description": "Point beyond 3σ limit", "count": 2 }
  ]
}
```

**Hiển thị Android:**

```
┌──────────────────────────────────────────┐
│  📈 X̄ Control Chart                      │
│                                          │
│  UCL ─ ─ ─ ─ ─ ─ ─ ─ ─ (102.97) [red]  │
│  ───────📊📊📊📊📊───── (96.52)  [blue] │
│  LCL ─ ─ ─ ─ ─ ─ ─ ─ ─ (90.07)  [red]  │
│                                          │
│  🔴 = Out of control point              │
├──────────────────────────────────────────┤
│  📉 Moving Range Chart                   │
│  (MR values per day, mean line at 1.85)  │
├──────────────────────────────────────────┤
│  ⚠️ Rule Violations:                     │
│  • Rule 1: Point beyond 3σ — 2 lần      │
│  • Rule 3: 6 points trending — 1 lần    │
├──────────────────────────────────────────┤
│  📊 Process Capability:                  │
│  Cpk: 1.28  |  Ppk: 1.28  |  σ: 2.15   │
└──────────────────────────────────────────┘
```

**Western Electric 8 Rules (phát hiện tự động):**

| Rule | Mô tả | Ý nghĩa |
|------|--------|---------|
| 1 | Point beyond 3σ limit | Điểm ngoài giới hạn kiểm soát |
| 2 | 9 consecutive points same side | Shift trung bình |
| 3 | 6 consecutive trending | Xu hướng tăng/giảm |
| 4 | 14 consecutive alternating | Oscillation bất thường |
| 5 | 2 of 3 in Zone A+ | Biến động lớn |
| 6 | 4 of 5 in Zone B+ | Xu hướng lệch |
| 7 | 15 consecutive within 1σ | Stratification (dữ liệu quá đều) |
| 8 | 8 consecutive beyond 1σ | Mixture (2+ phân phối) |

**Zone classification:** `above` (>3σ), `A+` (2σ-3σ), `B+` (1σ-2σ), `C` (±1σ), `B-` (-1σ to -2σ), `A-` (-2σ to -3σ), `below` (<-3σ)

---

## 8. Tab 5 — QC Tool (7 công cụ QC)

Gồm 5 sub-tabs, mỗi sub-tab gọi 1 API riêng.

### 8.1 Histogram (Phân phối Yield)

**API:** `D2`
```
GET /api/external/inspections/histogram?stationId={id}&startDate={start}&endDate={end}&bins=20
```

**Response:**
```json
{
  "bins": [
    { "binStart": 88.50, "binEnd": 91.00, "count": 3, "frequency": 10.00 }
  ],
  "statistics": {
    "n": 30, "mean": 96.52, "median": 97.00, "mode": 97.50,
    "stddev": 2.15, "skewness": -0.325, "kurtosis": 0.182,
    "min": 88.50, "max": 100.00
  },
  "normalDistribution": [
    { "x": 89.75, "pdf": 0.0125 }
  ]
}
```

**Hiển thị:**
- Bar chart: bins (yield ranges) vs count
- Normal distribution curve overlay
- Stats card: Mean, Median, Mode, StdDev, Skewness, Kurtosis

```
┌──────────────────────────────────────────┐
│        Histogram + Normal Curve          │
│   ▓                                      │
│   ▓▓       ▓▓▓▓▓▓                       │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                    │
│  ──── Normal Distribution Curve ────     │
├──────────────────────────────────────────┤
│  Mean: 96.52  Median: 97.00  σ: 2.15    │
│  Skewness: -0.33  Kurtosis: 0.18        │
│  n=30  Min: 88.50  Max: 100.00          │
└──────────────────────────────────────────┘
```

### 8.2 Scatter Diagram (Biểu đồ phân tán)

**API:** `D6`
```
GET /api/external/inspections/scatter?stationId={id}&startDate={start}&endDate={end}
```

**Response:**
```json
{
  "points": [
    { "period": "2024-01-15T10:00:00Z", "x": 45, "y": 2.22 }
  ],
  "statistics": {
    "n": 120,
    "correlation": -0.352,
    "rSquared": 0.124,
    "trendLine": { "slope": -0.0234, "intercept": 4.56 }
  },
  "xLabel": "Output Volume (inspections/hour)",
  "yLabel": "NG Rate (%)"
}
```

**Hiển thị:**
- Scatter plot: X = sản lượng/giờ, Y = NG rate %
- Trend line (linear regression)
- Stats: r (correlation), R², phương trình hồi quy

```
┌──────────────────────────────────────────┐
│  Scatter: Output vs NG Rate              │
│     •   •                                │
│   •  •    •   •                          │
│  ←─────── trend line ──────→             │
│        •  •  •                           │
│   •       •     •                        │
├──────────────────────────────────────────┤
│  r = -0.352  |  R² = 0.124              │
│  y = -0.023x + 4.56                     │
└──────────────────────────────────────────┘
```

### 8.3 Cause-Effect / Ishikawa (Biểu đồ xương cá)

**API:** `D8`
```
GET /api/external/inspections/cause-effect?stationId={id}&startDate={start}&endDate={end}
```

**Response:**
```json
{
  "categories": [
    {
      "name": "Man",
      "label": "Operator / Shift",
      "causes": [
        { "cause": "Night shift", "detail": "NG rate: 8.3%", "severity": "medium", "dataValue": 8.30 }
      ]
    },
    {
      "name": "Machine",
      "label": "Equipment",
      "causes": [
        { "cause": "M001 — Machine 1", "detail": "NG rate: 3.0%", "severity": "low", "dataValue": 3.00 }
      ]
    },
    { "name": "Material", "label": "Material / Components", "causes": [...] },
    { "name": "Method", "label": "Process / Procedure", "causes": [...] },
    { "name": "Measurement", "label": "Inspection Points", "causes": [...] },
    { "name": "Environment", "label": "Working Conditions", "causes": [...] }
  ]
}
```

**6M categories (theo mô hình Ishikawa):**

| Category | Icon | Dữ liệu tự động | Dữ liệu thủ công |
|----------|------|-------------------|-------------------|
| **Man** | 👤 | Shift NG rates (Morning/Afternoon/Night) | Operator skill |
| **Machine** | ⚙️ | Per-machine NG rates | Calibration |
| **Material** | 📦 | — | Supplier quality |
| **Method** | 📋 | — | SOP compliance |
| **Measurement** | 📏 | Top defect point | Gage R&R |
| **Environment** | 🌡️ | — | Temperature/ESD |

**Hiển thị:** Fishbone diagram hoặc danh sách grouped by category, severity coded by color (high=đỏ, medium=vàng, low=xanh, info=xám).

### 8.4 Check Sheet (Ma trận lỗi)

**API:** `D7`
```
GET /api/external/inspections/check-sheet?stationId={id}&startDate={start}&endDate={end}
```

**Response:**
```json
{
  "periods": ["2024-01-15", "2024-01-16", "2024-01-17"],
  "defects": [
    {
      "pointDefId": 42,
      "pointCode": "P042",
      "pointName": "Component Height",
      "byDay": [
        { "day": "2024-01-15", "count": 3 },
        { "day": "2024-01-16", "count": 1 },
        { "day": "2024-01-17", "count": 0 }
      ],
      "total": 4
    }
  ],
  "totalByPeriod": [
    { "day": "2024-01-15", "count": 8 },
    { "day": "2024-01-16", "count": 5 }
  ],
  "grandTotal": 13
}
```

**Hiển thị:** Table/Grid — rows = defect types, columns = days, cells = count (heatmap colors)

```
┌──────────────────┬───────┬───────┬───────┬───────┐
│ Defect           │ 15/01 │ 16/01 │ 17/01 │ Total │
├──────────────────┼───────┼───────┼───────┼───────┤
│ Component Height │   3   │   1   │   0   │   4   │
│ Solder Joint     │   5   │   3   │   2   │  10   │
│ Missing Part     │   0   │   1   │   1   │   2   │
├──────────────────┼───────┼───────┼───────┼───────┤
│ Total            │   8   │   5   │   3   │  16   │
└──────────────────┴───────┴───────┴───────┴───────┘
```

### 8.5 Stratification (Phân tầng)

**API:** `D3`
```
GET /api/external/inspections/stratification?stationId={id}&startDate={start}&endDate={end}
```

**Response:**
```json
{
  "byMachine": [
    { "machineCode": "M001", "machineName": "Machine 1", "total": 500, "ok": 480, "ng": 15, "ntf": 5, "yield": 96.00 }
  ],
  "byShift": [
    { "shift": "Morning", "hours": "06:00-14:00", "total": 350, "ok": 340, "ng": 8, "ntf": 2, "yield": 97.14 },
    { "shift": "Afternoon", "hours": "14:00-22:00", "total": 300, "ok": 285, "ng": 12, "ntf": 3, "yield": 95.00 },
    { "shift": "Night", "hours": "22:00-06:00", "total": 150, "ok": 140, "ng": 8, "ntf": 2, "yield": 93.33 }
  ],
  "byDayOfWeek": [
    { "dayOfWeek": 1, "dayName": "Monday", "total": 120, "ok": 115, "ng": 4, "yield": 95.83 }
  ]
}
```

**Hiển thị:** 3 grouped bar charts:

```
┌──────────────────────────────────────────┐
│  By Machine                              │
│  M001 ████████████████ 96.0%             │
│  M002 ██████████████   94.5%             │
├──────────────────────────────────────────┤
│  By Shift                                │
│  Morning   ████████████████████ 97.1%    │
│  Afternoon ████████████████     95.0%    │
│  Night     ████████████         93.3%    │
├──────────────────────────────────────────┤
│  By Day of Week                          │
│  Mon ████████  Tue ██████████            │
│  Wed █████████ Thu ████████████          │
└──────────────────────────────────────────┘
```

---

## 9. Tab 6 — AI Analysis (Phân tích AI)

### Sub-tab 1: AI Analysis

**API:** `D9`
```
GET /api/external/inspections/ai-analysis?stationId={id}&startDate={start}&endDate={end}
```

**Response đầy đủ gồm 5 phần:**

#### 9.1 Insights (Nhận xét AI)
```json
{
  "insights": [
    {
      "type": "trend",
      "title": "Downward yield trend detected",
      "description": "Yield is declining at ~0.75% per day.",
      "confidence": 0.68,
      "severity": "warning"
    },
    {
      "type": "capability",
      "title": "Marginal process capability",
      "description": "Cpk = 1.15 — below 1.33 target.",
      "confidence": 0.9,
      "severity": "warning"
    }
  ]
}
```

**Insight types:** `trend` | `volatility` | `periodicity` | `anomaly` | `capability`

**Hiển thị:** Card list, mỗi insight 1 card với icon theo type, background theo severity.

#### 9.2 Process Capability (Năng lực quy trình)
```json
{
  "processCapability": {
    "cp": 1.25,
    "cpk": 1.15,
    "ppm": 2350,
    "usl": 100,
    "lsl": 85,
    "mean": 96.52,
    "stddev": 2.00
  }
}
```

**Hiển thị:**
- Gauge chart hoặc stats card: Cp, Cpk (target ≥ 1.33), PPM
- Color coding: Cpk < 1.0 = đỏ, 1.0-1.33 = vàng, ≥ 1.33 = xanh
- USL/LSL spec limits: USL = 100%, LSL = 85%

#### 9.3 Anomaly Detection (Phát hiện bất thường)
```json
{
  "anomalies": [
    {
      "day": "2024-01-18",
      "yield": 82.35,
      "zScore": -4.12,
      "isAnomaly": true,
      "type": "unusually_low"
    }
  ]
}
```

**Thuật toán:** Modified Z-Score sử dụng MAD (Median Absolute Deviation), ngưỡng |z| > 3.5

**Hiển thị:** Table hoặc timeline, highlight ngày bất thường bằng màu đỏ.

#### 9.4 Forecast (Dự báo 7 ngày)
```json
{
  "forecast": [
    {
      "day": "2024-02-01",
      "predicted": 96.50,
      "lower": 91.28,
      "upper": 100.00
    }
  ]
}
```

**Thuật toán:** Exponential Smoothing (α=0.3), khoảng tin cậy 95%

**Hiển thị:** Line chart — historical data + dashed predicted line + shaded confidence band

#### 9.5 Clustering (Phân cụm)
```json
{
  "clusters": [
    { "id": 0, "label": "Low Performance", "centroid": 88.50, "count": 3 },
    { "id": 1, "label": "Normal Performance", "centroid": 96.80, "count": 22 },
    { "id": 2, "label": "High Performance", "centroid": 99.50, "count": 5 }
  ]
}
```

**Phân cụm:** 3 nhóm dựa trên mean ± 1σ
- **Low:** yield < mean - 1σ
- **Normal:** mean - 1σ ≤ yield ≤ mean + 1σ
- **High:** yield > mean + 1σ

**Hiển thị:** Pie chart hoặc donut chart + cluster summary cards.

### Sub-tab 2: Diagnostics

**API:** `D5` — (Giống panel AI Insights ở Overview, nhưng hiển thị đầy đủ)

```
GET /api/external/inspections/diagnostics?stationId={id}&startDate={start}&endDate={end}
```

**Response bao gồm:**
```json
{
  "overallStats": {
    "total": 1000, "ok": 960, "ng": 30, "ntf": 10,
    "fpy": 96.00, "retestRate": 1.00
  },
  "alerts": [...],
  "patterns": [...],
  "recommendations": [...],
  "topDefects": [...],
  "dailyYieldTrend": [...]
}
```

**Hiển thị đầy đủ:**
```
┌──────────────────────────────────────────┐
│  🏥 Overall Stats                        │
│  Total: 1000 | OK: 960 | NG: 30         │
│  FPY: 96.0% | Retest: 1.0%              │
├──────────────────────────────────────────┤
│  ⚠️ Alerts (3)                           │
│  🔴 Critical: Yield below 90%           │
│  🟡 Warning: Retest rate > 2%           │
│  🔵 Info: New product model detected     │
├──────────────────────────────────────────┤
│  🔍 Patterns Detected (2)               │
│  • Declining Trend (conf: 75%)           │
│  • Dominant Defect: P042 (conf: 90%)     │
├──────────────────────────────────────────┤
│  💡 Recommendations (3)                  │
│  🔴 HIGH: Investigate P042 immediately   │
│  🟡 MED: Review night shift procedure    │
│  🟢 LOW: Schedule calibration check      │
├──────────────────────────────────────────┤
│  📊 Top Defects                          │
│  1. P042 Component Height — 18 NG       │
│  2. P015 Solder Joint — 8 NG            │
├──────────────────────────────────────────┤
│  📈 Daily Yield Trend (mini chart)       │
└──────────────────────────────────────────┘
```

---

## 10. Header KPI Strip

KPI strip hiển thị cố định ở trên cùng, gọi 2 API:

### APIs

```
A2: GET /api/external/stations/{stationId}
A7: GET /api/external/stations/{stationId}/statistics?startDate={start}&endDate={end}
```

**A2 Response (station info):**
```json
{
  "data": {
    "id": 1, "code": "ST001", "name": "Station 1",
    "factoryName": "Factory A", "workshopName": "Workshop 1", "lineName": "Line 1"
  }
}
```

**A7 Response (KPI):**
```json
{
  "data": {
    "dateRange": { "startDate": "...", "endDate": "..." },
    "summary": {
      "totalInspections": 1000,
      "okCount": 960,
      "ngCount": 30,
      "ntfCount": 10,
      "retestCount": 10,
      "fpy": 96.00,
      "finalYield": 97.00,
      "retestRate": 1.00
    },
    "comparison": {
      "previousPeriod": {...},
      "yieldChange": 1.50,
      "yieldChangeDirection": "improved"
    }
  }
}
```

**Hiển thị KPI strip:**
```
┌──────┬──────────┬───────────┬────────┬──────┬────────┐
│ FPY  │  Final   │  Change   │ Output │  NG  │ Retest │
│96.0% │  97.0%   │  +1.5% ↑  │  1000  │  30  │ 1.0%   │
│      │          │  (green)  │        │(red) │        │
└──────┴──────────┴───────────┴────────┴──────┴────────┘
```

- **FPY**: First Pass Yield — tỷ lệ OK lần đầu
- **Final Yield**: Yield sau retest
- **Change**: So với kỳ trước (↑ xanh = improved, ↓ đỏ = declined)
- **Output**: Tổng số sản phẩm kiểm tra
- **NG**: Số sản phẩm lỗi (highlight đỏ nếu > 0)
- **Retest**: Tỷ lệ kiểm tra lại

---

## 11. Date Range Filtering

Tất cả API trong StationAnalysis đều nhận `startDate` và `endDate` (ISO 8601).

### Date Presets (Bộ chọn nhanh)

| Preset | startDate | endDate |
|--------|-----------|---------|
| **Today** | `today 00:00:00` | `today 23:59:59` |
| **Yesterday** | `yesterday 00:00:00` | `yesterday 23:59:59` |
| **1 Week** | `today - 7 days` | `today` |
| **1 Month** | `today - 30 days` | `today` |
| **Year** | `Jan 1 of this year` | `today` |
| **Custom** | User picks start | User picks end |

**Kotlin date helper:**
```kotlin
import java.time.*
import java.time.format.DateTimeFormatter

enum class DatePreset(val label: String) {
    TODAY("Today"),
    YESTERDAY("Yesterday"),
    WEEK_1("1W"),
    MONTH_1("1M"),
    YEAR("Year");

    fun toRange(): Pair<String, String> {
        val fmt = DateTimeFormatter.ISO_LOCAL_DATE
        val now = LocalDate.now()
        return when (this) {
            TODAY -> now.format(fmt) to now.format(fmt)
            YESTERDAY -> now.minusDays(1).format(fmt) to now.minusDays(1).format(fmt)
            WEEK_1 -> now.minusDays(7).format(fmt) to now.format(fmt)
            MONTH_1 -> now.minusDays(30).format(fmt) to now.format(fmt)
            YEAR -> LocalDate.of(now.year, 1, 1).format(fmt) to now.format(fmt)
        }
    }
}
```

---

## 12. Android Implementation Guide

### 12.1 Project Architecture

```
app/
├── data/
│   ├── api/
│   │   ├── ApiConfig.kt          // BASE_URL, MASTER_KEY
│   │   ├── ApiService.kt         // Retrofit interface
│   │   └── AuthInterceptor.kt    // Header injection
│   ├── model/
│   │   ├── StationModels.kt      // A1, A2 response models
│   │   ├── KpiModels.kt          // A7 response model
│   │   ├── InspectionModels.kt   // C2, C3 response models
│   │   ├── SpcModels.kt          // D1 response model
│   │   ├── QcToolModels.kt       // D2, D3, D6, D7, D8 models
│   │   ├── AiModels.kt           // D5, D9 response models
│   │   └── PointModels.kt        // A3, A8, A10 response models
│   └── repository/
│       └── StationRepository.kt  // Data layer
├── ui/
│   ├── station/
│   │   ├── StationAnalysisActivity.kt
│   │   ├── StationAnalysisViewModel.kt
│   │   ├── tabs/
│   │   │   ├── OverviewFragment.kt
│   │   │   ├── StationDetailFragment.kt
│   │   │   ├── HistoryDefectsFragment.kt
│   │   │   ├── SpcControlFragment.kt
│   │   │   ├── QcToolFragment.kt
│   │   │   └── AiAnalysisFragment.kt
│   │   └── components/
│   │       ├── KpiStripView.kt
│   │       ├── SpcChartView.kt
│   │       ├── ParetoChartView.kt
│   │       └── IshikawaView.kt
│   └── common/
│       ├── DatePresetSelector.kt
│       └── ChartUtils.kt
└── di/
    └── AppModule.kt              // Hilt DI
```

### 12.2 Retrofit API Interface

```kotlin
interface StationApiService {

    // ── Station ──
    @GET("api/external/stations")
    suspend fun getStations(): ApiResponse<StationsData>

    @GET("api/external/stations/{id}")
    suspend fun getStation(@Path("id") id: Int): ApiResponse<StationDetail>

    @GET("api/external/stations/{id}/inspection-points")
    suspend fun getInspectionPoints(
        @Path("id") stationId: Int,
        @Query("productModelId") productModelId: Int? = null,
    ): ApiResponse<InspectionPointsData>

    @GET("api/external/stations/{id}/reference-image")
    suspend fun getReferenceImage(@Path("id") stationId: Int): ResponseBody

    @GET("api/external/stations/{id}/products")
    suspend fun getStationProducts(@Path("id") stationId: Int): ApiResponse<ProductsData>

    // ── KPI ──
    @GET("api/external/stations/{id}/statistics")
    suspend fun getStatistics(
        @Path("id") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("productModelId") productModelId: Int? = null,
    ): ApiResponse<StatisticsData>

    @GET("api/external/stations/{id}/measurement-stats")
    suspend fun getMeasurementStats(
        @Path("id") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("productModelId") productModelId: Int? = null,
    ): ApiResponse<MeasurementStatsData>

    @GET("api/external/stations/{id}/fail-history")
    suspend fun getFailHistory(
        @Path("id") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("limit") limit: Int = 50,
    ): ApiResponse<FailHistoryData>

    // ── Inspection Trend ──
    @GET("api/external/inspections/trend")
    suspend fun getInspectionTrend(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("groupBy") groupBy: String = "day",
    ): ApiResponse<TrendData>

    // ── Defect Pareto ──
    @GET("api/external/inspections/defect-pareto")
    suspend fun getDefectPareto(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("limit") limit: Int = 20,
    ): ApiResponse<ParetoData>

    // ── D1: SPC Control Chart ──
    @GET("api/external/inspections/control-chart")
    suspend fun getControlChart(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<SpcData>

    // ── D2: Histogram ──
    @GET("api/external/inspections/histogram")
    suspend fun getHistogram(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("bins") bins: Int = 20,
    ): ApiResponse<HistogramData>

    // ── D3: Stratification ──
    @GET("api/external/inspections/stratification")
    suspend fun getStratification(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<StratificationData>

    // ── D4: Fail History (detailed) ──
    @GET("api/external/inspections/fail-history")
    suspend fun getFailHistoryDetailed(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
        @Query("limit") limit: Int = 50,
    ): ApiResponse<FailHistoryDetailData>

    // ── D5: Diagnostics ──
    @GET("api/external/inspections/diagnostics")
    suspend fun getDiagnostics(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<DiagnosticsData>

    // ── D6: Scatter ──
    @GET("api/external/inspections/scatter")
    suspend fun getScatter(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<ScatterData>

    // ── D7: Check Sheet ──
    @GET("api/external/inspections/check-sheet")
    suspend fun getCheckSheet(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<CheckSheetData>

    // ── D8: Cause-Effect (Ishikawa) ──
    @GET("api/external/inspections/cause-effect")
    suspend fun getCauseEffect(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<CauseEffectData>

    // ── D9: AI Analysis ──
    @GET("api/external/inspections/ai-analysis")
    suspend fun getAiAnalysis(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<AiAnalysisData>

    // ── D10: Yield Comparison ──
    @GET("api/external/inspections/yield-comparison")
    suspend fun getYieldComparison(
        @Query("stationId") stationId: Int,
        @Query("startDate") startDate: String,
        @Query("endDate") endDate: String,
    ): ApiResponse<YieldComparisonData>
}
```

### 12.3 ViewModel (Shared across tabs)

```kotlin
@HiltViewModel
class StationAnalysisViewModel @Inject constructor(
    private val repository: StationRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val stationId: Int = savedStateHandle["stationId"]!!

    // Date range state
    private val _dateRange = MutableStateFlow(DatePreset.TODAY.toRange())
    val dateRange: StateFlow<Pair<String, String>> = _dateRange

    // KPI
    val kpiState = dateRange.flatMapLatest { (start, end) ->
        flow {
            emit(UiState.Loading)
            try {
                val station = repository.getStation(stationId)
                val stats = repository.getStatistics(stationId, start, end)
                emit(UiState.Success(KpiUiModel(station, stats)))
            } catch (e: Exception) {
                emit(UiState.Error(e.message ?: "Unknown error"))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.Lazily, UiState.Loading)

    // Overview: 4 parallel calls
    val overviewState = dateRange.flatMapLatest { (start, end) ->
        flow {
            emit(UiState.Loading)
            try {
                coroutineScope {
                    val hourly = async { repository.getHourlyYield(stationId, start, end) }
                    val pareto = async { repository.getDefectPareto(stationId, start, end, limit = 10) }
                    val spc = async { repository.getControlChart(stationId, start, end) }
                    val diag = async { repository.getDiagnostics(stationId, start, end) }
                    emit(UiState.Success(OverviewUiModel(
                        hourlyYield = hourly.await(),
                        topDefects = pareto.await(),
                        spcMini = spc.await(),
                        diagnostics = diag.await(),
                    )))
                }
            } catch (e: Exception) {
                emit(UiState.Error(e.message ?: "Unknown error"))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.Lazily, UiState.Loading)

    // SPC Tab
    val spcState = dateRange.flatMapLatest { (start, end) ->
        flow {
            emit(UiState.Loading)
            try {
                val data = repository.getControlChart(stationId, start, end)
                emit(UiState.Success(data))
            } catch (e: Exception) {
                emit(UiState.Error(e.message ?: "Unknown error"))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.Lazily, UiState.Loading)

    // QC Tool sub-tabs (load on demand)
    fun loadHistogram() = loadQcData { repository.getHistogram(stationId, it.first, it.second) }
    fun loadScatter() = loadQcData { repository.getScatter(stationId, it.first, it.second) }
    fun loadCauseEffect() = loadQcData { repository.getCauseEffect(stationId, it.first, it.second) }
    fun loadCheckSheet() = loadQcData { repository.getCheckSheet(stationId, it.first, it.second) }
    fun loadStratification() = loadQcData { repository.getStratification(stationId, it.first, it.second) }

    // AI Analysis
    val aiState = dateRange.flatMapLatest { (start, end) ->
        flow {
            emit(UiState.Loading)
            try {
                val data = repository.getAiAnalysis(stationId, start, end)
                emit(UiState.Success(data))
            } catch (e: Exception) {
                emit(UiState.Error(e.message ?: "Unknown error"))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.Lazily, UiState.Loading)

    fun setDatePreset(preset: DatePreset) {
        _dateRange.value = preset.toRange()
    }

    fun setCustomRange(start: String, end: String) {
        _dateRange.value = start to end
    }
}
```

### 12.4 Data Flow Diagram

```
┌─────────────┐
│  User taps  │
│  Station    │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│  StationAnalysisActivity                                  │
│  ┌──────────────────────────────────────────────────┐    │
│  │ KpiStrip (always visible)                        │    │
│  │  Calls: A2 + A7                                  │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ TabLayout: [Overview][Detail][Defects][SPC][QC][AI]│   │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ ViewPager2 → Fragment per tab                     │   │
│  │                                                    │   │
│  │  Overview → C2(hour) + C3 + D1 + D5 (parallel)   │   │
│  │  Detail   → A3 + A8 + A10 (parallel)             │   │
│  │  Defects  → C3 + D4                              │   │
│  │  SPC      → D1                                   │   │
│  │  QC       → D2|D3|D6|D7|D8 (on sub-tab click)   │   │
│  │  AI       → D9|D5 (on sub-tab click)             │   │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 12.5 API Calls per Tab (Tổng hợp)

| Tab | APIs | Parallel? | Estimated calls |
|-----|------|-----------|-----------------|
| **Load page** | A2, A7 | ✅ | 2 calls |
| **Overview** | C2(hour), C3, D1, D5 | ✅ 4 parallel | 4 calls |
| **Station Detail** | A3, A8, A10, A4(image) | ✅ 4 parallel | 4 calls |
| **History & Defects** | C3, D4 | ✅ 2 parallel | 2 calls |
| **SPC Control** | D1 | — | 1 call |
| **QC: Histogram** | D2 | — | 1 call |
| **QC: Scatter** | D6 | — | 1 call |
| **QC: Cause-Effect** | D8 | — | 1 call |
| **QC: Check Sheet** | D7 | — | 1 call |
| **QC: Stratification** | D3 | — | 1 call |
| **AI: Analysis** | D9 | — | 1 call |
| **AI: Diagnostics** | D5 | — | 1 call |
| **Total (tất cả tabs)** | | | **~20 calls** |

> **Tip:** Cache kết quả D1 (SPC) vì dùng ở cả Overview (mini) và tab SPC (full). Tương tự C3 (Pareto) dùng ở Overview và tab Defects.

### 12.6 Recommended Android Libraries

| Library | Purpose | Dependency |
|---------|---------|------------|
| **Retrofit 2** | HTTP client | `com.squareup.retrofit2:retrofit:2.9.0` |
| **OkHttp** | HTTP + interceptor | `com.squareup.okhttp3:okhttp:4.12.0` |
| **Moshi / Gson** | JSON parsing | `com.squareup.moshi:moshi-kotlin:1.15.0` |
| **MPAndroidChart** | Charts (bar, line, scatter, pie) | `com.github.PhilJay:MPAndroidChart:v3.1.0` |
| **Hilt** | Dependency injection | `com.google.dagger:hilt-android:2.50` |
| **Coroutines** | Async operations | `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3` |
| **Glide / Coil** | Image loading | `io.coil-kt:coil:2.5.0` |
| **Material 3** | UI components / Tabs | `com.google.android.material:material:1.11.0` |

### 12.7 Quick Start — Minimal Working Example

```kotlin
// 1. Build Retrofit
val okhttp = OkHttpClient.Builder()
    .addInterceptor(AuthInterceptor())
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

val retrofit = Retrofit.Builder()
    .baseUrl("http://YOUR_SERVER:3001/")
    .client(okhttp)
    .addConverterFactory(MoshiConverterFactory.create())
    .build()

val api = retrofit.create(StationApiService::class.java)

// 2. Load Overview (in ViewModel / coroutine scope)
viewModelScope.launch {
    val stationId = 1
    val (start, end) = DatePreset.TODAY.toRange()

    // Parallel calls
    val kpi = async { api.getStatistics(stationId, start, end) }
    val hourly = async { api.getInspectionTrend(stationId, start, end, "hour") }
    val pareto = async { api.getDefectPareto(stationId, start, end, 10) }
    val spc = async { api.getControlChart(stationId, start, end) }
    val diag = async { api.getDiagnostics(stationId, start, end) }

    // Update UI
    _kpiState.value = kpi.await().data
    _overviewState.value = OverviewUiModel(
        hourlyYield = hourly.await().data,
        topDefects = pareto.await().data,
        spcMini = spc.await().data,
        diagnostics = diag.await().data,
    )
}
```

---

## Phụ lục: Tham khảo nhanh tất cả endpoint URLs

```
# Station info
GET /api/external/stations                               → A1: Danh sách stations
GET /api/external/stations/:id                           → A2: Chi tiết station
GET /api/external/stations/:id/inspection-points         → A3: Điểm kiểm tra
GET /api/external/stations/:id/reference-image           → A4: Ảnh tham chiếu
GET /api/external/stations/:id/products                  → A6: Sản phẩm tại station
GET /api/external/stations/:id/statistics                → A7: KPI thống kê
GET /api/external/stations/:id/measurement-stats         → A8: Thống kê từng point
GET /api/external/stations/:id/fail-history              → A9: Lịch sử NG (compact)

# Inspection analytics
GET /api/external/inspections/trend?groupBy=hour         → C2: Hourly yield trend
GET /api/external/inspections/defect-pareto              → C3: Pareto lỗi

# Advanced SPC / QC / AI
GET /api/external/inspections/control-chart              → D1: SPC Control Chart
GET /api/external/inspections/histogram                  → D2: Histogram phân phối
GET /api/external/inspections/stratification             → D3: Phân tầng máy/ca/ngày
GET /api/external/inspections/fail-history               → D4: NG history chi tiết
GET /api/external/inspections/diagnostics                → D5: AI Diagnostics
GET /api/external/inspections/scatter                    → D6: Scatter/Correlation
GET /api/external/inspections/check-sheet                → D7: Check Sheet matrix
GET /api/external/inspections/cause-effect               → D8: Ishikawa 6M
GET /api/external/inspections/ai-analysis                → D9: AI Analysis đầy đủ
GET /api/external/inspections/yield-comparison            → D10: So sánh yield
```

> Tất cả đều dùng header `x-master-key: YOUR_MASTER_KEY` và query params `stationId`, `startDate`, `endDate`.
