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
