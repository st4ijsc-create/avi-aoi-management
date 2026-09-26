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
 * ★★★ BỐN BÀI HỌC ĐẮT — người sau "tối ưu" mất bất kỳ cái nào dưới đây là tái tạo lại đúng lỗi
 * đã vá (ba cái đầu trả giá ở `deXuatCucBo.ts`, cái thứ tư ở Đợt D.1 — đo LIVE, Task 6):
 *   1. `JSON.parse("null")` / `("123")` / `('"x"')` / `("[1,2]")` đều là JSON HỢP LỆ ⇒ KHÔNG
 *      ném ở bước parse. Phải kiểm `typeof obj === "object" && obj !== null` TRƯỚC KHI chạm bất
 *      kỳ trường nào — chạm `obj.tool` trên `null` ném `TypeError` THOÁT RA NGOÀI vòng lặp và
 *      vứt luôn mọi khối hợp lệ đã thu được TRƯỚC khối hỏng đó trong CÙNG lượt.
 *   2. Regex hàng rào phải chấp nhận CẢ `\n` (LF) lẫn `\r\n` (CRLF) — extension chạy trên
 *      Windows, chữ model sinh có thể mang CRLF; một regex `\n` trần khiến MỌI khối trong lượt
 *      biến mất IM LẶNG (không lỗi, không cảnh báo — người dùng chỉ thấy model "trả lời suông").
 *   3. Thiếu trường / sai kiểu ⇒ BỎ QUA khối đó, KHÔNG đoán giá trị mặc định. Một đề xuất đọc
 *      sai còn tệ hơn không đọc được.
 *   4. ★ ĐỢT D.1 — hàng rào PHẢI chấp nhận thụt lề (model được dạy giao thức thường lồng khối vào
 *      MỘT MỤC DANH SÁCH markdown, xem `dayGiaoThucDoc.ts`; đo Task 6 Step 3B: model sinh ĐÚNG
 *      JSON nhưng cả ba dòng hàng rào bị thụt 3 dấu cách ⇒ regex cột-0 cũ khớp 0 khối). Nới CẢ
 *      hàng rào MỞ lẫn ĐÓNG — nới một bên mà giữ bên kia ở cột 0 chỉ đổi hình dạng lỗi (khối mở ra
 *      được không bao giờ khớp được điểm đóng thụt lề tương ứng, kết cục vẫn là "bỏ qua" y hệt).
 */

/** Nhãn hàng rào — nguồn DUY NHẤT cho cả regex tách khối (dưới đây) LẪN văn bản dạy giao thức
 *  (`dayGiaoThucDoc.ts`, `cauHoiSuaChon.ts`). Đổi một chỗ, đổi cả nơi DẠY lẫn nơi ĐỌC — không có
 *  bản chép tay cú pháp hàng rào nào được phép tồn tại ở nơi khác. */
export const NHAN_HANG_RAO = "avi-tool";

const HANG_RAO = new RegExp(
  // Hàng rào MỞ: cho phép thụt lề bằng dấu cách/tab ở ĐẦU DÒNG (bài học #4) — `^` + cờ `m` đòi nó
  // đứng đầu MỘT DÒNG (không phải giữa câu), giữ NGUYÊN vị trí bắt của mọi ca lưới cũ (hàng rào
  // luôn đứng ngay sau `\n` trong helper `KHOI` của lưới).
  `^([ \\t]*)\`\`\`${NHAN_HANG_RAO}\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*\`\`\``,
  "gm",
);

/**
 * Gỡ thụt lề `thut` (chuỗi khoảng trắng bắt được ở hàng rào MỞ) khỏi đầu MỖI dòng của `noiDung`.
 * Dòng có ÍT hơn `thut` khoảng trắng ở đầu thì gỡ hết phần khoảng trắng nó CÓ (không cắt lẹm vào
 * ký tự không phải khoảng trắng) — tránh trường hợp một dòng thụt NÔNG hơn hàng rào mở (hiếm,
 * nhưng an toàn hơn là giả định mọi dòng thụt ĐỀU) bị cắt sai.
 */
function goThutLe(noiDung: string, thut: string): string {
  if (thut.length === 0) return noiDung;
  return noiDung
    .split(/\r?\n/)
    .map((dong) => (dong.startsWith(thut) ? dong.slice(thut.length) : dong.replace(/^[ \t]*/, "")))
    .join("\n");
}

/**
 * Phân tích PHẦN THÂN (đã gỡ thụt lề) của MỘT khối — dùng CHUNG cho cả tách (`tachKhoiAviTool`)
 * LẪN xoá (`xoaKhoiAviTool`, PDCA vòng 2/round 2). Tách ra đây để hai hàm đó không có hai bản sao
 * validate trôi khỏi nhau — đúng bài học đắt đã ghi ở đầu tệp này (bốn bài học, mục 1/3).
 */
