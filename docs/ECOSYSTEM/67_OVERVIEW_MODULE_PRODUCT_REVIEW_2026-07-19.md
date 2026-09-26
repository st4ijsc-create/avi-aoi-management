# Doc 67 — Product Review module "Tổng quan": Báo cáo cải tiến tổng thể + Kết quả thực thi W1-W8

> **Ngày**: 2026-07-19 (audit) → 2026-07-20 (thực thi xong) · **Phương pháp**: 13 AI agent song song (9 agent per-page + 4 agent lát cắt ngang IA/a11y-responsive/performance/component-reuse), audit **code + live** (server :3000, tài khoản audit doc-65 + 2FA, 21 screenshot fullpage × 3 viewport 1280×800 / 1920×1080 / 390×844, capture console + network + inventory DOM).
> **Kết quả audit**: **196 findings** — **11 P0 · 62 P1 · 92 P2 · 31 P3**. 0 lỗi console, 0 API lỗi khi load (nền tảng ổn định — vấn đề nằm ở chất lượng sản phẩm, không phải cháy nổ).
> **Trạng thái**: ✅ **ĐÃ THỰC THI 8/8 WAVE** — user duyệt 5 quyết định §4, 8 commit trên `feat/hmi-dep` (`d839bb78`→`d0a03998`), mỗi wave gate tsc + build (+ i18n + unit test). Re-capture live đối chứng: **hScroll @1280 8/9 trang true→false**, landmark main 2→1 toàn module, console vẫn 0 lỗi. Xem §6.

## §6. KẾT QUẢ THỰC THI (2026-07-20)

**5 quyết định user duyệt**: (1) IA Full 9→4 + redirect role · (2) OEE 80/60 · (3) executive giữ + 2 cột desktop · (4) PDF thật print-stylesheet + thêm HTML · (5) mỗi wave 1 commit có gate trên `feat/hmi-dep`.

**8 commit (mỗi commit = 1 wave, gate xanh trước khi commit)**:
| Wave | Commit | Nội dung | Gate |
|---|---|---|---|
| W1 Sự thật số liệu | `d839bb78` | 6 agent: số cảnh báo ghi rõ phạm vi, filter kỳ nối thật, KPI Công ty→Nhà máy có dữ liệu, nút Xác nhận≠Resolve, PDF thật, FY/NTFY, Unknown→Chưa gán, tổng tầng khớp, approvals chỉ proposal | tsc+build |
| W2 Freshness AUD-01 | `76a476f7` | 8 trang khai tuổi dữ liệu (PollFreshness/FreshnessStrip); executive xóa badge Live giả + ErrorInline 5 vùng; dashboard-center AsyncBoundary | tsc+build |
| W3 Ops-console | `cb94dac5` | Gộp ×N alert-storm, bulk-ack, escalation QUÁ HẠN/HẾT HẠN, TV mode thật, còi WebAudio, bỏ re-render 1s | tsc+build |
| W4 Responsive/touch/a11y | `c1275f1e` | Diệt hScroll tại gốc shell (AssetScopeBar + 2 main lồng SidebarInset), 44px, WAI-ARIA tree, Andon TV 29px, executive 2 cột, e2e spec | tsc+vitest+build |
| W5 IA Full | `256bda97` | Menu 9→4, redirect theo role, tên nhất quán h1=breadcrumb=menu 3-locale, control-tower auto-persona, corporate hết nhảy app-shell, RelatedViews 2 chiều | tsc+i18n+build |
| W6 Performance | `2741a3da` | Dashboard 27→15 procedure + socket-invalidate, 3D demand-mode + **fix air-gap HDR CDN**, drill-down SQL GROUP BY (smoke PG live), route-warmer, websocket-first | tsc+build |
| W7 DS consolidation | `18b21012` | lib/format.ts + isaStateBadges (oeeTone 80/60) + ConnectionChip + EmptyState allClear + hooks; migrate 3 ngưỡng OEE + 5 map severity + 4 formatter; xóa 430 dòng CustomDashboard chết | tsc+vitest+build |
| W8 Features + i18n | `d0a03998` | **1000 key i18n** (548 vi + 452 zh) máy-dịch vỡ; dashboard-center 3 tab + nút Xem + confirm xóa + 6-template; drill-down URL-state + điểm-xấu-nhất; Andon chuông+flash+spotlight; executive duyệt 1-chạm; command-center tree-search + OEE fallback + rail filter; control-tower kiosk | tsc+i18n+vitest 40/40+build |

