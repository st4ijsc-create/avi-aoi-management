# Màn 2 (Phòng vận hành) + Màn 3 (Máy L3 / faceplate v2) — quyết định thị giác

Phiên: scada-ui, 2026-11-03. Phạm vi: chỉ màn 2 và 3 trong brief `docs/techdocs/ke-hoach/2026-11-03-mockup-5-man-brief.md`. Vỏ (rail, thanh đầu) vẽ TẠM để đủ khung; vỏ thật là của luong-ui (`shell.css`). Số liệu là GIẢ, mỗi giá trị mang chất lượng + tuổi. Chưa có mã app nào được viết.

Xem: `man-2-3.html` (bấm đổi màn / trạng thái / cỡ; `?bare=1&man=2|3&state=…&w=1280|1920` cho ảnh). Token: `token.css` của luong-ui (bản sao, KHÔNG sửa giá trị) qua `@import` trong `man-2-3.css`.

## Ảnh (20 tệp, `man-<n>-<trạng-thái>-<cỡ>.png`)
- Màn 2 (×2 cỡ): `binh-thuong`, `2-line-bat-thuong`, `mo-phong`.
- Màn 3 (×2 cỡ): `chay`, `dung-cho` (đã gửi DỪNG chờ xác nhận), `da-dung` (đọc lại khớp), `du-lieu-cu`, `local` (ẩn ghi), `lenh-ghi` (hộp xác nhận lệnh), `tho-ca` (ngăn Thợ Cả).
- 1280×800 = `data-density=comfortable` (chạm ≥ 48 px, rail thu 64 px); 1920×1080 = `default` (rail mở 240 px).

## Màn 2 — quyết định thị giác
1. Bình thường = YÊN: thẻ line nền `--isa-surface`, viền xám, chữ `--text-1`; không có màu, không xanh lá. Chỉ bất thường mới có màu.
2. Bất thường nổi bằng 4 lớp: viền trái 6 px màu ưu tiên + nền `-soft` + glyph (■1 ▲2 ▼3 ●4) + chữ "P1 Nghiêm trọng". Không dựa riêng màu.
3. Dữ liệu cũ THẮNG màu cảnh báo: line 6 có P2 nhưng dữ liệu cũ 41 s ⇒ thẻ tím sọc + gạch ngang giá trị, KHÔNG cam; hàng cảnh báo tương ứng cũng tím với chữ "◆ cũ" và nhãn "dữ liệu cũ"; banner trang nói rõ "cảnh báo của line này không còn đáng tin".
4. KPI ca (OEE, yield, sản lượng, dừng máy) là ô số Geist Mono tabular, kèm "chất lượng · tuổi" ngay dưới; chú thích khi số bị ảnh hưởng ("có 1 line dữ liệu cũ", "không gồm line mô phỏng").
5. Mô phỏng nhiều lớp (spec v3 §7), trên MỘT line: viền 4 px `--sim` + dải đặc "MÔ PHỎNG · không tính vào OEE nhà máy" + watermark chéo + pill; thêm banner trang và nhãn "+ 1 line MÔ PHỎNG" ở thanh đầu. Số của line mô phỏng KHÔNG cộng vào KPI nhà máy (nói rõ bằng chữ).
6. 5 cảnh báo nặng nhất: hình + số + chữ, tuổi, máy, trạng thái ISA-18.2 rút gọn (chưa ack in đậm, đã ack mờ). Bình thường chỉ còn 3 mục P3/P4 đã ack, không bịa đủ 5.
7. Persona = bộ lọc (Tất cả / Giám sát / Kỹ thuật) ở PageHeader, không trang riêng.
8. 1920×1080: cùng bố cục, số to hơn (44 px), thẻ cao hơn; khoảng trống phía dưới là chủ ý (phòng vận hành ít là yên).

