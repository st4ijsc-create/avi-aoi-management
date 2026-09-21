# `scripts/do-twin/` — PHÉP ĐO CHỐNG LƯNG CHO KHẲNG ĐỊNH TRONG MÃ

Đây **không phải** lưới kiểm (`*.unit.test.ts`). Lưới kiểm chạy trong `vitest` và canh **cơ
chế**; những kịch bản dưới đây chạy trên **trình duyệt thật / cơ sở dữ liệu thật** và trả về
**kết cục người dùng nhận được**. Chúng ở trong `scripts/` — chứ không nằm trong một thư mục đo
tạm — vì một lý do đã trả giá:

> ★★★ **Bốn con số không có truy vấn thì không phải bằng chứng — nó là một tin đồn có chữ số
> thập phân.**
>
> Mục backlog **V-21(1)** ghi *"tỉ lệ cảnh báo theo hạng sức khoẻ 53,5 / 49,6 / 49,7 / 55,8 %"*
> mà **không ghi truy vấn nào** sinh ra chúng. Khi đo lại ra một bức tranh khác hẳn
> (14,5 → 31,3 → 45,5 → 58,2 %), **không phân biệt được** *"dữ liệu đã đổi"* với *"phép đo cũ
> định nghĩa khác"* — mất luôn khả năng so trước/sau của cả một phát hiện.

Mỗi docblock trong `client/src/components/twin3d/` có bảng số đều phải trỏ được về một kịch bản
ở đây. Nếu một con số trong mã không có kịch bản tương ứng, **con số ấy đã hết hạn kiểm chứng**.

## Điều kiện chạy — bỏ một cái là số vô nghĩa

| | |
|---|---|
| **Máy chủ** | `http://127.0.0.1:3000` đang phục vụ **bản dựng mới nhất**. Kiểm `dist/BUILD-INFO.txt`: `luc-dung` phải **mới hơn** tệp nguồn cuối, và `client-index-html-mtime` phải khớp thứ đang phục vụ. |
| **Ép GPU** | `--use-gl=angle --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`. Chromium headless mặc định raster **bằng phần mềm**; một phát hiện "long task" của vòng 4 hoá ra là **hiện vật SwiftShader** — ép GPU thì 0 long task / 60 fps mà không đổi một dòng mã. |
| **Chế độ đo** | URL phải có `?do=1`. Không có nó thì `laCheDoDo()` sai và **mọi sổ `window.__dem*` biến mất** — kịch bản sẽ báo "không đo được" trong khi sản phẩm hoàn toàn bình thường. |
| **Tài khoản** | `qatd_admin` / `Qatd!2026`. |
| **CSDL** | `DATABASE_URL` trong môi trường (hai kịch bản `.mts` đọc thẳng CSDL). |

## Danh sách

| kịch bản | trả lời câu gì | số nó chống lưng |
|---|---|---|
| `3d-co-bieu-tuong-toa.mjs` | cỡ từng biểu tượng toà trên cảnh 3D tập đoàn, hai khung | **14/14** đạt 24 px · nhỏ nhất **25,0 px** @1280×720 |
| `san-chieu-cao-va-24px.mts` | sàn chiều cao nào đủ cho tiêu chí 24 px, trên **dữ liệu thật** | bảng sàn 6/16/18/20/30 m trong docblock `BIEU_TUONG_CAO_TOI_THIEU_MM` |
| `2d-tam-bieu-tuong-bi-che.mjs` | tâm biểu tượng 2D có bấm trúng chính nó không, và **ai** che | **14/14** thông tâm; 7/7 lớp phủ đều khai `data-che-nhan` |
| `2d-dien-tich-con-bam-duoc.mjs` | còn bao nhiêu **% diện tích** và ô vuông trống lớn nhất | bảng 21 %/6×6 px · 34 %/8×8 px trong docblock `khungNhinBan2D` |
| `bam-nen-co-xoa-dau-chon.mjs` | PH-42 — bấm nền có xoá dấu chọn khỏi cảnh không | **7,43 %** canvas đổi, vùng 624×301; đối chứng âm **0/672.570 px** |
| `canh-bao-theo-hang-suc-khoe.mts` | V-21(1) — tỉ lệ cảnh báo theo hạng sức khoẻ, kèm **đối chứng xáo trộn** | 14,5 → 31,3 → 45,5 → 58,2 %; biên độ thật 43,7 vs xáo 11,6, **0/200** |
| `ra-soat-du-lieu-twin.mts` | 12 phép kiểm hợp lý hình học trên 4 bảng | ⚠ **tập rỗng ⇒ chỉ canh TRÔI LƯỢC ĐỒ**, không nói gì về dữ liệu; `--yeu-cau-du-lieu` biến rỗng thành đỏ |
| `khoa-may-va-doi-soat.mts` | *"1.699 khoá sống · cần cấp 0"* — còn đúng không? | **549/1.700** có khoá · **CẦN CẤP 1.149** · 0 có-khoá-chưa-duyệt. Mã thoát 1 khi cần cấp > 0 |
| `lop-phu-an-bao-nhieu-canvas.mjs` | *"lớp phủ ăn 58,2 % canvas"* — còn đúng không? | panel **MỞ 56,7 %** · **THU 11,3 %** (hợp diện tích `[data-che-nhan]` ∩ canvas) |

## Ba luật rút ra từ chính các kịch bản này

1. **Đối chứng ÂM và DƯƠNG đi cùng nhau.** `bam-nen-co-xoa-dau-chon.mjs` là lượt **thứ tư**; ba
   lượt đầu lần lượt đo **camera**, đo **hư không**, rồi đo **lớp nền mờ của ngăn chi tiết** —
   mỗi lần một đối chứng bắt được. Một phép so ảnh trả "0 px khác" là vô nghĩa nếu nó chưa
   chứng minh được rằng nó **biết kêu**.
2. **Mỗi bề mặt một sổ riêng.** `hopKhoiMay()` tồn tại ở `/factory-command` nhưng trả **0 phần
   tử**; sổ đúng là `dsMay()` với **1.699** máy. Mang bộ chọn của màn này sang màn kia là tự
   sinh âm tính giả.
3. **Một phép đo chỉ nhìn chỗ mình chọn thì không bao giờ thấy chỗ mình không chọn.** Mọi lần
   báo *"cây sạch"* bằng `git status` với pathspec hẹp đều không nhìn tới `.qa-*` — và giấu
   mất **4.726 lượt xoá** chưa ghi nhận.