**Đối chứng live (capture before → after, 21 ảnh × 3 viewport)**:
- ✅ **hScroll @panel1280**: 8/9 trang `true→false` (andon vốn false). Nguồn gốc = shell (SidebarInset/AssetScopeBar), sửa 1 chỗ khỏi toàn module. Test `e2e/overview-responsive.spec.ts` chống tái phát.
- ✅ **Landmark `<main>` trùng**: 2→1 (executive 3→1) toàn module — do gỡ `<main>` lồng của shadcn SidebarInset.
- ✅ **Console/API**: giữ 0 lỗi / 0 fail sau 8 wave.
- ✅ **Ops-console**: bức tường 6.900px/192 nút → gộp thẻ ×N, vừa 1 màn, bulk-ack, escalation QUÁ HẠN, MTTA "—".
- ✅ **Executive**: 2 cột desktop, badge Live giả→PollFreshness, all-clear EmptyState, "50+" trung thực.
- ⚠️ **Tồn dư** (trung thực): mobile 390 `/dashboard` + `/executive` vẫn hScroll (W4 tập trung panel 1280; mobile là đợt sau); mỗi trang còn 1 nút icon shell chưa aria-label (dashboard 3→2). Không chặn phát hành, đưa vào backlog.

**Nợ hoãn có chủ đích (ngoài phạm vi 8 wave, ghi để không quên)**:
1. **Server mqtt severity**: `mqtt_alert_history` không có cột severity (severity thật ở `mqtt_connection_alerts`) — W1 map phòng thủ phía client, cần server expose để severity MQTT 100% thật.
2. **Server safety_events không lọc thời gian** trong `commandCenter.kpiSummary.alarms` — nguồn "đơ số" cảnh báo đang-mở (W1 đã ghi rõ phạm vi trên UI, chưa sửa gốc server).
3. **WebPush VAPID** cho executive (push-not-pull doc05) + **lịch gửi báo cáo NG theo ca** (cron+email đã có hạ tầng) — 2 tính năng automation lớn, tách thành initiative riêng.
4. **AlarmCard + useUnifiedAlerts primitive** (W7 làm tone/format/badge/chip nhưng chưa hợp nhất khối alarm-card 4 kiểu thành 1 component — rủi ro thấp, để đợt DS kế).
5. **CommandKpiStrip / MachineStatusTile / RadialGauge cho OEE**: cơ hội tái sử dụng còn lại, ROI trung bình.

---

# (Bản gốc báo cáo audit — giữ nguyên để tham chiếu)

## 0. Điểm sẵn-sàng-phát-hành per-page (0-10)

