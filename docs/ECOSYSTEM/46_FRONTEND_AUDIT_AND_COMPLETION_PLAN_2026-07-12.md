# 46 — AUDIT & KẾ HOẠCH HOÀN THIỆN FRONTEND SYNAPSE
## Đánh giá code + Playwright live từng chức năng theo 5 persona · Năng lực quản lý cao cấp · Lộ trình hoàn thiện

| | |
|---|---|
| Mã tài liệu | ECO-46 |
| Ngày | 2026-07-12 |
| Phương pháp | 6 agent song song: **4 Playwright drive LIVE** trên app đang chạy (localhost:3000) theo persona (supervisor/operator/maintenance/engineer) + **2 audit code** (kiến trúc FE + gap năng lực quản lý). Read-only, ~90 màn, screenshot bằng chứng. |
| Trạng thái | **BÁO CÁO ĐỂ REVIEW — chưa thực thi thay đổi nào** (tree sạch) |
| Bối cảnh | Sau khi thực thi trọn vẹn phần mềm doc 44 (16 commit W0-W7) + dựng hạ tầng Timescale/NATS/OpenBao |

---

## 0. TÓM TẮT ĐIỀU HÀNH

**Câu hỏi của bạn:** đã audit kỹ frontend (không chỉ code mà Playwright từng chức năng) chưa? đã xây các chức năng cao cấp hỗ trợ **quản lý** chưa? — và một báo cáo hoàn thiện với backend đã có.

**Trả lời ngắn:** Đã audit kỹ (6 agent, 4 drive live thật). Kết quả: **"vỏ" hệ sinh thái đã ở tầm thương mại trưởng thành (8/10 về hình thức), nhưng "ruột" chưa chảy** vì **3 nút thắt MÔI TRƯỜNG** (không phải chất lượng FE), và còn một số **bug FE thật** + **nợ kiến trúc**. FE ĐÃ có bộ chức năng quản lý rộng & thật (20+ màn điều hành production-grade), nhưng để đạt tầm Foxconn/Samsung cần **wire + hợp nhất** cái backend đã sẵn, không phải xây lại.

### Điểm số (thang 10, trừ ghi chú)

| Trục | Điểm | Ghi chú |
|---|---:|---|
| Hình thức chuyên nghiệp hệ sinh thái | **8.0** | Dark theme sang, App Launcher 11 SKU, i18n vi/en/zh, 404 sạch, tải <2s (3D twin 1.08s), brand SYNAPSE nhất quán tuyệt đối |
| Kiến trúc code FE | **6.5** | patterns kit phủ 186 file, nhưng app-shell hoist cờ-OFF (191 self-mount), 84 file hardcode màu, 35 monolith, i18n dup key |
| Hỗ trợ quản lý (management) | **76/100** | 20+ màn điều hành thật; gap = hợp nhất + wire semantic-layer/real-time/site-scope/SLA |
| UX persona Quản đốc (live) | **5.4** | Vỏ world-class, KPI OEE/yield/plan rỗng → chưa ra quyết định được |
| UX persona Vận hành (live) | **5.6** | Home + quick-action tốt; e-SOP chết live, andon no-ack, bug hiển thị |
| UX persona Kỹ sư (live) | **5.5** (e2e) / 7.0 (màn truy cập được) | Authoring (products/IR/POU) đẹp; twin bị chặn quyền, AI chat/codegen offline, thiếu data tune |
| **Chính trực dữ liệu** | **★ cao** | Gần như không bịa số — mọi chỗ rỗng đều honest-null ("—", "Not enough data"). Điểm cộng lớn với khách audit |

> **Vì sao UX live ~5.4-5.6 mà hình thức 8.0?** Vì **3 nút thắt môi trường** (§2) làm mọi màn "trông rỗng/chết" dù code + backend đã đúng. Sau khi gỡ 3 nút này (đa phần là thao tác vận hành/seed, không phải sửa FE), UX live dự kiến nhảy lên ~7.5-8.

---

## 1. PHƯƠNG PHÁP & PHẠM VI

