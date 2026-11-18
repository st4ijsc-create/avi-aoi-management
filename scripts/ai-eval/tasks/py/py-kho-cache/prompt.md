Dự án sandbox-projects/agent-f/py-kho-cache (Python, quản lý tồn kho, xem README): `RepoTep` đọc lại tệp JSON ở mỗi lần gọi nên chậm. Hãy thêm lớp cache:

1. Module mới `kho/repo_cache.py`, lớp `RepoCoCache(nguon, ttl_giay=30.0, dong_ho=time.monotonic)` bọc bất kỳ repo nào có `lay/luu/xoa/tat_ca`:
   - `lay(ma)`: còn hạn thì trả từ cache, không thì gọi `nguon.lay` rồi lưu vào cache — kết quả `None` (không có sản phẩm) cũng được cache. Mục hết hạn khi `dong_ho() - thời_điểm_nạp >= ttl_giay`.
   - `luu(sp)`: ghi xuống nguồn trước (write-through) rồi cập nhật cache; `xoa(ma)`: xoá ở nguồn, bỏ mục khỏi cache, trả về đúng kết quả của nguồn.
   - `tat_ca()`: luôn đọc từ nguồn, không cache.
   - Luôn trả BẢN SAO: người gọi sửa đối tượng nhận được (kể cả `DichVuKho.xuat` khi báo lỗi không đủ hàng) không được làm hỏng dữ liệu trong cache.
   - `thong_ke()` trả `{"trung": <số lần lay trúng cache>, "truot": <số lần lay phải đọc nguồn>}`; `xoa_cache()` xoá hết cache.
2. `DichVuKho(repo, cache_ttl=None, dong_ho=None)`: khi `cache_ttl` khác `None` thì tự bọc repo bằng `RepoCoCache` với TTL đó (và `dong_ho` nếu được truyền). Thêm `thong_ke_cache()` trả thống kê của cache, hoặc `None` khi không dùng cache.
3. Xuất `RepoCoCache` từ `kho/__init__.py`.

Test hiện có phải vẫn xanh: `python -m pytest sandbox-projects/agent-f/py-kho-cache/tests`.
