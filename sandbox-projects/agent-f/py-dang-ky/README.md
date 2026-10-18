# dang_ky — đăng ký tham dự sự kiện

- `dang_ky/mo_hinh.py` — `NguoiDangKy`
- `dang_ky/kho.py` — `KhoBoNho` (lưu trong bộ nhớ, cấp mã `DK-0001`, ...)
- `dang_ky/thong_diep.py` — bảng thông điệp + hàm `t(khoa, **tham_so)`
- `dang_ky/dich_vu.py` — `DichVuDangKy.dang_ky(du_lieu)` nhận dict từ form, trả mã đăng ký; lỗi ⇒ `LoiDangKy`

Python ≥ 3.10, chỉ thư viện chuẩn. Chạy test: `python -m pytest tests`
