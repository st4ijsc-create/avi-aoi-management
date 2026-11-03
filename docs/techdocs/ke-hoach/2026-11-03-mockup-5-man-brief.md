# Brief mockup 5 màn then chốt — luong‑ui / scada‑ui (chạy song song pha 0)

| | |
|---|---|
| Nguồn | Báo cáo 2026‑11‑03 §9 (vỏ, hệ thiết kế), §10 (42 màn); TechDocs 90 §4, 40 §4, 50 §4, 20 §4, 30 §4; spec SCADA mượt v3 §5–§6 (ISA‑101, mockup 4 trạng thái) |
| Quyết định | Chủ dự án 2026‑11‑03: "(b) chạy song song" với pha 0; font body **Be Vietnam Pro** + Geist Mono; theme **sáng ISA‑101** mặc định (tối sau SCADA pha 1) |
| Đầu ra | `docs/superpowers/specs/2026-11-mockup-5-man/` : `mockup.html` tĩnh (bấm đổi trạng thái, không build app) + ảnh PNG 1280×800 và 1920×1080 mỗi màn mỗi trạng thái + `token.css` đề xuất (đọc được bởi app lẫn simulator) |
| Nghiệm thu | chủ dự án duyệt thị giác; kiem‑dinh kiểm 8 quy tắc §3 bằng mắt + công cụ tương phản; **không viết mã vỏ** trước khi duyệt |

## 1. Năm màn

| # | Màn | Route đích | Nội dung bắt buộc hiện trong mockup | Trạng thái phải vẽ |
|---|---|---|---|---|
| 1 | **Home theo vai** | `/` | `RoleTileGrid` cho 3 vai: operator (máy được giao + andon + việc hôm nay), supervisor (line + yield ca + 5 cảnh báo nặng), engineer (máy có lỗi + phiên Thợ Cả + việc kỹ thuật); vỏ đầy đủ (thanh đầu 5 bất biến, rail 7 vùng thu gọn/mở) | bình thường · có P1 chưa ack · dữ liệu cũ (pill tím) |
| 2 | **Phòng vận hành** (ISA‑101 L1) | `/van-hanh` | lưới line theo nhà máy (bất thường nổi, bình thường yên — xám), OEE/yield ca (số tabular), 5 cảnh báo nặng nhất (hình + số + chữ), dòng sự kiện; persona = bộ lọc, không trang riêng | bình thường · 2 line bất thường · một line mô phỏng (nhãn MÔ PHỎNG nhiều lớp) |
| 3 | **Máy L3** (faceplate v2) | `/giam-sat/may/:id` | tab Tổng quan · Tag · Cảnh báo · Recipe · Kết quả · Lịch sử · Thợ Cả; trạng thái PackML đã xác nhận; ô số có viền + đơn vị + dòng tuổi/chất lượng; spark 60 s có khoảng hở không nối; huy hiệu REMOTE/LOCAL chữ viền đen; **DỪNG MÁY luôn hiện, không bị hộp xác nhận che**; `CommandConfirmDialog` (preview: hiện tại → yêu cầu → sau công thức, mức, real/simulated, TTL 60 s, TOTP khi mức ≥ 4) | chạy · đã gửi DỪNG chờ xác nhận · đã dừng (đọc lại) · dữ liệu cũ · LOCAL (ẩn ghi) |
| 4 | **Cảnh báo** | `/canh-bao` | tab Đang mở · Andon · Lịch sử · KPI · Định nghĩa · Thông báo; bảng ưu tiên glyph ■1 ▲2 ▼3 ●4 (token `--alarm-p1..p4`), trạng thái ISA‑18.2 (active‑unacked / acked / cleared‑unacked / shelved / OOS), cột tuổi, bậc leo thang, Ack/Shelve hàng loạt; `AlarmDrawer` (cause/action, spark, journal, delivery); `AlarmChip` ở vỏ | 12 cảnh báo hỗn hợp · lũ (ALARM_FLOOD) · một hàng tag stale (giá trị tím gạch thay vì màu cảnh báo) |
| 5 | **Tài sản** | `/tai-san` | master‑detail: cây ISA‑95 trái (ảo hoá, badge số thiết bị, `OriginBadge` real/sim/qa), chi tiết asset phải (tab Tổng quan · Kết nối & tag · Chứng thực · Cấu hình · Mô hình 3D · Lịch sử); bảng tag có role icon, writable/actuation/energy; `ScopeEmptyNotice` khi ngoài phạm vi; wizard 6 bước là ngăn phủ | chọn máy thật · chọn máy sim · ngoài phạm vi |

