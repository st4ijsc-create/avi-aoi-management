/** Đợt 12 · H1.1 — nén xuống mốc thấp: `nenLichSu({mucDich})` và công tắc `nenMocDich`. */
import { describe, expect, it } from "vitest";
import { nenLichSu, uocLuongTinNhan } from "./nguCanh";
import { nenMocDich } from "./vongAgent";
import type { TinNhan } from "./kieu";

/** system + câu hỏi + n cặp (assistant gọi read_file, tool trả 2800 ký tự = 1000 token). */
function lichSu(n: number): TinNhan[] {
  const ds: TinNhan[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
  ];
  for (let i = 0; i < n; i++) {
    ds.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${i}` }) } }] });
    ds.push({ role: "tool", tool_call_id: `c${i}`, name: "read_file", content: "x".repeat(2800) });
  }
  return ds;
}

describe("nenLichSu mucDich", () => {
  const NS = 10_000; // ngưỡng 7000 token ≈ 7 cặp
  it("không đặt mucDich ⇒ như cũ: dừng ngay khi vừa dưới ngưỡng", () => {
    const r = nenLichSu(lichSu(9), { nganSachToken: NS });
    expect(r.soNen).toBeGreaterThan(0);
    expect(r.tokenSau).toBeLessThanOrEqual(7000);
    expect(r.tokenSau).toBeGreaterThan(6000);
  });
  it("★ mucDich 0,5 ⇒ nén sâu tới ≤ 5000 token (không chỉ vừa dưới 7000)", () => {
    const r = nenLichSu(lichSu(9), { nganSachToken: NS, mucDich: 0.5 });
    expect(r.tokenSau).toBeLessThanOrEqual(5000);
    expect(r.tokenSau).toBe(uocLuongTinNhan(r.tinNhan));
  });
  it("chưa chạm ngưỡng ⇒ KHÔNG nén dù mucDich thấp (kích hoạt vẫn ở ngưỡng)", () => {
    const r = nenLichSu(lichSu(5), { nganSachToken: NS, mucDich: 0.3 });
    expect(r.soNen).toBe(0);
  });
  it("mucDich > ngưỡng bị kẹp về ngưỡng (không nén ít hơn cũ)", () => {
    const a = nenLichSu(lichSu(9), { nganSachToken: NS });
    const b = nenLichSu(lichSu(9), { nganSachToken: NS, mucDich: 0.95 });
    expect(b.tokenSau).toBe(a.tokenSau);
  });
  it("★ bước bỏ suy luận cũ cũng đi tới mucDich (không dừng ở ngưỡng)", () => {
    const vao = lichSu(9).map((m) => (m.role === "assistant" ? { ...m, reasoning_content: "r".repeat(1400) } : m));
    const nenTat = nenLichSu(vao, { nganSachToken: NS });
    const nenThap = nenLichSu(vao, { nganSachToken: NS, mucDich: 0.5 });
    expect(nenThap.tokenSau).toBeLessThan(nenTat.tokenSau);
    expect(nenThap.tokenSau).toBeLessThanOrEqual(5000);
  });
  it("bất biến giữ nguyên: system + câu hỏi + 2 lượt gần nhất nguyên văn; số tin không đổi", () => {
    const vao = lichSu(9);
    const r = nenLichSu(vao, { nganSachToken: NS, mucDich: 0.3 });
    expect(r.tinNhan.length).toBe(vao.length);
    expect(r.tinNhan.slice(0, 2)).toEqual(vao.slice(0, 2));
    expect(r.tinNhan.slice(-4)).toEqual(vao.slice(-4));
  });
});

describe("nenMocDich (công tắc host)", () => {
  it("số hợp lệ trong [0,30 ; 0,65]", () => {
    expect(nenMocDich("0.5")).toBe(0.5);
    expect(nenMocDich(" 0.45 ")).toBe(0.45);
    expect(nenMocDich(".6")).toBe(0.6);
    expect(nenMocDich("0.3")).toBe(0.3);
    expect(nenMocDich("0.65")).toBe(0.65);
  });
  it("vắng / ngoài khoảng / rác ⇒ undefined (hành vi cũ)", () => {
    for (const v of [undefined, "", "0.29", "0.66", "1", "-0.5", "abc", "0.5x", "50%", "NaN", "Infinity"]) expect(nenMocDich(v)).toBeUndefined();
  });
});
