import { describe, it, expect } from "vitest";
import { canDich, docBanDich, lenhDich } from "./dichTruyVan";

describe("dichTruyVan — phần thuần", () => {
  it("★ chỉ dịch câu tiếng Việt CÓ DẤU, không quá dài", () => {
    expect(canDich("Biểu đồ SPC tự làm mới sau bao lâu?", "vi")).toBe(true);
    expect(canDich("How often does SPC refresh?", "en")).toBe(false);
    expect(canDich("SPC refresh bao lau", "vi")).toBe(false); // không dấu ⇒ không có gì để dịch
    expect(canDich("", "vi")).toBe(false);
    expect(canDich("ả".repeat(301), "vi")).toBe(false);
  });
  it("★★★ bản dịch còn dấu Việt / rỗng ⇒ null (truy hồi như cũ)", () => {
    expect(docBanDich("How often does the SPC control chart refresh?")).toBe("How often does the SPC control chart refresh?");
    expect(docBanDich("English: \"What is the scrap rate target?\"\nextra")).toBe("What is the scrap rate target?");
    expect(docBanDich("Biểu đồ SPC làm mới mỗi phút")).toBeNull();
    expect(docBanDich("   \n  ")).toBeNull();
    expect(docBanDich(null)).toBeNull();
  });
  it("lệnh giữ nguyên câu hỏi", () => {
    expect(lenhDich("Máy báo E031?").nd).toContain("Máy báo E031?");
  });
});
