# Quyết định thị giác — màn 1, 4, 5 + vỏ + token (luong-ui)

Brief: `docs/techdocs/ke-hoach/2026-11-03-mockup-5-man-brief.md`. Màn 2, 3 (scada-ui): nhánh `docs/mockup-man-2-3`. Ảnh: `man-<n>-<trạng-thái>-<1280x800|1920x1080>.png`; HTML bấm đổi trạng thái: `mockup.html` → từng màn. **Chưa viết mã vỏ.**

## Vỏ (AppFrame) và token
1. **Thanh đầu 56 px, 5 bất biến theo thứ tự cố định**: phạm vi ISA-95 (breadcrumb + "Đổi phạm vi") · `AlarmChip` · `FreshnessPill` · nhãn THẬT/MÔ PHỎNG · ⌘K, rồi người dùng. Không `AppLauncher`, không chế độ Đơn giản/Nâng cao.
2. **Phạm vi mô phỏng đổi cả vỏ**: thanh đầu nền xanh ngọc nhạt + viền dưới 4 px, banner đặc dưới thanh đầu, pill "Mô phỏng", nhãn MÔ PHỎNG, khung chi tiết viền 4 px + watermark 8 % (màn 5, `may-mo-phong`).
3. **Rail 7 vùng, 64 px thu gọn / 240 px mở** (ảnh `man-1-rail-mo-*` và mọi ảnh 1920 dùng rail mở). Rail tối (`--isa-rail`) chỉ để tách điều hướng khỏi vùng làm việc — nội dung vẫn là theme sáng. Đáy rail = cài đặt + giao diện (không điều hướng). Mục đang chọn: nền `--isa-rail-2` + vạch trắng 4 px bên trái.
4. **Màu chỉ cho bất thường**: bề mặt toàn xám ISA; accent teal chỉ cho nút/tab/liên kết/focus; **không có xanh lá** ở bất kỳ nơi nào (kiểm bằng grep, xem dưới). Trạng thái "đang chạy" = ký hiệu ▶ + chữ, màu trung tính.
5. **Ưu tiên cảnh báo = hình + số + chữ** (■1 Nghiêm trọng · ▲2 Cao · ▼3 Trung bình · ●4 Thông tin) qua một `AlarmBadge`; P1/P2 ô đặc (chữ trắng), P3/P4 nền nhạt + viền. Hàng bảng có vạch trái theo ưu tiên (độ dày 6 px) để quét dọc.
6. **Dữ liệu cũ = tím + gạch xiên + viền đứt, thắng màu cảnh báo** (`.is-stale`): ô số, pill, hàng tag, cả trạng thái PackML suy ra từ dữ liệu cũ. uncertain = viền chấm xám (`1,42 kW · không chắc`). Thiếu tag `fault` bắt buộc = chữ nghiêng "không có tín hiệu" trên nền lõm, kèm dải cảnh báo (không bao giờ hiện "bình thường").
7. **Chữ**: Be Vietnam Pro 400/500/600/700 + Geist Mono 400/500/600; thang `.ds-h1…caption` (11–24 px); số đo dùng chữ thân + `tabular-nums` (`.num`), **Geist Mono chỉ cho mã/địa chỉ/giờ** — thử dùng mono cho số thập phân thì dấu phẩy rộng như một ô chữ ("96 , 4"), đã bỏ. Tối thiểu 11 px; không `text-[Npx]`, không hex ngoài `token.css`.
8. **Mật độ**: `comfortable` (1280×800: nút/hàng ≥ 48 px, chữ 15 px) và `default` (1920×1080: 40 px, 14 px) đặt bằng `data-density` ở thẻ gốc (DensityProvider ở vỏ).

## Màn 1 — Trang chủ theo vai (`/`)
1. Cùng một khung cho 3 vai (vận hành · giám sát · kỹ sư): dải 4 ô số ngay dưới tiêu đề (số + đơn vị + **tuổi dữ liệu**), rồi 3 `RoleTile` theo `home.tiles`. Bộ chọn vai chỉ có trong mockup; app thật lấy vai từ tài khoản (manager/admin có tile riêng — **không vẽ**, ngoài 3 vai brief).
2. Tile là đơn vị cảnh báo: có P1 chưa ack → vạch trái đỏ 6 px + `AlarmBadge` ở tiêu đề tile + `AlarmChip` đỏ nhấp nháy ở vỏ (CSS thuần, tắt khi `prefers-reduced-motion`). P2 → vạch cam, không nhấp nháy.
3. Vận hành viên: cỡ nút ≥ 48 px, Andon có **Ack / Giải quyết** ngay trên tile (không phải mở trang khác); "Việc hôm nay" là checklist.
4. Giám sát: "5 cảnh báo nặng nhất" là cùng danh sách với tab Đang mở (cùng `AlarmBadge`); Yield ca hiện **khoảng cách tới mục tiêu bằng chữ** ("▼ −0,2 điểm") chứ không tô màu vì còn trong dung sai.
5. Dữ liệu cũ: pill tím "DỮ LIỆU CŨ · 4 phút" ở vỏ **và** từng ô số tím gạch (không chỉ pill) — nhìn ảnh cắt nhỏ vẫn biết số nào không còn tin được.
- Đã trả lời: yield dưới mục tiêu nhưng trong dung sai KHÔNG tô màu, chỉ chữ ▼ (ISA-101); manager/admin vẽ SAU khi chủ dự án duyệt 3 vai.