- **Live Playwright**: đăng nhập thật 4 persona (operator1/maint1/supervisor1/engineer1 — qua session cookie API; admin bị khóa 2FA/429). Drive ~90 màn, ghi: load OK/lỗi, dữ liệu thật/rỗng/bịa, nút hoạt động/no-op, console error/HTTP 4xx-5xx, giá trị cho persona, điểm UX. Screenshot bằng chứng lưu scratchpad.
- **Audit code**: cấu trúc 196 trang + 288 component, adoption primitives, nợ kỹ thuật doc 39/42/43, RBAC, i18n, monolith.
- **Gap quản lý**: kiểm kê màn điều hành hiện có + đối chiếu chuẩn LDS-L5 / Ignition/AVEVA/Siemens/Tulip.

---

## 2. 🔴 BA NÚT THẮT MÔI TRƯỜNG (nguyên nhân gốc — KHÔNG phải lỗi chất lượng FE)

Đây là phát hiện quan trọng nhất. Đa số "màn chết/rỗng" mà 4 agent live gặp KHÔNG phải do FE kém, mà do 3 điều kiện môi trường chưa sẵn:

### 2.1 SERVER LIVE ĐANG CHẠY BUILD CŨ (predate doc 44) — P0 vận hành
- **Bằng chứng (2 agent độc lập xác nhận):** `sop.resolveActive`, `lineController.listStates`, `alarmKpi.summary`, `rum.report` đều trả **404** live, trong khi `machine.list`/`factoryCommand.overview` chạy tốt. Các router này CÓ trong source + đã đăng ký (`routers.ts` sop/lineController/alarmKpi + `rumRouter`) → **server chưa restart/rebuild sau các commit doc 44 W0/W3/W6**.
- **Hệ quả:** 3 tính năng MỚI được yêu cầu audit (**Line View, Alarm KPI ISA-18.2, e-SOP viewer**) đều "chết 404" live — nhưng code đúng, migration đã áp. Đây là **ảo giác do stale server**, không phải FE hỏng.
- **Khắc phục:** rebuild + restart server (`npm run build` + restart dev/prod). Sau đó 3 màn này hoạt động.

### 2.2 FULL-SIM CHỈ SINH TẦNG MÁY/BẢO TRÌ — chưa sinh tầng SẢN XUẤT/CHẤT LƯỢNG — P1 dữ liệu
- **Bằng chứng:** MỌI KPI hiệu suất (OEE, yield, throughput, output, NG, FPY, plan-vs-actual, SPC trend) = **0/"—"** ở tất cả màn quản lý (supervisor-home, factory-command, war-room, oee-dashboard, production-dashboard, quality-cockpit, corporate-dashboard). Nhưng tầng **máy/bảo trì có số thật**: 3 chạy/20 chờ, 25 vấn đề live, downtime 1198 phút, 12 work-order PdM auto-gen, failure-risk %.
- **Nguyên nhân:** Full-Sim (doc 40/41) sinh status/downtime/andon/WO nhưng KHÔNG sinh inspection→serial→OEE/yield; cũng chưa nạp **kế hoạch ca** (plan) → Plan-vs-Actual luôn rỗng.
- **Hệ quả:** quản đốc thấy "máy hỏng/offline" nhưng KHÔNG trả lời được câu cốt lõi "**tuyến có đạt kế hoạch không? OEE? yield?**" — đúng phần cần nhất. War-room/OEE/production dashboard "vỏ đúng chuẩn, ruột rỗng".
- **Khắc phục:** mở rộng Full-Sim sinh tầng sản xuất/chất lượng (inspection results → serial genealogy → OEE/yield rollup) + seed kế hoạch ca. (Backend semantic layer/oeeService đã sẵn — chỉ thiếu DỮ LIỆU đầu vào.)

### 2.3 MODEL AI SINH (LLM) ĐANG OFFLINE — chỉ embedding chạy — P1 tính năng
- **Bằng chứng:** Programming Copilot trả "AI code model offline — no suggestion (fail-safe)"; AI Chat không có ô nhập; **AI Auto Executive Summary xuất RÁC** ("cell cell cell…" ×hàng nghìn, trộn CN/EN — model degenerate loop). RAG grounding vẫn THẬT (trích đúng trang sổ tay Delta/Omron) → embedding chạy, LLM sinh không nạp.
- **Hệ quả:** AI chat/codegen không dùng được; báo cáo điều hành AI là gibberish (rủi ro uy tín cao — đập vào mắt quản lý).
- **Khắc phục:** nạp/warm model GGUF sinh (Qwen3) trên máy AI + **thêm guardrail chống degenerate-loop** (giới hạn độ dài + phát hiện lặp token + fallback template khi model loop). *(Ghi chú: fail-safe "no suggestion" là đúng — không bịa code — điểm cộng; nhưng exec-summary loop cần chặn.)*

