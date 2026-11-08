# Luật dự án (Thợ Cả — pilot)

Repo: TypeScript (server/ client/ shared/ scripts/), kiểm bằng vitest.

## Việc của bạn
- CHỈ sửa/tạo tệp có trong thẻ việc ("TỆP ĐƯỢC PHÉP"). Mọi tệp khác chỉ ĐỌC.
- Đọc mô-đun trước khi viết test: chỉ import những gì nó THẬT SỰ export; không bịa hàm/tham số.
- KHÔNG định nghĩa lại kiểu hoặc hàm mà mô-đun đích đã export — IMPORT nó (`import type { MsaReportInput } from "./msaReport"`). Kiểu tự đặt lệch kiểu thật làm `tsc` đỏ dù vitest xanh.
- Xong thì chạy "LỆNH KIỂM" của thẻ, đọc kết quả thật, rồi báo đỏ/xanh đúng sự thật. Không tự commit.
- LỆNH KIỂM: gọi `run_command` với ĐÚNG nguyên văn lệnh của thẻ — bộ chạy TỰ chạy nó ngay (không cần người duyệt) và trả KẾT QUẢ THẬT về cho bạn trong phần lý do của thẻ. Thấy chữ "bị từ chối" kèm "bộ chạy đã TỰ CHẠY lệnh kiểm" là bình thường, không phải lỗi: đọc Test Files / Tests và đuôi đầu ra. Đỏ ⇒ sửa rồi gọi lại; không gọi lại khi chưa sửa gì. Mọi lệnh khác bị từ chối.
- Khi bạn dừng, bộ chạy chạy LẠI lệnh kiểm và `tsc --noEmit -p tsconfig.tests.json` trên tệp bạn đổi: vitest xanh mà `tsc` đỏ vẫn KHÔNG đạt.
- Gặp một hành vi của mã nguồn mà bạn nghĩ là LỖI: BÁO nó trong báo cáo cuối. KHÔNG ghi lỗi đó thành kỳ vọng của test (test không được "ghim" lỗi cho xanh).
- Thẻ có dòng QUY TRÌNH "in danh sách rồi chờ duyệt": in danh sách (đúng số dòng tối đa của thẻ) rồi DỪNG NGAY trong cùng lượt — KHÔNG gọi công cụ nào, KHÔNG viết "tôi sẽ viết ngay". Khi thẻ đã có khoá ĐÃ DUYỆT thì KHÔNG in lại danh sách; làm theo đúng danh sách đó.

## Đặt tên & kiểu
- Định danh mới trong mã nghiệp vụ: tiếng Việt không dấu (vd `tinhTong`, `danhSachMay`). Tệp đã dùng tên tiếng Anh thì theo tệp đó.
- Chú thích tiếng Việt có dấu được. Tệp kết thúc dòng LF, không BOM.
- Mọi khoá i18n mới phải có ĐỦ ba ngôn ngữ vi / en / zh (client/src/i18n/locales).

## Test
- vitest, test thuần: KHÔNG chạm DB, mạng, đồng hồ thật (dùng fake timers / tham số giờ), tệp ngoài thư mục tạm.
- Tên tệp test theo vitest `include` (sai tên = vitest "No test files found"): client/src → `*.unit.test.ts` (hoặc `*.dom.test.tsx`); server / shared / scripts → `*.test.ts`; vscode-extension/src → `*.unit.test.ts`. KHÔNG sửa vitest.config.
- Đồng hồ giả (`vi.useFakeTimers()`) phải được trả lại trong `afterEach(() => vi.useRealTimers())` — KHÔNG đặt `vi.useRealTimers()` ở cuối thân ca (ca đỏ giữa chừng sẽ làm đồng hồ giả rò sang ca sau).
- Test phải KIỂM ĐƯỢC hành vi: assert giá trị cụ thể, ca biên, ca lỗi. `expect(x).toBeDefined()` một mình là test yếu.
- Không `DELETE` / `TRUNCATE`, không dùng tài khoản owner `aoi`.

## VÙNG CẤM (không sửa, kể cả khi được nhờ)
server/services/ot/** · mọi thứ liên quan STOP / dừng khẩn / interlock · auth, quyền, trpc, accessControl · drizzle/ và migration · socket* · thiết bị / PLC / OPC / MQTT / robot / scada · .env* và bí mật.
