# 64 — Sprint IA-10: Trục phạm vi ISA-95 (scoped-query axis)

Ngày: 2026-07-19 · Tiếp nối doc 63 (P2 IA-10, Increment-2). Người thực thi: Claude Code, user review từng wave (DEC-08).

## Hiện trạng (recon code thật — không giả định)
| Mảnh | Trạng thái |
|---|---|
| `useScope()` + `ScopeFilterBar` (`patterns/ScopeFilterBar.tsx`) | ✅ TỒN TẠI: URL-synced (factoryId/lineId/machineId/productModelId/dateFrom/dateTo), shareable, EntityPicker selects. **NHƯNG 0 trang tiêu thụ** (chỉ WorkspaceShell/Showcase render bar) |
| `SiteContext` (`contexts/SiteContext.tsx`) | ✅ tồn tại, localStorage-persisted — **tự nhận "CONTEXT-ONLY, không rewire query"** (dòng 10-11) |
| `commandCenter.hierarchy` (ecosystem service) | ✅ cây site→factory→line→station→machine→robot, status roll-up (NodeKind line 55) |
| Breadcrumb | theo MENU-path (`breadcrumbs.ts`), không theo tài sản |
| Scope khi điều hướng | **MẤT** — scope sống trong URL params từng trang; sang trang khác là hết |

→ Sprint = **không xây từ 0**: hợp nhất 3 mảnh sẵn có (useScope + SiteContext + hierarchy) thành MỘT trục bền ở shell, rồi phủ trang theo batch. Bất biến trung thực (P2): **trang chưa wire phải đọc "chưa lọc theo phạm vi" — không bao giờ ngầm-toàn-cục.**

## Kiến trúc đích
```
HEADER (shell) ── AssetScopeBar: [Site ▾] › [Xưởng ▾] › [Chuyền ▾] › [Máy ▾]   (cascade từ commandCenter.hierarchy)
                        │ persist: localStorage (scope-axis) + URL params (chia sẻ được; URL THẮNG khi có)
                        ▼
              AssetScopeProvider (client) — nguồn sự thật duy nhất
                        │ useScope() (mở rộng primitive sẵn có: URL > provider > rỗng)
        ┌───────────────┼──────────────────┐
   trang ĐÃ wire   trang ĐÃ wire      trang CHƯA wire
   query({lineId,  query({machineId})  KHÔNG nhận scope
   machineId,…})        │                   │
   chip "Phạm vi: SIM-L1 › SCREW"      chip "Toàn bộ — chưa lọc theo phạm vi"
```

## Wave & gate
### S0 — Nền trục (shell-level, 0 đổi dữ liệu trang nào)
| Task | Nội dung |
|---|---|
| S0.1 | `AssetScopeProvider`: state {siteId?, factoryId?, lineId?, machineId?} · persist localStorage · API `useAssetScope()` |
| S0.2 | Mở rộng `useScope()` hiện có: URL param **thắng**, fallback provider (điều hướng không mất scope), write-through cả hai |
| S0.3 | `AssetScopeBar` ở header (thay chỗ SiteSwitcher, hợp nhất site vào trục): 4 select cascade từ `commandCenter.hierarchy` (chọn cha → lọc con; đổi cha → clear con mồ côi) |
| S0.4 | **Bất biến trung thực**: `ScopeStatusChip` do shell cấp — trang wire gọi `markScopeWired()`; mặc định mọi trang hiện "Toàn bộ — chưa lọc" khi trục có selection |
| S0.5 | Breadcrumb: khi có scope, hiển thị thêm asset-path (Site › Chuyền › Máy) cạnh menu-path |
| Gate | tsc+build + Playwright: bar cascade đúng · điều hướng giữ scope · KHÔNG trang nào đổi data (chưa wire) |

### S1 — Pilot 6 trang Sàn vận hành (persona #1)
`/device-monitor` · `/dashboard` · `/oee-dashboard` · `/line-view` · `/wip-dashboard` · `/andon`
Mỗi trang: đọc `useScope()` → truyền vào query chính; nếu router **chưa nhận filter** → ghi vào bảng DEP-nhỏ (không blốc, làm nốt server-side nếu ≤30ph/router); gắn `markScopeWired()`.
Gate: mỗi trang — đổi máy/chuyền trên bar → **dữ liệu ĐỔI THẬT** (Playwright chụp trước/sau); trang ngoài pilot vẫn chip "chưa lọc".

### S2 — Phủ rộng theo 7 vùng IA (batch ~10-15 trang, ưu tiên: Chất lượng → Phân tích → Thiết bị còn lại → Kỹ thuật → AI/Admin)
+ Hợp nhất `SiteContext` vào trục (SiteSwitcher = tầng Site của AssetScopeBar) · retire chip cũ.
+ DEP-07 curate cây: tool backfill parent (machines.site/line) — cần quyết định của user (Q1).
Gate mỗi batch như S1.

## KẾT QUẢ THỰC THI (2026-07-19, cùng ngày)