## 2. Vỏ (chung cả 5)

- Thanh đầu: phạm vi ISA‑95 (`NodeBreadcrumb` + đổi phạm vi), `AlarmChip` (P1/P2 chưa ack), `FreshnessPill` (đẩy/hỏi vòng/mô phỏng/cũ), nhãn THẬT/MÔ PHỎNG, ⌘K, người dùng. Không `AppLauncher`, không chế độ Đơn giản/Nâng cao (Q3).
- Rail trái 7 vùng: Trang chủ · Giám sát · Sản xuất & Chất lượng · Dữ liệu chủ · Kỹ thuật · Thợ Cả · Phân tích & Quản trị; 64 px thu gọn / 240 px mở; đáy = cài đặt + theme (không điều hướng). Mục ẩn khi quyền rỗng.
- `ContextDrawer` phủ phải (ngăn Thợ Cả / chi tiết cảnh báo / máy) — vẽ 1 trạng thái mở ở màn 3.
- Breadcrumb khi sâu > 2 cấp; một `PageHeader` (tiêu đề, phụ đề ngữ cảnh, hành động, nút ngăn).

## 3. Quy tắc hệ thiết kế phải tuân (kiểm được)

1. Nền `--isa-field` xám sáng; chữ 3 mức; accent teal chỉ cho tương tác; **không xanh lá cho bình thường**.
2. Màu chỉ cho bất thường; 4 mức ưu tiên có **hình + số + chữ**; dữ liệu cũ **tím gạch thắng màu cảnh báo**; uncertain viền chấm xám; thiếu tag fault = "không có tín hiệu".
3. Chữ: Be Vietnam Pro body, Geist Mono mã/số kỹ thuật, `tabular-nums` cho số; thang 6 bậc `.ds-h1…caption`; **≥ 11 px** trên màn vận hành; **không `text-[Npx]`**, không lớp palette thô — mọi màu qua `token.css`.
4. Mật độ: `comfortable` cho 1280×800 (target chạm ≥ 48 px), `default` cho 1920×1080; vẽ cả hai.
5. Tương phản ≥ 4,5:1 cho giá trị (ghi số đo kèm ảnh).
6. Hoạt ảnh chỉ CSS, tôn trọng `prefers-reduced-motion`; STOP ba trạng thái (T6 spec v3); không hoạt ảnh khi dữ liệu cũ.
7. i18n: mọi chuỗi là khoá `vi` (mockup dùng tiếng Việt, ghi khoá dự kiến theo namespace vùng).
8. Mô phỏng: viền xanh ngọc 4 px + banner + watermark + pill (spec v3 §7) — không bỏ sót ở màn 2.

## 4. Cách làm (tham khảo spec v3 — đã làm mockup 4 trạng thái rất tốt)

- HTML + CSS tĩnh, không framework; token khai ở `token.css` (`--isa-*`, `--alarm-p1..p4`, `--packml-*`, `--stale`, `--sim`, `--actuation-1/3/4/5`, chữ, khoảng cách, bán kính) — chính tệp này sẽ thành `index.css` của app ở pha 2 (90‑P3) và được simulator đọc (Q9).
- Dữ liệu giả **mang chất lượng + tuổi** (không chỉ giá trị) để vẽ được trạng thái cũ/uncertain.
- Chụp ảnh bằng Playwright trên `mockup.html` (không cần server app); đặt tên `man-<n>-<trang-thai>-<kich-thuoc>.png`.
- Mỗi màn kèm 5–10 dòng "quyết định thị giác" + câu hỏi cho chủ dự án (nếu có); **không** mở rộng phạm vi quá 5 màn.

## 5. Bàn giao

- luong‑ui: màn 1, 4, 5 + vỏ + `token.css`; scada‑ui: màn 2, 3 (kế thừa mockup spec v3, ký hiệu 6 cái đầu, faceplate v2).
- Thời gian: cùng cửa sổ pha 0 (≈ 1 tuần); trình chủ dự án duyệt trước khi 90‑P3 bắt đầu.
- Sau duyệt: ghi quyết định vào 90 §4.2 (Nhật ký) và chuyển `token.css` thành việc đầu tiên của pha 2.
