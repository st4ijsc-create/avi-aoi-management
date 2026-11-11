# bao-cao-don — báo cáo đơn hàng cho kế toán

Node thuần (ESM), không phụ thuộc ngoài. Tiền tính bằng đồng, số nguyên.

- `src/tien.mjs` — phép tính tiền dùng chung.
- `src/tongHop.mjs` — cộng dồn dòng đơn thành tổng đơn (giảm giá, VAT 8 %). Dòng trả hàng ghi số lượng âm.
- `src/xuatCsv.mjs` — xuất báo cáo CSV.
- `index.mjs` — điểm vào.

Chạy test: `node --test sandbox-projects/agent-f/js-loi-3-lop/test/baoCao.test.mjs`
