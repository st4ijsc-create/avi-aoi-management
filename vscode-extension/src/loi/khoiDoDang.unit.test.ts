/**
 * LƯỚI cho `conKhoiDoDang` (vị từ thuần) + `vanBanHetTranConDoDang` (nhánh trình bày) — PDCA
 * vòng 2, xem docblock `khoiDoDang.ts` cho bối cảnh đầy đủ (T09 vòng 1: JSON thô lộ ra bong bóng
 * chat khi vòng lặp hết trần giữa lúc còn khối `avi-tool` dở dang).
 */
import { describe, it, expect } from "vitest";
import { conKhoiDoDang, vanBanHetTranConDoDang } from "./khoiDoDang";

const KHOI = (j: string) => "Giải thích...\n```avi-tool\n" + j + "\n```\nxong.";

describe("conKhoiDoDang", () => {
  it("★★★ văn bản có một khối avi-tool HỢP LỆ (đọc) ⇒ true", () => {
    expect(conKhoiDoDang(KHOI('{"tool":"doc_tep","args":{"path":"a"}}'))).toBe(true);
  });

  it("★★★ văn bản có một khối avi-tool HỢP LỆ (đề xuất sửa/ghi) ⇒ true — vị từ KHÔNG phân biệt đọc/ghi", () => {
    expect(conKhoiDoDang(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":1,"dongCuoi":2,"thayThe":"x"}}'))).toBe(
      true,
    );
  });

  it("★★★ văn bản KHÔNG có khối nào ⇒ false", () => {
    expect(conKhoiDoDang("Câu trả lời bình thường, không xin đọc gì thêm.")).toBe(false);
  });

  it("★★ khối JSON HỎNG cú pháp ⇒ tachKhoiAviTool đã loại bỏ ⇒ false (không có gì để coi là dở dang)", () => {
    expect(conKhoiDoDang(KHOI("{khong-phai-json}"))).toBe(false);
  });

  it("★★ hàng rào MỞ mà KHÔNG ĐÓNG (bị cắt giữa chừng bởi hết trần) ⇒ tachKhoiAviTool không khớp ⇒ false", () => {
    // Trường hợp model bị cắt NGAY GIỮA khi đang sinh khối (chưa kịp phát dấu đóng ```) — vị từ
    // dựa trên tachKhoiAviTool nên KHÔNG bắt được ca này; đây là giới hạn đã biết, không phải bug
    // của tệp này (tachKhoiAviTool vốn đã "hàng rào mở mà không đóng ⇒ bỏ qua", xem khoiAviTool.ts).
    const v = "Giải thích...\n```avi-tool\n" + '{"tool":"doc_tep","args":{"path":"a"}}';
    expect(conKhoiDoDang(v)).toBe(false);
  });

  it("★ chuỗi rỗng ⇒ false", () => {
    expect(conKhoiDoDang("")).toBe(false);
  });
});

describe("vanBanHetTranConDoDang", () => {
  it("★★★ KHÔNG có khối dở dang ⇒ null (giữ nguyên hành vi cũ, KHÔNG thêm cảnh báo thừa)", () => {
    expect(vanBanHetTranConDoDang("Đây là câu trả lời đầy đủ, hết ý.", 3, 3)).toBeNull();
  });

  it("★★★ CÓ khối dở dang ⇒ trả câu tiếng Việt, KHÔNG PHẢI null/rỗng", () => {
    const traLoi = "Để trả lời, tôi cần đọc thêm.\n" + KHOI('{"tool":"doc_tep","args":{"path":"src/A.ts"}}');
    const r = vanBanHetTranConDoDang(traLoi, 3, 3);
    expect(typeof r).toBe("string");
    expect(r).not.toBe("");
  });

  it("★★★ CHỐNG LỘ JSON THÔ — câu trả về KHÔNG chứa hàng rào ```avi-tool``` lẫn nguyên văn khối JSON", () => {
    const traLoi = "Để trả lời, tôi cần đọc thêm.\n" + KHOI('{"tool":"doc_tep","args":{"path":"src/A.ts"}}');
    const r = vanBanHetTranConDoDang(traLoi, 3, 3);
    expect(r).not.toContain("```");
    expect(r).not.toContain("avi-tool");
    expect(r).not.toContain('"tool":"doc_tep"');
    expect(r).not.toContain("src/A.ts");
  });

  it("★★ câu trả về nêu ĐÚNG số vòng/trần đã dùng (người dùng biết dừng ở đâu)", () => {
    const traLoi = KHOI('{"tool":"liet_ke","args":{"path":"src"}}');
    const r = vanBanHetTranConDoDang(traLoi, 2, 5);
    expect(r).toContain("2/5");
  });

  it("★★ câu trả về nói rõ CHƯA hoàn tất và có thể hỏi lại (nội dung tiếng Việt tối thiểu)", () => {
    const traLoi = KHOI('{"tool":"grep","args":{"mau":"x"}}');
    const r = vanBanHetTranConDoDang(traLoi, 3, 3);
    expect(r).toMatch(/chưa hoàn tất/i);
    expect(r).toMatch(/hỏi lại/i);
  });
});
