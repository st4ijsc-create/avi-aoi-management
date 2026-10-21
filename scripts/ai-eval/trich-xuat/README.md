# Bộ trích xuất MÙ — `bo-mu-2026-10-21.json`

Viết ngày **2026-10-21**. 30 bài văn bản thực tế nhà máy (phiếu bảo trì, email khách/NCC, log AOI/PLC/máy hàn, NCR, biên bản, PO, hoá đơn, báo cáo ca, tin nhắn Zalo…). Đáp án `dapAn` tính TAY theo văn bản, viết trước khi chạy bất kỳ model nào.

Cấu trúc: mảng `[{ id, vanBan, truong: [{ ten, kieu, batBuoc?, moTa }], dapAn }]`, `kieu` ∈ `chuoi | so | boolean | danh-sach`.

## Luật chấm (khớp từng trường)

- **chuoi**: so sau khi trim và gộp mọi chuỗi khoảng trắng thành một dấu cách. Phân biệt hoa/thường, TRỪ khi `moTa` nói rõ không phân biệt. Nếu `moTa` yêu cầu chuẩn hoá (ngày `YYYY-MM-DD`, giờ `HH:MM`, bỏ khoảng trắng số điện thoại…) thì đáp án đã ở dạng chuẩn hoá đó.
- **so**: so bằng giá trị số (`5` = `5.0`). Không chấp nhận chuỗi kèm đơn vị.
- **boolean**: `true`/`false` đúng kiểu.
- **danh-sach**: cùng độ dài, so từng phần tử theo thứ tự bằng luật của kiểu phần tử (chuỗi hoặc số như trên).
- **null**: thông tin không có trong văn bản ⇒ đáp án `null`; model phải trả `null` (thiếu khoá cũng tính là `null`). Trả giá trị bịa cho trường `null` = sai.
- Điểm bài = số trường đúng / số trường; điểm bộ = tổng trường đúng / tổng trường. `batBuoc` chỉ là gợi ý cho prompt, không đổi cách chấm.
