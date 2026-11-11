# don-hang — xử lý đơn hàng dạng văn bản

TypeScript chạy thẳng bằng Node 24 (type stripping), không phụ thuộc ngoài. Mã nguồn import nhau bằng đuôi `.ts`.

- `src/donHang.ts` — toàn bộ nghiệp vụ trong MỘT tệp: phân tích văn bản đơn, tính giá và mã giảm, thuế VAT theo loại hàng,
  định dạng tiền và in hoá đơn.
- `src/index.ts` — điểm vào công khai.

Một dòng đơn: `MA;LOAI;SO_LUONG;DON_GIA` (LOAI là `thuc-pham`, `sach` hoặc `thuong`). Dòng trống và dòng bắt đầu bằng `#` bị bỏ qua.

Chạy test: `node --test sandbox-projects/agent-f/ts-tach-module/test/donHang.test.ts`