## Màn 4 — Cảnh báo (`/canh-bao`)
1. 6 tab (Đang mở · Andon · Lịch sử · KPI · Định nghĩa · Thông báo) với số đếm; chỉ vẽ tab Đang mở (đủ theo brief §1).
2. Bảng: **ưu tiên → tài sản (breadcrumb ISA-95) → mã mono + thông điệp → giá trị/giới hạn (ô số) → tuổi → trạng thái ISA-18.2 + bậc leo thang**. Trạng thái có **ký hiệu** (● đang kích hoạt · ◐ đã ack · ○ đã hết chưa ack · ⏸ tạm ẩn · ⊘ ngoài dịch vụ); chỉ "chưa ack" mang màu chữ để mắt tìm việc cần làm. Cột "Leo thang" gộp xuống dòng phụ của ô trạng thái để vừa 1280 px.
3. Ack hàng loạt **chỉ P2–P4** (chủ dự án: P1 phải Ack từng hàng — ISA-18.2): ảnh chọn 3 hàng P2/P3 → thanh hành động "3 hàng đã chọn · Ack hàng loạt (chỉ P2–P4) · Tạm ẩn hàng loạt ▾". Nút Ack theo hàng chỉ có ở hàng cần ack.
4. **Lũ cảnh báo** (`lu-canh-bao`): dải cam trên bảng nói số/10 phút so ngưỡng ISA-18.2 (38/10) + 10 cột nhỏ mỗi phút; bảng **gom theo nguyên nhân gốc** (mất kết nối PLC = MỘT sự kiện `COMM_LOST` theo connection; 24 + 8 cảnh báo QUY TRÌNH của các máy phía sau thu gọn làm thứ cấp, không phải cảnh báo tag; nút "Ack nhóm" chỉ ack thứ cấp), P1/P2 độc lập vẫn hiện đầy đủ bên dưới nhóm — lũ không được che mất cảnh báo thật.
5. **Hàng tag stale**: giá trị tím gạch + "cũ 3 ph" thay vì màu cảnh báo; ưu tiên/vạch trái giữ nguyên (ưu tiên là thuộc tính định nghĩa, không phải dữ liệu); dải ghi chú nói "chưa thể xác nhận vượt ngưỡng".
6. `AlarmDrawer` (ngăn phải của vỏ, 440 px): cause/action từ định nghĩa, spark 15 phút **có khoảng hở mất tín hiệu không nối nét, tô SỌC TÍM** (thống nhất với scada-ui: mất kết nối/bad = sọc tím, uncertain = chấm xám) + đường HH nét đứt, journal timeline, bảng delivery (kênh/người nhận/✓✕), nút Ack · Tạm ẩn · Ghi chú · Ngoài dịch vụ · Mở máy L3.
- Đã trả lời (chu-du-an-HST, theo TechDocs): P1 Ack từng hàng; ngưỡng lũ mặc định 10/10 phút (ISA-18.2/EEMUA 191), cấu hình theo site qua `setting`, không hard-code.