> **Kết luận §2:** ~60% cảm giác "rỗng/chết" của bản audit live đến từ 3 nút thắt này. Gỡ chúng (restart server + prod-sim + AI model+guardrail) sẽ nâng UX live từ ~5.5 lên ~7.5-8 mà **gần như không đụng code FE**.

---

## 3. 🐞 BUG FRONTEND THẬT (độc lập với §2 — cần sửa dù môi trường có sẵn)

| # | Bug | Persona | Mức | Chi tiết |
|---|---|---|---|---|
| B1 | **Failure risk 6800% / 600%** | operator | P1 | Cockpit hiển thị xác suất >100% — bug tính/normalize (không clamp [0,100]). Lộ ra trước công nhân → mất tin số liệu |
| B2 | **Telemetry tags = "[object Object]"** ×4 | operator | P1 | Bug render — object không stringify. Machine cockpit |
| B3 | **Nút "Thêm/Add product" bị che, unclickable ở ≤1600px** | supervisor/engineer | P1 | doc 42 P0 #3 **VẪN CÒN** dạng bug layout — card panel phải đè lên CTA; chỉ click được ở 1920px. Chặn luồng tạo sản phẩm ở laptop phổ biến |
| B4 | **Machine Health aggregate 0/0/0 dù có máy thật + WO PdM** | maintenance | P1 | `/device-monitor?tab=health` list rỗng vô lý — aggregate không wire |
| B5 | **Work-orders "View Only" dù maintenance-home hứa tạo/đóng** | maintenance | P1 | Mâu thuẫn: landing quảng bá "Create, assign, close" nhưng trang 0 nút hành động |
| B6 | **Andon: operator không có nút ack + đếm mâu thuẫn** | operator | P1 | Board 4 andon đỏ nhưng operator không ack được; "OPEN ANDONS 4" vs "Alerts 0" |
| B7 | **AI Chat không render ô nhập** | engineer | P1 | Trang load, có prompt gợi ý nhưng **không có textbox** → không gõ/gửi được (một phần do §2.3, nhưng thiếu input là FE) |
| B8 | **Báo động giả "36 Low Yield Stations"** | supervisor | P2 | Gắn cờ low-yield cho cả 36 trạm chỉ vì 0% (no-data), không phải kém thật → nhiễu cảnh báo. Cần phân biệt "0% do thiếu data" vs "kém thật" |
| B9 | **RBAC over-centralized — single-admin bottleneck** | supervisor/engineer | P1 | Supervisor bị chặn **100% Data Management + Administration**; engineer bị chặn Twin/simulation (golden-thread gãy — Hub quảng bá "simulate" nhưng link twin = Access Denied) + view-only trên đúng bề mặt config họ sở hữu (defect-catalog/threshold/NG-rate/ECN). Cần xem lại ma trận quyền per-persona |
| B10 | **Responsive 768 (tablet) tràn ngang** | cross | P2 | Sidebar không auto-collapse (giữ ~260px) → overflow + cắt chữ stat card. Desktop-first |
| B11 | **Offline reload = màn trắng** | operator | P2 | Có OfflineBanner nhưng KHÔNG timestamp "dữ liệu cũ HH:MM", không hàng đợi offline, reload lúc rớt mạng = trắng (thiếu service worker/offline shell) |
| B12 | **i18n lẫn lộn** | cross | P2 | Operator EN nhưng nhiều chuỗi hardcode VN ("Gọi bảo trì", "Đang chạy"); ZH thiếu vài menu ("Giao ban", "Đổi sản phẩm"); **JSON dup key `signOff/signoff`** + 3 file `.bak` lẫn repo |
| B13 | **RUM `rum.report` 404 mỗi trang** | cross | P2 | 1 console error thường trực (một phần stale-server §2.1 — endpoint mới) |
| B14 | **"Gọi bảo trì" 1-tap không confirm/undo** | operator | P2 | Gọi `andon.raise` NGAY → chạm nhầm spam đội bảo trì |
| B15 | **Onboarding "Welcome!" modal che nút mỗi lần vào /operator** | operator | P3 | Chặn thao tác chạm đầu tiên |
| B16 | **404 page lệch tông brand** | cross | P3 | Nút xanh dương + nền sáng, lệch teal/dark SYNAPSE (render ngoài app-shell) |

---

## 4. 🏗️ NỢ KIẾN TRÚC FE (từ audit code, có file:line)

