import { describe, it, expect } from "vitest";
import { vanBanChoModel, menhLenhTuChoiChoModel } from "./vanBanChoModel";

describe("vanBanChoModel — kênh chữ RIÊNG cho model (G2 / P2)", () => {
  it("vắng textModel ⇒ dùng textSummary (mọi tool cũ KHÔNG đổi một byte)", () => {
    expect(vanBanChoModel({ textSummary: "12 lô NG hôm nay" })).toBe("12 lô NG hôm nay");
  });

  it("có textModel ⇒ model đọc textModel, KHÔNG đọc textSummary", () => {
    expect(vanBanChoModel({ textSummary: "câu trấn an cho người", textModel: "MỆNH LỆNH" })).toBe("MỆNH LỆNH");
  });

  it("textModel rỗng/toàn khoảng trắng ⇒ lùi về textSummary (không trả chuỗi rỗng câm)", () => {
    expect(vanBanChoModel({ textSummary: "S", textModel: "" })).toBe("S");
    expect(vanBanChoModel({ textSummary: "S", textModel: "   " })).toBe("S");
  });

  it("null/undefined ⇒ chuỗi rỗng, không ném", () => {
    expect(vanBanChoModel(null)).toBe("");
    expect(vanBanChoModel(undefined)).toBe("");
    expect(vanBanChoModel({})).toBe("");
  });
});

describe("menhLenhTuChoiChoModel — câu MỆNH LỆNH thay cho câu TRẤN AN", () => {
  const m = menhLenhTuChoiChoModel("server/routers.ts", "BUDGET_EXCEEDED", "ngân sách byte đã cạn");

  it("★ nói thẳng KHÔNG CÓ nội dung", () => {
    expect(m).toMatch(/KHÔNG có nội dung|KHÔNG trả về nội dung/);
    expect(m).toContain("server/routers.ts");
  });

  it("★ CẤM mô tả/tóm tắt/suy đoán — đây là vế chống bịa", () => {
    expect(m).toMatch(/KHÔNG ĐƯỢC/);
    expect(m).toMatch(/mô tả/);
    expect(m).toMatch(/tóm tắt/);
    expect(m).toMatch(/suy đoán/);
  });

  it("★ bảo model NÓI RA rằng chưa đọc được, kèm lý do", () => {
    expect(m).toMatch(/nói thẳng/);
    expect(m).toContain("ngân sách byte đã cạn");
  });

  it("★ mang mã máy-đọc-được", () => {
    expect(m).toContain("BUDGET_EXCEEDED");
  });

  it("★★★ TUYỆT ĐỐI không chứa cụm trấn-an — CHÍNH NÓ là nguyên nhân model bịa", () => {
    for (const cam of [
      "không phải một sự cố",
      "không phải sự cố",
      "not an error",
      "chỉ là một cái trần",
      "đây là thiết kế",
    ]) {
      expect(m.toLowerCase()).not.toContain(cam.toLowerCase());
    }
  });

  it("dùng được cho mọi mã từ chối, không chỉ BUDGET_EXCEEDED", () => {
    const s = menhLenhTuChoiChoModel(".env", "DENIED_SECRET", "tệp bí mật, hộp cát cấm đọc");
    expect(s).toContain("DENIED_SECRET");
    expect(s).toContain(".env");
    expect(s).toMatch(/KHÔNG ĐƯỢC/);
    expect(s.toLowerCase()).not.toContain("không phải sự cố");
  });
});
