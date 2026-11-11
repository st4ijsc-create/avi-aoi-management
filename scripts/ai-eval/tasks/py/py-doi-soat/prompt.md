Dự án sandbox-projects/agent-f/py-doi-soat (Python, tiện ích tồn kho, xem README) cần công cụ ĐỐI SOÁT tồn sổ sách với tồn kiểm kê. Hai tệp vào là CSV UTF-8, dòng đầu là tiêu đề, có các cột `ma,ten,so_luong` (xem `du_lieu/`).

1. Gói mới `doi_soat/` (ở gốc dự án), xuất từ `doi_soat/__init__.py`: `doc_ton`, `so_khop`, `dinh_dang`, `ChenhLech`.
   - `doi_soat/doc_csv.py` — `doc_ton(duong) -> dict[str, int]`: mã → tổng số lượng. Mã chuẩn hoá bằng `chuan_hoa_ma` (có sẵn trong `chuan_hoa.py`); mã trùng trong một tệp thì CỘNG DỒN; `so_luong` bỏ khoảng trắng hai đầu rồi đọc số nguyên. Thiếu một trong ba cột ⇒ `ValueError("thiếu cột: <tên cột>")`. `so_luong` không phải số nguyên ⇒ `ValueError` có chữ `dòng <n>` (n đếm cả dòng tiêu đề là dòng 1).
   - `doi_soat/so_khop.py` — `ChenhLech` có thuộc tính `ma`, `so_sach`, `kiem_ke`, `chenh` (= `kiem_ke - so_sach`); `so_khop(so_sach, kiem_ke)` nhận hai dict như trên, trả list `ChenhLech` của các mã có `chenh != 0`, xếp theo mã tăng dần; mã chỉ có ở một phía thì phía kia là 0.
   - `doi_soat/bao_cao.py` — `dinh_dang(ds) -> str`, ĐÚNG từng ký tự: dòng đầu `MA|SO_SACH|KIEM_KE|CHENH`; mỗi chênh lệch một dòng `<ma>|<so_sach>|<kiem_ke>|<chenh>`; dòng cuối `TONG|<số dòng chênh>|<tổng chenh>`. `chenh` và tổng ghi DẤU khi dương (`+2`), âm như thường (`-3`), không là `0`. Mỗi dòng kết thúc bằng `
` (kể cả dòng cuối). Danh sách rỗng ⇒ `MA|SO_SACH|KIEM_KE|CHENH
TONG|0|0
`.
2. CLI `scripts/chay_doi_soat.py`, chạy từ gốc dự án: `python scripts/chay_doi_soat.py <so_sach.csv> <kiem_ke.csv> [--out <tệp>]`.
   - In báo cáo (`dinh_dang`) ra stdout. Có `--out`: ghi báo cáo ra tệp đó, stdout chỉ in đúng một dòng `Đã ghi báo cáo <N> dòng chênh ra <tệp>` (N = số dòng chênh, `<tệp>` y như tham số).
   - Mã thoát: 0 nếu không có chênh lệch, 1 nếu có, 2 nếu lỗi dữ liệu vào (tệp không mở được, thiếu cột, số lượng hỏng): khi đó stdout rỗng và stderr bắt đầu bằng `Lỗi: `.
   - Test chạy CLI trong tiến trình con với `PYTHONUTF8=1`.
3. Test của bạn: `tests/test_doi_soat.py`, ít nhất 4 hàm `test_...`, phải xanh.
4. Thêm vào `README.md` một mục tiêu đề đúng `## Đối soát tồn kho`, có một khối ```bash mà dòng lệnh đầu tiên chạy được nguyên văn từ gốc dự án trên dữ liệu mẫu `du_lieu/so_sach.csv` và `du_lieu/kiem_ke.csv`.

Test hiện có phải vẫn xanh: `python -m pytest sandbox-projects/agent-f/py-doi-soat/tests`.