| Nợ | Trạng thái | Chi tiết |
|---|---|---|
| **App-shell hoist** (1 shell bền, doc 39 W1b) | 🟡 CODE XONG, **CỜ OFF** | `appLauncherFlag.ts:50` `VITE_APP_SHELL_PERSISTENT` default OFF → **191 trang vẫn tự mount `<DashboardLayout>`** (remount chrome mỗi điều hướng). Flip cờ sau smoke = **ROI cao nhất** |
| **Màu canonical** (doc 44 W6) | 🟡 phủ ~½ | `canonicalStatusColor.ts` là nguồn chuẩn wired StatusBadge (73 file), nhưng **84 file còn hardcode `bg-{red,green,...}-500` (320 lần)** |
| **RBAC hardgate `role==='admin'`** | 🟡 còn ~13-15 điểm tính năng | Nền `hasPermission()` đúng chuẩn; còn sót ProductModels:4024/4372, DataSettings:77, LicenseManagement, WorkstationManagement, MeasurementPointHealth... |
| **Monolith >1000 dòng** | 🔴 còn **35 trang** | ApiDocs 6818, ProductModels 4818, History 3220, Dashboard 3028, DataSettings 3015... |
| **Primitives doc 39** | 🟡 phân mảnh | patterns kit 186 file ✅; nhưng DataTable ~13 trang, AsyncBoundary 10, FilterBar 6, **FormScaffold 3 (chết)**; virtualization ~2 trang |
| **SQL-leak humanizer** | 🟡 15/269 mutation file | `trpcErrors.ts` chặn tốt (không thấy leak live) nhưng chưa phủ toàn app |
| **Real-time WS** | 🔴 thấp | `unsStreamClient` 1 trang; hook `useRealtimeDashboard` (xây W2-B) **không dùng ở đâu**; 49 file vẫn poll |
| **Semantic layer ra FE** | 🔴 0 consumer | backend `semanticsRouter`/OEE@v1 xong, **FE không màn nào gọi** `trpc.semantics` / hiển thị `definition_version` |
| **i18n** | 🟡 mạnh nhưng có bug | 13.6k key × 3 near-parity ✅; dup key `signOff/signoff`, 3 file `.bak` |

**doc 42 P0 status (xác nhận):** UPDATE master-data (EntityDialog zod-safe) ✅ đã vá source · SQL-leak toast ✅ đã vá (không thấy leak live) · nút "Thêm" ⚠️ **CÒN** (B3 layout occlusion). *Không verify live được MasterDataManagement vì RBAC khóa mọi session ngoài admin (B9).*

---

## 5. 📊 NĂNG LỰC QUẢN LÝ — ĐÃ CÓ GÌ & THIẾU GÌ (76/100)

### 5.1 ĐÃ CÓ (20+ màn điều hành THẬT, production-grade)
CommandCenter (cây Site→Máy + 3D + WS) · FactoryCommandView (2D/3D + drawer) · DrillDownDashboard (4 cấp) · MESControlTower (WIP/genealogy/orders 6 tab) · WarRoom (giao ban A/P/Q + so ca + top-5 downtime) · OpsConsole (5-nguồn cảnh báo + MTTA) · CorporateDashboard + CorporateLayout (đa nhà máy) · **FederationDashboard (đa-SITE thật)** · ManagementInsight (AI Q&A + exec summary) · OEEDashboard (SEMI E10) · **LineView (FSM 7 trạng thái)** · **AlarmKpiDashboard (ISA-18.2)** · TraceabilityLineage (genealogy 2 chiều) · ProductionDashboard · **SopViewer/Management (e-SOP)** · AndonBoard · Reports/PDF/PPT/ReportBuilder/Scheduled (cron đa kênh + VN-font) · 7 persona home.

### 5.2 GAP — 12 năng lực quản-lý-cao-cấp (backend sẵn → chỉ thiếu FE = đòn bẩy cao)

