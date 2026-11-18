# van_chuyen — tính phí giao hàng

Gói Python nhỏ tính phí giao hàng theo khối lượng (kg) và khoảng cách (km).

- `van_chuyen/phi.py` — hàm tính phí gốc.
- `van_chuyen/don_hang.py` — lớp `DonHang` (giá hàng, khối lượng, khoảng cách).
- `van_chuyen/bao_gia.py` — báo giá cho nhiều kiện, chọn kiện rẻ nhất.
- `van_chuyen/hoa_don.py` — tổng hoá đơn, phí giao nội thành.
- `van_chuyen/khuyen_mai.py` — phí sau khi giảm theo phần trăm.

Biểu phí chuẩn: 15 000 đ cơ bản + 2 000 đ mỗi kg (làm tròn LÊN tới kg nguyên) + 500 đ mỗi km (làm tròn LÊN tới km nguyên),
tối thiểu 20 000 đ.

Chạy test: `python -m pytest sandbox-projects/agent-f/py-doi-chu-ky/tests`
