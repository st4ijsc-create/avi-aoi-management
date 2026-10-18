# kho — quản lý tồn kho nhỏ

- `kho/mo_hinh.py` — `SanPham`, `LoiKho`
- `kho/repo_tep.py` — `RepoTep`: lưu sản phẩm trong một tệp JSON (đọc/ghi tệp ở MỖI lần gọi)
- `kho/dich_vu.py` — `DichVuKho`: nghiệp vụ nhập/xuất/tồn, nhận một repo bất kỳ có `lay/luu/xoa/tat_ca`

Python ≥ 3.10, chỉ thư viện chuẩn. Chạy test: `python -m pytest tests`