| Trang | Điểm | Chẩn đoán 1 câu |
|---|---|---|
| `/andon` (TV wall) | **7.0** | Chế tác kỹ nhất module (socket-first, PollFreshness, ISA-101, unit-test) — thiếu chuông/flash khi Andon mới, nút ack nằm trong marquee đang chạy |
| `/control-tower` | 6.5 | Kiến trúc panel-persona tốt nhưng "một cửa sự thật" tự mâu thuẫn số cảnh báo (3/3 vs 0), insight AI trùng lặp, load 12,3s |
| `/command-center` | 6.5 | Tổng hợp 1 màn tốt nhưng nhãn KPI cắt cụt ở 1280, cây 14×14px không bấm được găng tay, twin 3D phụ thuộc HDR từ CDN (air-gap → khung đen) |
| `/executive` (PWA) | 6.5 | Viết kỹ nhưng phản bội JTBD "duyệt nhanh": read-only 100%, badge "Live" giả, API lỗi → "Không có rủi ro" (false-negative nguy hiểm) |
| `/dashboard` (chính) | 5.5 | Monolith 3.222 dòng, ~29 procedure/lần mở, 2 hệ filter chồng nhau, "Xuất PDF" thực chất tải HTML, FY/NTFY tính sai ngữ nghĩa |
| `/ops-console` | 5.5 | Sụp đổ trước chính alert-storm nó sinh ra để phục vụ: 85 thẻ trùng chôn vùi 1 Andon critical, nút "Xác nhận" thực chất RESOLVE vĩnh viễn |
| `/drill-down` | 5.5 | Drill 4 tầng chạy thật nhưng số liệu là "50k inspections all-time" không khai kỳ, backend kéo 50.000 dòng/request, tiếng Việt máy-dịch |
| `/corporate-dashboard` | 5.5 | Bộ lọc kỳ **trang trí** (không lọc gì), KPI "Công ty" đếm sai (đếm nhà máy), i18n vỡ nát, không freshness |
| `/dashboard-center` | 4.0 | 2/3 tab (Mẫu/Chợ) **không có đường vào từ UI**, xóa không confirm, không có nút XEM dashboard vừa tạo |
| **Lát cắt IA toàn module** | 4.5 | 6/9 trang là biến thể "bảng điều hành" chồng lấp API lẫn nội dung — người dùng mới không biết vào cửa nào |

## 1. Bốn kết luận lớn (đọc 2 phút)

### KL-1. Khủng hoảng NIỀM TIN SỐ LIỆU — nhóm lỗi nặng nhất, phải sửa trước tiên
Module "Tổng quan" là cửa ngõ uy tín của sản phẩm, nhưng đang **nói dối người dùng** ở nhiều tầng:
- **Số tự mâu thuẫn trên cùng màn hình**: ControlTower chip "CẢNH BÁO 3/3" đỏ cạnh panel "0 TỔNG CẢNH BÁO" (2 router đếm 2 định nghĩa khác nhau). Tổng tầng Corporate 22.996 ≠ tầng Factory 22.995 (drill-down rơi im lặng bucket null).
- **Control trang trí**: CorporateDashboard Select "Tuần/Tháng/Quý" chỉ đổi subtitle file export — mọi con số đứng yên.
- **Giả-live (lớp lỗi AUD-01 đã định danh là lỗi nặng)**: ExecutiveMobile badge "Live" nhấp nháy vô điều kiện kể cả khi server chết; DrillDown badge LIVE theo socket nhưng không theo query; ControlTower "ĐANG POLL" cạnh dữ liệu 7,5 giờ tuổi; chỉ **1/9 trang** (AndonBoard) dùng đúng PollFreshness.
- **API lỗi → thông điệp trấn an**: ExecutiveMobile khi query lỗi hiện "Không có rủi ro" / "Bạn đã xử lý hết" — false-negative cho executive.
- **Nút nói dối hành vi**: OpsConsole nút "Xác nhận" trên interlock/MQTT thực chất **RESOLVE vĩnh viễn** (sự cố biến mất, audit trail sai); Dashboard nút "Xuất PDF" tải file **HTML**; severity MQTT hardcode "high" bỏ qua critical thật từ DB.
- **Số đếm sai**: "Công ty" = đếm nhà máy; "chờ quyết định" cộng cả insight FYI; MTTA hiện "0" khi không có dữ liệu; thực thể "Unknown/N/A" 100% yield đứng ĐẦU bảng xếp hạng tập đoàn.

### KL-2. Module thất bại với chính persona số 1 (operator panel-PC 10.1" đeo găng)
- **8/9 trang tràn ngang (hScroll) đúng ở 1280×800** — viewport của operator; nguồn nghi là shell chung (AssetScopeBar min-w không co). `/andon` (không dùng shell) là trang duy nhất không tràn.
- **Touch target dưới chuẩn 44px hàng loạt**: nút Ack/Resolve 32px, expander cây CommandCenter **14×14px**, drill-down 29/31 nút <44px, nút "Mở cockpit" chỉ hiện khi **hover** (cảm ứng không có hover → vô hình).
- **0 khả năng bàn phím trên cả 9 trang**: grep toàn module = 0 onKeyDown/tabIndex/focus-visible trên các div-onClick (cây, thẻ cảnh báo, machine card).
- **/ops-console là bức tường 192 nút cao 6.900px**: 85 thẻ cảnh báo trùng lặp, "Chưa xác nhận: 82" nhưng không có bulk-ack → không ai dọn, MTTA vô nghĩa.
- **Andon TV chữ chi tiết chỉ đọc được ~2,5-4m** trong khi persona đứng 5-10m (cần cap-height ≥32mm @FHD).

