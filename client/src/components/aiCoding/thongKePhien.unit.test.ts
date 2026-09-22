/** ★ F6 — lưới cho bộ cộng chỉ số phiên. Luật đắt nhất: nghĩ không đếm được KHÔNG thành 0. */
import { describe, it, expect } from "vitest";
import { congTuChoi, congUsage, thongKeRong } from "./thongKePhien";

describe("thongKePhien", () => {
  it("rỗng: 0 lượt, tokensNghi null (không biết), 0 từ chối", () => {
    expect(thongKeRong()).toEqual({ soLuot: 0, tokensVao: 0, tokensRa: 0, tokensNghi: null, nghiKhongDo: 0, msTong: 0, soTuChoi: 0 });
  });
  it("★★ cộng hai lượt đếm được suy luận ⇒ tổng đúng từng ô", () => {
    let tk = congUsage(thongKeRong(), { tokensIn: 800, tokensOut: 4200, tokensReasoning: 3900, latencyMs: 25000 });
    tk = congUsage(tk, { tokensIn: 1200, tokensOut: 300, tokensReasoning: 0, latencyMs: 5000 });
    expect(tk).toEqual({ soLuot: 2, tokensVao: 2000, tokensRa: 4500, tokensNghi: 3900, nghiKhongDo: 0, msTong: 30000, soTuChoi: 0 });
  });
  it("★★★ lượt KHÔNG đếm được suy luận ⇒ tăng nghiKhongDo, KHÔNG cộng 0 vào tokensNghi (null giữ null)", () => {
    const tk = congUsage(thongKeRong(), { tokensIn: 10, tokensOut: 20, latencyMs: 100 });
    expect(tk.tokensNghi).toBeNull();
    expect(tk.nghiKhongDo).toBe(1);
    const tk2 = congUsage(tk, { tokensIn: 10, tokensOut: 20, tokensReasoning: 7, latencyMs: 100 });
    expect(tk2.tokensNghi).toBe(7);
    expect(tk2.nghiKhongDo).toBe(1);
  });
  it("số rác (âm/NaN) không phá tổng", () => {
    const tk = congUsage(thongKeRong(), { tokensIn: -5, tokensOut: Number.NaN, tokensReasoning: -1, latencyMs: 10 });
    expect(tk.tokensVao).toBe(0);
    expect(tk.tokensRa).toBe(0);
    expect(tk.tokensNghi).toBe(0);
  });
  it("congTuChoi chỉ tăng soTuChoi", () => {
    const tk = congTuChoi(congTuChoi(thongKeRong()));
    expect(tk.soTuChoi).toBe(2);
    expect(tk.soLuot).toBe(0);
  });
});
