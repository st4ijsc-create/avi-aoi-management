# Quyết định thị giác — màn 1, 4, 5 + vỏ + token (luong-ui)

> **ĐÃ DUYỆT 2026-11-04** (chủ dự án, thị giác; main `ac0e63289`). `token.css` + `shell.css/js` là nguồn của `index.css`/AppFrame ở 90-P3 (pha 2); CHƯA viết mã vỏ cho tới khi pha 0 gộp xong và chủ dự án báo.

Brief: `docs/techdocs/ke-hoach/2026-11-03-mockup-5-man-brief.md`. Màn 2, 3 (scada-ui): nhánh `docs/mockup-man-2-3`. Ảnh: `man-<n>-<trạng-thái>-<1280x800|1920x1080>.png`; HTML bấm đổi trạng thái: `mockup.html` → từng màn. **Chưa viết mã vỏ.**

## Vỏ (AppFrame) và token
1. **Thanh đầu 56 px, 5 bất biến theo thứ tự cố định**: phạm vi ISA-95 (breadcrumb + "Đổi phạm vi") · `AlarmChip` · `FreshnessPill` · nhãn THẬT/MÔ PHỎNG · ⌘K, rồi người dùng. Không `AppLauncher`, không chế độ Đơn giản/Nâng cao.
2. **Phạm vi mô phỏng đổi cả vỏ**: thanh đầu nền xanh ngọc nhạt + viền dưới 4 px, banner đặc dưới thanh đầu, pill "Mô phỏng", nhãn MÔ PHỎNG, khung chi tiết viền 4 px + watermark 8 % (màn 5, `may-mo-phong`).
3. **Rail 7 vùng, 64 px thu gọn (ảnh 1280) / 240 px mở (ảnh 1920)**, **xám sáng như nền** (đã chốt 2026-11-04; bỏ biến thể rail tối), tách khỏi vùng làm việc bằng viền phải 1 px. Đáy rail = cài đặt + giao diện (không điều hướng). Mục đang chọn: nền `--isa-rail-2` (xanh dương nhạt) + chữ/vạch accent 4 px bên trái.
4. **Màu chỉ cho bất thường**: bề mặt toàn xám ISA; accent xanh dương chỉ cho nút/tab/liên kết/focus; **không có xanh lá** ở bất kỳ nơi nào (kiểm bằng grep, xem dưới). Trạng thái "đang chạy" = ký hiệu ▶ + chữ, màu trung tính.
5. **Ưu tiên cảnh báo = hình + số + chữ** (■1 Nghiêm trọng · ▲2 Cao · ▼3 Trung bình · ●4 Thông tin) qua một `AlarmBadge`; P1/P2 ô đặc (chữ trắng), P3/P4 nền nhạt + viền. Hàng bảng có vạch trái theo ưu tiên (độ dày 6 px) để quét dọc.
6. **Dữ liệu cũ = tím + gạch xiên + viền đứt, thắng màu cảnh báo** (`.is-stale`): ô số, pill, hàng tag, cả trạng thái PackML suy ra từ dữ liệu cũ. uncertain = viền chấm xám (`1,42 kW · không chắc`). Thiếu tag `fault` bắt buộc = chữ nghiêng "không có tín hiệu" trên nền lõm, kèm dải cảnh báo (không bao giờ hiện "bình thường").
7. **Chữ**: Be Vietnam Pro 400/500/600/700 + Geist Mono 400/500/600; thang `.ds-h1…caption` (11–24 px); số đo dùng chữ thân + `tabular-nums` (`.num`), **Geist Mono chỉ cho mã/địa chỉ/giờ** — thử dùng mono cho số thập phân thì dấu phẩy rộng như một ô chữ ("96 , 4"), đã bỏ. Tối thiểu 11 px; không `text-[Npx]`, không hex ngoài `token.css`.
8. **Mật độ**: `comfortable` (1280×800: nút/hàng ≥ 48 px, chữ 15 px) và `default` (1920×1080: 40 px, 14 px) đặt bằng `data-density` ở thẻ gốc (DensityProvider ở vỏ).

