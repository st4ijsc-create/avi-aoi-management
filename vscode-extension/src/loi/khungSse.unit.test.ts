/**
 * LƯỚI tách khung SSE. Ca SỐNG CÒN: một khung bị CẮT ĐÔI giữa hai chunk TCP — lỗi kinh điển của
 * SSE client viết tay (chunk không bao giờ trùng ranh giới khung). Đo bằng cách gọi hai lần và
 * mang `du` sang lần sau, đúng như vòng đọc thật.
 */
import { describe, it, expect } from "vitest";
import { tachKhungSse } from "./khungSse";

describe("tachKhungSse", () => {
  it("★★★ khung TRỌN VẸN ⇒ một sự kiện, dư rỗng", () => {
    const r = tachKhungSse("", 'data: {"type":"token","text":"a"}\n\n');
    expect(r.suKien).toEqual([{ type: "token", text: "a" }]);
    expect(r.du).toBe("");
    expect(r.hong).toEqual([]);
  });

  it("★★★ khung CẮT ĐÔI giữa hai chunk ⇒ chỉ ra sự kiện ở lần thứ hai", () => {
    const a = tachKhungSse("", 'data: {"type":"tok');
    expect(a.suKien).toEqual([]);
    const b = tachKhungSse(a.du, 'en","text":"xin"}\n\n');
    expect(b.suKien).toEqual([{ type: "token", text: "xin" }]);
    expect(b.du).toBe("");
  });

  it("★★★ HAI khung trong MỘT chunk ⇒ đúng thứ tự", () => {
    const r = tachKhungSse("", 'data: {"i":1}\n\ndata: {"i":2}\n\n');
    expect(r.suKien).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("★★ CRLF (\\r\\n\\r\\n) cũng là ranh giới khung", () => {
    const r = tachKhungSse("", 'data: {"i":9}\r\n\r\n');
    expect(r.suKien).toEqual([{ i: 9 }]);
  });

  it("★★★ JSON hỏng ⇒ vào `hong`, KHÔNG ném, KHÔNG nuốt im lặng", () => {
    const r = tachKhungSse("", "data: {khong-phai-json}\n\n");
    expect(r.suKien).toEqual([]);
    expect(r.hong).toEqual(["{khong-phai-json}"]);
  });

  it("★★ dòng chú thích ': ping' bị bỏ qua", () => {
    const r = tachKhungSse("", ': ping\n\ndata: {"i":3}\n\n');
    expect(r.suKien).toEqual([{ i: 3 }]);
    expect(r.hong).toEqual([]);
  });

  it("★★ khung nhiều dòng `data:` ⇒ nối bằng \\n rồi mới parse", () => {
    const r = tachKhungSse("", 'data: {"a":\ndata: 1}\n\n');
    expect(r.suKien).toEqual([{ a: 1 }]);
  });
});
