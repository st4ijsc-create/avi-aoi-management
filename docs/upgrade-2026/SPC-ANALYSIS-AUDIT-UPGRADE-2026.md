# Audit & Kế hoạch nâng cấp `/spc-analysis` — 1 màn hình SPC chuyên nghiệp (2026)

> Phạm vi: AUDIT chức năng SPC hiện có, so chuẩn (Minitab / JMP / InfinityQS / SPC for Excel), thiết kế lại
> thành **1 màn hình chuyên nghiệp, giảm tab tối đa**, và lập kế hoạch triển khai.
> Tài liệu này **chỉ đọc code** — không sửa code, không commit. Mọi nhận định đều dẫn `file:line`.

---

## 0. TÓM TẮT ĐIỀU HÀNH (TL;DR)

- **Phát hiện quan trọng nhất:** Route `/spc-analysis` (`client/src/pages/SPCAnalysis.tsx`) **KHÔNG phải là màn hình SPC theo chuẩn**. Nó là màn hình **AI Analytics** (Pareto / Yield Trend + dự báo / Anomaly / Root Cause / Workstation). **Không có** control chart (X-bar/R, I-MR), **không có** Cpk/Ppk, **không có** histogram chồng spec, **không có** bảng vi phạm Western Electric/Nelson.
- Các tính năng SPC "thật" **đã tồn tại nhưng bị phân mảnh ở 2 nơi khác**:
  1. `client/src/pages/SPCAdvanced.tsx` (route `/spc-advanced`) — 4 tab: Control Charts (X-bar/R), Capability (Cp/Cpk/Pp/Ppk + distribution bar), Rule Violations (WE+Nelson), CPK Trend.
  2. `server/routers/stationAnalysisRouter.ts` → `getMeasurementPointSPC` (dùng trong trang Station Analysis) — engine SPC **đầy đủ nhất**: X-bar/R + 8 rule + histogram (kèm overlay phân phối chuẩn) + capability + sample table.
- **Số tab hiện tại:** `/spc-analysis` = **5 tab**; `/spc-advanced` = **4 tab**. Tổng cộng người dùng phải nhảy giữa 2 trang + 9 tab để có một bức tranh SPC hoàn chỉnh.
- **GAP lớn nhất vs chuẩn:** không có KPI strip SPC (Cpk/Ppk/%OOC/sigma level/DPMO/yield) trên 1 view; control chart + capability + violations + Pareto nằm rải rác; biểu đồ vẽ tay bằng `<svg>`/`<div>` thay vì Recharts (đã có sẵn `recharts ^2.15.4`); thiếu I-MR và X-bar-S (chỉ có X-bar/R); thiếu dropdown chọn loại chart.
- **Bug/điểm sai công thức:** `server/routers/spcAdvancedRouter.ts:288-326` tính **Cp/Cpk bằng độ lệch chuẩn tổng thể (overall sample stdDev)** thay vì sigma **within-subgroup** (σ̂ = R̄/d2). Đây là nhầm lẫn Cp/Cpk ↔ Pp/Ppk — xem mục 4.
- **Đề xuất:** gộp về **1 màn hình** tại `/spc-analysis` với KPI strip + filter cố định trên cùng, **chọn loại chart bằng dropdown** (X-bar/R, X-bar/S, I-MR), 3 panel chính (Control Chart lớn — Capability — Violations/Pareto), dùng **collapsible section** thay vì tab. Thêm 1 endpoint gộp `spc.fullAnalysis` trả `{kpi, chart, capability, violations, pareto}` để 1 màn hình load 1 lần.

---

## 1. HIỆN TRẠNG (BƯỚC 1 — Audit)

### 1.1 Frontend — Routing & điều hướng

| Mục | Giá trị | Dẫn nguồn |
|---|---|---|
| Route AI "SPC AI Analysis" | `/spc-analysis` → `SPCAnalysis` | `client/src/App.tsx:43,192` |
| Route "SPC Advanced" | `/spc-advanced` → `SPCAdvanced` | `client/src/App.tsx:95,243` |
| Menu điều hướng | mục `nav.spcAnalysis`, perm `analytics_spc`, icon `Brain` | `client/src/lib/navigation.tsx:393-400` |
| Tái sử dụng SPCAdvanced | nhúng `SPCAdvancedContent` trong tab Analytics Settings | `client/src/pages/AnalyticsSettings.tsx:35,218-219` |

