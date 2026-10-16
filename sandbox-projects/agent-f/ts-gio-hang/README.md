# gio-hang

Giỏ hàng cho cửa hàng online (danh mục sản phẩm, giỏ, in hoá đơn).

- Viết bằng TypeScript nhưng **chạy thẳng bằng Node 24** (type stripping) — không cần `npm install`, không biên dịch.
  Vì vậy chỉ dùng cú pháp TS *xoá được*: KHÔNG `enum`, `namespace`, parameter properties (`constructor(private x)`).
  Import ghi đủ đuôi `.ts`, import kiểu dùng `import type`.
- Tiền là số nguyên VND.
- Chạy test: `node --test test/gioHang.test.ts`
