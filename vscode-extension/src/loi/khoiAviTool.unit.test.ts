/**
 * LƯỚI bộ tách khối rào ```avi-tool``` DÙNG CHUNG. Đây là phần đã tách ra khỏi `deXuatCucBo.ts`
 * (Đợt C) để cả parser GHI (`deXuatCucBo.ts`) và parser ĐỌC (`yeuCauDoc.ts`, Đợt D) dùng lại
 * ĐÚNG một vị từ an toàn — không phải hai bản sao trôi khỏi nhau.
 *
 * Các ca dưới đây phủ lại NGUYÊN VĂN ba bài học đắt mà `deXuatCucBo.ts` đã trả giá trước khi có
 * tệp này (xem docblock `khoiAviTool.ts`): `null`/số/chuỗi/mảng là JSON hợp lệ nhưng không phải
 * object ⇒ bỏ qua chứ KHÔNG ném; CRLF phải đọc được như LF; thiếu khối đóng ⇒ bỏ qua.
 */
import { describe, it, expect } from "vitest";
import { tachKhoiAviTool } from "./khoiAviTool";

const KHOI = (j: string) => "Giải thích...\n```avi-tool\n" + j + "\n```\nxong.";

describe("tachKhoiAviTool", () => {
  it("★★★ tách MỘT khối hợp lệ ⇒ đúng tool/args", () => {
    const r = tachKhoiAviTool(KHOI('{"tool":"doc_tep","args":{"path":"src/A.cs"}}'));
    expect(r).toEqual([{ tool: "doc_tep", args: { path: "src/A.cs" } }]);
  });

  it("★★★ JSON hỏng cú pháp ⇒ bỏ qua khối đó, KHÔNG ném", () => {
    expect(() => tachKhoiAviTool(KHOI("{khong-phai-json}"))).not.toThrow();
    expect(tachKhoiAviTool(KHOI("{khong-phai-json}"))).toEqual([]);
  });

  it("★★★ thân khối là `null` (JSON HỢP LỆ) ⇒ bỏ qua, KHÔNG ném, KHÔNG mất khối hợp lệ khác", () => {
    // JSON.parse("null") trả về null chứ không ném ⇒ try/catch quanh parse KHÔNG đủ. Chạm
    // obj.tool trên null sẽ ném TypeError THOÁT RA NGOÀI và vứt luôn mọi khối hợp lệ đã thu
    // được trước đó trong CÙNG lượt — đây là bài học đắt nhất của `deXuatCucBo.ts`.
    const v = KHOI("null") + KHOI('{"tool":"doc_tep","args":{"path":"a"}}');
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "doc_tep", args: { path: "a" } }]);
  });

  it("★★ thân khối là số / chuỗi / mảng (đều là JSON hợp lệ) ⇒ bỏ qua, không ném", () => {
    expect(tachKhoiAviTool(KHOI("123"))).toEqual([]);
    expect(tachKhoiAviTool(KHOI('"chuoi"'))).toEqual([]);
    expect(tachKhoiAviTool(KHOI("[1,2]"))).toEqual([]);
  });

  it("★★★ đầu vào CRLF (Windows) đọc được y như LF", () => {
    // Extension chạy trên Windows; chữ model sinh có thể mang \r\n. Regex `\n` trần làm MỌI
    // khối biến mất IM LẶNG cho cả lượt.
    const v = KHOI('{"tool":"doc_tep","args":{"path":"a"}}');
    expect(tachKhoiAviTool(v.replace(/\n/g, "\r\n"))).toEqual([{ tool: "doc_tep", args: { path: "a" } }]);
  });

  it("★★ NHIỀU khối trong một lượt ⇒ đọc đủ, đúng thứ tự", () => {
    const v = KHOI('{"tool":"doc_tep","args":{"path":"a"}}') + KHOI('{"tool":"liet_ke","args":{"path":"b"}}');
    expect(tachKhoiAviTool(v).map((x) => x.tool)).toEqual(["doc_tep", "liet_ke"]);
  });

  it("★★ khối hỏng KHÔNG làm mất khối hợp lệ đứng SAU nó", () => {
    const v = KHOI("{hong}") + KHOI('{"tool":"doc_tep","args":{"path":"b"}}');
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "doc_tep", args: { path: "b" } }]);
  });

  it("★★ hàng rào mở mà KHÔNG đóng ⇒ bỏ qua", () => {
    const v = "Giải thích...\n```avi-tool\n" + '{"tool":"doc_tep","args":{"path":"a"}}' + "\n(không có hàng rào đóng)";
    expect(tachKhoiAviTool(v)).toEqual([]);
  });

  it("★ văn bản không có khối nào ⇒ []", () => {
    expect(tachKhoiAviTool("chỉ là văn xuôi")).toEqual([]);
  });

  it("★★ `tool` không phải chuỗi ⇒ bỏ qua khối đó", () => {
    expect(tachKhoiAviTool(KHOI('{"tool":123,"args":{}}'))).toEqual([]);
    expect(tachKhoiAviTool(KHOI('{"args":{"path":"a"}}'))).toEqual([]);
  });

  it("★★ `args` không phải object (thiếu, null, chuỗi, số) ⇒ bỏ qua khối đó", () => {
    // Giữ ĐÚNG quy ước của `deXuatCucBo.ts` gốc: `typeof args !== "object" || !args` — loại
    // null/thiếu/số/chuỗi. KHÔNG thêm loại-trừ mảng ở tầng này (đó là kiểm riêng của từng tool
    // ĐỌC/GHI ở tầng trên, xem `yeuCauDoc.ts`/`deXuatCucBo.ts`) — tránh bịa hành vi mới ở lớp
    // dùng chung mà bản gốc chưa từng có.
    expect(tachKhoiAviTool(KHOI('{"tool":"doc_tep"}'))).toEqual([]);
    expect(tachKhoiAviTool(KHOI('{"tool":"doc_tep","args":null}'))).toEqual([]);
    expect(tachKhoiAviTool(KHOI('{"tool":"doc_tep","args":"x"}'))).toEqual([]);
    expect(tachKhoiAviTool(KHOI('{"tool":"doc_tep","args":5}'))).toEqual([]);
  });
});