### KL-3. Thừa cửa, thiếu định tuyến: 6 "bảng điều hành" chồng lấp
`/control-tower` được thiết kế làm "single surface hợp nhất 6 màn command" (gọi đúng hợp API của /executive + /drill-down + /command-center + /corporate-dashboard) **nhưng vẫn đứng ngang hàng với chính các trang nó thay thế**. Nhãn menu 5 trang đều xoay quanh "điều hành/điều khiển/chỉ huy"; h1 ≠ breadcrumb ≠ menu (Tháp vận hành/Tháp điều hành; Phòng vận hành/Bảng điều hành); /corporate-dashboard còn nhảy sang app-shell khác làm mất menu. Đăng nhập xong, mọi role đối mặt menu 9 mục thay vì rơi thẳng vào cửa của vai mình — dù hệ đã biết role từ auth.me.

### KL-4. Design system có sẵn nhưng bị bỏ rơi — mỗi trang một ngôn ngữ thị giác
Primitives đã tồn tại (MetricCard/StatChip/Sparkline/ConnectionChip/EmptyState/PollFreshness/FreshnessStrip/AsyncBoundary/FilterBar/DataTable/ScopeFilterBar/isaStateBadges/RadialGauge/PanelShell) nhưng 9 trang tự viết lại: **6 bản KPI-card, 5 bản badge live, 5 bộ map màu severity, 4 hàm relative-time, 3 bộ ngưỡng màu OEE khác nhau** (cùng OEE 72%: trang này xanh, trang kia vàng), 4 bản copy "socket→debounced invalidate". Cộng thêm ~430 dòng code chết (pages/CustomDashboard.tsx đã redirect nhưng chưa xóa) và 2 query chết trên Dashboard.

## 2. Danh sách 11 P0 (chặn phát hành)

| # | Trang | P0 | Bằng chứng |
|---|---|---|---|
| 1 | control-tower | Số cảnh báo tự mâu thuẫn 3/3 vs 0 trên cùng màn | ControlTower.tsx:243 vs panels.tsx:268 |
| 2 | corporate | Bộ lọc kỳ trang trí — không lọc dữ liệu nào | CorporateDashboard.tsx:52-62 |
| 3 | corporate | KPI "Công ty" đếm mã nhà máy | CorporateDashboard.tsx:84,107-108 |
| 4 | ops-console | Không dedup alert-storm: 85 thẻ trùng chôn 1 Andon critical | screenshot 6.895px, OpsConsole.tsx:219-309 |
| 5 | ops-console (IA) | Bức tường 192 nút, không bulk-ack, không nhóm | capture buttons=192 |
| 6 | IA | 6 bảng điều hành chồng lấp — control-tower đứng cạnh 5 trang nó gộp | navigation.tsx:186-269 + apiSample |
| 7 | i18n | Chuỗi Việt máy-ghép vỡ ngữ pháp trên dashboard-center/corporate/drill-down | vi.json ~60 key |
| 8 | responsive | Tràn ngang toàn cục 8/9 trang ở đúng 1280×800 operator | capture hScroll=true ×8 |
| 9 | a11y | 0 keyboard access toàn module (div-onClick không role/tabIndex) | grep 9 trang = 0 |
| 10 | performance | Dashboard bắn ~29 procedure khi mở, tab ẩn không gate | Dashboard.tsx:586-784 |
| 11 | executive | (P1 gộp P0-tương-đương) Badge Live giả + API lỗi hiện "Không có rủi ro" | ExecutiveMobile.tsx:431,533,687 |

