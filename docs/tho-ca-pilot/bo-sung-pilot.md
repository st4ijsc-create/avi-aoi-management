# Bổ sung riêng cho lượt pilot (đọc cùng AGENTS.md)

Luật chung của dự án đã nằm ở AGENTS.md; dưới đây chỉ là phần RIÊNG của lượt pilot.

- Phạm vi: chỉ sửa/tạo đúng các tệp ở "TỆP ĐƯỢC PHÉP SỬA/TẠO" của thẻ; tệp khác chỉ ĐỌC (ghi tệp khác bị tự từ chối, không tới người duyệt).
- Mỗi lần ghi tệp là một thẻ chờ NGƯỜI duyệt, thẻ hết hạn sau 5 phút. Bị từ chối hoặc hết hạn nghĩa là tệp CHƯA được ghi: đọc lý do, đổi cách làm rồi gửi lại, đừng lặp nguyên đề xuất.
- LỆNH KIỂM: gọi `run_command` với ĐÚNG nguyên văn lệnh của thẻ (không thêm tham số, không nối lệnh). Bộ chạy tự chạy nó và trả kết quả thật; chữ "bị từ chối … đã TỰ CHẠY" là bình thường. Mọi `run_command` khác bị từ chối. Sửa xong thì gọi lại; chưa sửa gì thì đừng gọi lại.
- Khi bạn dừng, bộ chạy chạy lại LỆNH KIỂM và `tsc -p tsconfig.tests.json` trên tệp bạn đổi: vitest xanh mà `tsc` đỏ vẫn KHÔNG đạt.
- Thẻ có dòng QUY TRÌNH: làm đúng nó (vd in danh sách rồi DỪNG ngay, không gọi công cụ nào). Thẻ đã có khoá ĐÃ DUYỆT thì không in lại, làm theo đúng danh sách đó.
