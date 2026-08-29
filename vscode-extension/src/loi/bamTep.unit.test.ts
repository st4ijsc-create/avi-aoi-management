/**
 * LƯỚI băm nội dung tệp — cùng vị từ máy chủ dùng để chặn TOCTOU (`applyDiff.ts` hàm `bam`,
 * `BASE_MISMATCH` ở dòng 399-404): nếu tệp trên đĩa đã đổi kể từ lúc model sinh đề xuất, phải
 * DỪNG chứ không ghi đè. Băm phải nói về BYTE THẬT trên đĩa — CRLF và LF PHẢI cho hai băm khác
 * nhau, nếu không một tệp đã đổi dòng-kết-thúc sẽ trông như chưa đổi ⇒ ghi đè mất thay đổi của
 * người dùng.
 */
import { describe, it, expect } from "vitest";
import { bamNoiDung, khopBanGoc } from "./bamTep";

describe("bamNoiDung", () => {
  it("★★★ cùng nội dung ⇒ cùng băm; khác MỘT ký tự ⇒ băm khác", () => {
    expect(bamNoiDung("hello world")).toBe(bamNoiDung("hello world"));
    expect(bamNoiDung("hello world")).not.toBe(bamNoiDung("hello worle"));
  });

  it("★★★ CRLF và LF là KHÁC nhau — KHÔNG tự chuẩn hoá dòng-kết-thúc", () => {
    expect(bamNoiDung("a\r\nb")).not.toBe(bamNoiDung("a\nb"));
  });

  it("★★ chuỗi rỗng có băm hợp lệ (sha256 hex = 64 ký tự)", () => {
    const h = bamNoiDung("");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("★ băm ỔN ĐỊNH: gọi hai lần cùng đầu vào ⇒ cùng kết quả", () => {
    const s = "nội dung có dấu tiếng Việt";
    expect(bamNoiDung(s)).toBe(bamNoiDung(s));
  });

  it("★ băm sha256 THẬT (đối chiếu giá trị đã biết của chuỗi rỗng)", () => {
    // Giá trị chuẩn sha256("") — chốt để không ai lặng lẽ đổi thuật toán băm.
    expect(bamNoiDung("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("khopBanGoc", () => {
  it("★★★ hai băm giống hệt ⇒ khớp", () => {
    const h = bamNoiDung("nội dung X");
    expect(khopBanGoc(h, h)).toBe(true);
  });

  it("★★★ hai băm khác nhau ⇒ KHÔNG khớp", () => {
    expect(khopBanGoc(bamNoiDung("A"), bamNoiDung("B"))).toBe(false);
  });

  it("★★ so khớp KHÔNG phân biệt hoa/thường của chuỗi hex (chỉ CASE của hex, không phải nội dung)", () => {
    const h = bamNoiDung("cùng một nội dung");
    expect(khopBanGoc(h.toUpperCase(), h)).toBe(true);
    expect(khopBanGoc(h, h.toUpperCase())).toBe(true);
  });
});
