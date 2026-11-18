Báo lỗi từ kế toán, dự án sandbox-projects/agent-f/js-loi-3-lop (báo cáo đơn hàng ra CSV, Node thuần, xem README):

> Báo cáo CSV tháng này lệch 1 đồng ở mấy đơn có trả hàng, đối chiếu với sổ không khớp. Ví dụ đơn DH-102: khách mua 1 áo giá 12.345 đ có giảm 10 %, hôm sau trả lại đúng cái áo đó. Đơn này phải ra tổng 0 đ, nhưng file CSV ghi dòng `DH-102,2,-1,0,-1`. Đơn không có trả hàng thì đúng.

Yêu cầu:
- Tìm nguyên nhân và sửa TẬN GỐC: một dòng trả hàng phải đúng bằng số âm của dòng bán tương ứng ở mọi khoản (tiền sau giảm, thuế), với mọi đơn giá và mức giảm. Số của đơn không có trả hàng giữ nguyên.
- Phép tính phần trăm tiền dùng chung (giảm giá, VAT và mọi nơi khác dùng nó) phải đúng cả với số tiền âm (hoàn tiền): phần trăm của một số âm bằng đúng số âm của phần trăm số dương tương ứng; kết quả với số dương giữ nguyên. Ví dụ: 10 % của 12.345 đ là 1.235 đ thì 10 % của -12.345 đ phải là -1.235 đ.
- KHÔNG đổi định dạng CSV (phần mềm kế toán đọc theo cột).
- Thêm một tệp test hồi quy mới trong `test/` (đuôi `.test.mjs`) tái hiện đúng lỗi này: phải đỏ trên mã trước khi sửa và xanh sau khi sửa.

Test hiện có phải vẫn xanh: `node --test sandbox-projects/agent-f/js-loi-3-lop/test/baoCao.test.mjs`.
