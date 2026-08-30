/**
 * ★★★ PDCA vòng 2 (round 2, `pdca3-report.md`) — mở RỘNG bản vá hẹp của vòng trước
 * (`khoiDoDang.ts`, CHỈ xử lý ca `het_tran` + khối DỞ DANG ở vòng CUỐI cùng của vòng lặp tác nhân).
 *
 * Chấm lại 11 tác vụ baseline của PDCA vòng 1 (`pdca1-t*-raw.json`, trường `daGuiExtDayDu` — danh
 * sách ĐẦY ĐỦ message gửi cho webview, kể cả `hoan_tat`) bằng ĐÚNG logic webview thật
 * (`ui/htmlBang.ts`: `token` ⇒ nối vào `textContent`, KHÔNG có điểm nào xoá/lọc giữa các vòng nội
 * bộ; `hoan_tat.vanBanCuoi != null` ⇒ THAY HẲN) phát hiện: **5/6 tác vụ ĐẠT của vòng 1** (T01, T02,
 * T03, T08, T11 — mọi tác vụ dùng ≥2 vòng nội bộ, tức có gọi tool đọc trước khi trả lời) đều lộ
 * nguyên văn khối ```avi-tool``` ĐÃ THỰC THI (không dở dang — model đã dùng xong, loop đã chạy tool
 * và đi tiếp) ra bong bóng chat cuối cùng, vì:
 *   1. Webview tích luỹ `token` XUYÊN SUỐT toàn bộ vòng lặp (mọi vòng, không riêng vòng cuối) —
 *      không có bước nào xoá nội dung của các vòng ĐÃ XONG trước khi vòng kế tiếp bắt đầu stream.
 *   2. Vòng trước (`khoiDoDang.ts`) chỉ ghi đè `vanBanCuoi` cho ĐÚNG MỘT nhánh dừng (`het_tran` +
 *      còn khối chưa thực thi trong `traLoiCuoi`, tức vòng CUỐI). Nhánh dừng PHỔ BIẾN NHẤT —
 *      `khong_con_tool` (model tự quyết đã đủ, trả lời xong xuôi, không xin đọc thêm) — không đụng
 *      tới gì cả ⇒ `vanBanCuoi: null` ⇒ webview giữ NGUYÊN chữ đã stream thô của MỌI vòng trước đó.
 *
 * `vanBanKhongRacGiaoThuc` là hàm THUẦN (không `import "vscode"`, không đọc đĩa/mạng) nhận văn bản
 * đã (hoặc sẽ) hiển thị cho người dùng — dùng lại `xoaKhoiAviTool` (`khoiAviTool.ts`, nơi DUY NHẤT
 * biết cú pháp hàng rào ```avi-tool```, không chép cú pháp lần thứ ba) để xoá MỌI khối HỢP LỆ, rồi
 * dọn khoảng trắng thừa còn sót lại. Trả `null` khi KHÔNG có gì bị xoá (văn bản vốn đã sạch) — người
 * gọi PHẢI coi `null` là "giữ nguyên hành vi cũ", đúng quy ước đã có ở
 * `khoiDoDang.ts::vanBanHetTranConDoDang` (không phải một luật DỪNG/THỰC THI mới, chỉ là mặt TRÌNH
 * BÀY — `docYeuCauDoc`/`docDeXuatCucBo`/`tachKhoiAviTool` vẫn đọc văn bản GỐC, không đổi).
 *
 * ★ Đừng nuốt nhầm nội dung thật: `xoaKhoiAviTool` chỉ xoá khối HỢP LỆ (parse được, có `tool`+
 * `args`) — một khối ví dụ/minh hoạ mà model trích khi giải thích cú pháp NHƯNG viết kiểu "điền vào
 * chỗ trống" không parse được (vd `"args": {...}`, xem lưới cho ca cụ thể — ★ lưu ý: placeholder
 * CÓ ngoặc kép như `"<đường dẫn tệp>"` vẫn LÀ một chuỗi JSON hợp lệ, KHÔNG rơi vào nhánh an toàn
 * này), một fence NGÔN NGỮ KHÁC (```ts, ```json...), hay một câu văn xuôi chỉ NHẮC ĐẾN chữ
 * "avi-tool" đều KHÔNG bị đụng — xem lưới `khoiAviTool.unit.test.ts` (mục "NHÁNH KIA") cho ba ca cụ
 * thể, hai trong số đó lấy NGUYÊN VĂN từ dữ liệu THẬT của PDCA vòng 1 (T01, T06).
 */
import { xoaKhoiAviTool } from "./khoiAviTool";

/** Câu dự phòng — chỉ dùng khi TOÀN BỘ văn bản chỉ gồm (các) khối `avi-tool`, không còn văn xuôi
 *  nào khác sau khi xoá (chưa từng thấy ở dữ liệu thật vòng 1, nhưng không được để bong bóng RỖNG). */
const CAU_DU_PHONG_KHI_RONG =
  "Đã xử lý xong các bước cần thiết ở hậu trường (đọc tệp/tìm kiếm) — không còn nội dung nào khác để hiển thị.";

/**
 * Xoá MỌI khối ```avi-tool``` HỢP LỆ khỏi `vanBan`, dọn khoảng trắng thừa còn sót lại. Trả `null`
 * nếu KHÔNG có khối nào bị xoá (đầu ra giống hệt đầu vào) — người gọi giữ nguyên hành vi cũ.
 */
export function vanBanKhongRacGiaoThuc(vanBan: string): string | null {
  const daXoa = xoaKhoiAviTool(vanBan);
  if (daXoa === vanBan) return null;

  // Dọn khoảng trắng thừa để lại sau khi xoá khối (thường để lại ≥2 dòng trống liền nhau giữa hai
  // đoạn văn xuôi) — chỉ đổi TRÌNH BÀY, không đổi Ý. Gộp MỌI dãy ≥2 dòng trống liên tiếp thành đúng
  // 1 dòng trống; gọt khoảng trắng ở hai đầu.
  const gonGang = daXoa.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();

  return gonGang.length > 0 ? gonGang : CAU_DU_PHONG_KHI_RONG;
}