## 3. Kế hoạch thực thi đề xuất — 8 đợt (W1→W8)

> Nguyên tắc xếp đợt: **niềm tin số liệu trước, persona chính trước, hợp nhất sau, đánh bóng cuối**. Mỗi đợt độc lập, có gate kiểm chứng (tsc + build + capture lại bằng harness đã dựng).

### W1 — SỰ THẬT SỐ LIỆU (P0 trust) · effort M · ~15 findings
Sửa toàn bộ nhóm "nói dối": thống nhất nguồn đếm cảnh báo control-tower; nối bộ lọc kỳ corporate vào query thật (API đã nhận startDate/endDate); sửa KPI Công ty; sửa nút Xác nhận≠Resolve theo nguồn + map severity thật từ DB; đổi nhãn "Xuất PDF"→trung thực hoặc window.print; sửa FY/NTFY sai công thức; lọc/nhãn "Chưa gán tập đoàn" cho Unknown/N/A (3 trang); sửa tổng lệch tầng drill-down; MTTA "—" khi null; approvalsTotal chỉ đếm proposal; đồng bộ chart/sparkline theo trục scope (hoặc badge "Toàn cục" trung thực).

### W2 — FRESHNESS CHUẨN HÓA (AUD-01 hoàn tất trên module cửa ngõ) · effort M · ~10 findings
PollFreshness/FreshnessStrip cho **8 trang còn thiếu** (chỉ AndonBoard đạt): thay badge Live giả (executive), badge LIVE tự chế (drill-down), "ĐANG POLL" + dữ liệu 7,5h (control-tower per-panel qua PanelShell.dataUpdatedAt), 2 đèn mâu thuẫn "Trực tiếp"/"ĐỊNH KỲ" (command-center); AsyncBoundary/isError cho ExecutiveMobile + CustomDashboardContent (hết giả-rỗng, hết "Không có rủi ro" khi lỗi); tem Updated derive từ dataUpdatedAt thay vì state tay.

### W3 — OPS-CONSOLE SỐNG SÓT ALERT-STORM · effort M-L · ~10 findings
Gộp theo (rule × máy) thành 1 thẻ + badge ×N + "Xác nhận cả nhóm"; multi-select + bulk-ack (DataTable primitive); virtualize; escalation critical unacked >10' (bảng alert_escalation_rules đã có, chưa nối) + auto-expire predictive quá hạn; nút ≥44px; tách AgeLabel tự tick (bỏ re-render toàn trang mỗi giây); pending theo từng alert thay vì khóa 192 nút; chế độ TV thật (font clamp vh, chỉ critical).

### W4 — RESPONSIVE + TOUCH + A11Y NỀN (persona #1) · effort M · ~25 findings
Diệt hScroll gốc ở shell (AssetScopeBar min-w-0, collapse cấp Máy <1366px) + test Playwright assert scrollWidth≤viewport@1280; touch target ≥44px các hành động chính (ack, tab persona, expander cây p-2 hit-area, hover-only→hiện thường trực); keyboard access (role+tabIndex+onKeyDown cho cây/thẻ/card, focus-visible token); landmark 1 main duy nhất, h1 cho drill-down/executive, aria-label icon-button; Andon TV: mã máy ≥28-32px@FHD, marquee pause khi chạm + duration theo số item + fix prefers-reduced-motion nuốt 29 andon; mobile 390: bỏ truncate trên số KPI, filter→Sheet.

### W5 — HỢP NHẤT IA THEO PERSONA (cần QUYẾT ĐỊNH của anh — xem §4) · effort L
Control-tower thành landing duy nhất group; menu rút 9→4-5 mục; redirect sau đăng nhập theo role (0-click tới đúng cửa); /executive giữ vai mobile-PWA, desktop redirect; gộp drill-down + corporate thành "Phân tích tập đoàn" (TabbedHub); dashboard-center dời sang Admin; thống nhất tên h1=breadcrumb=menu theo việc-cần-làm; corporate không nhảy app-shell; RelatedViews thành component chuẩn 2 chiều trên mọi trang.