9. **Slot "DỪNG MÁY" cố định ở vỏ** (scada-ui đề xuất khi vẽ màn 3): `.drawer` là `position: fixed` nên nút DỪNG MÁY của màn máy phải nằm ở lớp portal riêng, dịch trái theo ngăn (`right: var(--drawer-w) + gap`). Khuyến nghị cho AppFrame thật: khai báo một **slot vùng hành động cố định** (z-index trên drawer, không bị drawer/hộp xác nhận che) để mọi màn có lệnh dừng dùng chung — ghi vào 50 §4 khi hoàn thiện.

## Màn 1 — Trang chủ theo vai (`/`)
1. Cùng một khung cho 3 vai (vận hành · giám sát · kỹ sư): dải 4 ô số ngay dưới tiêu đề (số + đơn vị + **tuổi dữ liệu**), rồi 3 `RoleTile` theo `home.tiles`. Bộ chọn vai chỉ có trong mockup; app thật lấy vai từ tài khoản (manager/admin có tile riêng — **không vẽ**, ngoài 3 vai brief).
2. Tile là đơn vị cảnh báo: có P1 chưa ack → vạch trái đỏ 6 px + `AlarmBadge` ở tiêu đề tile + `AlarmChip` đỏ nhấp nháy ở vỏ (CSS thuần, tắt khi `prefers-reduced-motion`). P2 → vạch cam, không nhấp nháy.
3. Vận hành viên: cỡ nút ≥ 48 px, Andon có **Ack / Giải quyết** ngay trên tile (không phải mở trang khác); "Việc hôm nay" là checklist.
4. Giám sát: "5 cảnh báo nặng nhất" là cùng danh sách với tab Đang mở (cùng `AlarmBadge`); Yield ca hiện **khoảng cách tới mục tiêu bằng chữ** ("▼ −0,2 điểm") chứ không tô màu vì còn trong dung sai.
5. Dữ liệu cũ: pill tím "DỮ LIỆU CŨ · 4 phút" ở vỏ **và** từng ô số tím gạch (không chỉ pill) — nhìn ảnh cắt nhỏ vẫn biết số nào không còn tin được.
- Đã trả lời: yield dưới mục tiêu nhưng trong dung sai KHÔNG tô màu, chỉ chữ ▼ (ISA-101); manager/admin vẽ SAU khi chủ dự án duyệt 3 vai.

### Bổ sung sau duyệt (không cần duyệt lại — cùng khung): Home vai Quản lý + Quản trị
- **Quản lý** (`manager`: KPI): dải OEE nhà máy · FPY ca · giao đúng hạn (tuần) · sản lượng tuần; 3 tile — *OEE theo line* (thanh ngang xám + số, chỉ line bất thường mới có `AlarmBadge`), *Đơn hàng & tiến độ* (đơn trễ hạn chỉ nổi bằng chữ "▼ trễ 1 ngày" màu `--alarm-p2-ink`, không tô nền), *Cảnh báo ảnh hưởng sản xuất* (3 dòng đầu của danh sách Cảnh báo, cùng `AlarmBadge`).
- **Quản trị** (`admin`: sức khoẻ): dải người dùng · phiên · job nền lỗi · dung lượng CSDL; 3 tile — *Sức khoẻ hệ thống* (API · CSDL · broker · 2 edge: ký hiệu ▶/■ + chữ; edge mất kết nối ở trạng thái P1 mang `data-p1-unack` nên chip vỏ nhấp nháy đúng luật), *Phiên & tài khoản*, *Sao lưu & giấy phép*.
- Trạng thái dữ liệu cũ áp cho cả hai vai (ô số/hàng tím gạch, pill vỏ tím); ảnh: `man-1-{binh-thuong,p1-chua-ack}-quan-ly`, `man-1-{binh-thuong,p1-chua-ack,du-lieu-cu}-quan-tri` × 2 cỡ. Đo vùng chạm (`do-cham.mjs`) nay quét cả 5 vai của màn 1.

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

