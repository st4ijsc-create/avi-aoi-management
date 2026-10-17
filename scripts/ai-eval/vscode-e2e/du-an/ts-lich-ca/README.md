# lich-ca

Xếp lịch ca cho tổ sản xuất: ngày có 3 ca 8 giờ (`CA1`, `CA2`, `CA3`), ca 1 bắt đầu ở một giờ cấu hình được và ca có
thể vắt qua nửa đêm. Nhân viên được xếp VÒNG theo thứ tự danh sách, nối tiếp qua các ngày.

- Viết bằng TypeScript nhưng **chạy thẳng bằng Node 24** (type stripping) — không cần `npm install`, không biên dịch.
  Chỉ dùng cú pháp TS *xoá được*: KHÔNG `enum`, `namespace`, parameter properties. Import ghi đủ đuôi `.ts`, import
  kiểu dùng `import type` / `export type`.
- Ngày là chuỗi `YYYY-MM-DD`, tính theo UTC.
- `src/ca.ts` — `caCuaGio(gio, gioBatDau)`. `src/lich.ts` — `taoLich(nhanVien, tuNgay, soNgay)`, `soCaCuaNhanVien`.
  `src/index.ts` — điểm xuất công khai.
- Chạy test: `node --test test/lich.test.ts`