> Ghi chú: `/spc-advanced` **không có** mục menu riêng trong `navigation.tsx` → người dùng khó tìm; chỉ truy cập qua URL trực tiếp hoặc qua Analytics Settings.

### 1.2 `SPCAnalysis.tsx` (route `/spc-analysis`) — màn hình mà nhiệm vụ yêu cầu audit

Đây là **AI analytics**, KHÔNG phải SPC chuẩn. **5 tab** (`client/src/pages/SPCAnalysis.tsx:190-212`):

| # | Tab | Nội dung hiển thị | Nguồn dữ liệu (tRPC) | file:line |
|---|---|---|---|---|
| 1 | Pareto | Biểu đồ Pareto vẽ tay (div bar + cumulative %), bảng top-N điểm NG | `spcAnalysis.topNGPoints` | `SPCAnalysis.tsx:215-319`; router `spcAnalysisRouter.ts:56-89` |
| 2 | Trend & Prediction | Hướng trend, R², dự báo 7 ngày, line chart SVG (yield + MA5) | `spcAnalysis.yieldTrend` | `SPCAnalysis.tsx:322-468`; router `:92-164` |
| 3 | Anomaly Detection | Mean/Std/UCL/LCL (±zσ trên yield rate theo ngày), danh sách bất thường | `spcAnalysis.detectAnomalies` | `SPCAnalysis.tsx:471-564`; router `:167-212` |
| 4 | Root Cause | Gợi ý heuristic (theo top NG / workstation) | `spcAnalysis.rootCauseSuggestions` | `SPCAnalysis.tsx:577-639`; router `:215-308` |
| 5 | Workstation | Component `WorkstationAnalysis` (NG theo trạm) | `client/src/components/WorkstationAnalysis.tsx` | `SPCAnalysis.tsx:567-574` |

**Bộ lọc** (`SPCAnalysis.tsx:124-187`): startDate, endDate, factory, machine, interval (hour/day/week/month). **Thiếu** lọc theo measurement point / product model / subgroup size — vốn là yếu tố cốt lõi của SPC theo đặc trưng đo.

**Điều cần biết:** "control limits" ở tab Anomaly (`SPCAnalysis.tsx:503-514`) là **±zσ trên tỷ lệ yield theo ngày** — đây là kiểm soát mức sản lượng, **không phải** control chart X-bar/R trên giá trị đo. Không nên nhầm là SPC capability.

**Nút Export** (`SPCAnalysis.tsx:116-119`): chỉ là nút trống, chưa nối handler.

### 1.3 `SPCAdvanced.tsx` (route `/spc-advanced`) — SPC chuẩn "thật" nhưng nằm chỗ khác

**4 tab** (`client/src/pages/SPCAdvanced.tsx:307-325`):

| # | Tab | Nội dung | tRPC | file:line |
|---|---|---|---|---|
| 1 | Control Charts | X-bar chart + R chart (vẽ tay div/absolute), điểm OOC tô đỏ; stat cards (sample, subgroup, X̄ CL, est σ) | `workstationSpc.controlChart` | `SPCAdvanced.tsx:330-503`; router `spcAdvancedRouter.ts:406-444` |
| 2 | Capability | Cards Cp/Cpk/Pp/Ppk + màu theo ngưỡng, spec limits, process stats (mean/std/Cpu/Cpl), `DistributionBar` (spec ± 3σ — **không phải histogram thật**) | `workstationSpc.capability` | `SPCAdvanced.tsx:508-643`; router `:473-528`; bar `:1101-1183` |
| 3 | Rule Violations | Detect WE + Nelson (run-on-demand), summary critical/warning/info, list vi phạm, bảng violations đã lưu + ack/resolve | `spcRuleViolation.detect/list/acknowledge/resolve` | `SPCAdvanced.tsx:648-858`; router `:636-783` |
| 4 | CPK Trend | Latest Cpk, hướng trend, biểu đồ cột Cpk theo kỳ (vẽ tay), nút Calculate&Store | `cpkTrend.trend/calculate` | `SPCAdvanced.tsx:863-1090`; router `:786-930` |

**Bộ lọc** (`SPCAdvanced.tsx:223-287`): measurement point, startDate, endDate, machine, subgroup size (range 2-25). **Đúng hướng SPC** hơn `/spc-analysis`, nhưng mỗi tab có khối filter trùng lặp (tab 3 và tab 4 dựng lại filter riêng — `:650-698`, `:865-907`).

