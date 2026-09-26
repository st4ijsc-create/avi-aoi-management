import { describe, it, expect } from "vitest";
import { NGAN_SACH_NGHI_SAU, TRAN_SINH_NGHI_SAU, TRUONG_NGAN_SACH_NGHI, nganSachNghiChoLuot, tranMongMuonChoCheDo } from "./nghiSau";
import { TRAN_SINH_BIET_NGHI, tranTokenSinhMa } from "./tranTokenSinhMa";

describe("nghiSau — F3 'Nghĩ sâu'", () => {
  it("★ tên trường là thinking_budget_tokens (đo sống: reasoning_budget_tokens bị b9814 bỏ qua im lặng)", () => {
    expect(TRUONG_NGAN_SACH_NGHI).toBe("thinking_budget_tokens");
  });
  it("chỉ 'sau' + lớp nghĩ mới có ngân sách", () => {
    expect(nganSachNghiChoLuot("sinh-ma", "sau")).toBe(NGAN_SACH_NGHI_SAU);
    expect(nganSachNghiChoLuot("khoi-sua", "sau")).toBe(NGAN_SACH_NGHI_SAU);
    expect(nganSachNghiChoLuot("tao-khung", "sau")).toBe(NGAN_SACH_NGHI_SAU);
  });
  it("★★ cân bằng / nhanh / vắng ⇒ KHÔNG gửi trường (mặc định server, hành vi cũ y nguyên)", () => {
    expect(nganSachNghiChoLuot("sinh-ma", "can-bang")).toBeUndefined();
    expect(nganSachNghiChoLuot("sinh-ma", "nhanh")).toBeUndefined();
    expect(nganSachNghiChoLuot("sinh-ma")).toBeUndefined();
  });
  it("lớp phụ không nghĩ ⇒ không có ngân sách kể cả ở 'sau'", () => {
    expect(nganSachNghiChoLuot("chon-tep", "sau")).toBeUndefined();
    expect(nganSachNghiChoLuot("kb-qa", "sau")).toBeUndefined();
  });
  it("trần mong muốn: 'sau' ⇒ 32k; còn lại ⇒ undefined", () => {
    expect(tranMongMuonChoCheDo("sau")).toBe(TRAN_SINH_NGHI_SAU);
    expect(tranMongMuonChoCheDo("can-bang")).toBeUndefined();
    expect(tranMongMuonChoCheDo()).toBeUndefined();
  });
});

describe("tranTokenSinhMa — tranMongMuon", () => {
  it("model biết nghĩ + 'sau' ⇒ 32k khi ctx đủ", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 65536, tokenPrompt: 4000, modelDaTungNghi: true, tranMongMuon: TRAN_SINH_NGHI_SAU })).toBe(32_000);
  });
  it("★ vẫn bị kẹp theo ctx/slot − prompt − đệm (chỉ nới mong muốn, không nới ctx)", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 32768, tokenPrompt: 4000, modelDaTungNghi: true, tranMongMuon: TRAN_SINH_NGHI_SAU })).toBe(32768 - 4000 - 256);
  });
  it("vắng tranMongMuon ⇒ đúng 16k như cũ", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 65536, tokenPrompt: 4000, modelDaTungNghi: true })).toBe(TRAN_SINH_BIET_NGHI);
  });
  it("model KHÔNG nghĩ ⇒ bỏ qua tranMongMuon (3k như cũ)", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 65536, tokenPrompt: 4000, modelDaTungNghi: false, tranMongMuon: TRAN_SINH_NGHI_SAU })).toBe(3_000);
  });
  it("tranMongMuon rác ⇒ bỏ qua", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 65536, tokenPrompt: 0, modelDaTungNghi: true, tranMongMuon: Number.NaN })).toBe(TRAN_SINH_BIET_NGHI);
  });
});