| Năng lực | Trạng thái | Ghi chú |
|---|:--:|---|
| Control Tower 1-cửa | 🟡 | 6 màn command chồng lấn, không 1 điểm vào exec |
| Drill-down phân cấp nhất quán | 🟡 | 2 hiện thực khác nhau (quality vs status); thiếu cấp "Khu" |
| So sánh đa chiều (tuyến/ca/SP/thời kỳ) | 🟡 | phân tán, chưa 1 công cụ chung + benchmark |
| SLA phản hồi (MTTA+MTTR+escalation) | 🟡 | 3 nơi rời (OpsConsole/WorkOrder/MqttAlertRules), không 1 cockpit |
| Báo cáo điều hành tự động | ✅ | cron đa kênh + VN-font server; ⚠️ 1 đường jsPDF-client rủi ro mojibake VN |
| Multi-site/federation | ✅ | có; nhưng **site-scope chỉ Federation dùng**, dashboard khác không lọc theo site |
| Genealogy 2 chiều | 🟡 | lô+serial ✅; **thiếu carton/pallet (IPC-1782)**; search chưa lưu |
| **KPI semantic nhất quán (OEE 1 định nghĩa)** | 🟠 | **backend xong, FE 0 consumer** — không lộ `definition_version`/lineage |
| Quyết-định-hỗ-trợ AI | ✅ | ManagementInsight + Inbox (khi model online) |
| Mobile exec view | 🟡 | FactoryAlertSystem thiên alert, chưa exec-KPI/approvals |
| Persona (6 vai LDS-L5) | 🟡 | 7 home + RBAC; SupervisorHome mỏng |
| Real-time đều | 🟡 | WS ở 6 màn; nhiều màn line/monitor vẫn poll |

---

## 6. 🚀 KẾ HOẠCH HOÀN THIỆN FRONTEND (đề xuất — chờ duyệt)

Nguyên tắc: (1) gỡ nút thắt môi trường TRƯỚC (rẻ, mở khóa phần lớn giá trị); (2) sửa bug thật; (3) wire cái backend đã sẵn ra FE (đòn bẩy cao); (4) hợp nhất + hardening; (5) nợ kiến trúc. Mỗi đợt green-gate + verify live.

### FE-W0 — Gỡ 3 nút thắt môi trường (≈1-2 ngày, chủ yếu vận hành/seed)
- **Rebuild + restart server** → mở khóa Line View / Alarm KPI / e-SOP / RUM (§2.1). *(Verify lại 3 màn này live sau restart.)*
- **Mở rộng Full-Sim sinh tầng sản xuất/chất lượng** (inspection→serial→OEE/yield) + seed kế hoạch ca (§2.2) → mọi dashboard quản lý có số.
- **Nạp model AI sinh + guardrail degenerate-loop** (§2.3) → AI chat/codegen/exec-summary chạy thật, hết gibberish.
- **Nghiệm thu:** re-drive supervisor/operator/engineer live → KPI có số, 3 màn mới 200, AI trả lời được.

### FE-W1 — Sửa bug FE thật (≈3-5 ngày)
- B1 clamp failure-risk [0,100] · B2 stringify telemetry tags · B3 fix layout nút Add (≤1600px) · B4 wire machine-health aggregate · B5 work-order actions theo quyền · B6 andon ack cho operator + đồng bộ counter · B7 AI chat input box · B8 phân biệt no-data vs low-yield · B14 confirm "Gọi bảo trì" · B15 welcome-modal 1 lần · B13 rum 404 (đóng bởi W0 restart).
- **Nghiệm thu:** không còn số vô lý (>100%, [object Object]); mọi CTA quảng bá đều dùng được.

### FE-W2 — Wire backend-đã-sẵn ra FE (đòn bẩy cao nhất, ≈1-2 tuần)
- **Lộ semantic layer**: mọi KPI kèm `definition_version` (OEE@v1) + link định nghĩa/lineage; trang **Metric Catalog** (gọi `trpc.semantics`).
- **Real-time phủ đều**: adopt `useRealtimeDashboard`/`uns:subscribe` (đã xây) vào LineView/OEE/Production/WarRoom/DrillDown/AlarmKpi — bỏ poll.
- **Multi-site scope xuyên suốt**: `SiteContext` lọc MỌI dashboard quản lý, không chỉ Federation.
- **Cockpit SLA 1 màn** (MTTA+MTTR+escalation-breach).
- **Export font-safe thống nhất** (bỏ jsPDF-client, selector đa ngôn ngữ).
- **Virtualization fleet-scale** (DataTable virtual cho fleet/WIP/alarm-history/genealogy) + đo P95 ≤2s (web-vitals đã có).

