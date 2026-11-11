Dự án sandbox-projects/agent-f/py-doi-chu-ky (Python, gói `van_chuyen` tính phí giao hàng, xem README) cần đổi chữ ký hàm `tinh_phi` trong `van_chuyen/phi.py`.

1. Thêm vào `van_chuyen/phi.py` hai dataclass BẤT BIẾN (`frozen=True`):
   - `DonVanChuyen(khoi_luong, khoang_cach)` — kg và km.
   - `BieuPhi(co_ban=15000, moi_kg=2000, moi_km=500, toi_thieu=20000)`, và hằng `BIEU_PHI_CHUAN = BieuPhi()`.
2. Đổi `tinh_phi(khoi_luong, khoang_cach)` thành `tinh_phi(don, *, bieu_phi=BIEU_PHI_CHUAN)`: `don` là `DonVanChuyen`, `bieu_phi` CHỈ truyền theo tên. Công thức như cũ nhưng lấy số từ `bieu_phi`: `co_ban + moi_kg * ceil(khoi_luong) + moi_km * ceil(khoang_cach)`, không thấp hơn `toi_thieu`.
   - `don` không phải `DonVanChuyen` (ví dụ lời gọi kiểu cũ `tinh_phi(2, 10)`) ⇒ `TypeError`. Khối lượng hoặc khoảng cách âm ⇒ `ValueError` như cũ.
3. Sửa MỌI nơi trong gói đang dùng `tinh_phi` (trực tiếp hoặc gián tiếp) sang chữ ký mới. Hành vi công khai của gói GIỮ NGUYÊN: mọi hàm và phương thức khác (`DonHang.phi_giao`, `bao_gia_nhieu`, `bao_gia_re_nhat`, `tong_hoa_don`, `phi_giao_noi_thanh`, `phi_sau_giam`) giữ chữ ký và trả đúng số như trước. Ví dụ: `DonHang("A1", 100000, 2.3, 12.5).phi_giao()` vẫn là `27500`; `phi_giao_noi_thanh(3.5)` vẫn là `25500`.
4. Xuất `DonVanChuyen`, `BieuPhi`, `BIEU_PHI_CHUAN` từ `van_chuyen/__init__.py` (cả trong `__all__`).

Test hiện có phải vẫn xanh: `python -m pytest sandbox-projects/agent-f/py-doi-chu-ky/tests`.