**Đặc điểm kỹ thuật:** toàn bộ biểu đồ là **SVG/div thủ công** (`yPos()` ở `:211-214`), không dùng Recharts → khó thêm tooltip, zone ±1σ/±2σ, đánh dấu điểm theo rule.

### 1.4 Engine SPC đầy đủ nhất: `stationAnalysisRouter.getMeasurementPointSPC`

`server/routers/stationAnalysisRouter.ts:340-497+` trả về một payload **rất gần chuẩn**: `subgroups, controlLimits, xBarPoints (kèm violatedRules/ruleDescriptions), rPoints, ruleSummary, capability, specLimits, xBarHistogram, rHistogram, sampleTable, oocCount`. Đây là nơi **đáng tái sử dụng nhất** cho màn hình mới (đã có 8 rule + histogram + capability dùng within-subgroup sigma đúng — `:480`).

### 1.5 Backend — Tổng quan endpoint SPC

| Router | Endpoint | Tính được gì | file |
|---|---|---|---|
| `spcAnalysisRouter` | topNGPoints, yieldTrend, detectAnomalies, rootCauseSuggestions, workstationAnalysis, ngByWorkstation… | Pareto, hồi quy tuyến tính + dự báo, z-score anomaly trên yield, heuristic root cause | `server/routers/spcAnalysisRouter.ts` |
| `workstationSpcRouter` | controlChart (X-bar/R), capability (Cp/Cpk/Pp/Ppk), comparison | Control limits A2/D3/D4, capability indices | `spcAdvancedRouter.ts:404-529` |
| `spcRuleViolationRouter` | detect (WE+Nelson), list/save/acknowledge/resolve/activeCount | WE rule 1-4, Nelson 2,3,4,7,8 trên X-bar | `spcAdvancedRouter.ts:636-783` |
| `cpkTrendRouter` | calculate (lưu cpkHistory), trend, summaryByWorkstation | Cpk theo kỳ + hướng + alert <1.33/<1.0 | `spcAdvancedRouter.ts:786-930` |
| `spcConfigRouter` | CRUD `spc_configurations` (chartType enum đã có xbar_r/xbar_s/individual_mr/p/np/c/u) | Cấu hình chart type/subgroup | `spcAdvancedRouter.ts:333-401` |
| `qualityGateRouter` | CRUD + evaluate quality gate | Cổng chất lượng (yield/ng/cpk/consecutive) | `spcAdvancedRouter.ts:933-1157` |
| `stationAnalysisRouter` | getMeasurementPointSPC | **X-bar/R + 8 rule + histogram + capability + sample table** | `stationAnalysisRouter.ts:340+` |

**Hằng số control chart** (d2/D3/D4/A2) cho subgroup 2-25 ở `server/utils/spc.ts:60-83` — đầy đủ và chính xác.
**Bộ quy tắc** ở `server/utils/spc.ts:145-375` (`checkWesternElectricRules`, `checkNelsonRules`, `detectAllSpcRules` 8 rule) + `aiInspectionAnalytics.ts:176` (12 rule).

### 1.6 Data model — `drizzle/schema/spc.ts`

| Bảng | Lưu gì | Đánh giá |
|---|---|---|
| `spcConfigurations` | chartType (7 loại), subgroupSize, control limit method (auto/manual), manual UCL/LCL/CL, movingRangeSpan | **Đủ** — đã có sẵn xbar_s/individual_mr/p/np/c/u dù FE chưa dùng |
| `spcRuleViolations` | ruleType (12 enum), severity, violatingValues, subgroupIndices, controlLimits, ack/resolve | **Đủ** |
| `cpkHistory` | mean/stdDev/cp/cpk/pp/ppk/cpl/cpu/usl/lsl/nominal theo kỳ | **Đủ** |
| `correlationAnalyses` | ma trận tương quan | Đủ (dùng cho correlationRouter) |
| `qualityGates` / `qualityGateEvents` / templates | cổng chất lượng | Đủ |

**Kết luận data model:** schema **đã sẵn sàng** cho I-MR, X-bar-S, p/np/c/u chart và manual control limits. FE/BE chưa khai thác hết (`workstationSpc.controlChart` mới chỉ làm X-bar/R cứng).

### 1.7 i18n — namespace `spc`

