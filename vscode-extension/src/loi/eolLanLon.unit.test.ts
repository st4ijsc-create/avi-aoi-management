/**
 * LƯỚI `eolLanLon` — vị từ THUẦN phát hiện tệp EOL lẫn lộn (chuỗi, không chạm VSCode/đĩa).
 *
 * ⚠⚠⚠ TÍNH CHẤT MÀ NHÓM CA NÀY KHÔNG CANH ĐƯỢC: "từ chối ⇒ đĩa không đổi" chỉ đo được bằng một
 * VSCode host THẬT — xem `test-real-host/suite/eolBom.test.ts` (ca "EOL LẪN LỘN"). Nhóm ca ở đây
 * chỉ khẳng định vị từ trả đúng `true`/`false` cho một chuỗi cho trước; nó KHÔNG chứng minh rằng
 * `ui/apBanVa.ts` thật sự gọi tới vị từ này trước khi ghi, càng không chứng minh byte trên đĩa
 * không đổi. Hai điều đó là việc của ca real-host.
 */
import { describe, it, expect } from "vitest";
import { eolLanLon } from "./eolLanLon";

describe("eolLanLon", () => {
  it("★★★ tệp EOL LẪN LỘN (CRLF xen LF) ⇒ true", () => {
    expect(eolLanLon("M1\r\nM2\nM3\r\nM4\n")).toBe(true);
  });

  it("★★★ tệp CRLF ĐỒNG NHẤT ⇒ false — KHÔNG bị chặn nhầm", () => {
    expect(eolLanLon("L1\r\nL2\r\nL3\r\n")).toBe(false);
  });

  it("★★★ tệp LF ĐỒNG NHẤT ⇒ false — KHÔNG bị chặn nhầm", () => {
    expect(eolLanLon("dong 1\ndong 2\ndong 3\n")).toBe(false);
  });

  it("★★ tệp CRLF đồng nhất nhưng THIẾU EOL cuối ⇒ vẫn false (thiếu EOL cuối không phải kiểu thứ hai)", () => {
    expect(eolLanLon("L1\r\nL2\r\nL3")).toBe(false);
  });

  it("★★ tệp LF đồng nhất nhưng THIẾU EOL cuối ⇒ vẫn false", () => {
    expect(eolLanLon("1\n2\n3")).toBe(false);
  });

  it("★★ tệp MỘT dòng, không có dấu ngắt nào ⇒ false", () => {
    expect(eolLanLon("chi mot dong, khong newline")).toBe(false);
  });

  it("★★ chuỗi RỖNG ⇒ false", () => {
    expect(eolLanLon("")).toBe(false);
  });

  it("★★★ `\\r` ĐƠN ĐỘC (không theo sau `\\n`) KHÔNG được đếm là một kiểu ngắt dòng riêng", () => {
    // "a\rb\nc\nd": chỉ có "\n" là dấu ngắt THẬT (2 lần, cùng kiểu) — "\r" ở giữa "a" và "b" là ký
    // tự thường của dòng đầu, giống hệt cách `ghepBanVa.tachDongVaNgat` xử lý.
    expect(eolLanLon("a\rb\nc\nd")).toBe(false);
  });

  it("★★★ tệp CHỈ có `\\r` đơn độc, không hề có `\\n`/`\\r\\n` ⇒ false (không có dấu ngắt THẬT nào)", () => {
    expect(eolLanLon("a\rb\rc")).toBe(false);
  });

  it("★★★ `\\r` đơn độc CỘNG THÊM cả CRLF lẫn LF thật ⇒ vẫn true (hai kiểu ngắt THẬT, không tính \\r đơn độc là kiểu thứ ba)", () => {
    expect(eolLanLon("1\r\n2\n3\r4")).toBe(true);
  });

  it("★ đúng MỘT dấu ngắt trong cả tệp (2 dòng) ⇒ false — chỉ một kiểu thì không thể lẫn lộn", () => {
    expect(eolLanLon("1\r\n2")).toBe(false);
    expect(eolLanLon("1\n2")).toBe(false);
  });
});
