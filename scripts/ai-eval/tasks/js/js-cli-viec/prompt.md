Dự án CLI sandbox-projects/agent-f/js-cli-viec (quản lý danh sách việc, Node thuần, xem README) cần thêm lệnh con `export`:

- `viec export --csv` in CSV ra stdout (qua `io.ghi`). Cột theo thứ tự `id,tieuDe,xong,han` (dòng đầu là tiêu đề cột); `xong` ghi `1` hoặc `0`; `han` để trống nếu việc không có hạn. Dòng ngăn bằng `\n` và có `\n` ở cuối. Trường nào chứa dấu phẩy, nháy kép hoặc xuống dòng thì bọc trong nháy kép, nháy kép bên trong nhân đôi (RFC 4180). Kho rỗng thì chỉ có dòng tiêu đề.
- `--chua-xong`: chỉ xuất việc chưa xong. Các cờ có thể đứng theo thứ tự bất kỳ.
- `--out <tệp>`: ghi CSV ra tệp đó thay vì stdout, rồi in ra stdout đúng một dòng `Đã xuất <N> việc ra <tệp>`.
- Thiếu `--csv` (chưa hỗ trợ định dạng khác): ghi `Thiếu định dạng xuất: dùng --csv` (kèm xuống dòng) ra stderr qua `io.loi`, không in gì ra stdout, trả mã thoát 2.
- Viết phần CSV thành module dùng lại được `src/csv.mjs`, xuất `dongCsv(truong: string[]): string` (một dòng, không kèm ký tự xuống dòng) và `bangCsv(hang: string[][]): string` (cả bảng, mỗi hàng một dòng kết thúc bằng `\n`). Lệnh mới đặt ở `src/lenh/export.mjs` như các lệnh khác.
- `viec help` phải có dòng cho `export` theo cùng kiểu các dòng lệnh khác.

Test hiện có phải vẫn xanh: `node --test sandbox-projects/agent-f/js-cli-viec/test/cli.test.mjs`.