`client/src/i18n/locales/{en,vi,zh}.json` — **112 key** mỗi locale, **parity 3/3 đầy đủ** (đã verify). Các key mới cho màn hình gộp cần bổ sung đồng thời 3 ngôn ngữ.

---

## 2. SO CHUẨN SPC CHUYÊN NGHIỆP (BƯỚC 2)

Màn hình SPC chuẩn (Minitab/JMP/InfinityQS/SPC for Excel) trong **1 view** thường có:

| Thành phần chuẩn | Hiện trạng dự án | GAP |
|---|---|---|
| **Control chart** chọn loại theo subgroup: I-MR / X-bar-R / X-bar-S | Chỉ **X-bar/R** (`workstationSpc.controlChart`); schema có enum nhưng BE không sinh I-MR/X-bar-S | **THIẾU I-MR, X-bar-S**; thiếu dropdown chọn loại |
| Đánh dấu điểm vi phạm **trực tiếp trên chart** theo rule | `/spc-advanced` chỉ tô đỏ điểm ngoài ±3σ (`SPCAdvanced.tsx:412-414`); `stationAnalysisRouter` có `violatedRules` nhưng chart trong SPCAdvanced không hiển thị rule | Một phần — chưa overlay đủ rule lên chart chính của trang SPC |
| Vùng ±1σ/±2σ/±3σ (zones A/B/C) | Không vẽ zone | **THIẾU** |
| **Capability**: Cp/Cpk/Pp/Ppk + **histogram chồng spec LSL/USL/Target + đường phân phối chuẩn** | Có Cp/Cpk/Pp/Ppk; chỉ có `DistributionBar` (thanh ngang), **không phải histogram**. Histogram thật chỉ tồn tại ở `stationAnalysisRouter` (`computeHistogramBins` + normalCount overlay, `spc.ts:460-498`) nhưng KHÔNG render ở SPC page | **THIẾU histogram trên màn hình SPC** |
| Bảng vi phạm WE/Nelson (rule nào, điểm nào) | Có (`/spc-advanced` tab 3) | Có nhưng tách rời |
| **Pareto** nguyên nhân/loại lỗi | Có (`/spc-analysis` tab 1) | Có nhưng tách rời ở trang AI |
| **KPI strip**: Cpk, Ppk, %OOC, sigma level, DPMO, yield | **Không có** ở bất kỳ trang SPC nào | **THIẾU hoàn toàn** (DPMO & sigma level chưa được tính ở đâu) |
| Bộ lọc: sản phẩm / máy / điểm đo / thời gian / subgroup size | `/spc-advanced` có (trừ product model); `/spc-analysis` thiếu measurement point | Một phần — cần hợp nhất |
| Manual control limits / freeze baseline | Schema có (`manualUCL/LCL/CL`) nhưng FE không expose | **THIẾU UI** |

**Tổng kết GAP chính:**
1. Không tồn tại **một** màn hình SPC hợp nhất; phải dùng 2 trang + 9 tab.
2. Thiếu **KPI strip SPC** (đặc biệt **DPMO** và **sigma level** chưa được tính).
3. Thiếu **histogram capability thật** trên trang SPC (engine đã có sẵn ở `stationAnalysisRouter`).
4. Thiếu **I-MR** và **X-bar-S** (chỉ X-bar/R), thiếu **dropdown chọn loại chart**.
5. Biểu đồ vẽ tay SVG/div — nên chuyển **Recharts** (đã cài) để có tooltip, zones, đánh dấu rule.
6. **Nghi vấn công thức Cpk** ở `spcAdvancedRouter.capability` (mục 4).

---

## 3. THIẾT KẾ "1 MÀN HÌNH" (BƯỚC 3)

Mục tiêu: gộp về **một** trang `/spc-analysis` chuyên nghiệp, **không tab** (dùng dropdown + collapsible section).

### 3.1 Nguyên tắc
- **Filter + KPI strip dính trên cùng** (sticky), áp dụng cho toàn trang, load 1 lần.
- **Chọn loại control chart bằng Dropdown** (X-bar/R · X-bar/S · I-MR · p/np/c/u) thay vì tab.
- 3 khu vực chính trong cùng viewport: **(A) Control Chart lớn**, **(B) Capability + Histogram**, **(C) Violations + Pareto**.
- Các phần phụ (CPK Trend theo thời gian, Saved violations + ack/resolve, Root cause AI) đặt trong **collapsible section** bên dưới — mở khi cần, không chiếm chỗ mặc định.

