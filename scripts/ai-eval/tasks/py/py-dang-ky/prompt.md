Form đăng ký trong dự án sandbox-projects/agent-f/py-dang-ky (Python, xem README) đang nhận dữ liệu bẩn. Thêm kiểm tra hợp lệ và thông báo lỗi song ngữ Việt/Anh:

1. Module mới `dang_ky/kiem_tra.py`: dataclass `LoiTruong(truong: str, ma: str)` và hàm `kiem_tra(du_lieu: dict) -> list[LoiTruong]`. Kiểm theo thứ tự trường `ho_ten`, `email`, `tuoi`, `so_dien_thoai`; mỗi trường tối đa MỘT lỗi (lỗi đầu tiên gặp); hợp lệ thì trả danh sách rỗng.
   - `ho_ten`: thiếu, `None` hoặc rỗng sau khi bỏ khoảng trắng ⇒ `bat_buoc`; độ dài (sau strip) < 2 hoặc > 80 ⇒ `do_dai`.
   - `email`: thiếu/rỗng ⇒ `bat_buoc`; không có dạng `phần@tên.miền` (đúng một `@`, không khoảng trắng, phần sau `@` có dấu chấm với ký tự ở hai bên) ⇒ `email_sai`.
   - `tuoi`: thiếu/rỗng ⇒ `bat_buoc`; không phải số nguyên (chấp nhận `int` hoặc chuỗi chỉ gồm chữ số) ⇒ `khong_phai_so`; ngoài 16..100 ⇒ `ngoai_khoang`.
   - `so_dien_thoai`: KHÔNG bắt buộc (thiếu, `None`, chuỗi rỗng đều được). Có thì sau khi bỏ dấu cách và dấu chấm phải là `0` + 9 chữ số hoặc `+84` + 9 chữ số, không thì `sdt_sai`.
2. `dang_ky/thong_diep.py`: thêm tiếng Anh; đổi thành `t(khoa, ngon_ngu="vi", **tham_so)`. Khoá thiếu trong ngôn ngữ đã chọn, hoặc ngôn ngữ lạ, thì dùng tiếng Việt. Bảng thông điệp (vi / en):
   - `bat_buoc`: `{ten_truong} là bắt buộc` / `{ten_truong} is required`
   - `do_dai`: `{ten_truong} phải dài từ 2 đến 80 ký tự` / `{ten_truong} must be 2 to 80 characters long`
   - `email_sai`: `Email không hợp lệ` / `Invalid email address`
   - `khong_phai_so`: `{ten_truong} phải là số nguyên` / `{ten_truong} must be a whole number`
   - `ngoai_khoang`: `{ten_truong} phải từ 16 đến 100` / `{ten_truong} must be between 16 and 100`
   - `sdt_sai`: `Số điện thoại không hợp lệ` / `Invalid phone number`
   - `email_trung`: (đã có) / `Email is already registered`
   - tên trường `{ten_truong}`: ho_ten = `Họ tên` / `Full name`; email = `Email` / `Email`; tuoi = `Tuổi` / `Age`; so_dien_thoai = `Số điện thoại` / `Phone number`.
3. `DichVuDangKy.dang_ky(du_lieu, ngon_ngu="vi")`: chạy `kiem_tra` trước; có lỗi thì KHÔNG lưu gì và ném `LoiDangKy` có thuộc tính `loi` = danh sách dict `{"truong", "ma", "thong_diep"}` (thông điệp theo `ngon_ngu`), `str(lỗi)` = các thông điệp nối bằng `"; "`. Email trùng vẫn báo như cũ nhưng theo `ngon_ngu`, với `loi = [{"truong": "email", "ma": "email_trung", "thong_diep": ...}]`. Hợp lệ thì lưu `ho_ten` đã strip, `tuoi` kiểu `int`, số điện thoại đã bỏ dấu cách/dấu chấm (không có thì `None`).

Test hiện có phải vẫn xanh: `python -m pytest sandbox-projects/agent-f/py-dang-ky/tests`.
