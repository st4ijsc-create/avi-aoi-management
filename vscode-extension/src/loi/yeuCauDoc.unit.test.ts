/**
 * LƯỚI parser yêu cầu ĐỌC (Đợt D) — ba tool CHỈ ĐỌC (`doc_tep`/`liet_ke`/`grep`) mà AI dùng để
 * tự đọc mã trong workspace TRƯỚC khi đề xuất sửa. Dùng CHUNG `tachKhoiAviTool` với
 * `deXuatCucBo.ts` (xem docblock `khoiAviTool.ts`) — không phải một bản sao regex thứ hai.
 *
 * ⚠ Hai parser KHÔNG giẫm chân nhau: tool GHI (`de_xuat_sua`/`de_xuat_sua_doan`) là việc của
 * `deXuatCucBo.ts`, KHÔNG lọt vào đây; tool ĐỌC không lọt vào `deXuatCucBo.ts` (đã canh ở ca
 * "tool KHÁC" của tệp đó).
 */
import { describe, it, expect } from "vitest";
import { docYeuCauDoc } from "./yeuCauDoc";

const KHOI = (j: string) => "Giải thích...\n```avi-tool\n" + j + "\n```\nxong.";

describe("docYeuCauDoc", () => {
  it("★★★ đọc doc_tep", () => {
    const r = docYeuCauDoc(KHOI('{"tool":"doc_tep","args":{"path":"src/A.cs"}}'));
    expect(r).toEqual([{ loai: "doc_tep", path: "src/A.cs" }]);
  });

  it("★★★ đọc liet_ke", () => {
    const r = docYeuCauDoc(KHOI('{"tool":"liet_ke","args":{"path":"src"}}'));
    expect(r).toEqual([{ loai: "liet_ke", path: "src" }]);
  });

  it("★★★ đọc grep KHÔNG có path (tuỳ chọn)", () => {
    const r = docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":"TODO"}}'));
    expect(r).toEqual([{ loai: "grep", mau: "TODO" }]);
  });

  it("★★★ đọc grep CÓ path (tuỳ chọn) ⇒ cả hai dạng đều đọc được", () => {
    const r = docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":"TODO","path":"src"}}'));
    expect(r).toEqual([{ loai: "grep", mau: "TODO", path: "src" }]);
  });

  it("★★ doc_tep thiếu `path` ⇒ bỏ qua đề xuất đó", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"doc_tep","args":{}}'))).toEqual([]);
  });

  it("★★ liet_ke thiếu `path` ⇒ bỏ qua đề xuất đó", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"liet_ke","args":{}}'))).toEqual([]);
  });

  it("★★ grep thiếu `mau` ⇒ bỏ qua đề xuất đó", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"grep","args":{"path":"src"}}'))).toEqual([]);
  });

  it("★★★ grep có `mau` là chuỗi RỖNG ⇒ bỏ qua (grep rỗng khớp mọi thứ, không phải câu hỏi)", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":""}}'))).toEqual([]);
    expect(docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":"","path":"src"}}'))).toEqual([]);
  });

  it("★★★ tool GHI (de_xuat_sua/de_xuat_sua_doan) KHÔNG lọt vào đây", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"de_xuat_sua","args":{"path":"a","modified":"x"}}'))).toEqual([]);
    expect(
      docYeuCauDoc(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":1,"dongCuoi":2,"thayThe":"x"}}')),
    ).toEqual([]);
  });

  it("★★ tool lạ khác ⇒ bỏ qua", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"khong_ton_tai","args":{"path":"a"}}'))).toEqual([]);
  });

  it("★★ sai kiểu trường (path/mau không phải chuỗi) ⇒ bỏ qua", () => {
    expect(docYeuCauDoc(KHOI('{"tool":"doc_tep","args":{"path":123}}'))).toEqual([]);
    expect(docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":123}}'))).toEqual([]);
    expect(docYeuCauDoc(KHOI('{"tool":"grep","args":{"mau":"x","path":456}}'))).toEqual([]);
  });

  it("★★ NHIỀU khối, TRỘN đọc lẫn ghi trong một lượt ⇒ chỉ đọc lại đúng phần ĐỌC, đúng thứ tự", () => {
    const v =
      KHOI('{"tool":"doc_tep","args":{"path":"a"}}') +
      KHOI('{"tool":"de_xuat_sua","args":{"path":"z","modified":"y"}}') +
      KHOI('{"tool":"liet_ke","args":{"path":"b"}}');
    expect(docYeuCauDoc(v)).toEqual([
      { loai: "doc_tep", path: "a" },
      { loai: "liet_ke", path: "b" },
    ]);
  });

  it("★ văn bản không có khối nào ⇒ []", () => {
    expect(docYeuCauDoc("chỉ là văn xuôi")).toEqual([]);
  });

  it("★★★ thân khối là `null` ⇒ bỏ qua, KHÔNG ném, KHÔNG mất khối hợp lệ khác (dùng chung khoiAviTool)", () => {
    const v = KHOI("null") + KHOI('{"tool":"doc_tep","args":{"path":"a"}}');
    expect(docYeuCauDoc(v)).toEqual([{ loai: "doc_tep", path: "a" }]);
  });

  it("★★ đầu vào CRLF đọc được y như LF (dùng chung khoiAviTool)", () => {
    const v = KHOI('{"tool":"liet_ke","args":{"path":"a"}}');
    expect(docYeuCauDoc(v.replace(/\n/g, "\r\n"))).toEqual([{ loai: "liet_ke", path: "a" }]);
  });
});