### S0 — XONG ✅
`AssetScopeContext` (axis+labels, localStorage `asset-scope-axis.v1`, cascade-clear, wiredCount) · `useScope()` mở rộng (URL thắng → axis lấp → write-through) · `AssetScopeBar` header (cascade Xưởng›Chuyền›Máy từ `commandCenter.hierarchy`, refId+name thật) · `ScopeStatusChip` cạnh breadcrumb (bất biến trung thực: trang chưa wire hiện **"chưa lọc theo phạm vi"** amber) · provider mount App root · i18n scopeAxis ×3.

### S1 — 5/6 trang wire ✅ (1 hoãn TRUNG THỰC)
| Trang | Wire | Ghi chú |
|---|---|---|
| /dashboard | ✅ factoryId (axis thắng dropdown) + machineId → `getStatsWithComparison`/`getShiftStats` | getAllMachinesStats/getAllOEE → DEP-S2 |
| /oee-dashboard | ✅ axis.machineId auto-chọn panel máy (`getMachineOEE`) | lưới getAllOEE → DEP-S2 |
| /line-view | ✅ route param → axis.lineId → tuyến đầu | — |
| /wip-dashboard | ✅ ô nhập tay thắng, axis lấp khi trống → `wip.*` | — |
| /andon | ✅ URL kiosk thắng, axis lấp → `getAndonBoard{factoryId,lineIds}` | — |
| /device-monitor | ⏸ **HOÃN** — `machineStatus.listWithStatus` KHÔNG nhận input server; client-filter mù = rủi ro sai | chip tự hiện "chưa lọc" (bất biến giữ đúng) |

### DEP-S2 (server nhận thêm filter — làm ở S2)
`machineStatus.listWithStatus{machineId?,lineId?}` · `mqttClient.getAllOEE{lineId?,machineId?}` · `dashboard.getAllMachinesStats{factoryId?}` · `lineController.listStates{factoryId?}`.

## S2 — KẾT QUẢ (2026-07-19, cùng ngày)

### S2-A DEP-S2 server filters ✅ (4/4, đều optional/additive — không truyền = y hệt cũ)
`machineStatus.listWithStatus{machineId,lineId,factoryId}` (post-filter trên row đã join) · `mqttClient.getAllOEE{machineId,lineId}` (lineId tra machines→stations 1 query) · `dashboard.getAllMachinesStats{factoryId,lineId}` (filter trước compute, cache tách theo input) · `lineController.listStates{factoryId}` (tra lines→workshops).

### S2-B pilot đóng nốt ✅ — **6/6 trang wire**
/device-monitor giờ lọc server-side 3 cấp (hết hoãn) · Dashboard lưới máy + OEE grid + LineView dropdown tuyến đều theo trục.

### S2-C batch Chất lượng ✅ 4 trang wire (+2 defer trung thực)
| Trang | Wire |
|---|---|
| /pareto-analysis (+tab Pareto trong cockpit) | ✅ dropdown thắng, trục lấp factory/line/machine |
| /spc-analysis (+tab SPC trong cockpit) | ✅ máy: dropdown thắng, trục lấp |
| /measurement-point-health | ✅ unmappedRate theo máy trục (listUnmapped không input — DEP-S3) |
| /quality-cockpit | ✅ trục seed cockpit-scope.machineId + wired-chip |
| /history | ⏸ **DEP-S3** — `inspection.search` nhận **CODE string** (factoryCode/machineCode…), không ID; cần map id→code hoặc server thêm id |
| /defect-heatmap | ⏸ **S3** — page wrapper thuần; 3 component con giữ state riêng, wire = 3× seeding |
| (nuance) rail MachineWorkspace | ⏸ **S3** — rail fleet trái của /device-monitor (biến thể workspace) dùng nguồn máy RIÊNG, chưa theo trục; tab OEE nhúng thì ĐÃ lọc (proof 0/39) |

### S2-D tool backfill ✅
`scripts/ops/backfill-machine-parents.mjs` — báo cáo máy mồ côi (chuỗi station→line→workshop→factory đứt) + gán từ CSV `machineCode,stationCode` (`--apply` mới ghi; chạy owner-role). Cây do người vận hành curate qua UI /layout; tool chỉ nối parent.

### S2-E SiteContext merge → **DEFER có căn cứ**
SiteSwitcher = tầng FEDERATION đa-site (multi-instance), semantics khác trục tài sản nội-site; memory doc13: federation "cần ≥2 sites để test". Merge mù = không verify được. Để khi có site thứ 2; trục hiện tại đứng cạnh SiteSwitcher không xung đột.

## S3 — KẾT QUẢ (2026-07-19, cùng ngày)

