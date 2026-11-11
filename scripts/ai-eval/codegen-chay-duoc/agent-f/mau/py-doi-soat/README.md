# py-doi-soat — tiện ích tồn kho

Các tiện ích nhỏ cho dữ liệu tồn kho dạng CSV.

- `chuan_hoa.py` — `chuan_hoa_ma(ma)`: chuẩn hoá mã hàng (bỏ khoảng trắng hai đầu, viết hoa).
- `du_lieu/` — dữ liệu mẫu: `so_sach.csv` (tồn theo sổ sách) và `kiem_ke.csv` (tồn kiểm kê thực tế).

Chạy test: `python -m pytest sandbox-projects/agent-f/py-doi-soat/tests`

## Đối soát tồn kho

So tồn sổ sách với tồn kiểm kê, in các mã chênh lệch:

```bash
python scripts/chay_doi_soat.py du_lieu/so_sach.csv du_lieu/kiem_ke.csv
```

Mã thoát: 0 = khớp hết, 1 = có chênh lệch, 2 = lỗi dữ liệu vào.
