# thu-vien

Quản lý thư viện nhỏ (kho sách, mượn/trả) — JavaScript ESM chạy thẳng bằng Node, không cần `npm install`.

- `src/tienIch.mjs` — tiện ích chuỗi và ngày (ngày luôn tính theo **UTC**, định dạng `YYYY-MM-DD`).
- `src/sach.mjs` — `KhoSach`: thêm/lấy/tìm sách, danh sách xếp theo tên kiểu tiếng Việt.
- `src/muon.mjs` — `QuanLyMuon`: mượn, trả, hạn trả, số ngày trễ.
- `src/index.mjs` — điểm xuất công khai.
- Chạy test: `node --test test/thuVien.test.mjs`