function phanTichKhoi(jsonText: string): { tool: string; args: Record<string, unknown> } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    // JSON hỏng cú pháp ⇒ bỏ qua khối này, không ném — không được làm mất khối hợp lệ khác.
    return null;
  }

  // Bài học #1: `null`/số/chuỗi/mảng đều là JSON hợp lệ. Kiểm trước khi truy cập trường.
  if (!obj || typeof obj !== "object") {
    return null;
  }

  const rec = obj as Record<string, unknown>;
  if (typeof rec.tool !== "string") {
    return null;
  }
  // Giữ ĐÚNG quy ước gốc của `deXuatCucBo.ts`: object và truthy (loại null/thiếu/số/chuỗi).
  // KHÔNG loại-trừ mảng ở tầng dùng-chung này — bản gốc chưa từng làm vậy, và việc lọc theo
  // TỪNG trường cụ thể của mỗi tool (ở tầng trên) đã đủ để một `args` mảng không đi tới đâu.
  if (typeof rec.args !== "object" || !rec.args) {
    return null;
  }

  return { tool: rec.tool, args: rec.args as Record<string, unknown> };
}

export function tachKhoiAviTool(vanBan: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const ketQua: Array<{ tool: string; args: Record<string, unknown> }> = [];

  // `regex.exec` với cờ `g` đọc trạng thái `lastIndex` từ chính đối tượng regex; regex khai báo
  // ở module-scope thay vì bên trong hàm sẽ RÒ trạng thái giữa các lượt gọi. Tạo bản sao regex
  // mỗi lần gọi hàm để tránh lỗi kinh điển này.
  const rao = new RegExp(HANG_RAO.source, HANG_RAO.flags);
  let khop: RegExpExecArray | null;

  while ((khop = rao.exec(vanBan)) !== null) {
    // Bài học #4: nội dung phải được gỡ ĐÚNG mức thụt lề của hàng rào MỞ trước khi parse — để lại
    // khoảng trắng thừa ở đầu MỖI dòng bên trong JSON vô hại cho `JSON.parse` (bỏ qua khoảng trắng
    // NGOÀI chuỗi), nhưng gỡ đúng là hành vi đáng tin cậy hơn khi `thayThe`/`modified` sau này có
    // thể mang nội dung nhiều dòng mà việc thụt lệch có thể đổi Ý (thụt bên trong một chuỗi JSON
    // multi-dòng không hợp lệ, nhưng đây là phòng thủ chiều sâu, không phải giả định JSON luôn 1 dòng).
    const jsonText = goThutLe(khop[2], khop[1]);
    const ket = phanTichKhoi(jsonText);
    if (ket) ketQua.push(ket);
  }

  return ketQua;
}

/**
 * ★★★ PDCA vòng 2 (round 2, `pdca3-report.md`) — XOÁ khỏi `vanBan` MỌI khối rào ```avi-tool```
 * HỢP LỆ (đúng vị từ hợp lệ mà `tachKhoiAviTool` dùng — `phanTichKhoi` ở trên: parse được, là
 * object, có `tool:string`, có `args:object`). Dùng để dọn văn bản HIỂN THỊ cho người dùng —
 * không phải một luật thực thi mới; `tachKhoiAviTool`/`docYeuCauDoc`/`docDeXuatCucBo` (thực thi
 * tool thật) hoàn toàn KHÔNG đổi, đọc `vanBan` GỐC như cũ.
 *
 * Khối HỎNG cú pháp (JSON sai, thiếu trường, hàng rào mở không đóng) KHÔNG bị đụng — `phanTichKhoi`
 * trả `null` cho ca đó nên callback dưới đây GIỮ NGUYÊN đoạn khớp được. Đây là ranh giới AN TOÀN có
 * chủ đích: một khối minh hoạ/placeholder mà model trích khi giải thích cú pháp cho người dùng hỏi
 * VỀ `avi-tool` (xem `dayGiaoThucDoc.ts`, dùng placeholder dạng `<đường dẫn tệp>` — KHÔNG phải JSON
 * hợp lệ) sẽ KHÔNG bị xoá, giữ nguyên văn xuôi hợp lệ cho người dùng.
 */
export function xoaKhoiAviTool(vanBan: string): string {
  const rao = new RegExp(HANG_RAO.source, HANG_RAO.flags);
  return vanBan.replace(rao, (khopDayDu: string, thut: string, noiDung: string) => {
    const jsonText = goThutLe(noiDung, thut);
    return phanTichKhoi(jsonText) ? "" : khopDayDu;
  });
}
