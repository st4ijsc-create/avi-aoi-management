Dự án sandbox-projects/agent-f/ts-tach-module (TypeScript chạy thẳng bằng Node 24 — type stripping, xem README): `src/donHang.ts` gom cả bốn phần nghiệp vụ vào một tệp. Hãy TÁCH nó thành các module trong thư mục mới `src/donHang/`, hành vi giữ nguyên:

1. Mỗi module xuất ĐÚNG các tên sau (giá trị lúc chạy; kiểu `type`/`interface` đi theo module của nó):
   - `src/donHang/phanTich.ts`: `LoiDinhDang`, `phanTichDong`, `phanTichDon` (cùng kiểu `LoaiHang`, `DongDon`).
   - `src/donHang/gia.ts`: `BANG_MA_GIAM`, `thanhTien`, `tamTinh`, `timMaGiam`, `tienGiam` (cùng kiểu `MaGiam`).
   - `src/donHang/thue.ts`: `THUE_SUAT`, `thueDong`, `tongThue`.
   - `src/donHang/dinhDang.ts`: `dinhDangVnd`, `tongKet`, `inHoaDon` (cùng kiểu `TongKet`).
   - `src/donHang/index.ts`: xuất lại tất cả các tên trên.
2. Thân hàm/lớp chỉ nằm ở MỘT chỗ — module của nó. `src/donHang.ts` chỉ còn các câu `export … from "./donHang/…"` (giữ đường import cũ cho người dùng); `src/index.ts` vẫn là điểm vào công khai.
3. Module trong `src/donHang/` KHÔNG import `src/donHang.ts` hay `src/index.ts`, và không import vòng lẫn nhau. Node chạy TS bằng type stripping: kiểu chỉ import bằng `import type`.
4. Thêm test cho từng module: `test/donHang/phanTich.test.ts`, `gia.test.ts`, `thue.test.ts`, `dinhDang.test.ts` — mỗi tệp ít nhất 2 ca `test(...)`, import thẳng module đó (`../../src/donHang/<tên>.ts`), và phải xanh.

Test hiện có phải vẫn xanh: `node --test sandbox-projects/agent-f/ts-tach-module/test/donHang.test.ts`.