### 3.2 MOCKUP ASCII

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SPC Analysis — Thống kê kiểm soát quá trình          [⟳ Refresh] [⭳ Export]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ FILTERS (sticky)                                                               │
│ [Product ▾] [Machine ▾] [Measurement Point ▾] [Chart: X̄-R ▾]                   │
│ [Start date] [End date]  Subgroup size: [──●──] 5   [Rules ▾: WE+Nelson]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI STRIP                                                                       │
│ ┌────────┐┌────────┐┌────────┐┌─────────┐┌──────────┐┌──────────┐┌──────────┐ │
│ │ Cpk    ││ Ppk    ││ %OOC   ││ Sigma   ││ DPMO     ││ Yield    ││ Samples  │ │
│ │ 1.42 🟢││ 1.31 🟡││ 2.1%   ││ 4.3σ    ││ 1 250    ││ 99.1%    ││ 1 480    │ │
│ └────────┘└────────┘└────────┘└─────────┘└──────────┘└──────────┘└──────────┘ │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ (A) CONTROL CHART  [X̄-R ▾]                     │ (B) CAPABILITY                │
│  UCL ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  Cp 1.55  Cpk 1.42           │
│  ·····zone A·····                               │  Pp 1.40  Ppk 1.31           │
│   ───zone B───        ●        ⚠(WE2)           │  ┌─ Histogram + Normal ───┐  │
│  CL ━━━━●━━━●━━━●━━━━━━━●━━━●━━━━━●━━━━━━━━━━━  │  │ LSL│      ╱▔╲      │USL │  │
│   ───zone B───   ●         ●         ●(OOC red) │  │    │    ╱▆▆▆▆╲    │    │  │
│  ·····zone A·····                               │  │   ▂▄▆█████████▆▄▂  │    │  │
│  LCL ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  └────────────────────────┘  │
│  ── R / S / MR chart (cùng trục X) ──          │  Mean μ  StdDev σ  n          │
│  UCL ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  USL / Nominal / LSL          │
│  CL ━━━●━━━●━━━━●━━━━━●━━━━━●━━━━━━━━━━━━━━━━━  │                              │
├───────────────────────────────────────────────┴──────────────────────────────┤
│ (C) RULE VIOLATIONS                              │  PARETO (defect / point)     │
│  ┌─ rule ─────────────── pts ─ sev ─┐           │  ▆                            │
│  │ WE1 Beyond 3σ      #14      🔴   │           │  ▆ ▆                          │
│  │ WE2 2/3 beyond 2σ  #9-11    🟡   │           │  ▆ ▆ ▆      ╱── cum % ─────   │
│  │ Nelson3 6 trending #20-25   🟡   │           │  ▆ ▆ ▆ ▆ ▆ ╱                  │
│  └──────────────────────────────────┘           │  P1 P2 P3 P4 P5 …            │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▸ CPK Trend over time            (collapsible, default đóng)                    │
│ ▸ Saved violations & acknowledge (collapsible)                                  │
│ ▸ AI Root-cause suggestions      (collapsible)                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Component tái dùng (Recharts đã có `^2.15.4`)
- `ComposedChart` + `Line` + `ReferenceLine` (UCL/CL/LCL) + `ReferenceArea` (zone A/B/C) + `Scatter` (điểm, tô đỏ theo rule) → control chart X-bar & R/S/MR.
- `BarChart` + `Line` (cumulative) → **Pareto** (thay biểu đồ div thủ công ở `SPCAnalysis.tsx:236-270`).
- `BarChart` + `Line` (normal overlay) → **histogram capability** (dùng `xBarHistogram`/`rHistogram` từ `spc.ts:computeHistogramBins`, đã có `normalCount`).
- Tái dùng `DistributionBar` (`SPCAdvanced.tsx:1101-1183`) như view phụ "spec vs ±3σ".
- Giữ nguyên `WorkstationAnalysis` và `cpkTrend` chart trong section collapsible.

