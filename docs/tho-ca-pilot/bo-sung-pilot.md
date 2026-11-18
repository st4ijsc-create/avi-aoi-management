# Bổ sung riêng cho lượt pilot (đọc cùng AGENTS.md)

Luật chung đã ở AGENTS.md; dưới đây chỉ là phần RIÊNG của lượt pilot.

- Phạm vi: chỉ sửa/tạo đúng các tệp ở "TỆP ĐƯỢC PHÉP SỬA/TẠO" của thẻ; tệp khác chỉ ĐỌC (ghi tệp khác bị tự từ chối, không tới người duyệt).
- Mỗi lần ghi tệp là một thẻ chờ NGƯỜI duyệt, hết hạn sau 5 phút. Bị từ chối hoặc hết hạn nghĩa là tệp CHƯA được ghi: đọc lý do, đổi cách làm rồi gửi lại, đừng lặp nguyên đề xuất. Sửa tệp đang có bằng edit_file từng chỗ; không dùng write_file ghi đè cả tệp đang có.
- LỆNH KIỂM: gọi run_command với ĐÚNG nguyên văn lệnh của thẻ (không thêm tham số, không nối lệnh), tối đa 6 lần trong lượt. Kết quả tool có thể mở đầu bằng chữ "bị từ chối" rồi kèm kết quả đã TỰ CHẠY: đó là kết quả thật của lệnh kiểm, hãy đọc nó. Mọi run_command khác bị từ chối. Sửa xong thì gọi lại; chưa sửa gì thì đừng gọi lại.
- Khi bạn dừng, bộ chạy chạy lại LỆNH KIỂM và tsc -p tsconfig.tests.json trên tệp bạn đổi: vitest xanh mà tsc đỏ vẫn KHÔNG đạt.
- Việc chạm CSDL (thẻ có khoá CSDL): bạn chỉ nhận CON SỐ (mã thoát, Test Files, Tests), không có văn bản lỗi. Số ca đỏ > 0 thì đọc lại tệp bạn vừa sửa và danh sách đã duyệt trước khi sửa tiếp.
- Thẻ có TRẦN LƯỢT MODEL: đó là số lượt gọi model tối đa của bạn. Đừng tiêu lượt vào đọc lại tệp đã đọc; để dành ít nhất 2 lượt cuối cho lệnh kiểm.
- Thẻ có dòng QUY TRÌNH: làm đúng nó (vd in danh sách rồi DỪNG ngay, không gọi công cụ nào). Thẻ đã có khoá ĐÃ DUYỆT thì không in lại, làm theo đúng danh sách đó.