## Màn 5 — Tài sản (`/tai-san`)
1. Master-detail: **cây trái 280–340 px** (ảo hoá, badge số thiết bị + `AlarmBadge` ưu tiên cao nhất trong nhánh, `OriginBadge` cho site thật/mô phỏng/QA, cuộn trong khung) + **chi tiết phải** với 6 tab (Tổng quan · Kết nối & tag · Chứng thực · Cấu hình · Mô hình 3D · Lịch sử).
2. Máy thật: tab "Kết nối & tag" — 3 thẻ kết nối (giao thức, điểm cuối mono, trạng thái sống, hành động; kết nối mất = viền đứt tím) rồi bảng tag: **vai (role) có icon**, mã + địa chỉ, kiểu/đơn vị, **cờ ✎ ghi được · L3 mức tác động · ⚡ năng lượng**, giá trị sống kèm chất lượng/tuổi.
3. Mô phỏng: tab Tổng quan (form sinh từ lược đồ lớp) trong khung viền 4 px xanh ngọc + watermark; thanh đầu đổi nền, banner, pill — **nhãn xuất hiện ở 5 chỗ** (banner, nhãn đầu, pill, cây, tên thiết bị) để không thể nhầm với máy thật.
4. Ngoài phạm vi: `ScopeEmptyNotice` nói rõ "chưa được gán phạm vi" (không phải rỗng bình thường), có hành động "Xin cấp phạm vi" và "Về nút trong phạm vi của tôi"; cây chỉ thấy phần được gán.
5. Wizard "Thêm thiết bị" là **ngăn phủ 520 px** với bước 1–6 ngang (✓ xong · ● hiện tại), vẽ bước 3 (kết nối) kèm kết quả thử.
- Đã trả lời: mô phỏng/QA **chung cây** (10 §2 `site.origin`), phân biệt bằng OriginBadge + đổi vỏ; thẻ kết nối thay bảng chấp nhận khi ≤ 5 kết nối/máy, > 5 chuyển bảng.

## Hỏi chung
1. **`--accent` (#0b6477) và `--sim` (#0a7a72) gần nhau** (scada-ui cũng nêu): hiện tách bằng nghĩa dùng (sim luôn đi kèm nhãn chữ + viền dày + banner), không bằng màu. Phương án nếu cần tách hẳn: accent chuyển xanh dương hơn (≈ #0c5a85) hoặc sim chuyển xanh ngọc sáng hơn với chữ tối. Chọn?
2. Rail tối trong theme sáng, hay rail xám sáng? **Đã chụp cả hai để so**: `man-1-rail-mo-giam-sat-*` (tối) và `man-1-rail-xam-sang-giam-sat-*` (sáng, `?railtone=light`; tương phản 4 cặp đạt). Màn 3 của scada-ui hiện đang vẽ rail sáng.

## Tự kiểm 8 quy tắc §3 (không thay cho kiem-dinh)
| # | Quy tắc | Bằng chứng |
|---|---|---|
| 1 | Nền xám sáng; chữ 3 mức; accent chỉ tương tác; không xanh lá | `token.css` `--isa-*`, `--text-1/2/3`; `grep -i green` = 0; accent chỉ xuất hiện ở nút/tab/liên kết/focus/chọn |
| 2 | Màu chỉ cho bất thường; 4 mức = hình+số+chữ; stale thắng cảnh báo; uncertain viền chấm; thiếu tag fault = không có tín hiệu | màn 4 `du-lieu-cu`; màn 5 hàng `fault`; ô `1,42 kW` uncertain |
| 3 | Be Vietnam Pro + Geist Mono, tabular-nums, ≥ 11 px, không `text-[`/palette thô, mọi màu qua token | `grep` hex ngoài `token.css` = 0, `text-[` = 0, cỡ chữ < 11 px = 0 (lệnh trong lịch sử commit) |
| 4 | comfortable (1280×800, ≥ 48 px) + default (1920×1080) | 32 ảnh, mỗi trạng thái cả hai cỡ |
| 5 | Tương phản ≥ 4,5:1 cho giá trị | `tuong-phan.md`: 58 cặp, 0 không đạt (chữ ≥ 4,5:1, đồ hoạ ≥ 3:1) |
| 6 | Hoạt ảnh chỉ CSS, tôn trọng reduced-motion, không hoạt ảnh khi stale | `token.css` tắt mọi animation dưới `prefers-reduced-motion`; `.is-stale { animation: none !important }`; STOP 3 trạng thái thuộc màn 3 (scada-ui) |
| 7 | i18n: chuỗi là khoá vi | `khoa-i18n.md` (khoá dự kiến theo namespace vùng; chuỗi dữ liệu mẫu không phải khoá) |
| 8 | Mô phỏng: viền 4 px + banner + watermark + pill, màn 2 không sót | màn 5 `may-mo-phong` đủ 4 lớp (+ nhãn đầu); **màn 2 do scada-ui** |

**Giới hạn đã biết:** chưa chạy kiem-dinh; tương phản đo trên token, chưa đo từng điểm ảnh chụp; hoạt ảnh nhấp nháy P1 chỉ xem được trong HTML sống (ảnh tĩnh không thấy); ba vai manager/admin/operator-kiosk của Home chưa vẽ; tab ngoài tab đang chọn chưa vẽ.
