Trong dự án sandbox-projects/agent-f/ts-gio-hang (TypeScript chạy thẳng bằng Node 24, xem README của dự án), mình cần thêm mã giảm giá cho giỏ hàng:

1. Tạo module mới `src/maGiamGia.ts`, xuất kiểu `MaGiamGia` gồm hai loại:
   - theo phần trăm: `{ loai: "phan-tram", ma: string, phanTram: number, giamToiDa?: number }`
   - theo bậc: `{ loai: "bac", ma: string, bac: { tu: number, giam: number }[] }` — tạm tính ≥ `tu` của bậc nào thì được giảm `giam` của bậc CAO NHẤT đạt được (danh sách bậc có thể không sắp xếp); chưa đạt bậc nào thì giảm 0.
   và hàm `tinhGiam(ma: MaGiamGia, tamTinh: number): number`: loại phần trăm làm tròn XUỐNG tới đồng và không vượt `giamToiDa` (nếu có); `phanTram` nằm ngoài khoảng (0, 100] thì ném `RangeError`. Mọi loại: không bao giờ giảm quá tạm tính.
2. Lớp `GioHang`: thêm `apDungMa(ma: MaGiamGia)`, `boMa()`, `tamTinh()` (tổng trước giảm) và `tienGiam()`; `tongTien()` giờ trả tạm tính trừ tiền giảm. Giỏ chỉ giữ MỘT mã, áp mã mới thì thay mã cũ. Tiền giảm luôn tính theo giỏ hiện tại (thêm/bớt hàng sau khi áp mã thì tiền giảm đổi theo).
3. Hoá đơn (`inHoaDon`): khi có mã và tiền giảm > 0 thì chèn ngay trước dòng "Tổng cộng" hai dòng `Tạm tính: <tiền>` và `Giảm giá (<mã>): -<tiền>` (tiền định dạng bằng `dinhDangVnd` như các dòng khác, ví dụ `Giảm giá (GIAM10): -107.000 ₫`). Không có mã hoặc giảm 0 thì hoá đơn giữ nguyên như cũ.
4. Xuất `tinhGiam` và kiểu `MaGiamGia` từ `src/index.ts`.

Test hiện có phải vẫn xanh: `node --test sandbox-projects/agent-f/ts-gio-hang/test/gioHang.test.ts`.