| Mục | Kết quả |
|---|---|
| **S3-A /history** | ✅ server `inspection.search` nhận `factoryId/lineId/machineId` (resolve id→CODE 1-query/cấp; **CODE gõ tay THẮNG id**) + wire cả 2 query (list + allData phân tích) |
| **S3-B /defect-heatmap** | ✅ Board + DefectHeatmap: seed máy từ trục (effect — picker tại-tab vẫn thắng sau); TrendAnalysisChart nhận `machineId` prop từ page (đã có props sẵn) |
| **S3-C rail MachineWorkspace** | ✅ `MachineRail` đổi nguồn `machine.list` (không parent, không filter được) → `machineStatus.listWithStatus` **đã-scoped DEP-S2** → rail lọc server-side 3 cấp; không đụng machine.list (nhiều consumer) |
| **S3-D batch** | ✅ 7 trang: **alarm-kpi** (summary+lineId/machineId) · **sla-cockpit** (andon.list scoped; metrics server chưa nhận → DEP-S4) · **war-room** (seed factory) · **production-dashboard** (dropdown thắng, trục lấp; compare-mode giữ toàn cục chủ đích) · **energy** (machineId lấp sau Apply) · **correlation** (seed máy khi trống) · **comparison-studio** (factory lấp + lineId vào 3 feed nhận: station-overview/yield-by-product/compare) |

### DEP-S4 — KẾT QUẢ + ĐÍNH CHÍNH ngữ nghĩa (2026-07-19)
| Đích | Quyết định |
|---|---|
| `andon.metrics{lineId,machineId}` | ✅ **ĐÃ LÀM** — MTTA/MTTR lọc theo Chuyền/Máy; SlaCockpit wire cả metrics lẫn list |
| `measurementPoint.listUnmapped` | ✖ **KHÔNG phải đích trục** (đính chính) — unmapped point-def thuộc *product model* (__UNMAPPED__), không phải máy; ép machineId = ngữ nghĩa sai |
| `warRoom.briefing{lineId}` | ✖ **Giữ factory-level chủ đích** — giao ban là nghi thức toàn xưởng; drill theo chuyền đã có ở /line-view (trục lineId ✓) |
| `field.health/healthSummary` | ✖ **Tầng IoT/robot ngoài cây machines** — field device không map vào trục Xưởng›Chuyền›Máy; khi có tầng field trong cây (S-sau) mới xét |

### Trạng thái phủ trục sau S3
**~21 bề mặt wired** (6 pilot + 4 Quality + 7 S3-D + rail + heatmap×3 + history) trên khoảng ~30 trang mang dữ liệu theo-tài-sản; các trang còn lại hoặc thuộc DEP-S4 hoặc admin/AI control-plane (ít giá trị trục). SiteContext merge vẫn chờ site 2 (federation).

## §S5 POC — SỐ ĐO (2026-07-19, máy dev + CPU throttle ×4 ≈ panel yếu; Q4 user duyệt)
Script: `scripts/audit/s5-poc.mjs` (CDP throttle, PerformanceObserver LCP/longtask, soak heap).

| Phép đo | Kết quả | Ngưỡng G5 | Phán quyết |
|---|---|---|---|
| **LCP /dashboard** (throttle ×4) | **4.580ms** · 12 longtask (4.071ms) | < 2.000ms | ❌ **FAIL** |
| Interaction (click→double-rAF) | **25ms** | < 200ms | ✅ PASS |
| Soak /andon 2,8′ (poll 15s) | heap 33–75MB **dao động band, slope ÂM** (-12,6MB/′ do GC sau load) · 206 longtask | không tăng dần | ✅ không dấu hiệu leak (chỉ báo — ca 8h thật đo khi có panel) |

**Chẩn đoán LCP-fail** (khớp P1 AUD-18): main chunk `index-*.js` **10,3MB (gzip 2,2MB)** + **61 trang import eager** trong App.tsx → parse/exec JS nghẹt CPU yếu. **→ S5-OPT (hạng mục kế, ưu tiên cao)**: (1) chuyển nốt eager→`React.lazy`; (2) `build.rollupOptions.manualChunks` tách vendor lớn (three/recharts/codemirror…); (3) đo lại POC sau mỗi bước. CHÚ THÍCH TRUNG THỰC: throttle ×4 là xấp xỉ — chuẩn cuối đo trên panel-PC thật khi có.

### Định nghĩa XONG (sprint)
1. Trục hiện ở header mọi trang, cascade đúng cây, bền qua điều hướng, URL chia sẻ được.
2. ≥ S1 pilot: đổi scope → dữ liệu đổi thật (proof chụp).
3. Không tồn tại trang "ngầm-toàn-cục": hoặc wire, hoặc chip "chưa lọc".
4. tsc+build+Playwright xanh mỗi wave; mỗi wave 1 commit push PR.

## Câu hỏi chặn (đã hỏi user — điền đáp án vào đây)
| # | Câu hỏi | Đáp án (user 2026-07-19) |
|---|---|---|
| Q1 | DEP-07 dữ liệu cây máy THẬT: ai backfill site/line/machineType? | **Tôi viết operator-tool backfill** (pattern `884ca480`); sprint chạy SIM ngay |
| Q2 | Operator default scope sau login? | **Toàn nhà máy** (không auto theo assignment; user tự chọn — trục nhớ localStorage) |
| Q3 | Chốt 6 trang pilot S1? | **Như đề xuất**: device-monitor · dashboard · oee-dashboard · line-view · wip-dashboard · andon |
| Q4 | §S5 POC specs? | **POC tạm máy dev** (tải SIM 39 máy×4 tag + CPU throttle ×4); hiệu chỉnh khi có specs panel thật |
