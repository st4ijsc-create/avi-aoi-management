# bang-diem

Sổ điểm của một lớp: bài kiểm tra có hệ số, điểm trung bình, xếp loại, báo cáo lớp. Python thuần (3.11+), không phụ thuộc ngoài.

- `diem/mo_hinh.py` — `BaiKiemTra(ten, diem, he_so=1)`, `HocSinh(ma, ho_ten, bai=[])`.
- `diem/tinh.py` — `trung_binh(bai)`: trung bình CÓ HỆ SỐ, làm tròn 2 chữ số kiểu nửa-lên; không có bài ⇒ `None`.
- `diem/xep_loai.py` — `xep_loai(dtb)`: Giỏi ≥ 8 · Khá ≥ 6,5 · Trung bình ≥ 5 · Yếu; `None` ⇒ `None`.
- `diem/bao_cao.py` — `bao_cao_lop(hoc_sinh)`: mỗi học sinh một dòng.
- `diem/cu.py` — mã cũ, đang chờ dọn.
- Chạy test: `python -m pytest tests`