## Đã chốt 2026-11-04 (chủ dự án)
1. **`--accent` → xanh dương `#0c5a85`**, `--sim` giữ xanh ngọc `#0a7a72` độc quyền cho mô phỏng; `--accent-soft` `#d6e6f1`, `--focus-ring` theo accent. Bốn cặp tương phản accent (trên thẻ, trên nền trang, trên accent-soft, trên mục chọn rail) + chữ trắng trên accent đều ≥ 4,5:1 — xem `tuong-phan.md`.
2. **Rail trái xám sáng (như nền) là mặc định**; biến thể rail tối và thuộc tính `data-rail-tone` đã gỡ (thuộc tính thừa trong HTML của scada-ui vô hại).
3. "Dừng — chờ máy xác nhận" = huy hiệu tạm nhấp nháy cạnh nhãn PackML (việc của scada-ui; dùng `animation` CSS thuần, tắt khi `prefers-reduced-motion` — cùng quy tắc `chipPulse` của `AlarmChip`).
4. Sửa dữ liệu mẫu màn 5 `ngoai-pham-vi`: người dùng chỉ được gán Line SMT-01; liên kết `?node=SMT-03` trỏ tới nút KHÔNG có trong cây của họ ⇒ **cây không tô chọn dòng nào** (trước đây tô SMT-01 trong khi thông báo nói SMT-03), thông báo nói rõ nguồn, số thiết bị trong cây/chân cây chỉ tính phần được gán (14, không còn 142).

## Sửa theo kiem-dinh 2026-11-04 (báo cáo `D:\SOURCES\_kd_out\mock_out\BAO-CAO.md`, đo @713eb58a3)
1. **R1 tương phản**: ký tự ▲ của dải lũ dùng `--alarm-p2-ink` (6,96:1) thay `--alarm-p2` (3,64:1 trên nền nhạt). Rà toàn bộ: không còn chữ/ký tự nào dùng `color: var(--alarm-pN)` trực tiếp (grep = 0); màu chính chỉ cho glyph SVG/viền/ô đặc có chữ trắng. Thêm 2 cặp vào `tuong-phan.mjs` (cờ L3 trên nền lõm, ▲ lũ).
2. **R4 vùng chạm — KHÔNG ngoại lệ**: `.btn.sm`, `AlarmChip`, `.cmdk`, `.field` và hộp chọn `.chk` đều dùng `min-height/width: var(--touch-min)` (48 px @comfortable, 40 px @default); "sm" chỉ nhỏ chữ/đệm. Liên kết trong dòng chữ đổi thành nút `.btn.quiet` (mở rộng, lớp thiết bị) hoặc bỏ liên kết (mã máy ở tiêu đề AlarmDrawer — "Mở máy L3" ở chân ngăn đã có). Công cụ đo kèm: `node do-cham.mjs` → **728 phần tử tương tác, 0 dưới mục tiêu chạm** ở cả hai mật độ (loại khung `.demo` của mockup).
3. **Quy tắc 6, AlarmChip theo NGUỒN của P1 (định nghĩa chốt 2026-11-04, thay bản "có dữ liệu cũ bất kỳ ⇒ đứng yên" — bản đó fail-open)**: chip P1 nhấp nháy khi P1 chưa ack thuộc nguồn TƯƠI, kể cả khi nguồn/line khác đang cũ; chỉ **đứng yên + viền đứt tím + dấu "◇ cũ"** khi P1 đó thuộc nguồn cũ (class `.src-stale` trên chip) hoặc TOÀN phạm vi cũ (FreshnessPill của vỏ tím ⇒ `data-scope-stale`). `data-has-stale` chỉ để hiện pill "dữ liệu cũ · N", không tắt chip. Luật trong `shell.js` (phép đo của kiem-dinh làm luật): **nhấp nháy ⇔ tồn tại P1 chưa ack (`data-p1-unack`, đang hiển thị) KHÔNG là/không chứa/không có tổ tiên `.is-stale`**; mọi P1 chưa ack đều trên nguồn cũ ⇒ chip thêm `.src-stale` (đứng yên + viền đứt tím + "◇ cũ"). Ảnh màn 4: `du-lieu-cu-p1-nguon-cu` — P1 chưa ack DUY NHẤT là hàng tag cũ (`82,4 °C` cũ 3 ph; hai P1 kia đã ack) ⇒ chip đứng yên + dấu cũ, dải ghi chú giữ "chưa thể xác nhận vượt ngưỡng"; `p1-tuoi-line-khac-cu` (MỚI, không ghi đè) — P1 chưa ack trên nguồn TƯƠI + một hàng P2 tag cũ ⇒ chip VẪN nhấp nháy (không fail-open). `man-1/du-lieu-cu` + `man-3/du-lieu-cu` không có P1 chưa ack nên không minh hoạ luật (chip ■0). Tự đo DOM sống: hon-hop → chipPulse; du-lieu-cu → none + `src-stale`; p1-tuoi-line-cu → chipPulse. Một tên class duy nhất `.is-stale` (scada-ui đổi `.stale` theo).
3b. **Cỡ chữ 0 px (kiem-dinh, lưu ý nhẹ)**: hộp chọn `.chk` không còn ký tự "✓" trong HTML và không dùng `font-size: 0`; dấu ✓ vẽ bằng `::after`, trạng thái nằm ở `role="checkbox" aria-checked`. Phép "cỡ chữ < 11 px = 0" đếm được 0.
4. **Token cho scada-ui bỏ hex/rgba thô** (man-2-3): `--scrim` (phủ nền hộp thoại, color-mix từ `--text-1`), `--hatch-bg` / `--hatch-line` / `--hatch-stale` (gạch xiên; SVG `<pattern>` dùng `fill: var(--hatch-bg)` / `stroke: var(--hatch-line)` từ CSS), `--mock-canvas` / `--mock-bar` / `--mock-bar-ink` / `--mock-bar-ink-2` / `--mock-bar-line` / `--mock-bar-line-2` (khung điều khiển + nền ngoài CHỈ của mockup); chữ trắng trên nền đặc = `--accent-ink`. `--stale-soft`, `--stale`, `--isa-graphic`, `--isa-graphic-muted` đã có từ đầu.