/**
 * ★★★ ĐỢT D.1 (LỖI 2) — HÀNG RÀO THỤT LỀ. Đo Task 6 Step 3B: được dạy thẳng cú pháp, model lồng
 * khối vào một MỤC DANH SÁCH markdown ⇒ cả ba dòng hàng rào bị thụt (thường 3 dấu cách, khớp độ
 * rộng của "1. "). Regex cột-0 cũ khớp 0 khối cho ĐÚNG hình dạng model thật sự sinh ra.
 */
describe("tachKhoiAviTool — hàng rào THỤT LỀ (Đợt D.1, LỖI 2)", () => {
  it("★★★ hàng rào MỞ và ĐÓNG cùng thụt 3 dấu cách (mô phỏng lồng trong mục danh sách) ⇒ vẫn tách được", () => {
    // Đúng hình dạng đo được ở `t6-day-giao-thuc.txt`: "1. Đọc tệp:\n   ```avi-tool\n   {...}\n   ```".
    const v =
      "1. Đọc tệp:\n" +
      '   ```avi-tool\n   {"tool":"doc_tep","args":{"path":"src/modules/ModuleA.ts"}}\n   ```\n' +
      "xong.";
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "doc_tep", args: { path: "src/modules/ModuleA.ts" } }]);
  });

  it("★★ hàng rào MỞ thụt, ĐÓNG ở cột 0 ⇒ vẫn tách được (hai bên không cần khớp NHAU)", () => {
    const v = "  ```avi-tool\n" + '  {"tool":"liet_ke","args":{"path":"src"}}\n' + "```\nxong.";
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "liet_ke", args: { path: "src" } }]);
  });

  it("★★ hàng rào MỞ ở cột 0, ĐÓNG thụt lề ⇒ vẫn tách được", () => {
    const v = "```avi-tool\n" + '{"tool":"grep","args":{"mau":"x"}}\n' + "  ```\nxong.";
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "grep", args: { mau: "x" } }]);
  });

  it("★★★ CRLF + thụt lề CÙNG LÚC (hai bài học đắt cộng dồn) ⇒ vẫn tách được", () => {
    const v =
      ("1. Đọc tệp:\n" +
        '   ```avi-tool\n   {"tool":"doc_tep","args":{"path":"a"}}\n   ```\n' +
        "xong.").replace(/\n/g, "\r\n");
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "doc_tep", args: { path: "a" } }]);
  });

  it("★★ nội dung nhiều dòng, thụt lề LỒNG (JSON pretty-print bên trong mục danh sách) ⇒ gỡ đúng, parse đúng", () => {
    // Mỗi dòng thụt tối thiểu 3 (mức hàng rào) — các dòng bên trong JSON thụt SÂU HƠN (5) để giữ
    // định dạng pretty-print của chính JSON, phải được GIỮ NGUYÊN phần thụt riêng đó sau khi gỡ 3.
    const v =
      "1. Đọc tệp:\n" +
      "   ```avi-tool\n" +
      "   {\n" +
      '     "tool": "doc_tep",\n' +
      '     "args": { "path": "a" }\n' +
      "   }\n" +
      "   ```\n" +
      "xong.";
    expect(tachKhoiAviTool(v)).toEqual([{ tool: "doc_tep", args: { path: "a" } }]);
  });

  it("★ nhiều mục danh sách, nhiều khối thụt lề ⇒ đọc đủ, đúng thứ tự", () => {
    const v =
      "1. Đọc A:\n   ```avi-tool\n   " +
      '{"tool":"doc_tep","args":{"path":"a"}}\n   ```\n' +
      "2. Đọc B:\n   ```avi-tool\n   " +
      '{"tool":"doc_tep","args":{"path":"b"}}\n   ```\n';
    expect(tachKhoiAviTool(v).map((x) => (x.args as { path: string }).path)).toEqual(["a", "b"]);
  });

  it("★★ hàng rào giữa câu (KHÔNG đứng đầu dòng) ⇒ bỏ qua — chỉ đầu-dòng mới được coi là hàng rào thật", () => {
    // `^` + cờ `m`: một chuỗi "```avi-tool" xuất hiện giữa văn xuôi (không phải mở đầu một dòng)
    // không phải là ý định phát khối của model — tránh dương tính giả trên một câu vô tình chứa
    // đúng chuỗi đó.
    const v = 'Xem cú pháp: ```avi-tool\n{"tool":"doc_tep","args":{"path":"a"}}\n```\nxong.';
    expect(tachKhoiAviTool(v)).toEqual([]);
  });
});