## Màn 3 — quyết định thị giác
1. DỪNG MÁY luôn hiện, đặt trên một lớp riêng (portal) cao hơn cả scrim của hộp xác nhận ⇒ không bị hộp lệnh che (50 §4.1). Ở trạng thái dữ liệu cũ vẫn bấm được (viền đứt + dòng "vẫn gửi được dù dữ liệu cũ"). Ngăn Thợ Cả mở thì nút dịch sang trái ngăn, không bị che.
2. DỪNG ba trạng thái tách rời, không dùng chung một màu: "1 · Đã gửi → 2 · Máy nhận (chờ N s, nhấp nháy) → 3 · Đọc lại khớp (PackML Stopped)". Ở "chờ" PackML VẪN hiện Execute kèm chú thích "chưa xác nhận dừng"; chỉ khi đọc lại khớp mới hiện Stopped.
3. PackML hiện cả dãy trạng thái; trạng thái hiện tại có viền đậm + chữ + dấu (▶ Execute / ■ Stopped); khi dữ liệu cũ: "? Execute? — không rõ" viền đứt tím, không khẳng định.
4. Ô số: viền = ô số; số lớn Geist Mono; đơn vị; dòng dưới "chất lượng · tuổi". Tốt = viền đặc đen; nghi ngờ = viền CHẤM xám; cũ = viền đứt tím + nền sọc + gạch ngang số + "CŨ · 42 s"; thiếu tín hiệu = chữ "Không có tín hiệu" (không số, không 0).
5. Spark 60 s: khoảng hở KHÔNG nối và luôn tô sọc TÍM (D10 / 01-QUY-UOC §9 #7: không có mẫu vì mất kết nối = `quality=bad` = "không tin được", cùng ký hiệu với dữ liệu cũ); khi dữ liệu cũ phần đuôi còn có nét đứt tím. Xám CHẤM chỉ dành cho `uncertain`. Khi dừng, đường rơi về 0 thật.
6. Huy hiệu REMOTE = chữ viền đen đặc; LOCAL = chữ viền đen nền sọc; kèm chữ, không chỉ màu. LOCAL ẩn khối ghi, thay bằng ghi chú; DỪNG MÁY vẫn hiện.
7. Khối ghi: nhãn có dải + bước; dòng điều kiện "Được phép · ▲ Mức 4 cần TOTP" hoặc "Không cho phép: …"; nút "Đổi…" mở hộp; bị khoá (viền đứt) khi dừng/chờ dừng/dữ liệu cũ.
8. CommandConfirmDialog: preview 3 ô "Hiện tại → Yêu cầu → Sau công thức" (ô cuối viền đậm), mức tác động (token `--actuation-N` + hình ▲ + số), nhãn THẬT/MÔ PHỎNG + lý do bắt buộc, TTL 60 s đếm từ lúc nhận (số + thanh), ô TOTP chỉ hiện ở mức ≥ 4. Dùng chung HopThoaiLenh tổng quát hoá.
9. Ngăn Thợ Cả = ContextDrawer phủ phải 380 px có chip ngữ cảnh; đề xuất hiển thị khung ĐỨT, "CHƯA thực hiện", "Thợ Cả không tự gửi" — AI không bao giờ thực thi.
10. Ba nhóm trạng thái dùng ba KÝ HIỆU riêng để khỏi lẫn: tím sọc = dữ liệu cũ; xanh ngọc đặc + dải chữ = mô phỏng; viền đứt đen/xám = bị khoá/không cho phép.

## Đo tương phản (công thức WCAG 2.x; cặp màu lấy từ `token.css` của luong-ui @ba1315563)
| Cặp (chữ/nền) | Tỉ lệ |
|---|---|
| `--text-1` / `--isa-surface` | 14,45 |
| `--text-2` / `--isa-surface` | 8,17 |
| `--text-3` / `--isa-surface` | 5,58 |
| `--text-3` / `--isa-field` | 4,87 |
| `--stale` / `--stale-soft` (giá trị cũ) | 5,17 |
| `--stale` / `--isa-surface` | 6,35 |
| `--alarm-p1` / surface (glyph chữ) | 5,55 |
| `--alarm-p3` / surface | 5,10 |
| `--alarm-p4` / surface | 5,35 |
| `--alarm-p2` / surface | **4,33 ✗** — vì vậy chữ "P2 Cao" dùng `--alarm-p2-ink`, glyph (đồ hoạ ≥ 3:1) giữ `--alarm-p2` |
| trắng / `--alarm-p1` (glyph, nút DỪNG MÁY) | 5,90 |
| trắng / `--alarm-p2` (glyph) | 4,60 |
| trắng / `--alarm-p3`, `--alarm-p4` | 5,42 · 5,68 |
| trắng / `--sim` (dải MÔ PHỎNG) | 5,20 |
| `--sim-ink` / `--sim-soft` (banner) | 7,51 |
| `--alarm-p1-ink` / `--alarm-p1-soft` | 7,09 |
| `--text-1` / `--alarm-p1-soft` (thẻ line P1) | 11,66 |
| trắng / `--accent` (nút) | 6,77 |
| trắng / `--actuation-4`, `--actuation-3`, `--packml-stopped` | 4,60 · 5,42 · 9,34 |
Thang chữ nhỏ nhất dùng: 11 px (caption); phần lớn ≥ 12,5 px. Không dùng `text-[Npx]` hay màu hex trong `man-2-3.css` (mọi màu qua token).

## Luật đã chốt (chu-du-an-HST, 2026-11-03)
- Chữ ưu tiên (P1–P4) LUÔN dùng `--alarm-pN-ink`; glyph/viền dùng màu chính `--alarm-pN` (đồ hoạ ≥ 3:1). Áp cho cả 4 mức.
- Khoảng hở/mất kết nối trong spark = tím sọc (như dữ liệu cũ); uncertain = viền/nét chấm xám. KHÔNG thêm màu đỏ nhạt.
- Hộp xác nhận minh hoạ: setpoint mặc định mức 3; ví dụ hiển thị mức 4 + TOTP ghi rõ "kỹ sư đã siết tag này lên mức 4".
- Chờ chủ dự án: Q1 (accent ≈ sim; khuyến nghị đổi accent sang xanh lam đậm, --sim giữ xanh ngọc độc quyền), Q3 (khuyến nghị: KHÔNG đổi nhãn PackML; thêm huy hiệu tạm nhấp nháy "Dừng — chờ máy xác nhận" cạnh nhãn, biến mất khi đọc lại khớp).

## Câu hỏi cho chủ dự án
1. `--accent` (#0b6477) và `--sim` (#0a7a72) đều xanh ngọc, rất gần nhau. Trong mockup, mô phỏng luôn đi kèm viền 4 px + dải chữ + watermark nên không nhầm với nút/tab; có muốn đẩy `--accent` sang một màu khác (ví dụ xanh lam đậm) để tách hẳn không?
2. `--alarm-p2` (#c25400) đạt 4,33:1 trên nền thẻ — chữ P2 phải dùng ngả ink. Chấp nhận quy tắc "chữ ưu tiên luôn dùng `-ink`, glyph/viền dùng màu chính"?
3. Trạng thái DỪNG chờ xác nhận: PackML vẫn hiện Execute + chú thích (không hiện "Stopping"). Chủ dự án có muốn thêm trạng thái trung gian "Dừng — chờ máy xác nhận" lên chính nhãn PackML?
4. (ĐÃ TRẢ LỜI — xem Luật đã chốt) Spark: khoảng hở = tím sọc, không thêm đỏ nhạt.

## Chưa làm / giới hạn
- Chưa có màn 1/4/5 và vỏ thật (luong-ui); `man-2-3.css` có vỏ tạm.
- Chưa vẽ tab Tag/Cảnh báo/Recipe/Kết quả/Lịch sử/Thợ Cả bên trong màn 3 (chỉ tab Tổng quan + ngăn Thợ Cả).
- Chưa kiểm bằng công cụ tương phản tự động ngoài phép tính tay ở trên; chưa kiểm `prefers-reduced-motion` bằng trình duyệt (CSS có `@media`).

## Phông số (theo luong-ui, token.css @4d5e78c7c)
Số đo (`.num`) dùng Be Vietnam Pro + `tabular-nums` (dấu phẩy thập phân trong Geist Mono rộng bất thường: "96 , 4"); Geist Mono (`.mono`) chỉ cho mã, địa chỉ, giờ, mã TOTP. 20 ảnh đã chụp lại theo quy ước này.

## Vỏ dùng chung (cập nhật theo luong-ui)
Từ bản này màn 2/3 dùng `shell.css` + `shell.js` của luong-ui (nhánh `docs/mockup-man-1-4-5` @9eb5671d9): `.app .hdr .rail .main .page-h .tabs .btn .seg .pill .fresh .origin .alarm-badge .alarm-chip .drawer .sim-banner`, rail SÁNG (`data-rail-tone="light"`), thanh đầu theo 5 bất biến. Huy hiệu ưu tiên là `.alarm-badge` (glyph + số + chữ). `man-2-3.css` chỉ còn phần nội dung (ô số, thẻ line, PackML, DỪNG MÁY ba trạng thái, hộp lệnh, ngăn Thợ Cả). Khi gộp, `token.css`, `shell.css`, `shell.js`, `fonts/` của luong-ui phải nằm cùng thư mục (không commit ở nhánh này). Mục "Màn 3 — quyết định 1" (DỪNG MÁY trên portal) dùng token `--stop` / `--stop-ink`.