## Tự kiểm 8 quy tắc §3 (không thay cho kiem-dinh)
| # | Quy tắc | Bằng chứng |
|---|---|---|
| 1 | Nền xám sáng; chữ 3 mức; accent chỉ tương tác; không xanh lá | `token.css` `--isa-*`, `--text-1/2/3`; `grep -i green` = 0; accent chỉ xuất hiện ở nút/tab/liên kết/focus/chọn |
| 2 | Màu chỉ cho bất thường; 4 mức = hình+số+chữ; stale thắng cảnh báo; uncertain viền chấm; thiếu tag fault = không có tín hiệu | màn 4 `du-lieu-cu`; màn 5 hàng `fault`; ô `1,42 kW` uncertain |
| 3 | Be Vietnam Pro + Geist Mono, tabular-nums, ≥ 11 px, không `text-[`/palette thô, mọi màu qua token | `grep` hex ngoài `token.css` = 0, `text-[` = 0, cỡ chữ < 11 px = 0 (lệnh trong lịch sử commit) |
| 4 | comfortable (1280×800, ≥ 48 px) + default (1920×1080, ≥ 40 px) | 28 ảnh, mỗi trạng thái cả hai cỡ; `do-cham.mjs`: 728 phần tử, 0 dưới mục tiêu |
| 5 | Tương phản ≥ 4,5:1 cho giá trị | `tuong-phan.md`: 58 cặp, 0 không đạt (chữ ≥ 4,5:1, đồ hoạ ≥ 3:1) |
| 6 | Hoạt ảnh chỉ CSS, tôn trọng reduced-motion, không hoạt ảnh khi stale | `token.css` tắt mọi animation dưới `prefers-reduced-motion`; `.is-stale { animation: none !important }`; AlarmChip P1 chỉ đứng yên khi P1 thuộc nguồn cũ/toàn phạm vi cũ (mục "Sửa theo kiem-dinh" #3); STOP 3 trạng thái thuộc màn 3 (scada-ui) |
| 7 | i18n: chuỗi là khoá vi | `khoa-i18n.md` (khoá dự kiến theo namespace vùng; chuỗi dữ liệu mẫu không phải khoá) |
| 8 | Mô phỏng: viền 4 px + banner + watermark + pill, màn 2 không sót | màn 5 `may-mo-phong` đủ 4 lớp (+ nhãn đầu); **màn 2 do scada-ui** |

**Giới hạn đã biết:** chưa chạy kiem-dinh; tương phản đo trên token, chưa đo từng điểm ảnh chụp; hoạt ảnh nhấp nháy P1 chỉ xem được trong HTML sống (ảnh tĩnh không thấy); ba vai manager/admin/operator-kiosk của Home chưa vẽ; tab ngoài tab đang chọn chưa vẽ.
