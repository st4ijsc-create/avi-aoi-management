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
