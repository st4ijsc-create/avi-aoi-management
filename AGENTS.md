# AGENTS.md — luật cho tác nhân lập trình (Thợ Cả, pilot, agent-f)

Repo: ST4I AOI/AVI management. TypeScript chạy trên Node; client React 19 + Vite 7 + Tailwind 4; server Express 4 + tRPC 11;
CSDL PostgreSQL qua drizzle-orm 0.44 và postgres.js 3; zod 4; vitest 2.1; typescript 5.9. Đọc phiên bản thật ở `package.json` trước khi
dùng API của thư viện. Thư mục: `server/` `client/src/` `shared/` `scripts/` `drizzle/` `tools/machine-simulator/` (C#).

## 1. Việc được làm
- CHỈ sửa/tạo tệp có trong thẻ việc hoặc yêu cầu. Tệp khác chỉ ĐỌC. Đọc mô-đun trước khi viết test.
- Chỉ import những gì mô-đun THẬT SỰ export. Không bịa hàm, tham số, tên lớp. Không rõ chữ ký: mở tệp nguồn hoặc `lookup_api`, đừng đoán.
- KHÔNG định nghĩa lại kiểu/hàm mà mô-đun đích đã export: `import type { X } from "./mo-dun"`. Kiểu tự đặt lệch kiểu thật làm `tsc` đỏ dù vitest xanh.
- Gặp hành vi của mã nguồn mà bạn cho là LỖI: BÁO trong báo cáo cuối. KHÔNG ghi lỗi đó thành kỳ vọng của test (không ghim lỗi cho xanh).
- Không tự commit, không push, không đổi `package.json` / lockfile / cấu hình vitest.

## 2. Lệnh kiểm (chạy ĐÚNG, đọc kết quả thật, báo đỏ/xanh đúng sự thật)
- Test một tệp: `npx vitest run <tệp>`. Đọc dòng `Test Files` và `Tests`; "No test files found" nghĩa là SAI TÊN tệp (xem mục 4), không phải xanh.
- Kiểu: lệnh của cổng là `npm run check:tests` (= `tsc --noEmit -p tsconfig.tests.json`, heap 12 GB; trực tiếp thì đặt `NODE_OPTIONS=--max-old-space-size=12288`); mã sản xuất: `npm run check`. Vitest xanh mà tsc đỏ vẫn KHÔNG đạt.
- i18n: `npm run i18n:check`. Khoá i18n mới phải có đủ vi / en / zh (`client/src/i18n/locales`).
- SQL/DB: chỉ CSDL `aoi_management_test`, tài khoản ứng dụng (không dùng owner `aoi`). Ca chạm DB bọc trong giao dịch ROLLBACK; không `DELETE`/`TRUNCATE`. Chưa được giao lượt `_test` thì không chạy test chạm DB.
- Structured Text (PLC): dùng tool `compile_st`; tối đa 6 lần mỗi lượt, không gọi lại khi chưa sửa gì.
- C# (`tools/machine-simulator`, `sandbox-projects`): `dotnet build -warnaserror`; test bằng `dotnet test`.

## 3. Cấm
- `.env*`, khoá, token, đường dẫn tệp khoá: không đọc, không ghi, không in.
- DB thật, `git push`, `git reset --hard`, xoá tệp ngoài phạm vi thẻ.
- Vùng cấm (không sửa, kể cả khi được nhờ): `server/services/ot/**`, mọi thứ về STOP / dừng khẩn / interlock, auth / quyền / trpc / accessControl,
  `drizzle/` và migration, `socket*`, thiết bị / PLC / OPC / MQTT / robot / scada, `.env*`.

## 4. Test
- Tên tệp phải khớp `include` của vitest: `server/**` `shared/**` `scripts/**` → `*.test.ts`; `client/src/**` → `*.unit.test.ts` hoặc `*.dom.test.tsx`; `vscode-extension/src` → `*.unit.test.ts`.
- Test thuần: KHÔNG chạm DB, mạng, đồng hồ thật, tệp ngoài thư mục tạm. Giờ thì dùng fake timers hoặc tham số giờ.
- Đồng hồ giả `vi.useFakeTimers()` phải trả lại trong `afterEach(() => vi.useRealTimers())`. KHÔNG đặt `vi.useRealTimers()` ở cuối thân ca (ca đỏ giữa chừng làm đồng hồ giả rò sang ca sau).
- Test phải KIỂM ĐƯỢC hành vi: giá trị cụ thể, ca biên, ca lỗi. Một mình `toBeDefined()` / `toBeGreaterThan(0)` là test yếu. Giá trị kỳ vọng tính tay hoặc suy từ định nghĩa, không chép lại mã nguồn.
- Không viết chữ "Pha" kèm số trong tệp test (lưới `vramPha5Gate` đếm nó).

## 5. Đặt tên & định dạng
- Định danh mới trong mã nghiệp vụ: tiếng Việt không dấu (`tinhTong`, `danhSachMay`). Tệp đã dùng tên tiếng Anh thì theo tệp đó. Chú thích tiếng Việt có dấu được.
- Tệp kết thúc dòng LF, không BOM.

## 6. Luật ngôn ngữ (lỗi hay gặp của model)
- C#: thành viên `private` của LỚP LỒNG không gọi được từ lớp ngoài (CS0122). Cần dùng chung thì khai `internal` hoặc `public`, hoặc đưa lớp ra ngoài.
  Đừng đặt bộ phân tích trong `private class` rồi gọi phương thức `private` của nó từ hàm static của lớp ngoài.
- Trả đúng tập mà đặc tả yêu cầu, không trả tập bao trùm cho "dễ tính". Nếu chú thích của chính bạn có chữ "hoặc …" bên cạnh một kết quả là bạn đang lệch đặc tả: dừng và đọc lại đề.
- Vòng lặp tự điều khiển chỉ số (`i += 1` trong từng nhánh): kiểm MỌI nhánh đều tiến chỉ số, nếu không sẽ treo. Tự chạy ca biên (chuỗi rỗng, một phần tử, kết thúc bằng xuống dòng) trước khi báo xong.

## 7. Tra cứu thêm
- Tài liệu tham khảo (bản đồ repo, DDL, tài liệu thư viện ngoài) chỉ được dùng khi tệp có thật trong `docs/ai/`. Không thấy thì KHÔNG bịa nội dung: đọc thẳng mã nguồn.
