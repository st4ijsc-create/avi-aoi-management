/**
 * Tách khối rào ``` ```avi-tool ``` `` … ``` ``` ``` khỏi văn bản model — MỘT nơi DUY NHẤT biết
 * cú pháp hàng rào này.
 *
 * Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action`; MỌI đề xuất (GHI lẫn ĐỌC) đến từ văn bản
 * model dưới dạng khối này. Đợt C dựng `deXuatCucBo.ts` cho hai tool GHI với một regex RIÊNG.
 * Đợt D cần thêm ba tool ĐỌC (`doc_tep`/`liet_ke`/`grep`) — KHÔNG được chép regex đó sang tệp
 * thứ hai: đó là dựng lại bản sao thứ hai của một vị từ an toàn, và đúng cái bẫy mà
 * `shared/aiCodingLoop.ts` (docblock `daBiTuChoiGhi`) đã cảnh báo — hai bản sao sẽ trôi khỏi
 * nhau, và bản LỎNG HƠN bao giờ cũng là bản đang chạy. Cả `deXuatCucBo.ts` (GHI) lẫn
 * `yeuCauDoc.ts` (ĐỌC) đều gọi `tachKhoiAviTool` ở đây; đây là nơi DUY NHẤT sửa nếu cú pháp
 * hàng rào đổi.
 *
 * ★★★ BA BÀI HỌC ĐẮT đã trả giá ở `deXuatCucBo.ts` — người sau "tối ưu" mất bất kỳ cái nào dưới
 * đây là tái tạo lại đúng lỗi đã vá:
 *   1. `JSON.parse("null")` / `("123")` / `('"x"')` / `("[1,2]")` đều là JSON HỢP LỆ ⇒ KHÔNG
 *      ném ở bước parse. Phải kiểm `typeof obj === "object" && obj !== null` TRƯỚC KHI chạm bất
 *      kỳ trường nào — chạm `obj.tool` trên `null` ném `TypeError` THOÁT RA NGOÀI vòng lặp và
 *      vứt luôn mọi khối hợp lệ đã thu được TRƯỚC khối hỏng đó trong CÙNG lượt.
 *   2. Regex hàng rào phải chấp nhận CẢ `\n` (LF) lẫn `\r\n` (CRLF) — extension chạy trên
 *      Windows, chữ model sinh có thể mang CRLF; một regex `\n` trần khiến MỌI khối trong lượt
 *      biến mất IM LẶNG (không lỗi, không cảnh báo — người dùng chỉ thấy model "trả lời suông").
 *   3. Thiếu trường / sai kiểu ⇒ BỎ QUA khối đó, KHÔNG đoán giá trị mặc định. Một đề xuất đọc
 *      sai còn tệ hơn không đọc được.
 */

const HANG_RAO = /```avi-tool\r?\n([\s\S]*?)\r?\n```/g;

export function tachKhoiAviTool(vanBan: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const ketQua: Array<{ tool: string; args: Record<string, unknown> }> = [];

  // `regex.exec` với cờ `g` đọc trạng thái `lastIndex` từ chính đối tượng regex; regex khai báo
  // ở module-scope thay vì bên trong hàm sẽ RÒ trạng thái giữa các lượt gọi. Tạo bản sao regex
  // mỗi lần gọi hàm để tránh lỗi kinh điển này.
  const rao = new RegExp(HANG_RAO.source, HANG_RAO.flags);
  let khop: RegExpExecArray | null;

  while ((khop = rao.exec(vanBan)) !== null) {
    const jsonText = khop[1];

    let obj: unknown;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      // JSON hỏng cú pháp ⇒ bỏ qua khối này, không ném — không được làm mất khối hợp lệ khác.
      continue;
    }

    // Bài học #1: `null`/số/chuỗi/mảng đều là JSON hợp lệ. Kiểm trước khi truy cập trường.
    if (!obj || typeof obj !== "object") {
      continue;
    }

    const rec = obj as Record<string, unknown>;
    if (typeof rec.tool !== "string") {
      continue;
    }
    // Giữ ĐÚNG quy ước gốc của `deXuatCucBo.ts`: object và truthy (loại null/thiếu/số/chuỗi).
    // KHÔNG loại-trừ mảng ở tầng dùng-chung này — bản gốc chưa từng làm vậy, và việc lọc theo
    // TỪNG trường cụ thể của mỗi tool (ở tầng trên) đã đủ để một `args` mảng không đi tới đâu.
    if (typeof rec.args !== "object" || !rec.args) {
      continue;
    }

    ketQua.push({ tool: rec.tool, args: rec.args as Record<string, unknown> });
  }

  return ketQua;
}