### FE-W3 — Chức năng quản lý cao cấp mới (≈2-3 tuần)
- **Executive Control Tower 1-cửa** (hợp nhất 6 màn command chồng lấn, cấu-hình-theo-persona).
- **Drill-down phân cấp thống nhất** Nhà máy→Khu→Tuyến→Trạm→Máy (hòa giải 2 hiện thực + đưa LineView/cockpit vào đường drill).
- **So sánh đa chiều** (tuyến/ca/SP/thời kỳ + benchmark) 1 công cụ.
- **Genealogy carton/pallet** (IPC-1782) + forward-search lưu được.
- **Executive mobile/PWA view** (OEE/KPI briefing + AI summary + approvals).

### FE-W4 — Nợ kiến trúc + hardening (≈1-2 tuần)
- **Flip app-shell hoist** sau smoke (ROI cao) → hết remount 191 trang.
- **Codemod màu status** 84 file → canonical + ESLint rule cấm hex-status.
- Đóng ~13-15 RBAC hardgate → `hasPermission`.
- Tách 5 monolith đầu bảng (ApiDocs/ProductModels/History/Dashboard/DataSettings).
- Phổ cập `toastTrpcError` toàn mutation; chuẩn hoá 1 bộ primitive (khai tử FormScaffold/FilterBar gốc).
- Sửa i18n dup-key + xoá .bak + CI parity/no-dup-key + quét chuỗi VN hardcode.
- Responsive tablet (sidebar auto-collapse); offline shell (service worker + timestamp "dữ liệu cũ HH:MM"); 404 theo brand.
- **Rà soát ma trận RBAC per-persona** (mở master-data cho supervisor, twin/config cho engineer — B9).

---

## 7. ❓ CẦN BẠN QUYẾT (trước khi thực thi)

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| D1 | Ưu tiên thứ tự? | **FE-W0 (gỡ nút thắt) → W1 (bug) → W2 (wire backend) trước** — cho ROI thấy được ngay; W3/W4 sau |
| D2 | Full-Sim sinh tầng sản xuất — chấp nhận seed dữ liệu giả để demo/quản lý thấy KPI? | Nên (dữ liệu sim rõ nhãn "SIM"), vì đó là cách duy nhất demo năng lực quản lý khi chưa có máy thật |
| D3 | Ma trận RBAC: mở Data Management cho supervisor + Twin/config cho engineer? | Nên xem lại — hiện single-admin bottleneck cản cả vận hành lẫn kỹ sư |
| D4 | Executive Control Tower 1-cửa: hợp nhất 6 màn hay giữ song song? | Hợp nhất (giảm sprawl) nhưng giữ deep-link màn cũ 1 thời gian |
| D5 | Mức đầu tư exec-mobile (PWA vs mở rộng RN app)? | PWA exec-view (1 codebase React, nhanh) trước; RN app giữ cho alert 24/7 |

---

## PHỤ LỤC — Điểm mạnh nổi bật (giữ nguyên)
- **Chính trực dữ liệu** (honest-null khắp nơi — không bịa số): tài sản lớn nhất với khách audit.
- **Brand SYNAPSE nhất quán tuyệt đối** (0 Continuum/avi-aoi lộ UI; "AOI" chỉ còn là thuật ngữ loại máy).
- **Factory Command 2D/3D + drawer 4-tab** (WebGL mượt, đại tu 3D doc 40 có thật).
- **War-room đúng chuẩn giao ban** Foxconn/Samsung (A/P/Q + so ca + top-5 downtime + TV mode).
- **ProductModels doc 43** giải quyết "cấu hình quá nhiều gây bối rối" (4 tab + accordion + readiness score + ảnh PCB overlay).
- **IR Editor + POU Studio**: programming cấp hệ sinh thái (drag-drop + lint + transpile + diff/merge + **safety framing HITL 2-eyes xuất sắc**).
- **KHÔNG rò raw DB-ID** ở bất kỳ form nào (dùng mã người-đọc-được — EntityPicker).
- **RAG grounding thật** (trích đúng trang sổ tay vendor).
- **App Launcher 11 SKU + scope-theo-app**, i18n vi/en/zh không lộ key thô, 404 sạch, perf <2s.
- **doc 42 P0 UPDATE + SQL-leak đã vá** ở source (EntityDialog zod-safe + humanizer).

---

*Báo cáo lập từ 6 agent audit (4 Playwright live + 2 code), 2026-07-12. Read-only — 0 thay đổi code (1 sửa lỡ của agent đã revert; tree sạch). Kế hoạch FE-W0..W4 CHỜ DUYỆT + 5 quyết định D1-D5.*
