# Luật dự án (Thợ Cả — pilot)

Repo: TypeScript (server/ client/ shared/ scripts/), kiểm bằng vitest.

## Việc của bạn
- CHỈ sửa/tạo tệp có trong thẻ việc ("TỆP ĐƯỢC PHÉP"). Mọi tệp khác chỉ ĐỌC.
- Đọc mô-đun trước khi viết test: chỉ import những gì nó THẬT SỰ export; không bịa hàm/tham số.
- Xong thì chạy "LỆNH KIỂM" của thẻ, đọc kết quả thật, rồi báo đỏ/xanh đúng sự thật. Không tự commit.

## Đặt tên & kiểu
- Định danh mới trong mã nghiệp vụ: tiếng Việt không dấu (vd `tinhTong`, `danhSachMay`). Tệp đã dùng tên tiếng Anh thì theo tệp đó.
- Chú thích tiếng Việt có dấu được. Tệp kết thúc dòng LF, không BOM.
- Mọi khoá i18n mới phải có ĐỦ ba ngôn ngữ vi / en / zh (client/src/i18n/locales).

## Test
- vitest, test thuần: KHÔNG chạm DB, mạng, đồng hồ thật (dùng fake timers / tham số giờ), tệp ngoài thư mục tạm.
- Tên tệp test theo vitest `include` (sai tên = vitest "No test files found"): client/src → `*.unit.test.ts` (hoặc `*.dom.test.tsx`); server / shared / scripts → `*.test.ts`; vscode-extension/src → `*.unit.test.ts`. KHÔNG sửa vitest.config.
- Test phải KIỂM ĐƯỢC hành vi: assert giá trị cụ thể, ca biên, ca lỗi. `expect(x).toBeDefined()` một mình là test yếu.
- Không `DELETE` / `TRUNCATE`, không dùng tài khoản owner `aoi`.

## VÙNG CẤM (không sửa, kể cả khi được nhờ)
server/services/ot/** · mọi thứ liên quan STOP / dừng khẩn / interlock · auth, quyền, trpc, accessControl · drizzle/ và migration · socket* · thiết bị / PLC / OPC / MQTT / robot / scada · .env* và bí mật.
