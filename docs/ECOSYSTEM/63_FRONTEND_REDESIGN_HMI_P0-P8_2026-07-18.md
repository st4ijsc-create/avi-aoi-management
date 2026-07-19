# 63 — Thiết kế lại & nâng cấp Frontend HMI (SYNAPSE / LDS-L5) — P0→P8

Ngày: 2026-07-18. Vai trò: Principal Product Designer (MES/SCADA/HMI) + Frontend Architect.
Quy trình 8 pha P0→P8, trọng tài = 12 chuẩn công nghiệp + WCAG 2.2/Nielsen/CWV.
Phương pháp: audit LIVE (Playwright setOffline triad, 228 màn/684 ảnh) + workflow đa-agent verify đối kháng.

> **Nhãn bằng chứng** (hệ CHƯA xuống xưởng, user hiện = kỹ sư): **[M]** đo được · **[H]** vi phạm chuẩn (đọc code `file:line`) · **[W]** walkthrough · **[I]** ấn tượng nội bộ. [W]/[I] KHÔNG là phát hiện đã xác lập.

---

## Khung quyết định (DEC)
| Mã | Quyết định |
|---|---|
| DEC-05 | Thiết kế theo **THIẾT BỊ MỤC TIÊU** (80% panel PC cảm ứng gắn trạm), không theo hiện trạng PC kỹ sư. **Persona #1 = operator tại trạm**; engineer nhường khi xung đột. |
| DEC-06 | Nhãn [M]/[H]/[W]/[I] bắt buộc. |
| DEC-07 | **GATE-1** giữa P4–P7: prototype kiểm với **3 operator thật**; fail → không P7. Hệ chưa xuống xưởng → GATE-1 chờ pilot. |
| DEC-08 | Không FE dev → P7 = Claude Code trên repo thật, review từng bước; **giữ Radix/shadcn + áp token**; §S5 POC trước P7. Thiết bị không chạy Chrome (HMI PLC 7") = ngoài phạm vi. |
| DEC-Q1 | Thiết bị mục tiêu: **10.1" · 1280×800** (~149ppi), nhìn **50cm**, **cảm ứng điện dung + găng tay**. → target ≥48px, không hover/drag-chính-xác, chip thay gõ; shell gọn (rail thu icon, ContextDrawer **overlay**). |
| DEC-G2 | G2 → **G2a** (≤2s khi kênh sống) · **G2b** (khi kênh chết báo "mất kết nối/dữ liệu cũ" ≤T=2×heartbeat, không giả-live) · **G2c** (web = Andon/giám sát, không E-stop; an toàn read-only + nguồn + độ trễ). |

---

## P1 — Audit hiện trạng (18 AUD, code + live)

**Phán quyết:** hệ TỐT hơn narrative — PAIN-1 (menu sâu) đã sửa, sprawl phần lớn đã hợp nhất (doc 59/60), **không** vi phạm ISO 10218, audit-trail IEC 62443 đầy đủ, i18n hạng nhất (17.869 `t()`). Khoảng trống còn lại **cụ thể, phần lớn ở tầng trình bày**.

### AUD nổi bật
| AUD | Phát hiện | Nhãn |
|---|---|---|
| **AUD-01** (G8) | Dashboard gắn nhãn **"LIVE/Online/realtime" + timestamp giả** khi đã offline — **HỆ THỐNG: 10/26 màn realtime confirmed** (digital-twin/dashboard/control-tower/executive/connectivity/mqtt-dashboard/**system-health báo "Khỏe" khi mạng chết**/fleet-orchestration/command-center/factory-live-map). Verify đối kháng loại 3 dương-tính-giả (andon/wip/line-view). | **[M]+[H]** |
| AUD-01b | Counter "Cập nhật Xs trước" **tick khi offline** = ảo giác tươi | [M] |
| AUD-06 | Banner offline toàn cục **TỐT** (100%/201 màn, 0 crash) — NHƯNG `OfflineBanner` chỉ đọc `navigator.onLine`, **bỏ sót server-chết/socket-drop** (LAN vẫn lên) | [M]+[H] |
| AUD-05 | 6 route mồ côi URL-only + **28 trang collapse-vào-hub biến mất khỏi ⌘K** (comment `navigation.tsx:2255` tự nhận sai) | [H] |
| AUD-08 | Theme render **TỐI** (26/26); **xanh-cho-bình-thường + đỏ-cho-KPI-0%**; tường màu báo động; FAB/glow/hero (SaaS) | [M]+[H] |
| AUD-09 | Client trộn PackML + nhãn tự chế (sập 17→5 tông); E10 **dùng chung palette** PackML; state live = chữ không màu; unitMode vắng; 'call' Andon bất nhất | [H] |
| AUD-11 | `<html lang="en">` tĩnh dù app tiếng Việt chính | [H] |
| AUD-12 | Điều hướng **phẳng theo chức năng**, không cây ISA-95; breadcrumb theo menu | [H] |
| AUD-14 | Chống bão alarm thiên **ĐO** hơn **NGĂN** ở HMI; shelve thiếu lý-do/logbook ở UI | [H] |
| AUD-04 | Tab Serial **bỏ lịch sử xuyên-trạm** (không gọi getBySerial/getLineage) | [H] |
| AUD-16 | E-stop/safety read-only thiếu nhãn "nguồn telemetry, không phải kênh an toàn" | [H] |

**Insight cốt lõi:** primitive staleness ĐÚNG đã tồn tại (`unsStreamClient.stale`, heartbeat) nhưng **dashboard không dùng ở widget** = gap tầng trình bày (đúng phạm vi FE). ★ `OfflineBanner` navigator-only → cần **FreshnessStrip socket-aware**.

**Live-audit harness (tái dùng):** `scripts/audit/p1-live-triad.mjs` — Playwright standalone, login API→cookie, **chặn non-GET ở route layer**, mỗi màn **live→setOffline(true)→stale→setOffline(false)→recover** + log máy-đọc. RBAC hệ này = **permission per-USER** (bảng `permissions`, admin=god-bypass).

---

## P2 — Kiến trúc thông tin (judge-panel: PA1 8.4 / PA3 8.1 / PA2 6.6)
**Spine = PA1 task-flow** (Giám sát→Cảnh báo→Xử lý→Truy xuất→Đổi-model) + graft PA3 (persona-retire/kiosk/freshness-contract) + PA2 (cây trên `commandCenter.hierarchy` + node-staleness).
★ **BẤT BIẾN TRUNG THỰC:** trang chưa wire scope/freshness đọc "không-rõ", **không ngầm-toàn-cục** (AUD-12 ≡ AUD-01 = cùng lỗi trung thực).

**7 vùng** (thay 10 nhóm-chức-năng), phủ ~207 route: **IA-01 Sàn vận hành** (spine) · IA-02 Chất lượng&Truy xuất · IA-03 Sản phẩm&Công thức · IA-04 Kỹ thuật&Thiết bị · IA-05 Phân tích&Báo cáo · IA-06 Trợ lý AI · IA-07 Quản trị&Dữ liệu (+ "Me" neo ở chrome).

| Cơ chế | Sửa | Đợt |
|---|---|---|
| IA-08 **1 WorkspaceShell** (header+rail+main TabbedHub+ContextDrawer); mọi mô hình nav cũ = phép chiếu | AUD-17 | 1 |
| IA-09 **⌘K full-index** | AUD-05 | **1 (đã code)** |
| IA-10 **Trục ISA-95** scoped-query (SiteContext→query thật, ScopeFilterBar phẳng→cây) | AUD-12 | **2 (xâm lấn)** |
| IA-11 **FreshnessStrip + hợp đồng lastEventAt** | AUD-01/G8 | **1 (primitive đã code)** |
| IA-12 quy tắc persona (retire 6 role-home + 3 persona ControlTower + taxonomy App-Launcher) | AUD-13/17 | 1b |
| IA-13 alert-flow ở shell | G1 | 1b |
| IA-14 mật độ Simple/Advanced | ISA-101 | 1 |

---

## P3 — Luồng tác vụ (FLW, critic verify vs code)
| FLW | click/màn/nhớ | Verdict |
|---|---|---|
| **FLW-01** Ack+xử lý cảnh báo dừng chuyền | **3/0/0** (nhánh an toàn 5 tương tác — ISO-10218) | ✅ PASS |
| **FLW-02** Truy xuất serial xuyên trạm | **2–3** | ✅ PASS (sửa AUD-04) |
| FLW-03 Đổi model (changeover) | 8/1/0 (operator 3/1/0) | ⚠ REVISE → **DEP-08** |
| FLW-04 Kiosk ambient | 2/0/0 | ⚠ REVISE (lỗ hổng socket-freshness) |

★ **DEP-08**: bàn giao operator→supervisor duyệt **không dựng được** trên `aiCopilot.confirmAction` (buộc gắn đúng người đề xuất; changeover-apply không phải registered tool) → **cần backend**.

---

## P4 — Layout (4 SCR Increment-1, wireframe 1280×800, đều PASS)
SCR-01 shell chrome · SCR-02 kiosk operator · SCR-03 alert ContextDrawer (G1) · SCR-04 truy xuất serial.
**Đính chính reuse-fidelity (critic đọc code) → nạp P7:** chrome nên do `DashboardLayout`+`Sidebar` sở hữu (không phải ResizablePanel drag); Sidebar icon mặc định 48px → override `--sidebar-width-icon ≥64px`; gỡ `ResizableHandle` (no-drag); `ContextDrawer` (Sheet) phủ cả header + `SheetClose` ~24px+hover → override 56px; `ConfirmWithReason` nút 36px → ≥48px; **`PollFreshness` hardcode amber kể cả khi tươi** → trung-tính; `MachineCockpit` là PAGE → dùng `MachineCockpitBody`; **ngân sách dọc 800px = zero-slack** → overflow nội bộ.

---

## P5 — Design system (token ISA-101 trên oklch sẵn có, WCAG đo thật)
- **TOK-01..04** `--isa-field/panel/graphic/graphic-muted`: nền "im lặng" xám trung tính (dark mặc định operator — biện minh: ánh sáng xưởng thấp, cắt chói, ISA-101 về luminance không polarity).
- **AUD-08 fix — alarm 4 mức KHÁC hue** (TOK-A1..A8): critical đỏ-25 / high cam-55 / medium amber-85 / low vàng-nhạt-95 (+ fill fg đo ≥5.3:1). critical≠high (trước cùng đỏ).
- **AUD-09 fix — 3 palette TÁCH** (TOK-P1..6 PackML cool teal/cyan · TOK-E1..6 SEMI-E10 · alarm warm) → PackML≠E10≠severity.
- **Stale** (TOK-S1..S4): scrim + `grayscale(0.7) opacity(0.62)` + stamp `--alarm-medium` "as-of HH:MM".
- **Typography/density** (TOK-TD-01..16): sàn đọc-xa 50cm = **min ~20px** (ISO 9241-303 16 arcmin); hero 40/30 · value 22 tabular-nums · body 18/16; `[data-density]` comfortable(56px)/compact(48px, sàn găng cứng); target/icon ≥48/56.
> Giá trị oklch đầy đủ trong workflow P5 (`p5-design-system`). Áp dụng vào `index.css` + remap `severityCanonical`/`canonicalStatusColor` = đợt sau (có review — thay đổi màu diện rộng).

---

## P6 — Khoảng trống chức năng (29 FEA / 4 cụm, critic phân scope)
- **Alarm ISA-18.2** (7): FEA-A1 thẻ 4-trường (hybrid, join `alarm_taxonomy`+`master_alarms`), FEA-A2 field "cause" (**DEP-06**), FEA-A3 rollup+occurrence (FE cockpit / hybrid board), A4 deadband, A5 flood banner, A6 shelve-HMI (đổi RBAC+gỡ cờ `EQ_GOVERN_ENABLED`), A7 logbook.
- **Machine-state** (8, verdict pass): FEA-M1 `stateVocabulary.ts` grammar 3-mô-hình, M2 `<PackmlStateBadge>` 17-state, M3 cockpit badge màu, M4 `<UnitModeChip>`, M5 `<E10StateBadge>`, M6 `<AndonBadge>` chốt 'call', M7 legend, M8 nhất quán map/tile.
- **Freshness-safety** (6): **FEA-F1 FreshnessStrip** (đã code), FEA-F2 tile-desaturation contract, F3 per-source store, **F4 nhãn "Nguồn telemetry — không phải kênh an toàn"** (AUD-16), F5 safety-signal stale guard, F6 flip-'unknown' khi mạng down.
- **Trace-CFX** (8): FEA-T1 timeline xuyên trạm (FE, AUD-04), T2 full genealogy tRPC (**DEP-05**), T3 cây lineage, T4 chain-integrity, T5 `SerialTraceLink`, T6 handshake Hermes+WIP (**DEP-02**), T7 CFX panel, T8 recall export.

**Scope:** ~17 in-scope-FE · ~8 hybrid · ~4 DEP (**DEP-06** cause · **DEP-05** genealogy tRPC · **DEP-02** Hermes/CFX).

---

## P7 — CODE (Increment-1 slice AN TOÀN — đã ship trong commit này)
Nguyên tắc: chỉ đổi tầng trình bày, tái dùng token/primitive sẵn có, **verify tsc+build**, không đụng chrome xâm lấn.

| File | Thay đổi | AUD/FEA |
|---|---|---|
| `client/src/lib/navigation.tsx` | tách `applyRbacFilter` + **`getSearchNavGroups`** (RBAC không collapse) | **AUD-05/IA-09** |
| `client/src/components/DashboardLayout.tsx` | ⌘K dùng `searchAccessibleGroups` (uncollapsed) | AUD-05 |
| `client/index.html` + `client/src/i18n/index.ts` | `<html lang>` động theo i18next (`languageChanged`) | **AUD-11** |
| `client/src/components/PollFreshness.tsx` | trung-tính khi tươi, amber chỉ khi stale (`staleAfterMs`) | AUD-08/ISA-101 |
| `client/src/components/FreshnessStrip.tsx` (**mới**) | socket-aware (`useSocketConnected`) · live/stale/polling/offline · as-of tuyệt đối · neutral-khi-live | **AUD-01/G8, FEA-F1** |

**Còn ở dạng SPEC (đợt sau, có review / sau GATE-1):** token oklch → index.css + remap severity; shell chrome rework (Sidebar, gỡ drag); alert-chip+drawer FLW-01; kiosk SCR-02; trục ISA-95 IA-10 (Increment-2); FEA-M/A badges; DEP-02/05/06/08.
*(i18n: `freshness.stale/asOf/asOfShort` dùng `defaultValue` fallback — thêm vào vi/en/zh locale là follow-up nhỏ.)*

---

## P8 — QA & Lộ trình
### QA Increment-1 (đã ship)
- **AUD-05**: Playwright mở ⌘K, tìm 1 trang collapsed (vd "golden sample"/"gguf")→ hiện + điều hướng đúng; rail vẫn ẩn row đó.
- **AUD-11**: `document.documentElement.lang` = 'vi' sau load; đổi ngôn ngữ → lang đổi theo.
- **PollFreshness/FreshnessStrip**: fresh→neutral, stale→amber, offline→muted; as-of tuyệt đối; đóng băng đúng khi socket drop (dùng chính harness `p1-live-triad.mjs` setOffline triad để chụp regression).
- **Regression**: `tsc --noEmit` + `vite build` xanh; các thay đổi additive/an toàn (không cờ, không đổi hành vi rail/API).

### Lộ trình
| Đợt | Nội dung | Gate |
|---|---|---|
| **Inc-1 (ship)** | ⌘K/AUD-05 · lang/AUD-11 · PollFreshness · **FreshnessStrip** + design-system spec | tsc+build |
| **Inc-1b** | ✅ ĐÃ SHIP primitive (additive, byte-identical): **token oklch→index.css** · **isaStateBadges** (PackML/E10/Andon/UnitMode — AUD-09) · **SafetyProvenanceLabel** (AUD-16) · **stateVocabulary**. CÒN (sau cờ `HMI_ISA101_V2` default-OFF): ✅ **cockpit op-state→PackmlStateBadge** (đã wire, byte-identical off) · severity remap AUD-08 (app-wide) · FreshnessStrip vào shell header · tile-desaturation FEA-F2 · alarm 4-field FEA-A1 | live Playwright panel-PC viewport |
| **Inc-2** | Trục ISA-95 scoped-query IA-10 (từng-trang, chưa-wire đọc "không-rõ") + shell chrome (Sidebar) + alert-chip/drawer FLW-01 + kiosk | **GATE-1 (3 operator thật)** |
| **DEP** | ✅ **ĐÃ SHIP (2026-07-19, mig 0296+0297 LIVE)**: **DEP-05** `genealogy.getFullHistory` tRPC (tái dùng `assembleRecord` REST) · **DEP-06** `master_alarms.cause` + join 4-trường ISA-18.2 (cause/consequence/TTR/priority) vào `machineAlarms`/`robotAlarms` (batch, fail-safe) · **DEP-08** `changeover_requests` + namespace `recipes.changeover` (request=operator inert/machine_monitoring · approve=actuation+2FA+**SoD approver≠requester**→`performDeploy` pure-extract từ recipes.deploy · reject bắt lý do). **DEP-02 Hermes/CFX = DEFER đến pilot**: Hermes là giao thức TCP máy-kề-máy cần THIẾT BỊ THẬT hai đầu (hệ chưa xuống xưởng — không có gì để bắt tay); CFX ingest seam đã có (OFF, inbound 4 msg) nhưng handshake-timeline cần thiết bị phát CFX thật; thêm cột from/toStation mà không nguồn nuôi = bề mặt giả-khả-năng, vi phạm honest-null. Khi pilot: CFX-first (seam sẵn), Hermes sau. | backend |

★ **GATE-1 chờ pilot line/operator** (hệ chưa xuống xưởng). Inc-1 an toàn nên ship trước; Inc-2 (xâm lấn) sau GATE-1.

---

## Phụ lục A (2026-07-19) — Audit NAVBAR TRÁI (AUD-N) + tiêu thụ DEP ở FE

### Audit [M] (đo bằng grep/inventory trên navigation.tsx + vi.json)
| Mã | Phát hiện | Số liệu |
|---|---|---|
| AUD-N1 | **Label quá dài**: 28/120 nhãn rail ≥20 ký tự (23%), 11 nhãn ≥26; tệ nhất 36 ("Vật tư tại line (Feeder/MSD/Stencil)"). Mẫu song ngữ "VN (English)" ×15; tiền tố lặp "Trung tâm…"×9, "Bảng…"×8, "Phân tích…"×6; "cockpit/hub" dịch 3 kiểu (Buồng lái/Xưởng/Trung tâm) | 120 item rail / 148 leaf |
| AUD-N1b | **8 label RAW-STRING** hardcode trong navigation.tsx (vi phạm chính quy tắc i18n của nav): control-tower, executive, war-room, sla-cockpit, routing, materials, comparison-studio (label+desc), factory-command… | 8 chỗ |
| AUD-N2 | "Thao tác mở vô nghĩa": `buildModuleL2` ĐÃ promote section 0/1-item thành link (rule ≥2) — vấn đề thật là **hub-launcher row → trang-menu-tiles (menu 2 tầng)** ×7 hub và **near-dup rows** (data-comparison đã bị Comparison Studio gộp nhưng vẫn chiếm row; "Bảng điều khiển" vs "Bảng điều hành" khác 1 chữ) | 7 hub · 2 cặp near-dup |
| AUD-N3 | Recent sidebar hiện 5 (user chốt: **3**) | slice(0,5) |

### Đã sửa (commit này)
| Fix | Chi tiết |
|---|---|
| Recent → **3** | `SidebarQuickAccess` slice(0,3); store giữ 5 cho ⌘K |
| **27 nhãn rút gọn** (vi, en/zh đồng bộ) | Bỏ ngoặc song ngữ; ≤20 ký tự mục tiêu. VD: "Trung tâm Điều hành (Control Tower)"→"Control Tower" · "Trung tâm Điều hành Hệ sinh thái"→"Trung tâm chỉ huy" · "Bảng điều khiển doanh nghiệp"→"Tổng quan tập đoàn" · "Phân tích nguyên nhân gốc"→"Nguyên nhân gốc" · "Buồng lái chất lượng"→"Cockpit chất lượng" (nhất quán cockpit) · "Bảng điều hành"→"Phòng vận hành" (hết va "Bảng điều khiển") |
| **7 raw-label → i18n key** | nav.controlTower/executiveMobile/warRoom/slaCockpit/routingMaster/materialsAtLine/comparisonStudio(+Desc) — thêm đủ vi/en/zh |
| **Collapse near-dup** | `/data-comparison` vào COLLAPSED_INTO_HUB (Comparison Studio đã gộp, gate khớp analytics_advanced; ⌘K vẫn tìm được nhờ IA-09) |
| GATE-1 note | Hub-2-tầng (row menu → trang tile-menu): cân nhắc deep-link thẳng tab nội dung đầu tiên của hub — đổi hành vi điều hướng, để GATE-1 |

### FE tiêu thụ DEP (commit này)
- **DEP-05 → UI**: tab Serial (`TraceabilityLineage`) thêm Card **"Hành trình xuyên trạm"** — timeline gộp chain ∪ AOI/AVI ∪ process ∪ lắp linh kiện từ `genealogy.getFullHistory` + chip vật tư + đếm nguồn (đóng nốt AUD-04 ở UI).
- **DEP-08 → UI**: `ChangeoverQueue` nhúng trong ProductChangeoverWizard — operator chọn recipe (`changeover.recipeOptions`, gate machine_monitoring — catalog metadata) + gửi yêu cầu + "Yêu cầu của tôi"; người duyệt thấy hàng đợi pending với Duyệt (lỗi 2FA/SoD hiện nguyên văn từ server) / Từ chối (≥3 ký tự); người không có quyền → panel tự ẩn (FORBIDDEN → hide, không toast).
- i18n mới: `freshness.* / cockpit.alarm* / trace.stationJourney* / changeover.*` ×3 locale.

## GIẢ ĐỊNH & PHỤ THUỘC
- **GĐ**: 7 vùng phủ hết ~207 route · `commandCenter.hierarchy` trả cây 5 tầng dùng được (nợ backfill machineType/site) · payload phần lớn có `lastEventAt` · DashboardLayout/Sidebar gánh được chrome.
- **DEP-02** Hermes/CFX handshake+WIP · **DEP-05** full genealogy tRPC · **DEP-06** field cause alarm · **DEP-08** changeover 2-người.
