# sandbox-projects — DỰ ÁN THỬ cho AI local code

Hai dự án tối giản để **kiểm chứng AI local (`/ai-coding-workspace`) code được**, mỗi cái một
stack KHÁC nhau. Chúng **cách ly** với mã sản xuất: nằm ngoài `tsconfig`/`vitest` của repo chính
(`npm run check`/`check:tests` không quét), nên AI `apply_diff` ở đây **không đụng code đang chạy**.

Mỗi demo cố ý để **2 ca test ĐỎ** = nhiệm vụ mẫu cho AI. Vòng khép kín cần chứng minh:
*đọc mã → sửa (apply_diff) → chạy test → đọc lỗi thật → sửa tiếp → test XANH.*

## `csharp-demo/` — C#, xUnit
- `dotnet test` (từ gốc repo hoặc trong thư mục). 4 xanh / 2 đỏ.
- Nhiệm vụ: sửa `src/Calculator.cs` → `Divide` ném `ArgumentException("Không chia được cho 0")`
  khi mẫu số = 0. Hai ca `Divide_ByZero_*` phải xanh.
- ⚠ Danh sách trắng lệnh cần `dotnet test <đường .sln>` (trục 1 đã thêm).

## `react-pg-demo/` — React + Express + PostgreSQL
- `npm test` = `node --test test/*.test.mjs` (logic thuần, KHÔNG cần DB chạy). 3 xanh / 2 đỏ.
- Phần postgres: `npm run setup-db` tạo database RIÊNG `demo_react_pg` (không đụng `aoi_management`),
  `npm start` chạy API tại `:4100`. `web/App.jsx` là giao diện React.
- Nhiệm vụ: sửa `src/validate.mjs` → `validateTodo` cắt khoảng trắng (`trim`), từ chối tiêu đề
  toàn khoảng trắng, và chặn tiêu đề dài quá `MAX_TITLE`. Hai ca cuối phải xanh.
- ⚠ Danh sách trắng lệnh cần `node --test <đường>` để AI chạy được test demo này.

> Đây là dữ liệu THỬ do người dựng, không phải mã sản xuất. Xoá cả thư mục `sandbox-projects/`
> bất cứ lúc nào không ảnh hưởng hệ thống.