### 3.4 Endpoint gộp đề xuất: `spc.fullAnalysis`
Một query trả đủ để 1 màn hình load 1 lần:
```ts
spc.fullAnalysis({
  measurementPointDefId, productModelId?, machineId?,
  startDate, endDate, subgroupSize, chartType, enabledRules[]
}) => {
  kpi:        { cpk, ppk, oocPercent, sigmaLevel, dpmo, yield, sampleCount },
  chart:      { type, primary:{points,UCL,CL,LCL,zones}, secondary:{points,UCL,CL,LCL} }, // X̄ + R/S/MR
  capability: { cp,cpk,pp,ppk,cpu,cpl, mean,stdDev,specLimits, histogram[] },
  violations: { summary, items[] },
  pareto:     { items[], cumulativePercent[] }
}
```
- Tái dùng `calculateCapabilityIndices`, `computeControlLimits`, `detectAllSpcRules`, `computeHistogramBins` (đều ở `server/utils/spc.ts`) + logic của `stationAnalysisRouter.getMeasurementPointSPC` (đã có gần đủ payload này).
- **Bổ sung BE cần làm:** (a) hàm sinh I-MR (moving range, hằng số d2(2)=1.128, D4=3.267) và X-bar-S (hằng số c4/B3/B4); (b) tính **DPMO** = (#ngoài spec / n) × 1e6 và **sigma level** = NORMSINV(1 − DPMO/1e6) + 1.5; (c) sửa Cpk dùng within-subgroup sigma (mục 4).

---

## 4. BUG / ĐIỂM SAI CÔNG THỨC

**🔴 Cpk dùng sai sigma trong `spcAdvancedRouter.capability`.**
`server/routers/spcAdvancedRouter.ts:288-326` (`calculateCapabilityIndices` cục bộ) tính:
```
const s  = stdDev(workingValues, m, true);   // overall sample stdDev (n-1)
const cp  = (USL - LSL) / (6 * s);
const cpk = min((USL-m)/(3s), (m-LSL)/(3s));
const sp  = stdDev(workingValues, m, false); // population stdDev
const pp  = (USL-LSL)/(6*sp);                 // Pp
```
Theo chuẩn: **Cp/Cpk phải dùng sigma WITHIN-subgroup** (σ̂ = R̄/d2), còn **Pp/Ppk dùng sigma OVERALL**. Ở đây cả Cp/Cpk lẫn Pp/Ppk đều tính từ stdDev tổng thể → **Cpk thực chất đang là Ppk**, và Cp/Cpk sẽ lệch khi quá trình có biến thiên giữa các subgroup. (Ngoài ra Pp dùng population stdDev `n`, Cp dùng sample `n-1` → bất nhất.)

**Tham chiếu cách làm đúng đã có sẵn:** `server/utils/spc.ts:381-454` (`calculateCapabilityIndices` phiên bản shared) **nhận `estimatedSigma`** (within-subgroup) cho Cp/Cpk và dùng `overallStdDev` cho Pp/Ppk — và `stationAnalysisRouter.ts:480` gọi đúng với `limits.estimatedSigma`. → **Khuyến nghị:** bỏ hàm cục bộ trong `spcAdvancedRouter`, dùng phiên bản `utils/spc.ts` + truyền `limits.estimatedSigma` từ control chart.

**🟡 Phụ:** `spcAdvancedRouter.controlChart` không trả `estimatedSigma` cho client dưới dạng dễ ghép với capability; cần expose để KPI strip & histogram dùng chung 1 sigma.

**🟡 Phụ:** `SPCAnalysis.tsx:116-119` nút Export chưa nối handler (no-op).

> Các tính năng còn lại (control limit A2/D3/D4, WE/Nelson rules, Pareto cumulative, anomaly z-score) kiểm tra công thức **đúng**. Có test: `server/routers/spcAnalysisRouter.test.ts`, `server/utils/spcRules.test.ts`.

---

## 5. KẾ HOẠCH TRIỂN KHAI (BƯỚC 4 — đánh số)

### BE — Backend
1. **`spc.fullAnalysis` (endpoint gộp).** Tạo trong router mới (hoặc mở rộng `workstationSpcRouter`) trả `{kpi, chart, capability, violations, pareto}`. Tái dùng `computeControlLimits`, `detectAllSpcRules`, `computeHistogramBins`, `calculateCapabilityIndices` (`server/utils/spc.ts`). Tham chiếu payload `stationAnalysisRouter.getMeasurementPointSPC`.
2. **Sửa Cpk:** thay hàm cục bộ `spcAdvancedRouter.ts:288-326` bằng `utils/spc.ts:calculateCapabilityIndices` + truyền `estimatedSigma` within-subgroup. (Backward-compat: giữ nguyên shape `{cp,cpk,pp,ppk,cpu,cpl,mean,...}`.)
3. **Thêm chart types:** I-MR (moving range) và X-bar-S vào hàm sinh chart (đọc `chartType` từ input/`spcConfigurations`). Hằng số c4/B3/B4 cần bổ sung vào `utils/spc.ts`.
4. **KPI mở rộng:** tính `dpmo`, `sigmaLevel`, `oocPercent`, `yield` trong `fullAnalysis`.
5. **(Tùy chọn) Manual control limits:** đọc `spcConfigurations.manualUCL/LCL/CL` khi `controlLimitMethod='manual'`.

### FE — Frontend
6. **Gộp `/spc-analysis` thành 1 màn hình** theo mockup mục 3.2: Filter sticky + KPI strip + Dropdown chart + 3 panel (Control/Capability/Violations+Pareto) + 3 collapsible (CPK Trend / Saved violations / Root cause AI). Bỏ cấu trúc 5 tab.
7. **Chuyển biểu đồ sang Recharts:** control chart (`ComposedChart`+`ReferenceLine`+`ReferenceArea`+`Scatter`), Pareto (`BarChart`+`Line`), histogram capability (`BarChart`+`Line` normal overlay). Thay code SVG/div ở `SPCAnalysis.tsx:236-270,408-441` và `SPCAdvanced.tsx`.
8. **Dropdown chọn loại chart** thay tab; gọi `spc.fullAnalysis` 1 lần khi filter đổi.
9. **Nối nút Export** (CSV/PNG) — hiện no-op.
10. **Dọn route:** giữ `/spc-advanced` như alias/redirect tới `/spc-analysis` để backward-compat, hoặc nhúng cùng component. Thêm mục menu cho trang SPC hợp nhất nếu cần.

### Tests
11. Unit test `fullAnalysis` (kpi/chart/capability/violations/pareto) + test Cpk within-subgroup (so với giá trị Minitab mẫu). Mở rộng `spcRules.test.ts` cho I-MR/X-bar-S.
12. Snapshot/integration test FE màn hình gộp (render với mock tRPC).

### i18n
13. Bổ sung key mới (KPI: dpmo, sigmaLevel, oocPercent; chart type labels; histogram; zones) cho **cả `en`/`vi`/`zh`** đồng thời (giữ parity 112+).

### Nghiệm thu
14. 1 màn hình, 1 lần load, hiển thị đủ: control chart (chọn X̄-R/X̄-S/I-MR) + capability + histogram + violations + Pareto + KPI strip. Số tab = 0 (dropdown + collapsible).
15. Cpk khớp công thức within-subgroup (kiểm chứng bằng dataset chuẩn). DPMO/sigma level hiển thị đúng.
16. Parity i18n 3 ngôn ngữ; `/spc-advanced` không vỡ (redirect/alias).

### Rủi ro & Backward-compat
- **R1:** Đổi công thức Cpk khiến giá trị hiển thị thay đổi so với lịch sử `cpkHistory` → ghi chú rõ trong release, không migrate dữ liệu cũ (giá trị cũ vẫn là Pp-like). Mức: trung bình.
- **R2:** Recharts với dataset lớn (5 000 mẫu) có thể chậm → giới hạn điểm vẽ (downsample subgroup) hoặc virtualize. Mức: trung bình.
- **R3:** Gộp 2 trang → người dùng quen `/spc-advanced` cần redirect. Mức: thấp.
- **R4:** Endpoint gộp tăng tải 1 query → cache theo filter + index đã có trên `measurementResults`/`cpkHistory`. Mức: thấp.

---

## 6. KẾT LUẬN

- `/spc-analysis` hiện là **AI analytics 5 tab**, KHÔNG có control chart/Cpk/histogram/rule chuẩn SPC.
- Năng lực SPC chuẩn **đã tồn tại** nhưng phân mảnh ở `/spc-advanced` (4 tab) và `stationAnalysisRouter` (engine đầy đủ nhất).
- Đề xuất **hợp nhất về 1 màn hình** (dropdown + collapsible, 0 tab), thêm KPI strip (gồm **DPMO/sigma level còn thiếu**) và **histogram capability thật**, chuyển sang **Recharts**, và **sửa công thức Cpk** (`spcAdvancedRouter.ts:288-326`) sang sigma within-subgroup.
