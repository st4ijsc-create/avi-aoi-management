/**
 * ★★★ PDCA vòng 2 (Đợt D) — "còn khối `avi-tool` DỞ DANG trong văn bản cuối" + câu trình bày khi
 * vòng lặp tác nhân dừng vì HẾT TRẦN đúng lúc đó.
 *
 * Bối cảnh (đo được ở PDCA vòng 1, `pdca1-report.md`, tác vụ T09 + near-miss T03): `buocKeTiep`
 * (`vongTacNhan.ts`) dừng vòng lặp vì `het_tran` NGAY GIỮA LÚC câu trả lời cuối của model vẫn còn
 * một khối rào ```avi-tool``` CHƯA được thực thi (model xin đọc thêm/đề xuất sửa nhưng ngân sách
 * vòng đã hết). Tại điểm dừng đó, `ui/bangChat.ts` gửi `hoan_tat` với `vanBanCuoi: null` (trừ ca
 * `degraded`) — nghĩa là KHÔNG có gì thay thế đoạn văn bản đã stream token-by-token lên webview,
 * và đoạn đó vẫn còn NGUYÊN VĂN khối JSON nội bộ của giao thức `avi-tool`. Người dùng nhìn thấy
 * JSON thô thay vì một câu tiếng Việt giải thích chuyện gì xảy ra.
 *
 * Hai hàm THUẦN ở đây (không `import "vscode"`, không đọc đĩa/mạng) tách bạch hai việc:
 *   1. `conKhoiDoDang` — VỊ TỪ: văn bản này có còn khối `avi-tool` nào chưa bị xử lý không? Dùng
 *      LẠI `tachKhoiAviTool` (`khoiAviTool.ts`) — nơi DUY NHẤT biết cú pháp hàng rào; KHÔNG chép
 *      tay một regex thứ hai (đúng bài học đã ghi ở đầu `khoiAviTool.ts`).
 *   2. `vanBanHetTranConDoDang` — NHÁNH TRÌNH BÀY: nếu vị từ trên đúng, trả về câu tiếng Việt thay
 *      thế `vanBanCuoi`; nếu KHÔNG có khối dở dang, trả `null` (nghĩa là "đừng thay gì cả" — người
 *      gọi giữ nguyên hành vi CŨ, tức fallback `degradedCuoi ? traLoiCuoi : null` không đổi).
 *
 * ★ KHÔNG phải một luật DỪNG mới. `buocKeTiep` vẫn là nơi DUY NHẤT quyết định dừng/tiếp — hai hàm
 * ở đây chỉ quyết định NGƯỜI DÙNG THẤY GÌ sau khi `buocKeTiep` đã dừng vì `het_tran`. Người gọi
 * (`ui/bangChat.ts`) chỉ được phép gọi `vanBanHetTranConDoDang` khi `buoc.lyDo === "het_tran"` —
 * hai nhánh dừng còn lại (`khong_con_tool`, `nguoi_dung_dung`) KHÔNG được đổi hành vi hiện tại.
 */
import { tachKhoiAviTool } from "./khoiAviTool";

/**
 * Văn bản `vanBan` có còn ít nhất một khối rào ```avi-tool``` hợp lệ (đọc được `tool`+`args`)
 * chưa bị người gọi xử lý hay không. Dùng đúng vị từ an toàn của `tachKhoiAviTool` — bất kỳ khối
 * nào KHÔNG parse được (JSON hỏng, hàng rào mở mà không đóng, thiếu trường) đã bị `tachKhoiAviTool`
 * loại bỏ từ trước, nên KHÔNG tính là "dở dang" ở đây (không có gì để thực thi từ một khối hỏng).
 */
export function conKhoiDoDang(vanBan: string): boolean {
  return tachKhoiAviTool(vanBan).length > 0;
}

/**
 * Câu tiếng Việt để THAY cho `vanBanCuoi` (`hoan_tat`) khi vòng lặp tác nhân vừa dừng vì `het_tran`
 * VÀ câu trả lời cuối (`traLoiCuoi`) còn khối `avi-tool` dở dang — tránh lộ JSON thô ra bong bóng
 * chat của người dùng.
 *
 * Trả `null` khi KHÔNG có khối dở dang (hết trần nhưng model đã trả lời xong xuôi, không xin đọc
 * thêm gì) — người gọi PHẢI coi `null` là "giữ nguyên hành vi cũ", KHÔNG phải "hiện chuỗi rỗng".
 * Đây là lý do vì sao vòng đo lại (PDCA vòng 2) phải phủ CẢ HAI ca: hết-trần-có-khối VÀ
 * hết-trần-KHÔNG-khối, đừng thêm cảnh báo thừa cho ca sau.
 */
export function vanBanHetTranConDoDang(traLoiCuoi: string, vong: number, tran: number): string | null {
  if (!conKhoiDoDang(traLoiCuoi)) return null;
  return (
    `Đã chạm trần ${vong}/${tran} vòng đọc tự động giữa lúc câu trả lời còn dở — model đang muốn ` +
    "dùng thêm một công cụ (đọc tệp/tìm kiếm/đề xuất sửa) nhưng chưa kịp thực hiện. Câu trả lời " +
    "NÀY CHƯA hoàn tất; hỏi lại nếu bạn cần model tiếp tục."
  );
}