### W6 — PERFORMANCE · effort M · ~15 findings
Dashboard: gate query theo tab (29→~14 procedure), auto-refresh theo socketConnected, tách widget OEE-live khỏi root, xóa 2 query chết; CommandCenter: frameloop='demand' + bỏ Environment HDR CDN (air-gap!) + ErrorBoundary→StatusGridFallback; drill-down: SQL GROUP BY thay kéo 50k dòng (tái dùng cachedStats) + bộ chọn kỳ mặc định "Hôm nay"; control-tower vào route-warmer + panel poll gate isLive; socket websocket-first; AILocalChatBubble lazy; corporate getDailyStats 180→30 ngày + COUNT server-side; hook chung useSocketFirstQuery từ mẫu chuẩn AndonBoard/DrillDown.

### W7 — DESIGN SYSTEM CONSOLIDATION · effort L · ~20 findings
lib/format.ts (relTime/fmtPct/fmtNum "honest —"); oeeTone/yieldTone MỘT ngưỡng duy nhất; isaStateBadges mở rộng (severityTone/DotClass/TileClass/stateHex) thay 5 bộ map; MetricCard mở rộng (loading/sub/spark/size tv/onClick) thay 6 bản KPI-card; ConnectionChip thay 5 badge live; AlarmCard + useUnifiedAlerts; MachineStatusTile size sm|md|tv; PanelShell thăng cấp patterns/; EmptyState variant all-clear; useDebouncedInvalidate; Dashboard dùng patterns/Sparkline + ScopeFilterBar; sweep màu hardcode→token; xóa pages/CustomDashboard.tsx (430 dòng chết).

### W8 — TÍNH NĂNG THIẾU + TỰ ĐỘNG HÓA · effort M-L · ~15 findings
KPI chip/card click được → deep-view (StatChip.onClick có sẵn); sparkline + delta cho control-tower/executive (server đã trả per-day — doc65); Andon: chime WebAudio + flash + auto-spotlight khi Andon mới, badge QUÁ HẠN, reset cycle khi thao tác tay; executive: duyệt 1-chạm (aiInbox đã hỗ trợ server-side) + Web Push VAPID; dashboard-center: hiện 3 tab (TabbedHub), nút XEM, confirm xóa, empty-state = 6 template 1-click, auto-provision dashboard theo role; drill-down: URL-state (?corp=&factory=) + "Đi tới điểm xấu nhất" + deep-link từ Andon/alarm; lịch gửi báo cáo NG theo ca (cron+email đã có); i18n sweep ~60 key vi.json + lint chặn chuỗi EN-VN trộn; kiosk mode control-tower (?kiosk=1).

## 4. Các QUYẾT ĐỊNH cần anh chốt trước khi thực thi

1. **IA (W5) — mức độ hợp nhất**: (a) Full: menu 9→4 mục + redirect theo role (khuyến nghị, đúng tinh thần "1 persona 1 cửa"); (b) Soft: giữ 9 mục nhưng thêm redirect theo role + đổi tên nhãn; (c) Hoãn W5, chỉ làm W1-W4/W6-W8.
2. **Ngưỡng màu OEE chuẩn** (W7): chốt 80/60 (PanelShell hiện tại) hay 85/60 (Dashboard)? Ảnh hưởng mọi trang.
3. **/executive trên desktop**: redirect về control-tower hay giữ + layout 2 cột?
4. **Nút "Xuất PDF"**: sửa nhãn thành "Xuất HTML" (nhanh) hay làm PDF thật qua print-stylesheet (đúng)?
5. **Phạm vi commit**: từng wave 1 commit có gate, trên nhánh `feat/hmi-dep` hiện tại hay nhánh mới?

## 5. Phụ lục
- Digest đầy đủ 196 findings (evidence file:line): scratchpad `findings-digest.txt` (session 2026-07-19); journal workflow `wf_b145807b-dd4`.
- Capture: 21 screenshot + capture-report.json (console/network/DOM inventory per trang × viewport).
- Tài khoản audit `p1_audit_admin` đã TẮT lại sau audit (chuẩn doc 65).
