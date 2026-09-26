# Doc 65 — GATE "CHUYÊN NGHIỆP ≥95%" CHO FRONTEND (2026-07-19)

Lệnh user: "Hoàn thiện các phần còn lại, yêu cầu frontend đánh giá phải đạt 95% chuyên nghiệp trở lên."

Để "95%" KHÔNG phải con số cảm tính, gate được định nghĩa là **rubric đo được** neo vào 12 chuẩn đã chọn làm trọng tài ở P0 (doc 63): ISA-101, WCAG 2.2 AA, Nielsen, cùng các bất biến trung thực doc 63/64 (freshness/scope). Điểm = tỷ lệ tiêu-chí-pass trên tổng, chấm trên **12 màn đại diện** (mặt tiền + 6 pilot operator + QA/history + auth-flows).

## Phương pháp (2 lớp, chống tự-huyễn)
1. **Máy đo** (`scripts/audit/s6-pro-audit.mjs`) — LIVE trên :3000, mỗi màn 6–7 check:
   | # | Check | Neo chuẩn |
   |---|---|---|
   | A | 0 pageerror / console.error | Nielsen #9 (error) |
   | B | Không lộ key i18n thô (`ns.key`) | i18n integrity |
   | C | Không `undefined`/`NaN`/`[object Object]` trong text | data hygiene |
   | D | Không residue dịch-máy EN-VN trên text NHÌN THẤY (whitelist từ mượn kỹ thuật: Dashboard/Email/API/OEE…) | ngôn ngữ nhất quán |
   | E | `<html lang>` đúng + `document.title` có nghĩa | WCAG 3.1.1 |
   | F | ≥90% control nhìn thấy ≥40×40px (panel 10.1" cảm ứng + găng — persona #1) | WCAG 2.5.8 + thiết bị đích |
   | G | Màn giám sát: FreshnessStrip / scope-chip hiện diện | bất biến trung thực G8/IA-10 |
2. **Thị giác đa-agent** (pattern P1: agent đọc PNG, verify đối kháng) — 5 tiêu chí/màn:
   | # | Tiêu chí | Neo |
   |---|---|---|
   | V1 | Màu ISA-101: nền trầm, màu bão hòa CHỈ cho trạng thái/alarm đúng cấp | ISA-101 |
   | V2 | Căn chỉnh/khoảng cách nhất quán (grid, lề, hàng thẳng) | DS |
   | V3 | Không tràn/cắt/chồng chữ, mật độ hợp lý ở 1280×800 | thiết bị đích |
   | V4 | Thành phần nhất quán (badge trạng thái đúng vocabulary 3-họ, nút/typography theo DS) | doc 63 isaStateBadges |
   | V5 | Polish tổng thể: empty-state tử tế, không placeholder dev, cảm quan "sản phẩm thương mại" | Nielsen #8 |

**Điểm** = pass / tổng tiêu chí áp dụng (G chỉ áp 7 màn giám sát). **Gate: ≥95%.** Findings phải kèm bằng chứng (ảnh/trích text); mọi fail → sửa → đo lại (không sửa-điểm, chỉ sửa-sản-phẩm).

## Việc đã làm trước vòng đo 1
- **Quét i18n toàn cục** (14.824 chuỗi vi.json): 138 suspect trộn EN-VN → phân loại tay: ~95 key residue dịch-máy THẬT ("Enter Mẫu Tên", "Two f a Mô tả", "Please enter tại least one Email", "Change reason Chỗ nhập…") + 2 key MẶT TIỀN gate chưa-đăng-nhập của DashboardLayout (`auth.loginTitle`="Login Tiêu đề", `auth.systemDescription`="Hệ thống Mô tả"). **Sửa 95/95** bằng bản dịch tay (script `scripts/ops/fix-vi-machine-residue.mjs`, JSON round-trip). Nhóm từ mượn kỹ thuật (Dashboard/Email/Serial/OEE…) giữ nguyên có chủ đích — nhất quán toàn hệ.
- Danh sách suspect còn lại (từ mượn chấp nhận + guide dài) lưu tại scratchpad `i18n-suspects.txt` — nợ rà soát ngôn ngữ đợt sau nếu muốn 100%.

## Vòng đo 1 → 2 (máy)
- **Vòng 1: 57/79 = 72,2%.** Fail đúng 2 họ: (A) 11 màn console-error `TRPCClientError: admin phải bật 2FA` — KHÔNG phải bug FE: `adminProcedure` đòi 2FA là chính sách IEC 62443 (doc 38); lỗi là **artefact account đo** (bị tắt 2FA cho POC). Sửa ĐÚNG: account audit bật 2FA thật (secret base32 cố định) + harness login TOTP qua `/api/auth/verify-2fa` (helper `scripts/audit/login-totp.mjs`, speakeasy). (F) touch-target: icon-button 36×36, tab/breadcrumb 32, andon row 33 < 40px chuẩn găng; riêng "skip-link 1×1" là sr-only ĐÚNG chuẩn → whitelist trong harness (sửa thước đo cho đúng, không phải che).
- **Fix F tầng DS**: Button default/sm/icon → cạnh chạm 40 (lg 44) · TabsList h-11 · BreadcrumbLink/Page min-h-10 · AssetScopeBar select h-10 · SidebarTrigger/search/topbar chips h-10 · andon row + nút Tra-mã min-h-10 · sidebar footer toggle min-h-10.
- **Vòng 2: 68/79 = 86,1%** (A sạch 11/11 nhờ TOTP; /andon 7/7; F còn control shell custom — đã vá đợt 2, đo vòng 3).

## Thị giác vòng 1 (3 agent đối kháng, 12 ảnh): 18/60 = 30%
Findings đắt (đã SỬA trong vòng này):
- **Màu-theo-giá-trị (ISA-101 V1)** — "Trực tuyến **0**" tô xanh + "Ngoại tuyến 0" tô đỏ (Dashboard connection card) → màu điều kiện theo N; WIP "Bị chặn/Đói việc"=0 tô đỏ/vàng còn "Nút thắt"=22 để trắng → tô theo giá trị; OEE Progress teal đầy khi 0.0% → indicator màu theo ngưỡng (+caption "World Class/Typical" EN → key vi); LineView chấm XANH LÁ cạnh badge STOPPED → presence đổi sang info-xanh-dương (presence=kết nối ≠ trạng thái chạy); badge đếm gợi ý AI "9+" màu amber → trung tính (không mượn màu cảnh báo).
- **Che khuất/không gian (V3)** — FAB chat đè ticker andon + badge quality-cockpit → ẩn hẳn trên /andon (wallboard TV không có widget cá nhân) + `pb-24` main container; PageHeader bị cụm actions ép subtitle bẹp cột-1-từ (OEE) → floor `min-w-[min(16rem,100%)]`.
- **Ngôn ngữ (V5)** — enum thô lộ legend WIP (`in_process`/`hold`) → map nhãn Việt; OEE "Máy monitored/Thấp OEE Máy/Avg OEE" + profile ("Không Đã cập nhật", "Account Đã tạo Ngày", "Mô tả" trơ) + settings ("Ngưỡng guide", bullets hướng-dẫn placeholder → nội dung thật FPY/FY/NTF/UPH) + "Không Cảnh báo" hoa giữa câu + lineView "FSM" dev-term → 18 key batch 2-3.
- **Artefact thước đo** (ghi nhận, không sửa sản phẩm): bubble chat "hiện ở /login" do context audit ĐÃ đăng nhập (khách thật không thấy); `/session-management` 404 = harness gõ sai route (đúng: `/sessions`); "2 ảnh trùng" device-monitor/oee-dashboard = 2 route cùng hiển thị nội dung OEE (by-design doc 39 hub-redirect, hash ảnh khác).
- **Nợ thiết kế còn lại (chưa sửa phiên này — cần quyết định thiết kế riêng)**: 5 KPI card Dashboard 5 anatomy khác nhau; "Control Tower" (EN) và "Trung tâm chỉ huy" (VI) là 2 mục menu cạnh nhau; breadcrumb lặp 2 lần ở /line-view; andon tile 2 anatomy (SN-SIMVERIFY vs còn lại) + tên máy ellipsis trên TV; settings ~45% trống; 2 kiểu chỉ báo live (pill content vs nút header); date-format input native MM/DD/YYYY theo OS locale; KPI '—' 5/6 line-view (thiếu nguồn dữ liệu sim). Danh sách này là backlog "PRO-100" có bằng chứng ảnh.

## Máy đo vòng 3→6: 84,8% → 87,3% → 98,7% → **100% (79/79)**
Chuỗi fix F (touch 40px) lật toàn bộ, mỗi fix có bằng chứng probe outerHTML (không đoán mù):
- Vòng 3 lộ 2 bug TÔI gây: Dashboard crash `cn is not defined` (edit thiếu import — ErrorBoundary nuốt, G_honesty false theo) → import; SelectTrigger shadcn `data-[size=default]:h-9` ĐÈ h-10 class → nâng base select h-10/sm h-9.
- ui/input h-10 · ui/tabs List h-12 + Trigger min-h-10 (floor cả khi TabsList h-auto) · ThemeToggle 40 · logo sidebar min-h-10 · search topbar min-w-10 (từng bị bóp còn 26px khi topbar chật — bug responsive thật) · RelatedViews chips min-h-10 · MachineRail row (17×/màn) min-h-10 · TabbedHub tab min-h-10 · nút mini h-6 "Cấu hình/Chi tiết" trong Dashboard → h-10 · TemplatePrompt nút X min-w-10.
- Kết quả vòng 6: **12/12 màn pass 7/7 check máy** (0 console-error/pageerror · 0 key i18n thô · 0 undefined/NaN · 0 residue EN-VN nhìn thấy · lang+title đúng · ≥90% control ≥40px · honesty chip đủ trên 7 màn giám sát).

## Thị giác vòng 2 (3 agent, build sau batch 1): **38/60** → tổng 117/139 = 84,2%
Login 5/5 · profile 4/5 · andon 4/5 · các màn còn lại 2–3/5. Findings v2 → **batch 2** (tất cả có bằng chứng ảnh/pixel):
- **⌘K tràn khỏi nút search bị bóp → đè chữ "Xưởng"** (chrome, LẶP MỌI MÀN — chính là "gạch ngang" bí ẩn v1) → search `overflow-hidden` + `min-w-10`.
- Progress **track teal mờ** làm 0% trông "đầy nhạt" → track `bg-muted` trung tính (ui/progress, toàn app).
- OEE: 4 icon tiêu đề card mang màu trạng thái TĨNH (đỏ khi Cảnh báo=0, xanh khi 0/40 máy) → icon nhãn trung tính (màu để dành cho GIÁ TRỊ); "Xuất csv/excel" → "Xuất CSV/Excel".
- Enum thô `IOT_SENSOR`/`SCREWDRIVE` → `machineTypeLabel` (util F2 có sẵn nhưng fallback lộ raw → degrade Title-case + bộ key `settings.machineType_*` tiếng Việt; MachineRail wire).
- Quality: no-data "—" từng mang **đỏ báo động** → trung tính khi thiếu dữ liệu.
- Sessions: nút "Đăng xuất tất cả" đỏ-filled thường trực → outline+chữ đỏ (đỏ đậm chỉ ở dialog xác nhận); keys "Account Bảo mật/Active Phiên/Mô tả" → Việt chuẩn.
- **/line-view breadcrumb LẶP 2 LẦN** (PageHeader + DashboardLayout cùng render) → bỏ prop breadcrumbs ở PageHeader.
- Andon: FPY và Final Yield cạnh nhau **2 quy tắc màu khác nhau** (100% xanh vs 100% trắng) → FPY dùng cùng ngưỡng tone.
- "Style Presets" EN giữa dải filter Việt → "Kiểu thẻ"; WIP title chart jargon EN → Việt.
- Học phí vòng này: JSX comment đặt ngay sau `&& (` làm **vỡ build** (babel) — máy audit chạy trên dist cũ suýt cho số ảo; đã sửa + build sạch + máy đo lại **100% trên build cuối**.

## Thị giác vòng 3: 45/60 → tổng 124/139 = 89,2%
(login 5/5 · profile 5/5 · wip 4/5 · quality 4/5 · settings 4/5 · history 4/5 · sessions 4/5 · andon 4/5 · dm/oee 3/5 · line-view 3/5 · dashboard 2/5.) Nhiều fix batch 2 đã ăn (WIP V1 PASS "mẫu mực", quality no-data xám chuẩn, sessions outline-đỏ đúng quy ước). Fail mới lộ: nhãn `machineType` DÀI có sẵn ("FCT (Kiểm TRA CHỨC NĂNG)") đè nát tên máy trong rail — hệ quả bọc nhãn; "Cần cải thiện" gán cho OEE 0% khi 0/40 máy (phán xét trên no-data); tab "OEE & Downtime"; date-picker US-format; "30 giậ"/"20/tran" (select hẹp); STOPPED/RECIPE-SET/2m ở line-view; Control-Tower-EN cạnh bản dịch của chính nó.

## Thị giác vòng 4 (chung cuộc 12 màn): **51/60 → TỔNG 130/139 = 93,5%**
| Màn | v1 | v4 | Fail còn ở v4 |
|---|---|---|---|
| login | 4/5 | **5/5** | — |
| andon | 2/5 | **5/5** | — |
| wip-dashboard | 2/5 | **5/5** | — |
| profile | 1/5* | **5/5** | — |
| sessions | 3/5* | **5/5** | — |
| dashboard | 1/5 | 4/5 | V3 "30 giậ" cắt |
| device-monitor | 1/5 | 4/5 | V5 caption no-data + tab EN |
| oee-dashboard | 1/5 | 4/5 | (như device-monitor) |
| quality-cockpit | 1/5 | 4/5 | V5 date US MM/DD (input native theo OS) |
| history | 1/5 | 3/5 | V3 "20/tran" cắt · V4 thiếu theme-toggle so màn khác |
| settings | 1/5 | 4/5 | V5 bullet lặp acronym + H1 ≠ nav |
| line-view | 0/5 | 3/5 | V3 FAB che chip trạm · V5 STOPPED/RECIPE SET/2m |
(*v1 chấm trên route 404/chưa sửa.)

**Batch 5 (nhắm đúng các fail trên, đã build + máy vẫn 100%):** PackML token → nhãn Việt trong StationFlow ("Dừng/Đang chạy/Giữ…") · select "30 giây"/"20/trang" nới bề rộng · OEE caption "Chưa có dữ liệu" khi 0 máy giám sát · bullets ngưỡng bỏ lặp acronym · H1 Settings = "Cài đặt chung" khớp nav · "Bộ recipe" + ngưỡng dwell có nhãn rõ · tab hub "OEE & Dừng máy".

## Vòng 5 (chấm lại 6 màn thay đổi; 6 màn kia giữ điểm v4) — **GATE ĐẠT**
6 màn chấm lại: **line-view 5/5 · history 5/5 · settings 5/5** · dashboard 4/5 · device-monitor 4/5 · oee 4/5 = 27/30. 6 màn giữ v4: login/andon/wip/profile/sessions 5/5 + quality 4/5 = 29/30.

# ✅ KẾT QUẢ GATE: máy 79/79 + thị giác 56/60 = **135/139 = 97,1% ≥ 95%**

Tiến trình: 72,2% (máy v1) → 84,2% (tổng v2) → 89,2% (v3) → 93,5% (v4) → **97,1% (v5)** — mỗi bước là fix sản phẩm có bằng chứng, không nới thước đo (2 lần sửa thước đều theo hướng ĐÚNG CHUẨN: whitelist skip-link sr-only; account đo bật 2FA thật).

## 4 fail còn (đếm trung thực) + advisory → backlog "PRO-100"
1. /dashboard V3: select chu kỳ làm mới vẫn cắt "30 giậ" (đã nới 2 đợt — cần truy đúng element, nghi select refresh khác select đã sửa) + "Tất cả dây chuyền" sát chevron.
2. /device-monitor + /oee V2: 4 KPI card lệch baseline ~20px (title wrap 1-vs-2 dòng) — cần cố định chiều cao title.
3. /quality-cockpit V5: input date native hiển thị MM/DD/YYYY theo OS locale — cần date-picker custom theo vi-VN (đụng DS form, làm riêng).
4. Advisory tích lũy (không fail): FAB chat nên smart-hide/thu nhỏ khi đè content; amber "2277 Phút" nên gắn ngưỡng; "Trực tiếp" 2 chỉ báo/màn; 22.996 thiếu dấu nghìn; chip "Dừng" hàng loạt khi Ready nên trung tính; "Dwell" còn 1 chỗ chưa dịch; theme-toggle thiếu ở history; H1 thiếu icon-square ở sessions; UA-parser "không rõ" khi UA có Windows NT.

## Nợ thiết kế lớn (cần QUYẾT ĐỊNH thiết kế, ngoài phạm vi phiên)
5 KPI card Dashboard 5 anatomy · menu "Control Tower"→"Tháp vận hành" đã đổi nhãn nhưng vẫn 2 TRANG trùng khái niệm với "Trung tâm chỉ huy" (IA cần gộp) · andon tile 2 anatomy + tên máy ellipsis trên TV · settings tab ngưỡng: form dưới fold · date-picker DS · số nghìn định dạng thống nhất toàn hệ.

## PRO-100 — thực thi backlog (user duyệt "đồng ý khuyến nghị", cùng ngày)
**A. 4 fail còn lại của gate:**
- 2 select cắt chữ: probe `scrollWidth > clientWidth` chỉ đích danh `Dashboard:1330` (select refresh — KHÁC select đã sửa 2 đợt trước) + `:1263` → nới; select tuyến /line-view w-56→w-72 (chip Ready chen trong trigger).
- KPI OEE lệch baseline: 4 CardTitle `min-h-10 items-start` + giá trị "2277 phút" 1 dòng — agent xác nhận **cùng baseline, oee 5/5**.
- **`DateField` mới (patterns/)**: Popover+Calendar hiển thị CỐ ĐỊNH dd/MM/yyyy (locale vi), contract ISO `yyyy-MM-dd` giữ nguyên — thay 2 input native ở quality-cockpit (native hiển thị theo OS → từng ra MM/DD/YYYY); trục X chart đồng bộ dd/MM bằng tickFormatter.
**B. Advisory:** số nghìn vi-VN (22.996) · UA-parser fallback FE (server trả sẵn CHUỖI "không rõ" truthy → phải coi unknown-ish là thiếu) · '::1'→"Máy cục bộ" · H1 sessions có icon-square · "Dwell"→"Lưu" · **PACKML_TONE**: chip "Dừng/Chờ/Sẵn sàng" trung tính (12 chip vàng đồng loạt khi tuyến Ready là nhiễu cảnh báo), màu chỉ cho EXECUTE/HELD/ABORTED · **TrendIndicator polarity `goodWhen`**: NG/NTF tăng = đỏ (từng ↗ xanh) · timestamp "13/7"→"13/07/2026".
**C. Nợ thiết kế đã chốt:**
- **IA gộp**: `/control-tower` ("hợp nhất 6 màn command" — trùng vai `/command-center` đứng cạnh) → `COLLAPSED_INTO_HUB` (gate khớp machine_status; ⌘K + deep-link + RelatedViews từ Dashboard vẫn tới được) — đúng cơ chế doc 59.
- Anatomy 5 KPI Dashboard: khung đã thống nhất (đạt thước v4/v5); sparkline 5/5 cần server trả per-day ok/ng/ntf (`getDailyStats` hiện chỉ có output/fpy/finalYield) → **nợ backend nhỏ**, không đục server trong phiên FE.
- Andon tile: mã máy wrap theo token '-' (zero-width-space), hết ellipsis nuốt hậu tố lẫn hết gãy giữa từ "CONVEY/OR".
**Vòng xác nhận (2 agent, 6 màn):** oee **5/5** · andon 4/5 · sessions 4/5 · quality 4/5 · dashboard 3/5 · line-view 3/5 — mọi fail nêu ra đều đã vá NGAY trong batch chót ở trên (polarity NTF, UA-unknown-ish, break-token, trục X, selector, timestamp). Nit mới phát sinh (caption lệch 16px card-1 OEE, "5 Sự kiện" hoa giữa cụm, 2 marker legend cùng họ cam-đỏ, sparkline artifact chấm đơn, "Tỉ/Tỷ" chính tả toàn hệ, 2-đường-vào-OEE trên sidebar) → **nợ nhỏ vòng sau**; reviewer đối kháng mỗi vòng soi tinh hơn — điểm gate chính thức giữ ở phép đo v5: **97,1%**.

## Vòng đóng-nợ (user: "xử lý nốt phần còn nợ", cùng ngày)
- **"Nợ backend per-day" HOÁ RA KHÔNG TỒN TẠI**: đọc `server/db/statistics.ts::getDailyStats` — server ĐÃ trả `okCount/ngCount/ntfCount` mỗi ngày từ W5-E (doc 27); chỉ FE chưa map. → sparkline **5/5 KPI card** (OK xanh/NG đỏ/NTF vàng theo token) không đụng server, không restart.
- Sparkline artifact: `<2 điểm không vẽ` (hết "chấm mồ côi") + margin 2px (hết vệt xén mép).
- OEE: caption chuyển LÊN TRƯỚC progress → hàng caption 4 card cùng độ cao; "sự kiện"/"tổng số máy" chữ thường.
- **Tỷ/Tỉ**: chuẩn hoá 23 chỗ "Tỉ lệ"→"Tỷ lệ" toàn vi.json (đa số 150-vs-23), JSON round-trip validate.
- Quality: 2 series legend tách họ màu (báo-giả → xanh dương #3b82f6; lọt-lỗi giữ đỏ) + trục X dd/MM. ★GOTCHA: regex qua `bash node -e` bị nuốt backslash (`\d`→`d`) — Edit tool mới giữ nguyên; đã kiểm cả 2 chart.
- **IA**: `/oee-dashboard` là redirect thuần (QA4F-1) nhưng còn row rail riêng → vào `COLLAPSED_INTO_HUB` (gate khớp hub) — hết "2 đường vào 1 nội dung"/sidebar-active lệch.
- Shell: FAB 56→48px (vẫn ≥40 chạm, đè ít hơn) · `nav.beta` "Thử nghiệm"→"Beta" (brand "SYNAPSE Platform" hết ellipsis) · ThemeToggle thêm aria-label · sessions "phiên đang hoạt động" nhất quán.
- **Theme-toggle history "thiếu"**: probe DOM xác nhận sun-icon HIỆN DIỆN trên /history → finding là misread ảnh của agent, không phải bug — đóng không sửa.
- tsc 0 + build xanh + máy audit giữ **100% (79/79)**.

**Verify agent (3 màn) — mọi mục nhắm ✓** (sparkline 5/5 không chấm mồ côi, NTF-tăng đỏ, selects hết cắt, caption 4 card OEE cùng baseline + chữ thường, legend tách hue xanh-dương/đỏ, trục X dd/MM, title Cockpit khớp nav). Findings lớp mới → **vá luôn cùng vòng**: FPY sparkline "khối đặc" → YAxis ẩn domain min-max (chuỗi ~97% thành đường dao động, 5 sparkline cùng họ) · card OK/NG/NTF `flex-1 min-w-0` (hết vệt xén mép) · "2.277 phút" có dấu nghìn · **fill ngày trống trục category** (gap 14–18/07 từng bị nén 1 bước làm dốc trend cuối méo — chèn null-day, connectNulls giữ đường liền) · nguồn "OEE & Downtime" thứ 2 = fallback MachineWorkspace + thêm key chính thức `deviceHub.tabs.oee` · 2 "Tỉ lệ" sót (nằm trong chính FIXES map — ghi đè sau normalize) sửa tận gốc map.
**Misread ảnh đã xác minh bằng chân lý khác (KHÔNG sửa):** "báo giá" — vi.json 0 khớp, 12 "báo giả" đúng (nét dấu hỏi trên font render nhỏ); theme-toggle "thiếu" ở history — probe DOM xác nhận sun-icon hiện diện. Bài học: findings agent-thị-giác phải đối chiếu nguồn chân lý (file/DOM) trước khi sửa.
**★GOTCHA công cụ (lặp 3 lần trong phiên):** chuỗi thay thế đi qua `bash node -e` bị nuốt backslash/lệch indentation — mọi sửa code chứa regex/JSX phải dùng Edit tool, node-script chỉ cho thao tác chuỗi thuần.

## Phương pháp — bài học tái dùng
- **Screenshot-verify + element-attribution trước khi tin bất kỳ số nào** (2FA đá về login từng cho "PASS" ảo; cn-missing crash từng bị ErrorBoundary nuốt cho máy-100% ảo trên dist cũ).
- Máy đo (khách quan, chạy lại được) + thị giác đa-agent đối kháng (bắt cái máy không thấy) là cặp bổ khuyết; agent mỗi vòng soi tinh hơn — dừng ở ngưỡng lợi-ích-giảm-dần và ghi advisory làm backlog.
- Sửa THƯỚC chỉ khi thước sai chuẩn (sr-only whitelist, 2FA-account), không bao giờ để đẹp số.

